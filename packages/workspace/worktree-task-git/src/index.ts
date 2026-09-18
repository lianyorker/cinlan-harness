/** Local Git worktree provider for Worktree Task lifecycle management. */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema } from '@deepseek-ai/dsh-git-settings/settings-schema'
import type { GitSourceControlSettings } from '@deepseek-ai/dsh-git-settings/types'
import type {} from '@deepseek-ai/dsh-settings'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SubprocessHandle, SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import {
  WorktreeTaskError,
  WorktreeTaskId,
  WorktreeTaskService,
} from '@deepseek-ai/dsh-worktree-task'
import type {
  ActivateTaskRequest,
  ArchiveTaskRequest,
  BindSessionRequest,
  BindSessionResult,
  CreateTaskRequest,
  DeleteTaskRequest,
  DeleteTaskResult,
  HibernateTaskRequest,
  WorktreeTask,
  WorktreeTaskHook,
  WorktreeTaskSettings,
  UpdateWorktreeTaskSettingsRequest,
  WorktreeTaskDefaults,
  WorktreeTaskReview,
  WorktreeTaskCleanupReceipt,
} from '@deepseek-ai/dsh-worktree-task'
import type { WorktreeTaskId as WorktreeTaskIdType } from '@deepseek-ai/dsh-worktree-task/types'
import { gitWorktreeTaskSpec, worktreeTaskDefaults } from './spec.ts'
import type { GitWorktreeTaskRecord } from './spec.ts'

/** Default maximum simultaneously materialized managed checkouts. */
export const DEFAULT_MAX_ACTIVE_CHECKOUTS = 8
/** Default maximum bytes captured from either Git or task-hook output stream. */
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024
/** Default upper bound for one Git command or task hook. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000
/** Default graceful process-tree termination interval. */
export const DEFAULT_GRACE_MS = 2_000

/** Deployment-controlled local Git worktree policy. */
export interface Config {
  /** Managed checkout root; omitted uses `<DSH_HOME>/worktree-tasks/v1`. */
  root?: string
  /** Harness home used only when root is omitted. */
  dshHome?: string
  /** Git executable name or path. */
  executable?: string
  /** Maximum simultaneously materialized managed checkouts. */
  maxActiveCheckouts?: number
  /** Maximum captured bytes per output stream. */
  maxOutputBytes?: number
  /** Milliseconds allowed for one Git command or task hook. */
  commandTimeoutMs?: number
  /** Milliseconds allowed for graceful subprocess termination. */
  graceMs?: number
}

interface ResolvedConfig {
  readonly root: string
  readonly executable: string
  readonly maxActiveCheckouts: number
  readonly maxOutputBytes: number
  readonly commandTimeoutMs: number
  readonly graceMs: number
}

interface CommandRequest {
  readonly cwd: string
  readonly executable: string
  readonly args: readonly string[]
  readonly signal: AbortSignal | undefined
  readonly env: NodeJS.ProcessEnv | undefined
  readonly failureCode: 'git-failed' | 'operation-failed'
  readonly label: string
}

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly exitCode: number | null
}

interface WorktreeRegistration {
  readonly path: string
  readonly branch?: string
}

interface GitConfigOverride {
  readonly key: string
  readonly value: string
}

const GIT_ENVIRONMENT_TOMBSTONES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR',
  'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_SYSTEM', 'GIT_DIR', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NAMESPACE', 'GIT_OBJECT_DIRECTORY',
  'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE', 'GIT_WORK_TREE',
] as const

const FILTER_CONFIG_PATTERN = '^filter\\..*\\.(clean|smudge|process)$'

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of GIT_ENVIRONMENT_TOMBSTONES) env[key] = undefined
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase().startsWith('GIT_')) env[key] = undefined
  }
  env.GIT_ATTR_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = '/dev/null'
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  env.GCM_INTERACTIVE = 'never'
  env.LANG = 'C'
  env.LC_ALL = 'C'
  return env
}

