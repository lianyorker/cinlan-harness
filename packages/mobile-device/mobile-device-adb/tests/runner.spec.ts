/** Native ADB commands retain process ownership through bounded output and range settlement. */
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { PassThrough } from 'node:stream'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adbCommand, resolveConfig, type Config } from '../src/config.ts'
import { AdbRunner } from '../src/runner.ts'

function deferred<T>() {
  let resolveValue!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolveValue = done; reject = fail })
  return { promise, resolve: resolveValue, reject }
}
const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  vi.useRealTimers()
})
function childProcess(spec: SubprocessSpawnSpec) {
  const stdout = new PassThrough()
  const outcome = deferred<SubprocessOutcome>()
  const range = deferred<boolean>()
  const stderr = { text: '', lossy: false }
  let ended = false
  const finish = (exitCode: number | null = 0, signal: NodeJS.Signals | null = null): void => {
    if (ended) return
    ended = true
    stdout.end()
    outcome.resolve({ exitCode, signal })
  }
  const terminate = vi.fn(() => { finish(null, 'SIGTERM') })
  const waitForExit = vi.fn(async () => range.promise)
  const handle: SubprocessHandle = { stdin: undefined, stdout, stderr: undefined, control: undefined,
    collected: { stderr: { readFrom: () => ({ ...stderr, nextOffset: Buffer.byteLength(stderr.text) }) } },
    done: outcome.promise, terminate, waitForExit }
  spec.signal?.addEventListener('abort', () => { finish(null, 'SIGTERM') }, { once: true })
  return { spec, stdout, outcome, range, stderr, finish, terminate, waitForExit, handle }
}
function bench(config: Config = {}) {
  const ctx = new Context()
  let sdk = ''
  const children: ReturnType<typeof childProcess>[] = []
  const resolveExecutable = vi.fn(async (command: string) => command)
  const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
    const child = childProcess(spec)
    children.push(child)
    return child.handle
  })
  ctx.provide('subprocess', { resolveExecutable, spawn } as unknown as Context['subprocess'])
  const runner = new AdbRunner(ctx, resolveConfig(config), () => sdk)
  const b = { ctx, runner, children, resolveExecutable, spawn, setSdk(value: string) { sdk = value },
    async next(index = 0) {
      await vi.waitFor(() => { expect(children.length).toBeGreaterThan(index) })
      return children[index]!
    } }
  disposers.push(async () => {
    for (const child of children) { child.finish(); child.range.resolve(true) }
    await runner.dispose()
    await ctx.fiber.dispose()
  })
  return b
}

