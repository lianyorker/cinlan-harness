/** Local Git worktree provider for Worktree Task lifecycle management. */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
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
} from '@deepseek-ai/dsh-worktree-task'
import type { WorktreeTaskId as WorktreeTaskIdType } from '@deepseek-ai/dsh-worktree-task/types'
import { gitWorktreeTaskSpec } from './spec.ts'
import type { GitWorktreeTaskRecord } from './spec.ts'

/** Default maximum simultaneously materialized managed checkouts. */
export const DEFAULT_MAX_ACTIVE_CHECKOUTS = 8
/** Default maximum bytes captured from either Git output stream. */
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024
/** Default upper bound for one Git command. */
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
  /** Milliseconds allowed for one Git command. */
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
  if (reader === undefined) return { text: '', truncated: false }
  const read = reader.readFrom(0)
  return { text: read.text, truncated: read.lossy }
}

const snapshot = (record: GitWorktreeTaskRecord): WorktreeTask => {
  const { linkedIssue, ...rest } = record
  return linkedIssue === undefined ? rest : { ...rest, linkedIssue }
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
  }

  protected async [Service.init](): Promise<void> {
    await mkdir(this.config.root, { recursive: true })
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
      await this.operationTail
      await domain.close()
    }, 'worktree-task-git.domain')
    await this.enqueue(async () => {
      for (const record of [...this.records.values()]) {
        if (record.status !== 'active') continue
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

  async create(request: CreateTaskRequest): Promise<WorktreeTask> {
    return this.enqueue(async () => {
      const sourcePath = await realpath(request.sourcePath)
      if (!(await stat(sourcePath)).isDirectory()) {
        throw new WorktreeTaskError('invalid-workspace', `workspace source is not a directory: ${sourcePath}`)
      }
      await this.makeCapacity()
      const repositoryProbe = await this.git(sourcePath, ['rev-parse', '--show-toplevel'])
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
      const filters = await this.filterOverrides(repositoryPath)
      const statusResult = await this.git(
        repositoryPath,
        ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
        undefined,
        filters,
      )
      this.assertSuccess(statusResult, 'status')
      if (statusResult.stdout.length > 0) {
        throw new WorktreeTaskError(
          'git-failed',
          `workspace "${sourcePath}" has staged, unstaged, or untracked changes; commit or stash them before creating a task`,
        )
      }
      const baseRef = request.baseRef ?? 'HEAD'
      const headResult = await this.git(repositoryPath, ['rev-parse', '--verify', baseRef])
      this.assertSuccess(headResult, 'rev-parse base ref')
      const baseHead = headResult.stdout.trim()
      const branchResult = await this.git(repositoryPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      this.assertSuccess(branchResult, 'rev-parse branch')
      const baseBranch = branchResult.stdout.trim()
      const id = WorktreeTaskId(randomUUID())
      const checkoutRoot = join(this.config.root, String(id))
      const checkoutPath = sourceRelative.length === 0 ? checkoutRoot : join(checkoutRoot, sourceRelative)
      const branch = `dsh/task/${String(id)}`
      if (await exists(checkoutRoot)) {
        throw new WorktreeTaskError('conflict', `managed checkout destination already exists: ${checkoutRoot}`)
      }
      const add = await this.git(
        repositoryPath,
        ['worktree', 'add', '--no-track', '-b', branch, checkoutRoot, baseHead],
        undefined,
        filters,
      )
      this.assertSuccess(add, 'worktree add')
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
        createdAt: now,
        updatedAt: now,
      }
      try {
        await this.requireTable().put(id, record)
      } catch (error: unknown) {
        const rollback = await Promise.allSettled([
          this.git(repositoryPath, ['worktree', 'remove', '--force', checkoutRoot], undefined, filters)
            .then(result => { this.assertSuccess(result, 'rollback worktree remove') })
            .then(() => this.git(repositoryPath, ['branch', '-D', branch], undefined, filters))
            .then(result => { this.assertSuccess(result, 'rollback branch delete') }),
        ])
        const failures = rollback.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
        if (failures.length > 0) {
          throw new AggregateError([error, ...failures],
            `could not persist or fully roll back worktree task "${id}"`)
        }
        throw error
      }
      this.records.set(id, record)
      return snapshot(record)
    })
  }

  list(): WorktreeTask[] {
    return [...this.records.values()].map(snapshot)
  }

  get(taskId: WorktreeTaskIdType): WorktreeTask {
    const record = this.records.get(taskId)
    if (record === undefined) {
      throw new WorktreeTaskError('not-found', `unknown worktree task "${taskId}"`)
    }
    return snapshot(record)
  }

  /**
   * Bind a session to a task, activating a hibernated checkout first.
   * @param request - task and session identities.
   * @returns the task snapshot and active checkout path.
   */
  async bindSession(request: BindSessionRequest): Promise<BindSessionResult> {
    return this.enqueue(async () => {
      const record = this.requireRecord(request.taskId)
      if (record.sessionIds.includes(request.sessionId)) {
        return { task: snapshot(record), checkoutPath: record.checkoutPath }
      }
      if (record.status === 'hibernated') {
        await this.activateRecord(record)
      }
      if (record.status === 'archived') {
        throw new WorktreeTaskError('conflict', `cannot bind session to archived task "${request.taskId}"`)
      }
      const updated = await this.write({
        ...record,
        sessionIds: [...record.sessionIds, request.sessionId],
        updatedAt: new Date().toISOString(),
      })
      this.sessionIndex.set(request.sessionId, request.taskId)
      return { task: snapshot(updated), checkoutPath: updated.checkoutPath }
    })
  }

  async unbindSession(taskId: WorktreeTaskIdType, sessionId: SessionId): Promise<WorktreeTask> {
    return this.enqueue(async () => {
      const record = this.requireRecord(taskId)
      if (!record.sessionIds.includes(sessionId as never)) return snapshot(record)
      const sessionIds = record.sessionIds.filter(id => id !== sessionId)
      this.sessionIndex.delete(sessionId)
      const updated = await this.write({
        ...record,
        sessionIds,
        updatedAt: new Date().toISOString(),
      })
      return snapshot(updated)
    })
  }

  async activate(request: ActivateTaskRequest): Promise<WorktreeTask> {
    return this.enqueue(async () => {
      const record = this.requireRecord(request.taskId)
      if (record.status === 'archived') {
        throw new WorktreeTaskError('conflict', `cannot activate archived task "${request.taskId}"`)
      }
      return snapshot(await this.activateRecord(record))
    })
  }

  async hibernate(request: HibernateTaskRequest): Promise<WorktreeTask> {
    return this.enqueue(async () => {
      const record = this.requireRecord(request.taskId)
      if (this.isBusy(record)) {
        throw new WorktreeTaskError(
          'busy',
          `cannot hibernate task "${request.taskId}" while sessions are bound`,
        )
      }
      return snapshot(await this.hibernateRecord(record))
    })
  }

  async archive(request: ArchiveTaskRequest): Promise<WorktreeTask> {
    return this.enqueue(async () => {
      const record = this.requireRecord(request.taskId)
      if (this.isBusy(record)) {
        throw new WorktreeTaskError(
          'busy',
          `cannot archive task "${request.taskId}" while sessions are bound`,
        )
      }
      const hibernated = await this.hibernateRecord(record)
      const archived = await this.write({
        ...hibernated,
        status: 'archived',
        updatedAt: new Date().toISOString(),
      })
      return snapshot(archived)
    })
  }

  async delete(request: DeleteTaskRequest): Promise<DeleteTaskResult> {
    return this.enqueue(async () => {
      const record = this.requireRecord(request.taskId)
      if (this.isBusy(record)) {
        throw new WorktreeTaskError(
          'busy',
          `cannot delete task "${request.taskId}" while sessions are bound`,
        )
      }
      const hibernated = await this.hibernateRecord(record)
      const filters = await this.filterOverrides(hibernated.repositoryPath)
      const merged = await this.git(
        hibernated.repositoryPath,
        ['merge-base', '--is-ancestor',
          `refs/heads/${hibernated.branch}`, `refs/heads/${hibernated.baseBranch}`],
      )
      if (merged.exitCode === 1 && !merged.stdoutTruncated && !merged.stderrTruncated) {
        return { deleted: false, retainedBranch: hibernated.branch }
      }
      this.assertSuccess(merged, 'merge-base')
      const deleteBranch = await this.git(
        hibernated.repositoryPath,
        ['branch', '-d', '--', hibernated.branch],
        undefined,
        filters,
      )
      this.assertSuccess(deleteBranch, 'branch delete')
      await this.requireTable().delete(hibernated.id)
      this.records.delete(hibernated.id)
      for (const sessionId of hibernated.sessionIds) this.sessionIndex.delete(sessionId)
      return { deleted: true }
    })
  }

  findForSession(sessionId: SessionId): WorktreeTask | undefined {
    const taskId = this.sessionIndex.get(sessionId)
    if (taskId === undefined) return undefined
    const record = this.records.get(taskId)
    return record === undefined ? undefined : snapshot(record)
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
        .filter(r => r.status === 'active' && r.id !== activating && !this.isBusy(r))
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
    const timeout = AbortSignal.timeout(this.config.commandTimeoutMs)
    const signal = requestSignal === undefined ? timeout : AbortSignal.any([requestSignal, timeout])
    const configArgs = [
      { key: 'core.fsmonitor', value: 'false' },
      { key: 'core.hooksPath', value: join(this.config.root, '.disabled-hooks') },
      { key: 'commit.gpgSign', value: 'false' },
      ...overrides,
    ].flatMap(({ key, value }) => ['-c', `${key}=${value}`])
    let handle: SubprocessHandle
    try {
      signal.throwIfAborted()
      const executable = await this.ownerCtx.subprocess.resolveExecutable(this.config.executable, undefined, signal)
      signal.throwIfAborted()
      handle = this.ownerCtx.subprocess.spawn({
        argv: [executable, ...configArgs, ...args],
        cwd,
        env: gitEnvironment(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: this.config.maxOutputBytes },
          stderr: { maxBytes: this.config.maxOutputBytes },
        },
        graceMs: this.config.graceMs,
        signal,
      })
    } catch (error: unknown) {
      requestSignal?.throwIfAborted()
      throw new WorktreeTaskError('git-failed', `could not start Git command "${args[0] ?? ''}": ${String(error)}`, { cause: error })
    }
    const [done, treeExit] = await Promise.allSettled([handle.done, handle.waitForExit()])
    requestSignal?.throwIfAborted()
    if (done.status === 'rejected' || treeExit.status === 'rejected' || !treeExit.value) {
      const failures: unknown[] = []
      if (done.status === 'rejected') failures.push(done.reason)
      if (treeExit.status === 'rejected') failures.push(treeExit.reason)
      else if (!treeExit.value) failures.push(new Error('process tree remained live'))
      throw new WorktreeTaskError(
        'git-failed',
        `Git command "${args[0] ?? ''}" did not settle: ${failures.map(String).join('; ')}`,
        { cause: failures.length === 1 ? failures[0] : new AggregateError(failures) },
      )
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
    if (this.table === undefined || this.domain === undefined) {
      throw new WorktreeTaskError('operation-failed', 'worktree task provider is not started')
    }
    return this.table
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

export default GitWorktreeTask