const pathKey = (path: string): string => {
  const normalized = resolve(path).replace(/[\\/]+$/u, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const pathIsWithin = (root: string, path: string): boolean => {
  const child = relative(root, path)
  return child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child)
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const readCollected = (reader: SubprocessOutputReader | undefined): { text: string; truncated: boolean } => {
  if (reader === undefined) throw new WorktreeTaskError('operation-failed', 'Task subprocess omitted collected output')
  const read = reader.readFrom(0)
  return { text: read.text, truncated: read.lossy }
}

/** Git-backed Worktree Task provider with durable records and bounded active checkout count. */
export class GitWorktreeTask extends WorktreeTaskService {
  static inject = ['storageDomain', 'subprocess']

  static Config: z<Config> = z.object({
    root: z.string(),
    dshHome: z.string(),
    executable: z.string().default('git'),
    maxActiveCheckouts: z.number().step(1).min(1).default(DEFAULT_MAX_ACTIVE_CHECKOUTS),
    maxOutputBytes: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_BYTES),
    commandTimeoutMs: z.number().step(1).min(1).default(DEFAULT_COMMAND_TIMEOUT_MS),
    graceMs: z.number().step(1).min(1).default(DEFAULT_GRACE_MS),
  })

  private readonly config: ResolvedConfig
  private readonly ownerCtx: Context
  private table?: KvTable<WorktreeTaskIdType, GitWorktreeTaskRecord>
  private domain?: Domain<typeof gitWorktreeTaskSpec>
  private readonly records = new Map<WorktreeTaskIdType, GitWorktreeTaskRecord>()
  private readonly sessionIndex = new Map<SessionId, WorktreeTaskIdType>()
  private operationTail: Promise<void> = Promise.resolve()
  private readonly lifetime = new AbortController()
  private managedRoot: string

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.ownerCtx = ctx
    const root = config.root ?? join(resolveDshHome(config.dshHome), 'worktree-tasks', 'v1')
    const resolved = {
      root: resolve(root),
      executable: config.executable ?? 'git',
      maxActiveCheckouts: config.maxActiveCheckouts ?? DEFAULT_MAX_ACTIVE_CHECKOUTS,
      maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      commandTimeoutMs: config.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      graceMs: config.graceMs ?? DEFAULT_GRACE_MS,
    }
    if (resolved.executable.trim().length === 0) throw new Error('worktree-task-git: executable must be non-empty')
    for (const [key, value] of Object.entries(resolved).filter(([, value]) => typeof value === 'number')) {
      if (!Number.isSafeInteger(value) || (value as number) < 1) {
        throw new Error(`worktree-task-git: ${key} must be a positive safe integer`)
      }
    }
    this.config = resolved
    this.managedRoot = resolved.root
  }

  protected async [Service.init](): Promise<void> {
    await mkdir(this.config.root, { recursive: true })
    this.managedRoot = await realpath(this.config.root)
    await mkdir(join(this.config.root, '.disabled-hooks'), { recursive: true })
    const domain = await this.ownerCtx.storageDomain.open(gitWorktreeTaskSpec)
    this.domain = domain
    const table = domain.table('tasks')
    this.table = table
    for (const [taskId, record] of table.entries()) {
      this.records.set(taskId, record)
      for (const sessionId of record.sessionIds) this.sessionIndex.set(sessionId, taskId)
    }
    this.ownerCtx.effect(() => async () => {
      this.lifetime.abort()
      await this.operationTail
      await domain.close()
    }, 'worktree-task-git.domain')
    await this.enqueue(async () => {
      for (const record of [...this.records.values()]) {
        if (record.status !== 'active' || this.cleanupNeedsAttention(record.id)) continue
        try {
          await this.hibernateRecord(record)
        } catch (error: unknown) {
          this.ownerCtx.logger.warn(
            `worktree-task-git: retained unreconciled checkout for task "${record.id}": ${String(error)}`,
          )
        }
      }
    })
  }

  async create(request: CreateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask> {
    return this.enqueue(async (signal) => {
      const defaults = this.settings().value
      this.validateDefaults(defaults)
      const sourcePath = await realpath(request.sourcePath)
      if (!(await stat(sourcePath)).isDirectory()) {
        throw new WorktreeTaskError('invalid-workspace', `workspace source is not a directory: ${sourcePath}`)
      }
      const repositoryProbe = await this.git(sourcePath, ['rev-parse', '--show-toplevel'], signal)
      if (repositoryProbe.exitCode !== 0) {
        throw new WorktreeTaskError(
          'invalid-workspace',
          repositoryProbe.stderr.trim() || `workspace is not inside a Git worktree: ${sourcePath}`,
        )
      }
      const repositoryPath = await realpath(repositoryProbe.stdout.trimEnd())
      const sourceRelative = relative(repositoryPath, sourcePath)
      if (sourceRelative === '..' || sourceRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
        || isAbsolute(sourceRelative)) {
        throw new WorktreeTaskError('invalid-workspace', `workspace is outside its reported Git root: ${sourcePath}`)
      }
      const filters = await this.filterOverrides(repositoryPath, signal)
      const statusResult = await this.git(
        repositoryPath,
        ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
        signal,
        filters,
      )
      this.assertSuccess(statusResult, 'status')
      if (statusResult.stdout.length > 0) {
        throw new WorktreeTaskError(
          'git-failed',
          `workspace "${sourcePath}" has staged, unstaged, or untracked changes; commit or stash them before creating a task`,
        )
      }
      const baseRef = request.baseRef ?? defaults.baseRef
      this.validateDefaults({ ...defaults, baseRef })
      const headResult = await this.git(repositoryPath, ['rev-parse', '--verify', '--end-of-options', baseRef + '^{commit}'], signal)
      this.assertSuccess(headResult, 'rev-parse base ref')
      const baseHead = headResult.stdout.trim()
      const branchResult = await this.git(repositoryPath, ['rev-parse', '--abbrev-ref', 'HEAD'], signal)
      this.assertSuccess(branchResult, 'rev-parse branch')
      const baseBranch = branchResult.stdout.trim()
      const id = WorktreeTaskId(randomUUID())
      const launch = {
        ...defaults,
        setup: await this.resolveHook(defaults.setup, signal),
        cleanup: await this.resolveHook(defaults.cleanup, signal),
      }
      const parent = await this.checkoutParent(defaults.defaultDirectory, false)
      const checkoutRoot = join(parent, String(id))
      for (const reserved of this.records.values()) {
        if (pathIsWithin(reserved.checkoutRoot, checkoutRoot) || pathIsWithin(checkoutRoot, reserved.checkoutRoot)) {
          throw new WorktreeTaskError('conflict', `Task checkout overlaps the reserved checkout for task "${reserved.id}": ${reserved.checkoutRoot}`)
        }
      }
      const checkoutPath = sourceRelative.length === 0 ? checkoutRoot : join(checkoutRoot, sourceRelative)
      const branch = await this.resolveCreateBranch(repositoryPath, id, signal)
      if (await exists(checkoutRoot)) {
        throw new WorktreeTaskError('conflict', `managed checkout destination already exists: ${checkoutRoot}`)
      }
      if (await this.branchExists(repositoryPath, branch, signal)) {
        throw new WorktreeTaskError('conflict', `managed task branch already exists: ${branch}`)
      }
      await this.makeCapacity(signal)
      await this.checkoutParent(defaults.defaultDirectory, true)
      const now = new Date().toISOString()
      const record: GitWorktreeTaskRecord = {
        id,
        name: request.name,
        workspaceId: request.workspaceId,
        sourcePath,
        repositoryPath,
        baseRef,
        baseBranch,
        baseHead,
        branch,
        checkoutRoot,
        checkoutPath,
        status: 'active',
        ...(request.linkedIssue === undefined ? {} : { linkedIssue: request.linkedIssue }),
        sessionIds: [],
        head: baseHead,
        launch,
        createdAt: now,
        updatedAt: now,
      }
      try {
        const add = await this.git(
          repositoryPath,
          ['worktree', 'add', '--no-track', '-b', branch, checkoutRoot, baseHead],
          signal,
          filters,
        )
        this.assertSuccess(add, 'worktree add')
        await this.runHook(record, 'setup', signal)
        await this.validateCheckoutPath(record)
        signal.throwIfAborted()
        await this.requireTable().put(id, record)
      } catch (error: unknown) {
        if (error instanceof WorktreeTaskError && error.context?.settlement === 'unknown') {
          throw new WorktreeTaskError(error.code,
            `${error.message}. Task "${id}" may retain branch "${branch}" and checkout "${checkoutRoot}"; inspect them before operator recovery.`,
            { ...error.context, cause: error, taskId: id, branch, checkoutRoot, checkoutPath })
        }
        try {
          await this.rollbackCreatedTask(record, filters)
        } catch (rollbackError: unknown) {
          throw new AggregateError([error, rollbackError],
            `could not fully roll back worktree task "${id}"; inspect branch "${branch}" and checkout "${checkoutRoot}"`)
        }
        throw error
      }
      this.records.set(id, record)
      return this.snapshot(record)
    }, requestSignal)
  }

  settings(): WorktreeTaskSettings {
    return structuredClone(this.boundResult({ ...this.requireDomain().global.get(), managedRoot: this.managedRoot }))
  }

  async updateSettings(request: UpdateWorktreeTaskSettingsRequest, requestSignal?: AbortSignal): Promise<WorktreeTaskSettings> {
    const owned = structuredClone(request)
    return this.enqueue(async (signal) => {
      const current = this.settings()
      if (!Number.isSafeInteger(owned.expectedRevision) || owned.expectedRevision !== current.revision) {
        throw new WorktreeTaskError('conflict', 'Worktree Task defaults changed; reload before saving')
      }
      const value = worktreeTaskDefaults.parse(owned.value)
      this.validateDefaults(value)
      this.boundResult({ revision: current.revision + 1, managedRoot: this.managedRoot, value })
      signal.throwIfAborted()
      await this.requireDomain().global.set({ revision: current.revision + 1, value })
      return this.settings()
    }, requestSignal)
  }

  async review(taskId: WorktreeTaskIdType, requestSignal?: AbortSignal): Promise<WorktreeTaskReview> {
    return this.enqueue(async (signal) => {
      const record = this.requireRecord(taskId)
      const ownership = await this.checkoutOwnership(record, signal)
      const head = await this.localBranchHead(record, record.branch, signal)
      if (record.status === 'active' && (!ownership.checkoutExists || !ownership.registered)) {
        throw new WorktreeTaskError('conflict', 'Task checkout is missing; restore it before reviewing active changes')
      }
      if (record.status !== 'active' && ownership.checkoutExists) {
        throw new WorktreeTaskError('conflict', 'Inactive task still has a checkout; reconcile it before review')
      }
      const active = record.status === 'active'
      const cwd = active ? record.checkoutRoot : record.repositoryPath
      const filters = await this.filterOverrides(record.repositoryPath, signal)
      const patch = await this.git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary',
        record.baseHead, ...active ? [] : [head], '--'], signal, filters)
      this.assertSuccess(patch, 'review diff')
      let dirty = false
      let untracked: string[] = []
      if (active) {
        const status = await this.git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal, filters)
        this.assertSuccess(status, 'review status')
        dirty = status.stdout.length !== 0
        const files = await this.git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'], signal, filters)
        this.assertSuccess(files, 'review untracked files')
        untracked = files.stdout.split(String.fromCharCode(0)).filter(path => path.length > 0)
      }
      if (await this.localBranchHead(record, record.branch, signal) !== head) {
        throw new WorktreeTaskError('conflict', 'Task branch changed during review; refresh the review')
      }
      const cleanupReceipt = this.receipt(taskId)
      return structuredClone(this.boundResult({ taskId, baseHead: record.baseHead, head, checkoutRoot: record.checkoutRoot,
        dirty, patch: patch.stdout, untracked, setup: record.launch?.setup ?? null, cleanup: record.launch?.cleanup ?? null,
        ...(cleanupReceipt === undefined ? {} : { cleanupReceipt }) }))
    }, requestSignal)
  }

  private boundResult<T>(value: T): T {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > this.config.maxOutputBytes) {
      throw new WorktreeTaskError('operation-failed', 'Worktree Task result exceeded the configured byte limit')
    }
    return value
  }

  private validateDefaults(value: WorktreeTaskDefaults): void {
    const directory = value.defaultDirectory
    const parts = directory.replaceAll(String.fromCharCode(92), '/').split('/')
    if (directory.length > 0 && (isAbsolute(directory) || directory.includes(':') || parts.some(part =>
      part.length === 0 || part === '.' || part === '..' || part === '.disabled-hooks' || part.includes(String.fromCharCode(0))))) {
      throw new WorktreeTaskError('invalid-path', 'Default directory must be a relative child of the managed root')
    }
    if (value.baseRef.trim().length === 0 || value.baseRef.startsWith('-') || value.baseRef.includes(String.fromCharCode(0))) {
      throw new WorktreeTaskError('invalid-path', 'The starting ref must be a nonempty Git revision, not an option')
    }
  }

  private async checkoutParent(directory: string, create: boolean): Promise<string> {
    let path = this.managedRoot
    if (pathKey(await realpath(path)) !== pathKey(path)) throw new WorktreeTaskError('conflict', 'Managed root moved')
    for (const part of directory.length === 0 ? [] : directory.replaceAll(String.fromCharCode(92), '/').split('/')) {
      path = join(path, part)
      if (!await exists(path)) {
        if (!create) continue
        await mkdir(path)
      }
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isDirectory() || pathKey(await realpath(path)) !== pathKey(path)) {
        throw new WorktreeTaskError('invalid-path', 'Default directory must not traverse a link or non-directory')
      }
    }
    return path
  }

  private async validateCheckoutPath(record: GitWorktreeTaskRecord): Promise<void> {
    let path: string
    try {
      path = await realpath(record.checkoutPath)
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      throw new WorktreeTaskError('invalid-path', `Task working directory is missing: ${record.checkoutPath}`)
    }
    if (!pathIsWithin(record.checkoutRoot, path) || !(await stat(path)).isDirectory()) {
      throw new WorktreeTaskError('invalid-path', `Task working directory must be a directory inside its checkout: ${record.checkoutPath}`)
    }
  }

  private async resolveHook(hook: WorktreeTaskHook | null, signal: AbortSignal): Promise<{ executable: string; args: string[] } | null> {
    if (hook === null) return null
    return { executable: await this.ownerCtx.subprocess.resolveExecutable(hook.executable, undefined, signal), args: [...hook.args] }
  }

  private async runHook(record: GitWorktreeTaskRecord, kind: 'setup' | 'cleanup', signal?: AbortSignal): Promise<void> {
    const hook = record.launch?.[kind]
    if (hook == null) return
    const ownership = await this.checkoutOwnership(record, signal)
    if (!ownership.checkoutExists || !ownership.registered) throw new WorktreeTaskError('conflict', 'Hook requires an owned checkout')
    await this.validateCheckoutPath(record)
    const result = await this.command({
      cwd: record.checkoutPath,
      executable: hook.executable,
      args: hook.args,
      signal,
      env: undefined,
      failureCode: 'operation-failed',
      label: kind + ' hook',
    })
    if (result.exitCode !== 0 || result.stdoutTruncated || result.stderrTruncated) {
      throw new WorktreeTaskError('operation-failed', kind + ' hook failed: ' +
        (result.stderr.trim() || (result.stdoutTruncated || result.stderrTruncated ? 'output exceeded the configured byte limit' : String(result.exitCode))))
    }
  }

  /** Resolve missing headless settings explicitly from the shared schema defaults. */
  private resolveGitSettings(): GitSourceControlSettings {
    const settings = this.ownerCtx.get('settings')
    const section = settings?.get(GIT_SETTINGS_NAMESPACE)
    if (section === undefined) return GitSourceControlSettingsSchema()
    return section as GitSourceControlSettings
  }

  /** Resolve and validate a new branch before capacity changes or worktree creation. */
  private async resolveCreateBranch(repositoryPath: string, id: WorktreeTaskIdType, signal?: AbortSignal): Promise<string> {
    const settings = this.resolveGitSettings()
    const suffix = `dsh/task/${String(id)}`
    let prefix: string
    let correction: string
    switch (settings.branchPrefix) {
      case 'none':
        return suffix
      case 'custom':
        prefix = settings.branchPrefixCustom
        correction = 'Set a non-empty valid custom branch prefix in Git settings, or choose None.'
        break
      case 'git-username':
        prefix = await this.repositoryUsername(repositoryPath, signal)
        correction = 'Set a valid repository-local github.user or user.username with git config --local, or choose another branch prefix mode.'
        break
      default:
        return assertNever(settings.branchPrefix)
    }
    const branch = prefix + (prefix.endsWith('/') ? '' : '/') + suffix
    const checked = await this.git(repositoryPath, ['check-ref-format', '--branch', branch], signal)
    if (prefix.length === 0 || checked.exitCode !== 0) {
      throw new WorktreeTaskError('git-failed', `Invalid Worktree Task branch prefix ${JSON.stringify(prefix)}. ${correction}`)
    }
    this.assertSuccess(checked, 'check-ref-format')
    return branch
  }

  private async repositoryUsername(repositoryPath: string, signal?: AbortSignal): Promise<string> {
    for (const key of ['github.user', 'user.username']) {
      const result = await this.git(repositoryPath, ['config', '--local', '--no-includes', '--get', key], signal)
      if (result.exitCode === 1 && !result.stdoutTruncated && !result.stderrTruncated) continue
      this.assertSuccess(result, `config --local --get ${key}`)
      return result.stdout.replace(/\r?\n$/u, '')
    }
    throw new WorktreeTaskError(
      'git-failed',
      'Git username branch prefix requires repository-local github.user or user.username. Set one with git config --local, or choose Custom or None in Git settings.',
    )
  }

  list(): WorktreeTask[] {
    return [...this.records.values()].map(record => this.snapshot(record))
  }

  get(taskId: WorktreeTaskIdType): WorktreeTask {
    const record = this.records.get(taskId)
    if (record === undefined) {
      throw new WorktreeTaskError('not-found', `unknown worktree task "${taskId}"`)
    }
    return this.snapshot(record)
  }

  /**
   * Bind a session to a task, activating a hibernated checkout first.
   * @param request - task and session identities.
   * @returns the task snapshot and active checkout path.
   */
  async bindSession(request: BindSessionRequest, requestSignal?: AbortSignal): Promise<BindSessionResult> {
    return this.enqueue(async (signal) => {
      let record = this.requireRecord(request.taskId)
      this.assertTaskResumable(record.id)
      if (record.status === 'archived') {
        throw new WorktreeTaskError('conflict', `cannot bind session to archived task "${request.taskId}"`)
      }
      if (record.status === 'hibernated') record = await this.activateRecord(record, signal)
      else {
        const ownership = await this.checkoutOwnership(record, signal)
        if (!ownership.checkoutExists || !ownership.registered) {
          throw new WorktreeTaskError('conflict', 'Task checkout is missing; restore it before binding a session')
        }
        await this.validateCheckoutPath(record)
      }
      if (record.sessionIds.includes(request.sessionId)) {
        return { task: this.snapshot(record), checkoutPath: record.checkoutPath }
      }
      const updated = await this.write({
        ...record,
        sessionIds: [...record.sessionIds, request.sessionId],
        updatedAt: new Date().toISOString(),
      })
      this.sessionIndex.set(request.sessionId, request.taskId)
      return { task: this.snapshot(updated), checkoutPath: updated.checkoutPath }
    }, requestSignal)
  }

  async unbindSession(taskId: WorktreeTaskIdType, sessionId: SessionId, requestSignal?: AbortSignal): Promise<WorktreeTask> {
    return this.enqueue(async () => {
      const record = this.requireRecord(taskId)
      if (!record.sessionIds.includes(sessionId)) return this.snapshot(record)
      const sessionIds = record.sessionIds.filter(id => id !== sessionId)
      const updated = await this.write({
        ...record,
        sessionIds,
        updatedAt: new Date().toISOString(),
      })
      this.sessionIndex.delete(sessionId)
      return this.snapshot(updated)
    }, requestSignal)
  }

  async activate(request: ActivateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask> {
    return this.enqueue(async (signal) => {
      const record = this.requireRecord(request.taskId)
      if (record.status === 'archived') {
        throw new WorktreeTaskError('conflict', `cannot activate archived task "${request.taskId}"`)
      }
      this.assertTaskResumable(record.id)
      return this.snapshot(await this.activateRecord(record, signal))
    }, requestSignal)
  }

  async hibernate(request: HibernateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask> {
    return this.enqueue(async (signal) => {
      const record = this.requireRecord(request.taskId)
      if (this.isBusy(record)) {
        throw new WorktreeTaskError(
          'busy',
          `cannot hibernate task "${request.taskId}" while sessions are bound`,
        )
      }
      this.assertCleanupSettled(record.id)
      if (record.status === 'archived') return this.snapshot(record)
      return this.snapshot(await this.hibernateRecord(record, signal))
    }, requestSignal)
  }

  async archive(request: ArchiveTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask> {
    return this.enqueue(async signal => this.snapshot(await this.archiveRecord(
      this.requireRecord(request.taskId), 'archive', signal,
    )), requestSignal)
  }

  async delete(request: DeleteTaskRequest, requestSignal?: AbortSignal): Promise<DeleteTaskResult> {
    return this.enqueue(async (signal) => {
      const archived = await this.archiveRecord(this.requireRecord(request.taskId), 'delete', signal)
      const cleanupReceipt = this.receipt(archived.id)
      const receipt = cleanupReceipt === undefined ? {} : { cleanupReceipt: structuredClone(cleanupReceipt) }
      const filters = await this.filterOverrides(archived.repositoryPath, signal)
      const merged = await this.git(
        archived.repositoryPath,
        ['merge-base', '--is-ancestor', `refs/heads/${archived.branch}`, `refs/heads/${archived.baseBranch}`],
        signal,
      )
      if (merged.exitCode === 1 && !merged.stdoutTruncated && !merged.stderrTruncated) {
        return { deleted: false, retainedBranch: archived.branch, ...receipt }
      }
      this.assertSuccess(merged, 'merge-base')
      const deleteBranch = await this.git(
        archived.repositoryPath, ['branch', '-d', '--', archived.branch], signal, filters,
      )
      this.assertSuccess(deleteBranch, 'branch delete')
      await this.requireTable().delete(archived.id)
      this.records.delete(archived.id)
      return { deleted: true, ...receipt }
    }, requestSignal)
  }

  private async archiveRecord(
    record: GitWorktreeTaskRecord,
    operation: 'archive' | 'delete',
    signal: AbortSignal,
  ): Promise<GitWorktreeTaskRecord> {
    if (this.isBusy(record)) {
      throw new WorktreeTaskError('busy', `cannot ${operation} task "${record.id}" while sessions are bound`)
    }
    this.assertCleanupSettled(record.id)
    if (record.status === 'archived') return record
    let current = record
    const hook = record.launch?.cleanup
    if (hook != null && this.receipt(record.id)?.status !== 'succeeded') {
      if (record.status === 'hibernated') current = await this.activateRecord(record, signal)
      signal.throwIfAborted()
      const receipt = { operation, hook, startedAt: new Date().toISOString() }
      const receipts = this.requireDomain().table('cleanup_receipts')
      await receipts.put(record.id, { ...receipt, status: 'running' })
      try {
        await this.runHook(current, 'cleanup', signal)
      } catch (error: unknown) {
        // Unobserved process exit cannot authorize another invocation, even after cancellation.
        if (!(error instanceof WorktreeTaskError && error.context?.settlement === 'unknown')) {
          try {
            await receipts.put(record.id, { ...receipt, status: 'failed', finishedAt: new Date().toISOString() })
          } catch (persistenceError: unknown) {
            throw new AggregateError([error, persistenceError], 'Cleanup failed and its settlement could not be saved; review before retrying')
          }
        }
        throw error
      }
      // A failed success write leaves the durable running claim; repeating may repeat external effects.
      await receipts.put(record.id, { ...receipt, status: 'succeeded', finishedAt: new Date().toISOString() })
    }
    signal.throwIfAborted()
    const hibernated = await this.hibernateRecord(current, signal)
    return this.write({ ...hibernated, status: 'archived', updatedAt: new Date().toISOString() })
  }

  private receipt(taskId: WorktreeTaskIdType): WorktreeTaskCleanupReceipt | undefined {
    return this.requireDomain().table('cleanup_receipts').get(taskId)
  }

  private cleanupNeedsAttention(taskId: WorktreeTaskIdType): boolean {
    const receipt = this.receipt(taskId)
    return receipt !== undefined && receipt.status !== 'succeeded'
  }

  private assertCleanupSettled(taskId: WorktreeTaskIdType): void {
    if (this.receipt(taskId)?.status === 'running') {
      throw new WorktreeTaskError('conflict', 'Cleanup has an unsettled receipt; inspect the checkout and external effects before operator recovery. It will not run again automatically.')
    }
  }

  private assertTaskResumable(taskId: WorktreeTaskIdType): void {
    this.assertCleanupSettled(taskId)
    if (this.receipt(taskId)?.status === 'succeeded') {
      throw new WorktreeTaskError('conflict', 'Task cleanup already succeeded; finish archiving or deleting the task')
    }
  }

  private snapshot(record: GitWorktreeTaskRecord): WorktreeTask {
    const { linkedIssue, ...task } = record
    const cleanupReceipt = this.receipt(record.id)
    return structuredClone({
      ...task,
      ...(linkedIssue === undefined ? {} : { linkedIssue }),
      ...(cleanupReceipt === undefined ? {} : { cleanupReceipt }),
    })
  }

  findForSession(sessionId: SessionId): WorktreeTask | undefined {
    const taskId = this.sessionIndex.get(sessionId)
    if (taskId === undefined) return undefined
    const record = this.records.get(taskId)
    return record === undefined ? undefined : this.snapshot(record)
  }

  private requireRecord(taskId: WorktreeTaskIdType): GitWorktreeTaskRecord {
    const record = this.records.get(taskId)
    if (record === undefined) {
      throw new WorktreeTaskError('not-found', `unknown worktree task "${taskId}"`)
    }
    return record
  }

  private isBusy(record: GitWorktreeTaskRecord): boolean {
    return record.sessionIds.length > 0
  }

  private async makeCapacity(signal?: AbortSignal, activating?: WorktreeTaskIdType): Promise<void> {
    while ([...this.records.values()].filter(r => r.status === 'active' && r.id !== activating).length
      >= this.config.maxActiveCheckouts) {
      signal?.throwIfAborted()
      const candidate = [...this.records.values()]
        .filter(r => r.status === 'active' && r.id !== activating && !this.isBusy(r) && !this.cleanupNeedsAttention(r.id))
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0]
      if (candidate === undefined) {
        throw new WorktreeTaskError(
          'operation-failed',
          `all ${this.config.maxActiveCheckouts} managed task checkouts are in use`,
        )
      }
      await this.hibernateRecord(candidate, signal)
    }
  }

  private async activateRecord(
    record: GitWorktreeTaskRecord,
    signal?: AbortSignal,
  ): Promise<GitWorktreeTaskRecord> {
    const ownership = await this.checkoutOwnership(record, signal)
    const head = await this.localBranchHead(record, record.branch, signal)
    if (ownership.checkoutExists && ownership.registered) {
      await this.validateCheckoutPath(record)
      return this.write({
        ...record,
        status: 'active',
        head,
        updatedAt: new Date().toISOString(),
      })
    }
    await this.makeCapacity(signal, record.id)
    const filters = await this.filterOverrides(record.repositoryPath, signal)
    if (ownership.registered) {
      const remove = await this.git(
        record.repositoryPath,
        ['worktree', 'remove', '--force', record.checkoutRoot],
        signal,
        filters,
      )
      this.assertSuccess(remove, 'worktree remove')
    }
    const add = await this.git(
      record.repositoryPath,
      ['worktree', 'add', record.checkoutRoot, record.branch],
      signal,
      filters,
    )
    this.assertSuccess(add, 'worktree add')
    try {
      await this.validateCheckoutPath(record)
    } catch (error: unknown) {
      try {
        const remove = await this.git(record.repositoryPath, ['worktree', 'remove', '--force', record.checkoutRoot], undefined, filters)
        this.assertSuccess(remove, 'rollback worktree remove')
      } catch (rollbackError: unknown) {
        throw new AggregateError([error, rollbackError], `could not validate or roll back task checkout "${record.id}"`)
      }
      throw error
    }
    return this.write({
      ...record,
      status: 'active',
      head,
      updatedAt: new Date().toISOString(),
    })
  }

  private async hibernateRecord(
    record: GitWorktreeTaskRecord,
    signal?: AbortSignal,
  ): Promise<GitWorktreeTaskRecord> {
    const ownership = await this.checkoutOwnership(record, signal)
    const filters = await this.filterOverrides(record.repositoryPath, signal)
    let head = await this.localBranchHead(record, record.branch, signal)
    if (ownership.checkoutExists) {
      const statusResult = await this.git(
        record.checkoutRoot,
        ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
        signal,
        filters,
      )
      this.assertSuccess(statusResult, 'status')
      if (statusResult.stdout.length > 0) {
        this.assertSuccess(await this.git(record.checkoutRoot, ['add', '--all'], signal, filters), 'add')
        // Checkpoint commits use a stable service identity; they are provider-owned snapshots, not user-authored commits.
        this.assertSuccess(await this.git(record.checkoutRoot, [
          '-c', 'user.name=Cinlan Harness',
          '-c', 'user.email=worktree-task@localhost',
          'commit', '--no-gpg-sign', '--no-verify', '-m', `Checkpoint worktree task ${record.id}`,
        ], signal, filters), 'commit')
      }
      const headResult = await this.git(record.checkoutRoot, ['rev-parse', '--verify', 'HEAD'], signal, filters)
      this.assertSuccess(headResult, 'rev-parse')
      head = headResult.stdout.trim()
    }
    if (ownership.registered) {
      const remove = await this.git(
        record.repositoryPath,
        ['worktree', 'remove', '--force', record.checkoutRoot],
        signal,
        filters,
      )
      this.assertSuccess(remove, 'worktree remove')
    }
    if (record.status === 'hibernated' && !ownership.checkoutExists && !ownership.registered && head === record.head) {
      return record
    }
    return this.write({ ...record, status: 'hibernated', head, updatedAt: new Date().toISOString() })
  }

  private async checkoutOwnership(
    record: GitWorktreeTaskRecord,
    signal?: AbortSignal,
  ): Promise<{ readonly checkoutExists: boolean; readonly registered: boolean }> {
    const managedRelative = relative(this.managedRoot, record.checkoutRoot)
    if (managedRelative === '' || !pathIsWithin(this.managedRoot, record.checkoutRoot)) {
      throw new WorktreeTaskError('invalid-path', `Task checkout is outside the managed root: ${record.checkoutRoot}`)
    }
    await this.checkoutParent(managedRelative, false)
    const registrations = await this.worktreeRegistrations(record.repositoryPath, signal)
    const expectedBranch = `refs/heads/${record.branch}`
    const atPath = registrations.find(candidate => pathKey(candidate.path) === pathKey(record.checkoutRoot))
    const atAnotherPath = registrations.find(candidate =>
      candidate.branch === expectedBranch && pathKey(candidate.path) !== pathKey(record.checkoutRoot))
    if (atAnotherPath !== undefined) {
      throw new WorktreeTaskError(
        'conflict',
        `managed branch "${record.branch}" is registered at an unrelated worktree: ${atAnotherPath.path}`,
      )
    }
    if (atPath !== undefined && atPath.branch !== expectedBranch) {
      throw new WorktreeTaskError(
        'conflict',
        `Git registers another branch at managed checkout path: ${record.checkoutRoot}`,
      )
    }
    const checkoutExists = await exists(record.checkoutRoot)
    if (checkoutExists && atPath === undefined) {
      throw new WorktreeTaskError(
        'conflict',
        `managed checkout path is occupied by an unrelated directory: ${record.checkoutRoot}`,
      )
    }
    return { checkoutExists, registered: atPath?.branch === expectedBranch }
  }

  private async rollbackCreatedTask(record: GitWorktreeTaskRecord, filters: readonly GitConfigOverride[]): Promise<void> {
    const ownership = await this.checkoutOwnership(record)
    if (ownership.registered) {
      const remove = await this.git(record.repositoryPath, ['worktree', 'remove', '--force', record.checkoutRoot], undefined, filters)
      this.assertSuccess(remove, 'rollback worktree remove')
    }
    if (await this.branchExists(record.repositoryPath, record.branch)) {
      const remove = await this.git(record.repositoryPath, ['branch', '-D', '--', record.branch], undefined, filters)
      this.assertSuccess(remove, 'rollback branch delete')
    }
  }

  private async branchExists(repositoryPath: string, branch: string, signal?: AbortSignal): Promise<boolean> {
    const result = await this.git(repositoryPath, ['show-ref', '--verify', '--quiet', 'refs/heads/' + branch], signal)
    if (result.exitCode === 1 && !result.stdoutTruncated && !result.stderrTruncated) return false
    this.assertSuccess(result, 'show-ref')
    return true
  }

  private async localBranchHead(
    record: GitWorktreeTaskRecord,
    branch: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.git(
      record.repositoryPath,
      ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`],
      signal,
    )
    if (result.stdoutTruncated || result.stderrTruncated) {
      throw new WorktreeTaskError('git-failed', 'git rev-parse output exceeded the configured limit')
    }
    if (result.exitCode !== 0) {
      throw new WorktreeTaskError('conflict', `managed branch is missing: ${branch}`)
    }
    return result.stdout.trim()
  }

  private async worktreeRegistrations(repositoryPath: string, signal?: AbortSignal): Promise<WorktreeRegistration[]> {
    const result = await this.git(repositoryPath, ['worktree', 'list', '--porcelain', '-z'], signal)
    this.assertSuccess(result, 'worktree list')
    const registrations: WorktreeRegistration[] = []
    let current: { path?: string; branch?: string } = {}
    for (const field of result.stdout.split('\0')) {
      if (field.length === 0) {
        if (current.path !== undefined) {
          const entry = { path: current.path, ...(current.branch === undefined ? {} : { branch: current.branch }) }
          registrations.push(entry)
        }
        current = {}
      } else if (field.startsWith('worktree ')) current.path = field.slice('worktree '.length)
      else if (field.startsWith('branch ')) current.branch = field.slice('branch '.length)
    }
    return registrations
  }

  private async filterOverrides(repositoryPath: string, signal?: AbortSignal): Promise<GitConfigOverride[]> {
    const result = await this.git(
      repositoryPath,
      ['config', '--null', '--name-only', '--get-regexp', FILTER_CONFIG_PATTERN],
      signal,
      [],
    )
    if (result.exitCode === 1 && result.stdout.length === 0 && result.stderr.length === 0) return []
    this.assertSuccess(result, 'config')
    if (result.stdout.length === 0) return []
    if (!result.stdout.endsWith('\0')) {
      throw new WorktreeTaskError('git-failed', 'git config returned an invalid filter record')
    }
    const drivers = new Set<string>()
    for (const key of result.stdout.slice(0, -1).split('\0')) {
      const driver = /^filter\.(.+)\.(?:clean|smudge|process)$/iu.exec(key)?.[1]
      if (driver === undefined || driver.length === 0 || driver.includes('=')) {
        throw new WorktreeTaskError('git-failed', 'git config returned an unsupported filter name')
      }
      drivers.add(driver)
    }
    return [...drivers].flatMap(driver => [
      { key: `filter.${driver}.clean`, value: '' },
      { key: `filter.${driver}.smudge`, value: '' },
      { key: `filter.${driver}.process`, value: '' },
      { key: `filter.${driver}.required`, value: 'false' },
    ])
  }

  private async git(
    cwd: string,
    args: readonly string[],
    requestSignal?: AbortSignal,
    overrides: readonly GitConfigOverride[] = [],
  ): Promise<CommandResult> {
    const configArgs = [
      { key: 'core.fsmonitor', value: 'false' },
      { key: 'core.hooksPath', value: join(this.config.root, '.disabled-hooks') },
      { key: 'commit.gpgSign', value: 'false' },
      ...overrides,
    ].flatMap(({ key, value }) => ['-c', key + '=' + value])
    return this.command({
      cwd,
      executable: this.config.executable,
      args: [...configArgs, ...args],
      signal: requestSignal,
      env: gitEnvironment(),
      failureCode: 'git-failed',
      label: 'Git command "' + (args[0] ?? '') + '"',
    })
  }

  private async command(request: CommandRequest): Promise<CommandResult> {
    const timeout = AbortSignal.timeout(this.config.commandTimeoutMs)
    const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout])
    let handle: SubprocessHandle
    try {
      signal.throwIfAborted()
      const executable = await this.ownerCtx.subprocess.resolveExecutable(request.executable, undefined, signal)
      signal.throwIfAborted()
      handle = this.ownerCtx.subprocess.spawn({
        argv: [executable, ...request.args],
        cwd: request.cwd,
        env: request.env,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: this.config.maxOutputBytes },
          stderr: { maxBytes: this.config.maxOutputBytes },
        },
        graceMs: this.config.graceMs,
        signal,
      })
    } catch (error: unknown) {
      request.signal?.throwIfAborted()
      throw new WorktreeTaskError(request.failureCode, 'could not start ' + request.label + ': ' + String(error), { cause: error })
    }
    const [done, treeExit] = await Promise.allSettled([handle.done, handle.waitForExit()])
    if (done.status === 'rejected' || treeExit.status === 'rejected' || !treeExit.value) {
      const failures: unknown[] = []
      if (done.status === 'rejected') failures.push(done.reason)
      if (treeExit.status === 'rejected') failures.push(treeExit.reason)
      else if (!treeExit.value) failures.push(new Error('process tree remained live'))
      throw new WorktreeTaskError(
        request.failureCode,
        request.label + ' did not settle: ' + failures.map(String).join('; '),
        { cause: failures.length === 1 ? failures[0] : new AggregateError(failures), settlement: 'unknown' },
      )
    }
    request.signal?.throwIfAborted()
    if (timeout.aborted) {
      throw new WorktreeTaskError(request.failureCode, request.label + ' timed out after ' + this.config.commandTimeoutMs + 'ms')
    }
    const stdout = readCollected(handle.collected.stdout)
    const stderr = readCollected(handle.collected.stderr)
    return {
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      exitCode: done.value.exitCode,
    }
  }

  private assertSuccess(result: CommandResult, operation: string): void {
    if (result.stdoutTruncated || result.stderrTruncated) {
      throw new WorktreeTaskError('git-failed', `git ${operation} output exceeded the configured limit`)
    }
    if (result.exitCode !== 0) {
      throw new WorktreeTaskError(
        'git-failed',
        result.stderr.trim() || `git ${operation} failed with exit code ${String(result.exitCode)}`,
      )
    }
  }

  private async write(record: GitWorktreeTaskRecord): Promise<GitWorktreeTaskRecord> {
    await this.requireTable().put(record.id, record)
    this.records.set(record.id, record)
    return record
  }

  private requireTable(): KvTable<WorktreeTaskIdType, GitWorktreeTaskRecord> {
    return this.requireDomain().table('tasks')
  }

  private requireDomain(): Domain<typeof gitWorktreeTaskSpec> {
    if (this.table === undefined || this.domain === undefined) {
      throw new WorktreeTaskError('operation-failed', 'worktree task provider is not started')
    }
    return this.domain
  }

  private enqueue<T>(operation: (signal: AbortSignal) => Promise<T>, requestSignal?: AbortSignal): Promise<T> {
    const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal])
    const result = this.operationTail.then(() => { signal.throwIfAborted(); return operation(signal) })
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

export default GitWorktreeTask