describe('Native ADB command ownership', () => {
  it('retains raw PNG bytes at the complete output bound and waits for range exit', async () => {
    const b = bench()
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128])
    const task = b.runner.run(['-t', '7', 'exec-out', 'screencap', '-p'], undefined, pngBytes.length)
    let settled = false
    void task.then(() => { settled = true })
    const child = await b.next()
    child.stdout.write(pngBytes.subarray(0, 7)); child.stdout.write(pngBytes.subarray(7)); child.finish()
    await vi.waitFor(() => { expect(child.waitForExit).toHaveBeenCalledOnce() })
    expect(settled).toBe(false)
    expect(child.terminate).toHaveBeenCalledOnce()
    child.range.resolve(true)
    expect(await task).toEqual(pngBytes)
    expect(child.spec.argv).toEqual(['adb', '-t', '7', 'exec-out', 'screencap', '-p'])
    expect(child.spec.stdio).toMatchObject({ stdin: 'ignore', stdout: 'pipe' })
  })

  it.each([{ chunks: [[1, 2], [3, 4]] }, { chunks: [[1, 2, 3, 4]] }])('terminates overflowing stdout and joins the owned process range', async ({ chunks }) => {
    const b = bench()
    const task = b.runner.run(['devices', '-l'], undefined, 3)
    const error = task.catch((value: unknown) => value)
    let settled = false
    void error.then(() => { settled = true })
    const child = await b.next()
    for (const chunk of chunks) child.stdout.write(Buffer.from(chunk))
    await vi.waitFor(() => { expect(child.waitForExit).toHaveBeenCalledOnce() })
    expect(child.spec.signal?.aborted).toBe(true)
    expect(child.terminate).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    child.range.resolve(true)
    expect(await error).toMatchObject({ code: 'MOBILE_ADB_OUTPUT_TOO_LARGE' })
  })

  it('distinguishes a command deadline from caller cancellation and waits for exit', async () => {
    vi.useFakeTimers()
    const b = bench({ commandTimeoutMs: 25 })
    const task = b.runner.run(['devices', '-l'], undefined, 100)
    const error = task.catch((value: unknown) => value)
    await vi.advanceTimersByTimeAsync(0)
    const child = b.children[0]!
    await vi.advanceTimersByTimeAsync(25)
    expect(child.spec.signal?.aborted).toBe(true)
    expect(child.waitForExit).toHaveBeenCalledOnce()
    child.range.resolve(true)
    expect(await error).toMatchObject({ code: 'MOBILE_ADB_TIMEOUT', message: 'Android ADB command timed out' })
  })

  it('preserves the caller abort reason and still joins the subprocess range', async () => {
    const b = bench()
    const caller = new AbortController()
    const task = b.runner.run(['devices', '-l'], caller.signal, 100)
    const result = task.catch((value: unknown) => value)
    const child = await b.next()
    const reason = new Error('caller cancellation')
    caller.abort(reason)
    await vi.waitFor(() => { expect(child.waitForExit).toHaveBeenCalledOnce() })
    child.range.resolve(true)
    expect(await result).toBe(reason)
  })

  it('bounds executable resolution and refuses to spawn after its deadline', async () => {
    vi.useFakeTimers()
    const b = bench({ commandTimeoutMs: 10 })
    const resolution = deferred<string>()
    b.resolveExecutable.mockImplementationOnce(async () => resolution.promise)
    const task = b.runner.run([], undefined, 100)
    const result = task.catch((value: unknown) => value)
    await vi.advanceTimersByTimeAsync(10)
    resolution.resolve('resolved-after-deadline')
    expect(await result).toMatchObject({ code: 'MOBILE_ADB_TIMEOUT' })
    expect(b.spawn).not.toHaveBeenCalled()
  })

  it('does not resolve or spawn for an already cancelled request', async () => {
    const b = bench()
    const reason = new Error('cancelled before execution')
    await expect(b.runner.run([], AbortSignal.abort(reason), 100)).rejects.toBe(reason)
    expect(b.resolveExecutable).not.toHaveBeenCalled()
    expect(b.spawn).not.toHaveBeenCalled()
  })

  it('disposal aborts active commands and waits for range settlement before rejecting new commands', async () => {
    const b = bench()
    const task = b.runner.run(['devices', '-l'], undefined, 100)
    const error = task.catch((value: unknown) => value)
    const child = await b.next()
    let disposed = false
    const disposal = b.runner.dispose().then(() => { disposed = true })
    await vi.waitFor(() => { expect(child.waitForExit).toHaveBeenCalledOnce() })
    expect(disposed).toBe(false)
    child.range.resolve(true)
    await disposal
    expect(await error).toMatchObject({ code: 'MOBILE_PROVIDER_DISPOSED' })
    await expect(b.runner.run([], undefined, 100)).rejects.toMatchObject({ code: 'MOBILE_PROVIDER_DISPOSED' })
  })

  it('pins executable selection across async work and cleanup while independent operations see the new SDK', async () => {
    const b = bench()
    const firstSdk = resolve('first-sdk')
    const secondSdk = resolve('second-sdk')
    const resume = deferred<undefined>()
    b.setSdk(firstSdk)
    const scoped = b.runner.scoped(async () => {
      await b.runner.run(['devices', '-l'], undefined, 100)
      await resume.promise
      return b.runner.run(['-t', '1', 'shell', 'rm', '-f', '/data/local/tmp/owned.xml'], undefined, 100, true)
    })
    const first = await b.next()
    first.finish(); first.range.resolve(true)
    b.setSdk(secondSdk)
    const independent = b.runner.scoped(() => b.runner.run(['devices', '-l'], undefined, 100))
    const second = await b.next(1)
    second.finish(); second.range.resolve(true)
    await independent
    resume.resolve(undefined)
    const cleanup = await b.next(2)
    cleanup.finish(); cleanup.range.resolve(true)
    await scoped
    expect(b.resolveExecutable.mock.calls.map(call => call[0])).toEqual([
      adbCommand('', firstSdk), adbCommand('', secondSdk), adbCommand('', firstSdk),
    ])
  })

  it('permits owned cleanup after disposal with an independent deadline and ignores caller cancellation', async () => {
    vi.useFakeTimers()
    const b = bench({ commandTimeoutMs: 1000, cleanupTimeoutMs: 15 })
    await b.runner.dispose()
    const task = b.runner.run(['-t', '1', 'shell', 'rm', '-f', '/data/local/tmp/owned.xml'], AbortSignal.abort(), 100, true)
    const error = task.catch((value: unknown) => value)
    await vi.advanceTimersByTimeAsync(0)
    const child = b.children[0]!
    expect(child.spec.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(15)
    expect(child.spec.signal?.aborted).toBe(true)
    child.range.resolve(true)
    expect(await error).toMatchObject({ code: 'MOBILE_ADB_TIMEOUT' })
  })

  it('rejects unavailable executables and command diagnostics without exposing subprocess payloads', async () => {
    const b = bench()
    b.resolveExecutable.mockRejectedValueOnce(new Error('private path'))
    await expect(b.runner.run([], undefined, 100)).rejects.toMatchObject({ code: 'MOBILE_ADB_UNAVAILABLE' })
    const failed = b.runner.run([], undefined, 100)
    const error = failed.catch((value: unknown) => value)
    const child = await b.next()
    child.stderr.text = 'private diagnostic'
    child.finish(1); child.range.resolve(true)
    expect(await error).toMatchObject({ code: 'MOBILE_ADB_COMMAND_FAILED', message: 'Android ADB command failed; inspect device connection and authorization' })
  })

  it('rejects truncated stderr even when the command exit code reports success', async () => {
    const b = bench()
    const task = b.runner.run([], undefined, 100)
    const error = task.catch((value: unknown) => value)
    const child = await b.next()
    child.stderr.lossy = true
    child.finish(); child.range.resolve(true)
    expect(await error).toMatchObject({ code: 'MOBILE_ADB_OUTPUT_TOO_LARGE' })
  })

  it('sanitizes range-observation failures rather than leaking provider diagnostics', async () => {
    const b = bench()
    const task = b.runner.run([], undefined, 100)
    const error = task.catch((value: unknown) => value)
    const child = await b.next()
    child.finish()
    await vi.waitFor(() => { expect(child.waitForExit).toHaveBeenCalledOnce() })
    child.range.reject(new Error('private process diagnostic'))
    expect(await error).toMatchObject({ code: 'MOBILE_ADB_CLEANUP_FAILED' })
    expect((await error as Error).message).not.toContain('private')
  })
})
