/** Git commands settle only after their outcome and managed range are both complete. */
import { setImmediate as nextTurn } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessCollectedOutputs, SubprocessHandle, SubprocessOutcome, SubprocessOutputReader,
  SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { GitProcess } from '../src/process.ts'

class ScriptedSubprocessRuntime extends SubprocessRuntime {
  readonly spawned = Promise.withResolvers<SubprocessSpawnSpec>()
  readonly terminating = Promise.withResolvers<true>()
  readonly lookups: { command: string; env: Readonly<Record<string, string>> | undefined; signal: AbortSignal | undefined }[] = []
  readonly specs: SubprocessSpawnSpec[] = []

  constructor(ctx: Context, private readonly handle: SubprocessHandle) {
    super(ctx)
  }

  async resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    this.lookups.push({ command, env, signal })
    signal?.throwIfAborted()
    return '/managed/bin/git'
  }

  async terminalEnvironment(): Promise<never> {
    throw new Error('This fixture supports managed batch commands only')
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    spec.signal?.throwIfAborted()
    this.specs.push(spec)
    spec.signal?.addEventListener('abort', () => { this.terminating.resolve(true) }, { once: true })
    this.spawned.resolve(spec)
    return this.handle
  }

  async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('This fixture supports managed batch commands only')
  }
}

function observe<T>(promise: Promise<T>) {
  const settled = vi.fn<() => void>()
  const drained = promise.then(settled, settled)
  return { promise, settled, drained }
}

function fixture(options: { missing?: 'stdout' | 'stderr'; lossy?: 'stdout' | 'stderr'; stderr?: string } = {}) {
  const done = Promise.withResolvers<SubprocessOutcome>()
  const exited = Promise.withResolvers<boolean>()
  const readStdout = vi.fn<SubprocessOutputReader['readFrom']>(() => ({
    text: 'complete stdout', nextOffset: 15, lossy: options.lossy === 'stdout',
    ...(options.lossy === 'stdout' ? { spillPath: '/unread/stdout.spill' } : {}),
  }))
  const stderr = options.stderr ?? 'complete stderr'
  const readStderr = vi.fn<SubprocessOutputReader['readFrom']>(() => ({
    text: stderr, nextOffset: Buffer.byteLength(stderr), lossy: options.lossy === 'stderr',
    ...(options.lossy === 'stderr' ? { spillPath: '/unread/stderr.spill' } : {}),
  }))
  const collected: SubprocessCollectedOutputs = {
    ...(options.missing === 'stdout' ? {} : { stdout: { readFrom: readStdout } }),
    ...(options.missing === 'stderr' ? {} : { stderr: { readFrom: readStderr } }),
  }
  const handle: SubprocessHandle = {
    stdin: undefined, stdout: undefined, stderr: undefined, control: undefined, collected, done: done.promise,
    terminate: () => {}, waitForExit: () => exited.promise,
  }
  const ctx = new Context()
  const runtime = new ScriptedSubprocessRuntime(ctx, handle)
  const config = { executable: 'configured-git', timeoutMs: 30_000, graceMs: 123, maxOutputBytes: 456 }
  const git = new GitProcess(runtime, config)
  onTestFinished(async () => {
    done.resolve({ exitCode: 0, signal: null })
    exited.resolve(true)
    await git.dispose()
    await ctx.fiber.dispose()
  })
  return { git, runtime, config, done, exited, readStdout, readStderr }
}

