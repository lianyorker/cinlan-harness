/** Managed, bounded Git subprocesses shared by every sidebar operation. */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { SidebarGitError } from './errors.ts'

/** Deployment-controlled process limits. */
export interface GitProcessOptions {
  /** Git executable resolved by the managed subprocess provider. */
  executable: string
  /** Milliseconds before aborting one Git command. */
  timeoutMs: number
  /** Milliseconds allowed for managed process termination. */
  graceMs: number
  /** Maximum retained bytes per stdout or stderr stream; truncation fails the command. */
  maxOutputBytes: number
}

interface CommandResult { stdout: string; stderr: string; exitCode: number | null }

/** Git environment entries that can redirect repository or configuration selection. */
const GIT_ENVIRONMENT_TOMBSTONES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR',
  'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_SYSTEM', 'GIT_DIR', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NAMESPACE', 'GIT_OBJECT_DIRECTORY',
  'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE', 'GIT_WORK_TREE',
] as const

/** Preserve normal user configuration while removing ambient repository redirection. */
function gitEnvironment(local: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const redirects = new Set<string>(GIT_ENVIRONMENT_TOMBSTONES)
  for (const name of GIT_ENVIRONMENT_TOMBSTONES) env[name] = undefined
  for (const name of Object.keys(local ? process.env : {})) {
    if (redirects.has(name.toUpperCase()) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/i.test(name)) env[name] = undefined
  }
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

/** Own every process until its managed range has exited, including cancellation and disposal. */
export class GitProcess {
  private readonly lifetime = new AbortController()
  private readonly active = new Set<Promise<CommandResult>>()

  constructor(private readonly subprocess: SubprocessRuntime, private readonly options: GitProcessOptions,
    private readonly local = true, private readonly executionSignal?: AbortSignal) {}

  /** Refuse new work after the owning service leaves. */
  assertActive(): void {
    if (this.lifetime.signal.aborted) throw new SidebarGitError('unavailable', 'The sidebar Git service was disposed')
  }

  /** Terminate and drain all owned subprocess ranges. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled([...this.active])
  }

  /**
   * Run a command and retain its exit status for expected negative probes.
   * @param cwd - authoritative repository or Session directory.
   * @param args - Git arguments; no shell interpretation occurs.
   * @param signal - caller cancellation.
   * @param input - optional stdin, closed after these bytes.
   * @returns complete stdout/stderr and the process exit code.
   */
  async capture(cwd: string, args: readonly string[], signal?: AbortSignal, input?: string): Promise<CommandResult> {
    this.assertActive()
    signal?.throwIfAborted()
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort() }, this.options.timeoutMs)
    const operationSignal = AbortSignal.any([this.lifetime.signal, deadline.signal,
      ...(this.executionSignal === undefined ? [] : [this.executionSignal]), ...(signal === undefined ? [] : [signal])])
    const operation = (async (): Promise<CommandResult> => {
      try {
        const executable = await this.subprocess.resolveExecutable(this.options.executable, undefined, operationSignal)
        operationSignal.throwIfAborted()
        const handle = this.subprocess.spawn({
          argv: [executable, '-C', cwd, '--no-pager', '--literal-pathspecs', '-c', 'color.ui=false', '-c', 'core.fsmonitor=false', ...args],
          cwd,
          env: gitEnvironment(this.local),
          stdio: { stdin: input === undefined ? 'ignore' : { data: input },
            stdout: { maxBytes: this.options.maxOutputBytes }, stderr: { maxBytes: this.options.maxOutputBytes } },
          graceMs: this.options.graceMs,
          signal: operationSignal,
        })
        const [outcome, quiescence] = await Promise.allSettled([handle.done, handle.waitForExit()])
        operationSignal.throwIfAborted()
        if (outcome.status === 'rejected') throw outcome.reason
        if (quiescence.status === 'rejected') throw quiescence.reason
        if (!quiescence.value) throw new Error('Git process range did not exit')
        const stdout = handle.collected.stdout?.readFrom(0)
        const stderr = handle.collected.stderr?.readFrom(0)
        if (stdout === undefined || stderr === undefined) throw new Error('Git subprocess omitted collected output')
        if (stdout.lossy || stderr.lossy) throw new SidebarGitError('output-limit', 'Git output exceeded the configured byte limit')
        return { stdout: stdout.text, stderr: stderr.text, exitCode: outcome.value.exitCode }
      } catch (error) {
        if (error instanceof SidebarGitError) throw error
        if (deadline.signal.aborted) throw new SidebarGitError('git-error', 'Git operation timed out', { cause: error })
        if (this.executionSignal?.aborted) {
          const reason: unknown = this.executionSignal.reason
          const message = reason instanceof Error && reason.message.length > 0
            ? reason.message : 'The captured execution environment disconnected'
          throw new SidebarGitError('unavailable', message, { cause: error })
        }
        if (this.lifetime.signal.aborted) throw new SidebarGitError('unavailable', 'The Git process owner was disposed', { cause: error })
        if (operationSignal.aborted) throw new SidebarGitError('cancelled', 'Git operation was cancelled', { cause: error })
        throw new SidebarGitError('git-error', error instanceof Error ? error.message : String(error), { cause: error })
      }
    })()
    this.active.add(operation)
    try { return await operation } finally { clearTimeout(timer); this.active.delete(operation) }
  }

  /**
   * Execute a command whose nonzero exit is a failure.
   * @param cwd - authoritative repository directory.
   * @param args - Git arguments.
   * @param signal - caller cancellation.
   * @param input - optional closed stdin bytes.
   * @returns complete stdout.
   */
  async run(cwd: string, args: readonly string[], signal?: AbortSignal, input?: string): Promise<string> {
    const result = await this.capture(cwd, args, signal, input)
    if (result.exitCode !== 0) {
      throw new SidebarGitError('git-error', result.stderr.trim() || 'Git command failed with exit ' + String(result.exitCode))
    }
    return result.stdout
  }
}
