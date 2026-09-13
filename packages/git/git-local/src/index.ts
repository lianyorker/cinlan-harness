/** Local Service Provider for the read-only Git capability. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GitError, GitRepositoryId, GitRuntime } from '@deepseek-ai/dsh-git'
import type { GitDiff, GitDiffRequest, GitLogEntry, GitLogRequest, GitRepository, GitResolveRequest, GitStatus } from '@deepseek-ai/dsh-git'
import type { SubprocessHandle, SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'

/** Deployment-controlled local Git command and observation limits. */
export interface Config {
  /** Git executable name or path resolved by the active subprocess provider. */
  executable: string
  /** Maximum captured stdout or stderr bytes for one observation. */
  maxOutputBytes: number
  /** Maximum commit count accepted from one log request. */
  maxLogEntries: number
  /** Milliseconds allowed for graceful subprocess termination. */
  graceMs: number
}

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly exitCode: number | null
}

interface GitConfigOverride {
  readonly key: string
  readonly value: string
}

/** Git environment entries that can redirect repository selection or command configuration. */
const GIT_ENVIRONMENT_TOMBSTONES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
] as const

const FILTER_CONFIG_PATTERN = '^filter\\..*\\.(clean|process)$'

/**
 * Build a deterministic read-only Git environment for one command.
 * Static tombstones protect replaceable subprocess providers, while the ambient
 * scan also removes unknown or differently-cased `GIT_*` entries on this host.
 */
function gitObservationEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of GIT_ENVIRONMENT_TOMBSTONES) env[key] = undefined
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase().startsWith('GIT_')) env[key] = undefined
  }
  env.GIT_ATTR_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = '/dev/null'
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.LANG = 'C'
  env.LC_ALL = 'C'
  return env
}

/** Build Git 2.25-compatible command-scope configuration arguments. */
function gitConfigArgs(overrides: readonly GitConfigOverride[]): string[] {
  return [{ key: 'core.fsmonitor', value: 'false' }, ...overrides]
    .flatMap(({ key, value }) => ['-c', `${key}=${value}`])
}

const readCollected = (reader: SubprocessOutputReader | undefined): { text: string; truncated: boolean } => {
  if (reader === undefined) return { text: '', truncated: false }
  const read = reader.readFrom(0)
  return { text: read.text, truncated: read.lossy }
}

const parseBranch = (header: string): string | undefined => {
  const unborn = /^## (?:No commits yet on|Initial commit on) (.+)$/.exec(header)?.[1]
  if (unborn !== undefined) return unborn
  if (header === '## HEAD (no branch)') return undefined
  const divergence = header.indexOf('...', 3)
  return divergence < 0 ? header.slice(3) : header.slice(3, divergence)
}

const invalidStatusRecord = (): GitError =>
  new GitError('COMMAND_FAILED', 'git status returned an invalid record')

/** Parse strict NUL-framed porcelain v1 status output. */
function parseStatus(output: string): GitStatus {
  if (output.length === 0 || !output.endsWith('\0')) throw invalidStatusRecord()
  const records = output.slice(0, -1).split('\0')
  const header = records.shift()
  if (header === undefined || !header.startsWith('## ') || header.length === 3) throw invalidStatusRecord()
  const ahead = /ahead (\d+)/.exec(header)?.[1]
  const behind = /behind (\d+)/.exec(header)?.[1]
  let staged = 0
  let unstaged = 0
  let untracked = 0
  let conflicted = 0
  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    const record = records[recordIndex]
    if (record === undefined || record.length < 4 || record.charAt(2) !== ' ') throw invalidStatusRecord()
    const index = record.charAt(0)
    const worktree = record.charAt(1)
    if (index === '?' && worktree === '?') {
      untracked++
      continue
    }
    if (!/^[ MADRCUT]{2}$/.test(`${index}${worktree}`) || (index === ' ' && worktree === ' ')) {
      throw invalidStatusRecord()
    }
    if (index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C') {
      const origin = records[++recordIndex]
      if (origin === undefined || origin.length === 0) throw invalidStatusRecord()
    }
    if (index === 'U' || worktree === 'U' || (index === worktree && (index === 'A' || index === 'D'))) conflicted++
    if (index !== ' ') staged++
    if (worktree !== ' ') unstaged++
  }
  return {
    branch: parseBranch(header),
    ahead: ahead === undefined ? 0 : Number(ahead),
    behind: behind === undefined ? 0 : Number(behind),
    staged,
    unstaged,
    untracked,
    conflicted,
    clean: staged === 0 && unstaged === 0 && untracked === 0 && conflicted === 0,
  }
}

/** Convert an infrastructure failure into the provider's stable error vocabulary. */
function commandExecutionError(operation: string, failure: unknown): GitError {
  let detail: string
  try {
    detail = failure instanceof Error ? failure.message : String(failure)
  } catch {
    detail = '<unprintable failure>'
  }
  return new GitError('COMMAND_FAILED', `git ${operation} failed: ${detail}`, { cause: failure })
}