describe('GitProcess managed commands', () => {
  it('uses the resolved executable, literal argv, closed stdin, and bounded collection without overriding identity or signing', async () => {
    const h = fixture()
    const capture = observe(h.git.capture('/repo with spaces', ['commit', '--cleanup=verbatim', '-F', '-'], undefined, 'Reviewed message\n'))
    const spec = await h.runtime.spawned.promise
    expect(h.runtime.lookups).toEqual([{ command: 'configured-git', env: undefined, signal: spec.signal }])
    expect(spec.argv).toEqual([
      '/managed/bin/git', '-C', '/repo with spaces', '--no-pager', '--literal-pathspecs',
      '-c', 'color.ui=false', '-c', 'core.fsmonitor=false', 'commit', '--cleanup=verbatim', '-F', '-',
    ])
    expect(spec).toMatchObject({
      cwd: '/repo with spaces', graceMs: 123,
      stdio: { stdin: { data: 'Reviewed message\n' }, stdout: { maxBytes: 456 }, stderr: { maxBytes: 456 } },
      env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0' },
    })
    const env = spec.env!
    for (const key of [
      'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_NAMESPACE',
      'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_PARAMETERS',
      'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_CEILING_DIRECTORIES',
    ]) {
      expect(Object.hasOwn(env, key)).toBe(true)
      expect(env[key]).toBeUndefined()
    }
    for (const key of [
      'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL',
      'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM', 'HOME', 'XDG_CONFIG_HOME',
    ]) expect(Object.hasOwn(env, key)).toBe(false)
    expect(spec.signal?.aborted).toBe(false)
    h.done.resolve({ exitCode: 0, signal: null })
    h.exited.resolve(true)
    await expect(capture.promise).resolves.toEqual({ stdout: 'complete stdout', stderr: 'complete stderr', exitCode: 0 })
    expect(h.readStdout).toHaveBeenCalledWith(0)
    expect(h.readStderr).toHaveBeenCalledWith(0)
  })

  for (const cause of ['caller', 'timeout', 'dispose'] as const) {
    it.each(['done', 'range'] as const)(cause + ' cancellation drains both barriers when %s settles first', async (first) => {
      const h = fixture()
      const caller = new AbortController()
      if (cause === 'timeout') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const capture = observe(h.git.capture('/repo', ['status', '--porcelain=v1', '-z'], caller.signal))
        const spec = await h.runtime.spawned.promise
        expect(spec.stdio.stdin).toBe('ignore')
        const disposal = cause === 'dispose' ? observe(h.git.dispose()) : undefined
        if (cause === 'caller') caller.abort()
        if (cause === 'timeout') await vi.advanceTimersByTimeAsync(h.config.timeoutMs)
        await h.runtime.terminating.promise
        expect(spec.signal?.aborted).toBe(true)
        if (first === 'done') h.done.resolve({ exitCode: null, signal: 'SIGTERM' })
        else h.exited.resolve(true)
        // Drain promise reactions before observing the barrier that is still held.
        await nextTurn()
        expect(capture.settled).not.toHaveBeenCalled()
        if (disposal !== undefined) expect(disposal.settled).not.toHaveBeenCalled()
        expect(h.readStdout).not.toHaveBeenCalled()
        expect(h.readStderr).not.toHaveBeenCalled()
        if (first === 'done') h.exited.resolve(true)
        else h.done.resolve({ exitCode: null, signal: 'SIGTERM' })
        await expect(capture.promise).rejects.toMatchObject(cause === 'timeout'
          ? { code: 'git-error', message: 'Git operation timed out' }
          : { code: 'cancelled', message: 'Git operation was cancelled' })
        if (disposal !== undefined) {
          await disposal.promise
          await expect(h.git.capture('/repo', ['status'])).rejects.toMatchObject({ code: 'unavailable' })
          expect(h.runtime.specs).toHaveLength(1)
        }
      } finally {
        if (cause === 'timeout') vi.useRealTimers()
      }
    })
  }

  it.each([false, true])('drains a rejected command outcome before settling (dispose: %s)', async (disposeDuringDrain) => {
    const h = fixture()
    const capture = observe(h.git.capture('/repo', ['status']))
    await h.runtime.spawned.promise
    h.done.reject(new Error('provider could not collect the command outcome'))
    await nextTurn()
    expect(capture.settled).not.toHaveBeenCalled()
    const disposal = disposeDuringDrain ? observe(h.git.dispose()) : undefined
    await nextTurn()
    if (disposal !== undefined) expect(disposal.settled).not.toHaveBeenCalled()
    expect(h.readStdout).not.toHaveBeenCalled()
    h.exited.resolve(true)
    await expect(capture.promise).rejects.toMatchObject(disposeDuringDrain
      ? { code: 'cancelled' }
      : { code: 'git-error', message: 'provider could not collect the command outcome' })
    if (disposal !== undefined) await disposal.promise
  })

  it.each(['rejected', 'unconfirmed'] as const)('refuses output when range exit is %s', async (failure) => {
    const h = fixture()
    const capture = observe(h.git.capture('/repo', ['status']))
    await h.runtime.spawned.promise
    if (failure === 'rejected') h.exited.reject(new Error('range observation failed'))
    else h.exited.resolve(false)
    await nextTurn()
    expect(capture.settled).not.toHaveBeenCalled()
    h.done.resolve({ exitCode: 0, signal: null })
    await expect(capture.promise).rejects.toMatchObject({
      code: 'git-error', message: failure === 'rejected' ? 'range observation failed' : 'Git process range did not exit',
    })
    expect(h.readStdout).not.toHaveBeenCalled()
    expect(h.readStderr).not.toHaveBeenCalled()
  })

  it.each(['stdout', 'stderr'] as const)('refuses a missing %s collector', async (missing) => {
    const h = fixture({ missing })
    const capture = observe(h.git.capture('/repo', ['diff']))
    await h.runtime.spawned.promise
    h.done.resolve({ exitCode: 0, signal: null })
    h.exited.resolve(true)
    await expect(capture.promise).rejects.toMatchObject({ code: 'git-error', message: 'Git subprocess omitted collected output' })
  })

  it.each(['stdout', 'stderr'] as const)('refuses lossy %s even when a spill path exists', async (lossy) => {
    const h = fixture({ lossy })
    const capture = observe(h.git.capture('/repo', ['diff']))
    await h.runtime.spawned.promise
    h.done.resolve({ exitCode: 0, signal: null })
    h.exited.resolve(true)
    await expect(capture.promise).rejects.toMatchObject({ code: 'output-limit', message: 'Git output exceeded the configured byte limit' })
  })

  it('retains a nonzero exit for an expected negative probe', async () => {
    const h = fixture({ stderr: '' })
    const capture = observe(h.git.capture('/repo', ['show-ref', '--verify', '--quiet', 'refs/heads/missing']))
    await h.runtime.spawned.promise
    h.done.resolve({ exitCode: 1, signal: null })
    h.exited.resolve(true)
    await expect(capture.promise).resolves.toEqual({ stdout: 'complete stdout', stderr: '', exitCode: 1 })
  })

  it.each([
    { stderr: '  hook refused the commit\n', expected: 'hook refused the commit' },
    { stderr: ' \n', expected: 'Git command failed with exit 1' },
  ])('reports a failed command without returning partial stdout: %j', async ({ stderr, expected }) => {
    const h = fixture({ stderr })
    const run = observe(h.git.run('/repo', ['commit']))
    await h.runtime.spawned.promise
    h.done.resolve({ exitCode: 1, signal: null })
    h.exited.resolve(true)
    await expect(run.promise).rejects.toMatchObject({ code: 'git-error', message: expected })
  })
})
