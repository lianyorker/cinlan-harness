/** Local Git worktree provider for managed per-Session workspace isolation. */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SubprocessHandle, SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import {
  WorkspaceIsolation,
  WorkspaceIsolationError,
  WorkspaceIsolationLeaseId,
} from '@deepseek-ai/dsh-workspace-isolation'
import type {
  EnsureWorkspaceIsolationRequest,
  WorkspaceIsolationComparison,
  WorkspaceIsolationFileChange,
  WorkspaceIsolationFileChangeKind,
  WorkspaceIsolationInspection,
  WorkspaceIsolationIntegrationResult,
  WorkspaceIsolationLease,
  WorkspaceIsolationPatch,
  WorkspaceIsolationReservation,
  WorkspaceIsolationTeardownResult,
} from '@deepseek-ai/dsh-workspace-isolation'
import { gitWorkspaceIsolationRecord, gitWorkspaceIsolationSpec } from './spec.ts'
import type { GitWorkspaceIsolationRecord } from './spec.ts'

/** Default maximum simultaneously materialized managed checkouts. */
export const DEFAULT_MAX_ACTIVE_CHECKOUTS = 4
/** Default maximum bytes captured from either Git output stream. */
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024
/** Default upper bound for one Git command. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000
/** Default graceful process-tree termination interval. */
export const DEFAULT_GRACE_MS = 2_000

/** Deployment-controlled local Git worktree policy. */
export interface Config {
  /** Managed checkout root; omitted uses `<DSH_HOME>/worktrees/v1`. */
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

/** Remove ambient Git routing and interactive credential behavior. */
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

const snapshot = (record: GitWorkspaceIsolationRecord): WorkspaceIsolationLease => ({ ...record })

const fileChangeKind = (status: string): WorkspaceIsolationFileChangeKind => {
  switch (status[0]) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'type-changed'
    case 'U': return 'unmerged'
    case '?': return 'untracked'
    default: return 'other'
  }
}

/** Parse Git's NUL-framed name-status output without interpreting path bytes as delimiters. */
function parseNameStatus(output: string): WorkspaceIsolationFileChange[] {
  if (output.length === 0) return []
  if (!output.endsWith('\0')) {
    throw new WorkspaceIsolationError('COMMAND_FAILED', 'git diff returned an invalid changed-path record')
  }
  const fields = output.slice(0, -1).split('\0')
  const changes: WorkspaceIsolationFileChange[] = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    const firstPath = fields[index++]
    if (status === undefined || firstPath === undefined || status.length === 0 || firstPath.length === 0) {
      throw new WorkspaceIsolationError('COMMAND_FAILED', 'git diff returned an incomplete changed-path record')
    }
    const kind = fileChangeKind(status)
    if (kind === 'renamed' || kind === 'copied') {
      const path = fields[index++]
      if (path === undefined || path.length === 0) {
        throw new WorkspaceIsolationError('COMMAND_FAILED', 'git diff returned an incomplete rename record')
      }
      changes.push({ kind, path, previousPath: firstPath })
    } else {
      changes.push({ kind, path: firstPath })
    }
  }
  return changes
}

/** Read untracked paths from Git's NUL-framed porcelain output. */
function parseUntracked(output: string): WorkspaceIsolationFileChange[] {
  if (output.length === 0) return []
  if (!output.endsWith('\0')) {
    throw new WorkspaceIsolationError('COMMAND_FAILED', 'git status returned an invalid working-tree record')
  }
  return output.slice(0, -1).split('\0').flatMap((field) => {
    if (!field.startsWith('?? ') || field.length === 3) return []
    return [{ kind: 'untracked' as const, path: field.slice(3) }]
  })
}

/** Parse NUL-framed commit id and subject pairs. */
function parseCommits(output: string): WorkspaceIsolationComparison['commits'] {
  if (output.length === 0) return []
  if (!output.endsWith('\0')) {
    throw new WorkspaceIsolationError('COMMAND_FAILED', 'git log returned an invalid commit record')
  }
  const fields = output.slice(0, -1).split('\0')
  if (fields.length % 2 !== 0) {
    throw new WorkspaceIsolationError('COMMAND_FAILED', 'git log returned an incomplete commit record')
  }
  const commits: Array<{ id: string; summary: string }> = []
  for (let index = 0; index < fields.length; index += 2) {
    commits.push({ id: fields[index]!, summary: fields[index + 1]! })
  }
  return commits
}