/** Parse `rev-parse --show-toplevel --is-inside-work-tree` without trimming a valid root path. */
function parseRepositoryProbe(output: string, requestPath: string): string {
  const usesCrLf = output.endsWith('\r\n')
  if (!output.endsWith('\n')) {
    throw new GitError('COMMAND_FAILED', 'git rev-parse returned an invalid repository record')
  }
  const withoutFinalLineEnding = output.slice(0, usesCrLf ? -2 : -1)
  const separator = withoutFinalLineEnding.lastIndexOf('\n')
  if (separator < 0) {
    throw new GitError('COMMAND_FAILED', 'git rev-parse returned an invalid repository record')
  }
  let root = withoutFinalLineEnding.slice(0, separator)
  if (usesCrLf && root.endsWith('\r')) root = root.slice(0, -1)
  const insideWorkTree = withoutFinalLineEnding.slice(separator + 1)
  if (insideWorkTree !== 'true') {
    throw new GitError('NOT_REPOSITORY', `path is not inside its Git work tree: ${requestPath}`)
  }
  if (root.length === 0) {
    throw new GitError('NOT_REPOSITORY', `git returned an empty repository root for '${requestPath}'`)
  }
  return root
}

/** Local provider backed by one explicit executable in the active execution world. */
export class LocalGitRuntime extends GitRuntime {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    executable: z.string().required(),
    maxOutputBytes: z.number().required(),
    maxLogEntries: z.number().required(),
    graceMs: z.number().required(),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    if (config.executable.trim().length === 0) {
      throw new GitError('INVALID_REQUEST', 'git executable must be non-empty')
    }
    if (!Number.isSafeInteger(config.maxOutputBytes) || config.maxOutputBytes < 1) {
      throw new GitError('INVALID_REQUEST', 'git maxOutputBytes must be a positive safe integer')
    }
    if (!Number.isSafeInteger(config.maxLogEntries) || config.maxLogEntries < 1) {
      throw new GitError('INVALID_REQUEST', 'git maxLogEntries must be a positive safe integer')
    }
    if (!Number.isSafeInteger(config.graceMs) || config.graceMs < 1) {
      throw new GitError('INVALID_REQUEST', 'git graceMs must be a positive safe integer')
    }
  }

  async resolveRepository(request: GitResolveRequest): Promise<GitRepository> {
    if (request.path.length === 0) throw new GitError('INVALID_REQUEST', 'git repository path must not be empty')
    const result = await this.run(request.path, ['rev-parse', '--show-toplevel', '--is-inside-work-tree'], request.signal)
    this.assertComplete(result, 'rev-parse')
    if (result.exitCode !== 0) throw new GitError('NOT_REPOSITORY', result.stderr.trim() || `not a Git repository: ${request.path}`)
    const root = parseRepositoryProbe(result.stdout, request.path)
    const head = await this.run(root, ['rev-parse', '--verify', 'HEAD'], request.signal)
    this.assertComplete(head, 'rev-parse')
    return { id: GitRepositoryId(root), root, head: head.exitCode === 0 ? head.stdout.trim() : undefined }
  }

  async status(repository: GitRepository, signal?: AbortSignal): Promise<GitStatus> {
    const config = await this.filterNeutralizationConfig(repository.root, signal)
    const result = await this.run(repository.root, ['status', '--porcelain=v1', '--branch', '-z'], signal, undefined, config)
    this.assertSuccess(result, 'status')
    return parseStatus(result.stdout)
  }

  async diff(request: GitDiffRequest): Promise<GitDiff> {
    const maxBytes = request.maxBytes ?? this.config.maxOutputBytes
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > this.config.maxOutputBytes) {
      throw new GitError('INVALID_REQUEST', 'git diff maxBytes must be a positive value within the provider limit')
    }
    const config = await this.filterNeutralizationConfig(request.repository.root, request.signal)
    const result = await this.run(
      request.repository.root,
      ['diff', '--no-ext-diff', '--no-textconv', '--no-color'],
      request.signal,
      maxBytes,
      config,
    )
    this.assertSuccess(result, 'diff', true)
    return { text: result.stdout, truncated: result.stdoutTruncated }
  }

  async log(request: GitLogRequest): Promise<readonly GitLogEntry[]> {
    const limit = request.limit ?? this.config.maxLogEntries
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.config.maxLogEntries) {
      throw new GitError('INVALID_REQUEST', 'git log limit must be a positive value within the provider limit')
    }
    const result = await this.run(
      request.repository.root,
      ['log', '-z', `-${limit}`, '--format=%H%x00%an%x00%cI%x00%s'],
      request.signal,
    )
    this.assertSuccess(result, 'log')
    if (result.stdout.length === 0) return []
    if (!result.stdout.endsWith('\0')) throw new GitError('COMMAND_FAILED', 'git log returned an invalid record')
    const fields = result.stdout.slice(0, -1).split('\0')
    const entries: GitLogEntry[] = []
    for (let index = 0; index < fields.length; index += 4) {
      const hash = fields[index]
      const authorName = fields[index + 1]
      const committedAt = fields[index + 2]
      const subject = fields[index + 3]
      if (hash === undefined || authorName === undefined || committedAt === undefined || subject === undefined) {
        throw new GitError('COMMAND_FAILED', 'git log returned an invalid record')
      }
      entries.push({ hash, authorName, committedAt, subject: subject.trimEnd() })
    }
    return entries
  }

  /** Disable every configured clean/process filter before a work-tree observation. */
  private async filterNeutralizationConfig(root: string, signal?: AbortSignal): Promise<GitConfigOverride[]> {
    const result = await this.run(
      root,
      ['config', '--null', '--name-only', '--get-regexp', FILTER_CONFIG_PATTERN],
      signal,
    )
    this.assertComplete(result, 'config')
    if (result.exitCode === 1 && result.stdout.length === 0 && result.stderr.length === 0) return []
    if (result.exitCode !== 0) {
      throw new GitError('COMMAND_FAILED', result.stderr.trim() || 'git config failed while inspecting filters')
    }
    if (result.stdout.length === 0) return []
    if (!result.stdout.endsWith('\0')) {
      throw new GitError('COMMAND_FAILED', 'git config returned an invalid filter record')
    }

    const drivers = new Set<string>()
    for (const key of result.stdout.slice(0, -1).split('\0')) {
      const match = /^filter\.(.+)\.(?:clean|process)$/i.exec(key)
      const driver = match?.[1]
      if (driver === undefined || driver.length === 0) {
        throw new GitError('COMMAND_FAILED', 'git config returned an invalid filter record')
      }
      if (driver.includes('=')) {
        throw new GitError('COMMAND_FAILED', 'git config returned a filter name unsupported by command-scope configuration')
      }
      drivers.add(driver)
    }

    return [...drivers].flatMap(driver => [
      { key: `filter.${driver}.clean`, value: '' },
      { key: `filter.${driver}.process`, value: '' },
      { key: `filter.${driver}.required`, value: 'false' },
    ])
  }

  private async run(
    cwd: string,
    args: readonly [string, ...string[]],
    signal?: AbortSignal,
    maxBytes = this.config.maxOutputBytes,
    config: readonly GitConfigOverride[] = [],
  ): Promise<CommandResult> {
    const operation = args[0]
    let handle: SubprocessHandle
    try {
      const executable = await this.ctx.subprocess.resolveExecutable(this.config.executable, undefined, signal)
      signal?.throwIfAborted()
      handle = this.ctx.subprocess.spawn({
        argv: [executable, ...gitConfigArgs(config), ...args],
        cwd,
        env: gitObservationEnv(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes, spill: { maxBytes } },
          stderr: { maxBytes },
        },
        graceMs: this.config.graceMs,
        signal,
      })
    } catch (error: unknown) {
      signal?.throwIfAborted()
      throw commandExecutionError(operation, error)
    }

    const [done, treeExit] = await Promise.allSettled([
      handle.done,
      Promise.resolve().then(() => handle.waitForExit()),
    ])
    signal?.throwIfAborted()
    const failures: unknown[] = []
    if (done.status === 'rejected') failures.push(done.reason)
    if (treeExit.status === 'rejected') failures.push(treeExit.reason)
    else if (!treeExit.value) failures.push(new Error('subprocess tree exit was not observed'))
    if (failures.length > 0) {
      throw commandExecutionError(
        operation,
        failures.length === 1 ? failures[0] : new AggregateError(failures, `git ${operation} process cleanup failed`),
      )
    }
    /* v8 ignore next 2 -- a rejected `done` result populated `failures` and threw above. */
    if (done.status !== 'fulfilled') throw commandExecutionError(operation, done.reason)
    const outcome = done.value
    const stdout = readCollected(handle.collected.stdout)
    const stderr = readCollected(handle.collected.stderr)
    return {
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      exitCode: outcome.exitCode,
    }
  }

  private assertComplete(result: CommandResult, operation: string, allowStdoutTruncation = false): void {
    if (result.stderrTruncated || (!allowStdoutTruncation && result.stdoutTruncated)) {
      throw new GitError('OUTPUT_TOO_LARGE', `git ${operation} output exceeded the configured limit`)
    }
  }

  private assertSuccess(result: CommandResult, operation: string, allowStdoutTruncation = false): void {
    this.assertComplete(result, operation, allowStdoutTruncation)
    if (result.exitCode !== 0) throw new GitError('COMMAND_FAILED', result.stderr.trim() || `git ${operation} failed`)
  }
}

export default LocalGitRuntime