/** Git-backed provider with durable leases and bounded active checkout count. */
export class GitWorkspaceIsolation extends WorkspaceIsolation {
  static inject = ['agents', 'storageDomain', 'subprocess']

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
  private table?: KvTable<SessionId, GitWorkspaceIsolationRecord>
  private domain?: Domain<typeof gitWorkspaceIsolationSpec>
  private readonly records = new Map<SessionId, GitWorkspaceIsolationRecord>()
  private readonly reservations = new Map<WorkspaceIsolationLease['id'], number>()
  private operationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.ownerCtx = ctx
    const root = config.root ?? join(resolveDshHome(config.dshHome), 'worktrees', 'v1')
    const resolved = {
      root: resolve(root),
      executable: config.executable ?? 'git',
      maxActiveCheckouts: config.maxActiveCheckouts ?? DEFAULT_MAX_ACTIVE_CHECKOUTS,
      maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      commandTimeoutMs: config.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      graceMs: config.graceMs ?? DEFAULT_GRACE_MS,
    }
    if (resolved.executable.trim().length === 0) throw new Error('workspace-isolation-git: executable must be non-empty')
    for (const [key, value] of Object.entries(resolved).filter(([, value]) => typeof value === 'number')) {
      if (!Number.isSafeInteger(value) || (value as number) < 1) {
        throw new Error(`workspace-isolation-git: ${key} must be a positive safe integer`)
      }
    }
    this.config = resolved
  }

  /** Open lease persistence, then checkpoint recoverable inactive checkouts left by an earlier process. */
  protected async [Service.init](): Promise<void> {
    await mkdir(this.config.root, { recursive: true })
    await mkdir(join(this.config.root, '.disabled-hooks'), { recursive: true })
    const domain = await this.ownerCtx.storageDomain.open(gitWorkspaceIsolationSpec)
    this.domain = domain
    const table = domain.table('leases')
    this.table = table
    for (const [sessionId, record] of table.entries()) this.records.set(sessionId, record)
    this.ownerCtx.effect(() => async () => {
      await this.operationTail
      await domain.close()
    }, 'workspace-isolation-git.domain')
    await this.enqueue(async () => {
      for (const record of [...this.records.values()]) {
        if (record.phase !== 'active' || this.ownerCtx.agents.get(record.sessionId) !== undefined) continue
        try {
          await this.hibernateRecord(record)
        } catch (error: unknown) {
          this.ownerCtx.logger.warn(
            `workspace-isolation-git: retained unreconciled checkout for session "${record.sessionId}": ${String(error)}`,
          )
        }
      }
    })
  }

  async ensure(request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationLease> {
    return this.enqueue(() => this.ensureLease(request))
  }

  async acquire(request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationReservation> {
    return this.enqueue(async () => {
      const lease = await this.ensureLease(request)
      this.reservations.set(lease.id, (this.reservations.get(lease.id) ?? 0) + 1)
      let released = false
      return {
        lease,
        release: () => {
          if (released) return
          released = true
          const count = this.reservations.get(lease.id)
          if (count === undefined || count <= 0) {
            throw new WorkspaceIsolationError(
              'COMMAND_FAILED',
              'acquired workspace lease lost its reservation before release',
            )
          }
          const remaining = count - 1
          if (remaining === 0) this.reservations.delete(lease.id)
          else this.reservations.set(lease.id, remaining)
        },
      }
    })
  }

  private async ensureLease(request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationLease> {
    request.signal?.throwIfAborted()
    const sourcePath = await realpath(request.sourcePath)
    if (!(await stat(sourcePath)).isDirectory()) {
      throw new WorkspaceIsolationError('NOT_REPOSITORY', `workspace source is not a directory: ${sourcePath}`)
    }
    const existing = this.records.get(request.sessionId)
    if (existing !== undefined) {
      if (pathKey(existing.sourcePath) !== pathKey(sourcePath)) {
        throw new WorkspaceIsolationError(
          'LEASE_CONFLICT',
          `session "${request.sessionId}" already owns an isolation lease for "${existing.sourcePath}"`,
        )
      }
      const active = await this.activateRecord(existing, request.signal)
      return snapshot(active)
    }
    const created = await this.createLease(request.sessionId, sourcePath, request.signal)
    return snapshot(created)
  }

  async activate(
    leaseId: WorkspaceIsolationLease['id'],
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationLease> {
    return this.enqueue(async () => {
      signal?.throwIfAborted()
      const record = this.requireRecord(leaseId)
      return snapshot(await this.activateRecord(record, signal))
    })
  }

  async hibernate(leaseId: WorkspaceIsolationLease['id']): Promise<WorkspaceIsolationLease> {
    return this.enqueue(async () => {
      const record = this.requireRecord(leaseId)
      if (this.isBusy(record)) {
        throw new WorkspaceIsolationError(
          'LEASE_BUSY',
          `cannot hibernate workspace lease "${leaseId}" while it is in use`,
        )
      }
      return snapshot(await this.hibernateRecord(record))
    })
  }

  async inspect(
    leaseId: WorkspaceIsolationLease['id'],
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationInspection> {
    return this.enqueue(() => this.inspectRecord(this.requireRecord(leaseId), signal))
  }

  async compare(
    leaseId: WorkspaceIsolationLease['id'],
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationComparison> {
    return this.enqueue(() => this.compareRecord(this.requireRecord(leaseId), signal))
  }

  async merge(
    leaseId: WorkspaceIsolationLease['id'],
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationIntegrationResult> {
    return this.enqueue(() => this.integrateRecord(this.requireRecord(leaseId), 'merge', signal))
  }

  async cherryPick(
    leaseId: WorkspaceIsolationLease['id'],
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationIntegrationResult> {
    return this.enqueue(() => this.integrateRecord(this.requireRecord(leaseId), 'cherry-pick', signal))
  }

  async exportPatch(
    leaseId: WorkspaceIsolationLease['id'],
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationPatch> {
    return this.enqueue(async () => {
      const comparison = await this.compareRecord(this.requireRecord(leaseId), signal)
      if (comparison.patchTruncated) {
        throw new WorkspaceIsolationError(
          'COMMAND_FAILED',
          `workspace lease "${leaseId}" patch exceeds the configured output limit`,
        )
      }
      return {
        leaseId,
        fileName: `workspace-${String(leaseId)}.patch`,
        content: comparison.patch,
        includesWorkingTree: comparison.includesWorkingTree,
        hasUntrackedFiles: comparison.hasUntrackedFiles,
      }
    })
  }

  async teardown(leaseId: WorkspaceIsolationLease['id']): Promise<WorkspaceIsolationTeardownResult> {
    return this.enqueue(async () => {
      const record = this.requireRecord(leaseId)
      if (this.isBusy(record)) {
        throw new WorkspaceIsolationError(
          'LEASE_BUSY',
          `cannot tear down workspace lease "${leaseId}" while it is in use`,
        )
      }
      return this.teardownRecord(record)
    })
  }

  async pruneOrphans(): Promise<number> {
    return this.enqueue(async () => {
      let pruned = 0
      const managedPaths = new Set([...this.records.values()].map(r => pathKey(r.checkoutRoot)))

      for (const record of [...this.records.values()]) {
        const registrations = await this.worktreeRegistrations(record.repositoryPath)
        const filters = await this.filterOverrides(record.repositoryPath)

        for (const registration of registrations) {
          const regPath = pathKey(registration.path)
          const leaseId = relative(pathKey(this.config.root), regPath)
          if (gitWorkspaceIsolationRecord.shape.id.safeParse(leaseId).success
            && registration.branch === `refs/heads/dsh/session/${leaseId}`
            && !managedPaths.has(regPath)) {
            try {
              const remove = await this.git(
                record.repositoryPath,
                ['worktree', 'remove', '--force', registration.path],
                undefined,
                filters,
              )
              this.assertSuccess(remove, 'worktree remove')
              pruned++
            } catch (error: unknown) {
              this.ownerCtx.logger.warn(
                `workspace-isolation-git: failed to prune orphan worktree at "${registration.path}": ${String(error)}`,
              )
            }
          }
        }
      }

      return pruned
    })
  }

  find(sessionId: SessionId): WorkspaceIsolationLease | undefined {
    const record = this.records.get(sessionId)
    return record === undefined ? undefined : snapshot(record)
  }

  sourceFor(sessionId: SessionId, cwd: string): string | undefined {
    const record = this.records.get(sessionId)
    return record !== undefined && pathKey(record.checkoutPath) === pathKey(cwd)
      ? record.sourcePath
      : undefined
  }

  list(): readonly WorkspaceIsolationLease[] {
    return [...this.records.values()].map(snapshot)
  }

  /** Create a branch and worktree only after proving the source checkout is clean. */
  private async createLease(
    sessionId: SessionId,
    sourcePath: string,
    signal?: AbortSignal,
  ): Promise<GitWorkspaceIsolationRecord> {
    await this.makeCapacity(signal)
    const repositoryProbe = await this.git(sourcePath, ['rev-parse', '--show-toplevel'], signal)
    if (repositoryProbe.exitCode !== 0) {
      throw new WorkspaceIsolationError(
        'NOT_REPOSITORY',
        repositoryProbe.stderr.trim() || `workspace is not inside a Git worktree: ${sourcePath}`,
      )
    }
    const repositoryPath = await realpath(repositoryProbe.stdout.trimEnd())
    const sourceRelative = relative(repositoryPath, sourcePath)
    if (sourceRelative === '..' || sourceRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
      || isAbsolute(sourceRelative)) {
      throw new WorkspaceIsolationError('NOT_REPOSITORY', `workspace is outside its reported Git root: ${sourcePath}`)
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
      throw new WorkspaceIsolationError(
        'SOURCE_DIRTY',
        `workspace "${sourcePath}" has staged, unstaged, or untracked changes; commit or stash them before creating an isolated session`,
      )
    }
    const headResult = await this.git(repositoryPath, ['rev-parse', '--verify', 'HEAD'], signal)
    this.assertSuccess(headResult, 'rev-parse')
    const head = headResult.stdout.trim()
    const branchResult = await this.git(repositoryPath, ['rev-parse', '--abbrev-ref', 'HEAD'], signal)
    this.assertSuccess(branchResult, 'rev-parse branch')
    const baseBranch = branchResult.stdout.trim()
    const id = WorkspaceIsolationLeaseId(randomUUID())
    const checkoutRoot = join(this.config.root, String(id))
    const checkoutPath = sourceRelative.length === 0 ? checkoutRoot : join(checkoutRoot, sourceRelative)
    const branch = `dsh/session/${String(id)}`
    if (await exists(checkoutRoot)) {
      throw new WorkspaceIsolationError('LEASE_CONFLICT', `managed checkout destination already exists: ${checkoutRoot}`)
    }
    const add = await this.git(
      repositoryPath,
      ['worktree', 'add', '--no-track', '-b', branch, checkoutRoot, head],
      signal,
      filters,
    )
    this.assertSuccess(add, 'worktree add')
    const now = new Date().toISOString()
    const record: GitWorkspaceIsolationRecord = {
      id,
      sessionId,
      sourcePath,
      repositoryPath,
      checkoutRoot,
      checkoutPath,
      branch,
      phase: 'active',
      reviewState: 'none',
      baseBranch,
      baseHead: head,
      head,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await this.requireTable().put(sessionId, record)
    } catch (error: unknown) {
      const rollback = await Promise.allSettled([
        this.git(repositoryPath, ['worktree', 'remove', '--force', checkoutRoot], undefined, filters)
          .then((result) => { this.assertSuccess(result, 'rollback worktree remove') })
          .then(() => this.git(repositoryPath, ['branch', '-D', branch], undefined, filters))
          .then((result) => { this.assertSuccess(result, 'rollback branch delete') }),
      ])
      const failures = rollback.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length > 0) {
        throw new AggregateError([error, ...failures],
          `could not persist or fully roll back workspace lease "${id}"`)
      }
      throw error
    }
    this.records.set(sessionId, record)
    return record
  }

  private requireRecord(leaseId: WorkspaceIsolationLease['id']): GitWorkspaceIsolationRecord {
    const record = [...this.records.values()].find(candidate => candidate.id === leaseId)
    if (record === undefined) {
      throw new WorkspaceIsolationError('LEASE_CONFLICT', `unknown workspace isolation lease "${leaseId}"`)
    }
    return record
  }

  /** Verify that the managed branch is registered only at its provider-owned path. */
  private async checkoutOwnership(
    record: GitWorkspaceIsolationRecord,
    signal?: AbortSignal,
  ): Promise<{ readonly checkoutExists: boolean; readonly registered: boolean }> {
    const registrations = await this.worktreeRegistrations(record.repositoryPath, signal)
    const expectedBranch = `refs/heads/${record.branch}`
    const atPath = registrations.find(candidate => pathKey(candidate.path) === pathKey(record.checkoutRoot))
    const atAnotherPath = registrations.find(candidate =>
      candidate.branch === expectedBranch && pathKey(candidate.path) !== pathKey(record.checkoutRoot))
    if (atAnotherPath !== undefined) {
      throw new WorkspaceIsolationError(
        'LEASE_CONFLICT',
        `managed branch "${record.branch}" is registered at an unrelated worktree: ${atAnotherPath.path}`,
      )
    }
    if (atPath !== undefined && atPath.branch !== expectedBranch) {
      throw new WorkspaceIsolationError(
        'LEASE_CONFLICT',
        `Git registers another branch at managed checkout path: ${record.checkoutRoot}`,
      )
    }
    const checkoutExists = await exists(record.checkoutRoot)
    if (checkoutExists && atPath === undefined) {
      throw new WorkspaceIsolationError(
        'LEASE_CONFLICT',
        `managed checkout path is occupied by an unrelated directory: ${record.checkoutRoot}`,
      )
    }
    return { checkoutExists, registered: atPath?.branch === expectedBranch }
  }

  /** Resolve an owned local branch ref or classify missing provider state as a lease conflict. */
  private async localBranchHead(
    record: GitWorkspaceIsolationRecord,
    branch: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.git(
      record.repositoryPath,
      ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`],
      signal,
    )
    if (result.stdoutTruncated || result.stderrTruncated) {
      throw new WorkspaceIsolationError('COMMAND_FAILED', 'git rev-parse output exceeded the configured limit')
    }
    if (result.exitCode !== 0) {
      throw new WorkspaceIsolationError('LEASE_CONFLICT', `managed branch is missing: ${branch}`)
    }
    return result.stdout.trim()
  }

  /** Require the managed branch to retain the lease's creation commit in its history. */
  private async assertManagedLineage(record: GitWorkspaceIsolationRecord, signal?: AbortSignal): Promise<void> {
    const result = await this.git(
      record.repositoryPath,
      ['merge-base', '--is-ancestor', record.baseHead, `refs/heads/${record.branch}`],
      signal,
    )
    if (result.exitCode === 1 && !result.stdoutTruncated && !result.stderrTruncated) {
      throw new WorkspaceIsolationError(
        'LEASE_CONFLICT',
        `managed branch "${record.branch}" no longer contains its creation commit`,
      )
    }
    this.assertSuccess(result, 'merge-base')
  }

  /** Read active working-tree dirtiness and changed paths. */
  private async workingTreeState(
    record: GitWorkspaceIsolationRecord,
    signal?: AbortSignal,
  ): Promise<{
    readonly dirty: boolean
    readonly changes: readonly WorkspaceIsolationFileChange[]
    readonly hasUntrackedFiles: boolean
  }> {
    const filters = await this.filterOverrides(record.repositoryPath, signal)
    const status = await this.git(
      record.checkoutRoot,
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      signal,
      filters,
    )
    this.assertSuccess(status, 'status')
    const changed = await this.git(
      record.checkoutRoot,
      ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--name-status', '-z', 'HEAD', '--'],
      signal,
      filters,
    )
    this.assertSuccess(changed, 'diff changed paths')
    const untracked = parseUntracked(status.stdout)
    return {
      dirty: status.stdout.length > 0,
      changes: [...parseNameStatus(changed.stdout), ...untracked],
      hasUntrackedFiles: untracked.length > 0,
    }
  }

  /** Materialize a hibernated or crash-interrupted lease without changing its branch identity. */
  private async activateRecord(
    record: GitWorkspaceIsolationRecord,
    signal?: AbortSignal,
  ): Promise<GitWorkspaceIsolationRecord> {
    const ownership = await this.checkoutOwnership(record, signal)
    const head = await this.localBranchHead(record, record.branch, signal)
    if (ownership.checkoutExists && ownership.registered) {
      return this.write({
        ...record,
        phase: 'active',
        reviewState: 'none',
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
      phase: 'active',
      reviewState: 'none',
      head,
      updatedAt: new Date().toISOString(),
    })
  }

  /** Inspect current checkout state without materializing or checkpointing it. */
  private async inspectRecord(
    record: GitWorkspaceIsolationRecord,
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationInspection> {
    signal?.throwIfAborted()
    const ownership = await this.checkoutOwnership(record, signal)
    const branchHead = await this.localBranchHead(record, record.branch, signal)
    if (!ownership.checkoutExists) {
      return {
        lease: snapshot(record),
        checkoutState: 'absent',
        branchHead,
        workingTreeChanges: [],
        hasUntrackedFiles: false,
      }
    }
    const workingTree = await this.workingTreeState(record, signal)
    return {
      lease: snapshot(record),
      checkoutState: workingTree.dirty ? 'dirty' : 'clean',
      branchHead,
      workingTreeChanges: workingTree.changes,
      hasUntrackedFiles: workingTree.hasUntrackedFiles,
    }
  }

  /** Build bounded review data without changing active checkout content. */
  private async compareRecord(
    record: GitWorkspaceIsolationRecord,
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationComparison> {
    signal?.throwIfAborted()
    const ownership = await this.checkoutOwnership(record, signal)
    const branchHead = await this.localBranchHead(record, record.branch, signal)
    const targetHead = await this.localBranchHead(record, record.baseBranch, signal)
    await this.assertManagedLineage(record, signal)
    const filters = await this.filterOverrides(record.repositoryPath, signal)
    const includesWorkingTree = ownership.checkoutExists
    const diffCwd = includesWorkingTree ? record.checkoutRoot : record.repositoryPath
    const revisions = includesWorkingTree
      ? [record.baseHead]
      : [record.baseHead, `refs/heads/${record.branch}`]
    const changed = await this.git(
      diffCwd,
      ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--name-status', '-z', ...revisions, '--'],
      signal,
      filters,
    )
    this.assertSuccess(changed, 'diff changed paths')
    const workingTree = includesWorkingTree
      ? await this.workingTreeState(record, signal)
      : { dirty: false, changes: [], hasUntrackedFiles: false }
    const untracked = workingTree.changes.filter(change => change.kind === 'untracked')
    const divergence = await this.git(
      record.repositoryPath,
      ['rev-list', '--left-right', '--count',
        `refs/heads/${record.baseBranch}...refs/heads/${record.branch}`],
      signal,
    )
    this.assertSuccess(divergence, 'rev-list divergence')
    const counts = divergence.stdout.trim().split(/\s+/u).map(Number)
    if (counts.length !== 2 || counts.some(count => !Number.isSafeInteger(count) || count < 0)) {
      throw new WorkspaceIsolationError('COMMAND_FAILED', 'git rev-list returned invalid divergence counts')
    }
    const commitsResult = await this.git(
      record.repositoryPath,
      ['log', '-z', '--reverse', '--format=%H%x00%s',
        `${record.baseHead}..refs/heads/${record.branch}`],
      signal,
    )
    this.assertSuccess(commitsResult, 'log')
    const patch = await this.git(
      diffCwd,
      ['diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', ...revisions, '--'],
      signal,
      filters,
    )
    if (patch.stderrTruncated) {
      throw new WorkspaceIsolationError('COMMAND_FAILED', 'git diff stderr exceeded the configured limit')
    }
    if (patch.exitCode !== 0) {
      throw new WorkspaceIsolationError(
        'COMMAND_FAILED',
        patch.stderr.trim() || `git diff failed with exit code ${String(patch.exitCode)}`,
      )
    }
    return {
      lease: snapshot(record),
      targetHead,
      branchHead,
      ahead: counts[1]!,
      behind: counts[0]!,
      commits: parseCommits(commitsResult.stdout),
      changedFiles: [...parseNameStatus(changed.stdout), ...untracked],
      patch: patch.stdout,
      patchTruncated: patch.stdoutTruncated,
      includesWorkingTree,
      hasUntrackedFiles: workingTree.hasUntrackedFiles,
    }
  }

  /** Checkpoint one checkout, then require a clean source checkout on the recorded base branch. */
  private async prepareIntegration(
    record: GitWorkspaceIsolationRecord,
    signal?: AbortSignal,
  ): Promise<{ readonly lease: GitWorkspaceIsolationRecord; readonly branchHead: string }> {
    if (this.isBusy(record)) {
      throw new WorkspaceIsolationError(
        'LEASE_BUSY',
        `cannot integrate workspace lease "${record.id}" while it is in use`,
      )
    }
    const lease = await this.hibernateRecord(record, signal)
    const branchHead = await this.localBranchHead(lease, lease.branch, signal)
    await this.localBranchHead(lease, lease.baseBranch, signal)
    await this.assertManagedLineage(lease, signal)
    const registrations = await this.worktreeRegistrations(lease.repositoryPath, signal)
    const source = registrations.find(candidate => pathKey(candidate.path) === pathKey(lease.repositoryPath))
    if (source?.branch !== `refs/heads/${lease.baseBranch}`) {
      throw new WorkspaceIsolationError(
        'LEASE_CONFLICT',
        `source checkout must have base branch "${lease.baseBranch}" checked out`,
      )
    }
    const filters = await this.filterOverrides(lease.repositoryPath, signal)
    const status = await this.git(
      lease.repositoryPath,
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      signal,
      filters,
    )
    this.assertSuccess(status, 'status')
    if (status.stdout.length > 0) {
      throw new WorkspaceIsolationError(
        'SOURCE_DIRTY',
        `source checkout for base branch "${lease.baseBranch}" has staged, unstaged, or untracked changes`,
      )
    }
    return { lease, branchHead }
  }

  /** Merge or cherry-pick a managed branch without leaving a conflicted source checkout. */
  private async integrateRecord(
    record: GitWorkspaceIsolationRecord,
    operation: 'merge' | 'cherry-pick',
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationIntegrationResult> {
    signal?.throwIfAborted()
    const prepared = await this.prepareIntegration(record, signal)
    const filters = await this.filterOverrides(prepared.lease.repositoryPath, signal)
    try {
      if (operation === 'merge') {
        const result = await this.git(
          prepared.lease.repositoryPath,
          ['merge', '--no-edit', '--no-verify', prepared.lease.branch],
          signal,
          filters,
        )
        if (result.exitCode !== 0) {
          throw new WorkspaceIsolationError(
            'COMMAND_FAILED',
            result.stderr.trim() || `git merge failed with exit code ${String(result.exitCode)}`,
          )
        }
      } else {
        const merges = await this.git(
          prepared.lease.repositoryPath,
          ['rev-list', '--merges', `${prepared.lease.baseHead}..refs/heads/${prepared.lease.branch}`],
          signal,
        )
        this.assertSuccess(merges, 'rev-list merges')
        if (merges.stdout.trim().length > 0) {
          throw new WorkspaceIsolationError(
            'COMMAND_FAILED',
            `managed branch "${prepared.lease.branch}" contains merge commits; use merge instead`,
          )
        }
        const count = await this.git(
          prepared.lease.repositoryPath,
          ['rev-list', '--count', `${prepared.lease.baseHead}..refs/heads/${prepared.lease.branch}`],
          signal,
        )
        this.assertSuccess(count, 'rev-list count')
        if (count.stdout.trim() !== '0') {
          const result = await this.git(
            prepared.lease.repositoryPath,
            ['cherry-pick', `${prepared.lease.baseHead}..refs/heads/${prepared.lease.branch}`],
            signal,
            filters,
          )
          if (result.exitCode !== 0) {
            throw new WorkspaceIsolationError(
              'COMMAND_FAILED',
              result.stderr.trim() || `git cherry-pick failed with exit code ${String(result.exitCode)}`,
            )
          }
        }
      }
    } catch (error: unknown) {
      try {
        await this.abortIntegration(prepared.lease, operation, filters)
      } catch (abortError: unknown) {
        throw new WorkspaceIsolationError(
          'COMMAND_FAILED',
          `git ${operation} failed and its conflict state could not be aborted`,
          { cause: new AggregateError([error, abortError]) },
        )
      }
      throw error
    }
    const targetHead = await this.localBranchHead(prepared.lease, prepared.lease.baseBranch, signal)
    const lease = await this.write({
      ...prepared.lease,
      phase: 'hibernated',
      reviewState: 'none',
      head: prepared.branchHead,
      updatedAt: new Date().toISOString(),
    })
    return { lease: snapshot(lease), targetBranch: lease.baseBranch, targetHead }
  }

  /** Abort only a Git integration state proven to belong to the source checkout. */
  private async abortIntegration(
    record: GitWorkspaceIsolationRecord,
    operation: 'merge' | 'cherry-pick',
    filters: readonly GitConfigOverride[],
  ): Promise<void> {
    const marker = operation === 'merge' ? 'MERGE_HEAD' : 'CHERRY_PICK_HEAD'
    const markerProbe = await this.git(
      record.repositoryPath,
      ['rev-parse', '-q', '--verify', marker],
      undefined,
      filters,
    )
    let inProgress = markerProbe.exitCode === 0
    if (markerProbe.exitCode !== 0 && markerProbe.exitCode !== 1 && markerProbe.exitCode !== 128) {
      this.assertSuccess(markerProbe, `rev-parse ${marker}`)
    }
    if (!inProgress && operation === 'cherry-pick') {
      const gitPath = await this.git(record.repositoryPath, ['rev-parse', '--git-path', 'sequencer'])
      this.assertSuccess(gitPath, 'rev-parse sequencer')
      const candidate = gitPath.stdout.trim()
      const sequencerPath = isAbsolute(candidate) ? candidate : resolve(record.repositoryPath, candidate)
      inProgress = await exists(sequencerPath)
    }
    if (!inProgress) return
    const aborted = await this.git(
      record.repositoryPath,
      [operation === 'merge' ? 'merge' : 'cherry-pick', '--abort'],
      undefined,
      filters,
    )
    this.assertSuccess(aborted, `${operation} abort`)
  }

  /** Commit non-ignored changes on the managed branch, then remove only its exact checkout. */
  private async hibernateRecord(
    record: GitWorkspaceIsolationRecord,
    signal?: AbortSignal,
  ): Promise<GitWorkspaceIsolationRecord> {
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
          '-c', 'user.email=workspace-isolation@localhost',
          'commit', '--no-gpg-sign', '--no-verify', '-m', `Checkpoint workspace lease ${record.id}`,
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
    if (record.phase === 'hibernated' && !ownership.checkoutExists && !ownership.registered && head === record.head) {
      return record
    }
    return this.write({ ...record, phase: 'hibernated', head, updatedAt: new Date().toISOString() })
  }

  /** Reclaim the checkout and delete only a branch already integrated into its recorded base branch. */
  private async teardownRecord(record: GitWorkspaceIsolationRecord): Promise<WorkspaceIsolationTeardownResult> {
    const hibernated = await this.hibernateRecord(record)
    await this.localBranchHead(hibernated, hibernated.branch)
    await this.localBranchHead(hibernated, hibernated.baseBranch)
    const merged = await this.git(
      hibernated.repositoryPath,
      ['merge-base', '--is-ancestor',
        `refs/heads/${hibernated.branch}`, `refs/heads/${hibernated.baseBranch}`],
    )
    if (merged.exitCode === 1 && !merged.stdoutTruncated && !merged.stderrTruncated) {
      const retained = hibernated.reviewState === 'branch-retained'
        ? hibernated
        : await this.write({
          ...hibernated,
          reviewState: 'branch-retained',
          updatedAt: new Date().toISOString(),
        })
      return { status: 'review', lease: snapshot(retained), reason: 'unmerged-branch' }
    }
    this.assertSuccess(merged, 'merge-base')
    const filters = await this.filterOverrides(hibernated.repositoryPath)
    const deleteBranch = await this.git(
      hibernated.repositoryPath,
      ['branch', '-d', '--', hibernated.branch],
      undefined,
      filters,
    )
    this.assertSuccess(deleteBranch, 'branch delete')
    await this.requireTable().delete(hibernated.sessionId)
    this.records.delete(hibernated.sessionId)
    return { status: 'removed', leaseId: hibernated.id }
  }

  /** Reclaim the oldest inactive managed checkout until one capacity slot exists. */
  private isBusy(record: GitWorkspaceIsolationRecord): boolean {
    return this.reservations.has(record.id) || this.ownerCtx.agents.get(record.sessionId) !== undefined
  }

  /** Reclaim the oldest inactive managed checkout until one capacity slot exists. */
  private async makeCapacity(signal?: AbortSignal, activating?: WorkspaceIsolationLease['id']): Promise<void> {
    while ([...this.records.values()].filter(record => record.phase === 'active' && record.id !== activating).length
      >= this.config.maxActiveCheckouts) {
      signal?.throwIfAborted()
      const candidate = [...this.records.values()]
        .filter(record => record.phase === 'active' && record.id !== activating
          && !this.isBusy(record))
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0]
      if (candidate === undefined) {
        throw new WorkspaceIsolationError(
          'CAPACITY',
          `all ${this.config.maxActiveCheckouts} managed workspace checkouts are in use`,
        )
      }
      await this.hibernateRecord(candidate, signal)
    }
  }

  /** Read exact worktree paths and branch refs from Git's NUL-framed registry. */
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

  /** Disable repository clean/smudge/process filters before commands that touch content. */
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
      throw new WorkspaceIsolationError('COMMAND_FAILED', 'git config returned an invalid filter record')
    }
    const drivers = new Set<string>()
    for (const key of result.stdout.slice(0, -1).split('\0')) {
      const driver = /^filter\.(.+)\.(?:clean|smudge|process)$/iu.exec(key)?.[1]
      if (driver === undefined || driver.length === 0 || driver.includes('=')) {
        throw new WorkspaceIsolationError('COMMAND_FAILED', 'git config returned an unsupported filter name')
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

  /** Run one bounded Git subprocess with hooks and ambient config disabled. */
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
      throw new WorkspaceIsolationError('COMMAND_FAILED', `could not start Git command "${args[0] ?? ''}": ${String(error)}`, { cause: error })
    }
    const [done, treeExit] = await Promise.allSettled([handle.done, handle.waitForExit()])
    requestSignal?.throwIfAborted()
    if (done.status === 'rejected' || treeExit.status === 'rejected' || !treeExit.value) {
      const failures: unknown[] = []
      if (done.status === 'rejected') failures.push(done.reason)
      if (treeExit.status === 'rejected') failures.push(treeExit.reason)
      else if (!treeExit.value) failures.push(new Error('process tree remained live'))
      throw new WorkspaceIsolationError(
        'COMMAND_FAILED',
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
      throw new WorkspaceIsolationError('COMMAND_FAILED', `git ${operation} output exceeded the configured limit`)
    }
    if (result.exitCode !== 0) {
      throw new WorkspaceIsolationError(
        'COMMAND_FAILED',
        result.stderr.trim() || `git ${operation} failed with exit code ${String(result.exitCode)}`,
      )
    }
  }

  private async write(record: GitWorkspaceIsolationRecord): Promise<GitWorkspaceIsolationRecord> {
    await this.requireTable().put(record.sessionId, record)
    this.records.set(record.sessionId, record)
    return record
  }

  private requireTable(): KvTable<SessionId, GitWorkspaceIsolationRecord> {
    if (this.table === undefined || this.domain === undefined) {
      throw new WorkspaceIsolationError('UNAVAILABLE', 'workspace isolation provider is not started')
    }
    return this.table
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

export default GitWorkspaceIsolation
