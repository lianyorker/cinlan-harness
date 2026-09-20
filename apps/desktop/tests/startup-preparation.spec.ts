import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import { runDesktopPreparationWorker, type DesktopPreparationRequest } from '../src/startup-preparation.ts'

const roots: string[] = []
const workers: Array<{ cancel: AbortController; done: Promise<unknown> }> = []

function request(): DesktopPreparationRequest {
  const root = mkdtempSync(join(tmpdir(), 'dsh-startup-worker-'))
  roots.push(root)
  return { paths: resolveDesktopPaths(root), runtime: { node: process.execPath, pnpm: join(root, 'pnpm.mjs') }, seed: root, primaryRuntime: join(root, 'runtime', 'primary-runtime'), version: '1.0.0' }
}

function run(source: string, input: DesktopPreparationRequest, report: (stage: string) => void) {
  const cancel = new AbortController()
  const done = runDesktopPreparationWorker(source, input, cancel.signal, report)
  workers.push({ cancel, done: done.catch(() => undefined) })
  return { cancel, done }
}

afterEach(async () => {
  for (const worker of workers) worker.cancel.abort()
  await Promise.all(workers.splice(0).map(worker => worker.done))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop preparation worker ownership', () => {
  it('keeps the main loop responsive during synchronous work and awaits cancellation cleanup', async () => {
    const input = request()
    const stages: string[] = []
    let entered!: () => void
    const preparing = new Promise<void>((resolve) => { entered = resolve })
    const worker = run(`
const { parentPort, workerData } = require('node:worker_threads')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const flag = new Int32Array(workerData.cancellation)
parentPort.postMessage({ type: 'stage', stage: 'extracting' })
while (Atomics.load(flag, 0) === 0) Atomics.wait(flag, 0, 0, 10)
writeFileSync(join(workerData.seed, 'cleanup-complete'), 'finished')
parentPort.postMessage({ type: 'stage', stage: 'activating' })
parentPort.postMessage({ type: 'done' })
parentPort.close()
`, input, (stage) => { stages.push(stage); entered() })
    await preparing
    // Only the main loop can run this callback while the worker's synchronous loop is blocked.
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(existsSync(join(input.seed, 'cleanup-complete'))).toBe(false)
    const stopped = expect(worker.done).rejects.toThrow('fixture close')
    worker.cancel.abort(new Error('fixture close'))
    await stopped
    expect(readFileSync(join(input.seed, 'cleanup-complete'), 'utf8')).toBe('finished')
    expect(stages).toEqual(['extracting'])
  })

  it('waits for worker exit after a completion message', async () => {
    const input = request()
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => { entered = resolve })
    const worker = run(`
const { parentPort, workerData } = require('node:worker_threads')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
parentPort.on('message', () => {
  writeFileSync(join(workerData.seed, 'exit-cleanup'), 'closed')
  parentPort.close()
})
parentPort.postMessage({ type: 'stage', stage: 'verifying' })
parentPort.postMessage({ type: 'done' })
`, input, () => { entered() })
    let settled = false
    const settlement = worker.done.then(() => { settled = true }, () => { settled = true })
    await waiting
    expect(settled).toBe(false)
    worker.cancel.abort()
    await settlement
    expect(readFileSync(join(input.seed, 'exit-cleanup'), 'utf8')).toBe('closed')
  })

  it('contains a stage observer exception and joins worker cleanup', async () => {
    const input = request()
    const worker = run(`
const { parentPort, workerData } = require('node:worker_threads')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
parentPort.on('message', () => {
  writeFileSync(join(workerData.seed, 'observer-cleanup'), 'closed')
  parentPort.postMessage({ type: 'done' })
  parentPort.close()
})
parentPort.postMessage({ type: 'stage', stage: 'verifying' })
`, input, () => { throw new Error('observer failed') })
    await expect(worker.done).rejects.toThrow('observer failed')
    expect(readFileSync(join(input.seed, 'observer-cleanup'), 'utf8')).toBe('closed')
  })

  it.each([
    { source: "require('node:worker_threads').parentPort.close()", error: /without completing/u },
    { source: "throw new Error('broken worker')", error: /broken worker/u },
    { source: "const p = require('node:worker_threads').parentPort; p.postMessage({type:'stage',stage:'invented'}); p.close()", error: /invalid message/u },
    { source: "const p = require('node:worker_threads').parentPort; p.postMessage({type:'error',message:'seed failed',stack:'Error: seed failed'}); p.close()", error: /seed failed/u },
  ])('rejects worker failure after its exit ($error)', async ({ source, error }) => {
    const worker = run(source, request(), () => {})
    await expect(worker.done).rejects.toThrow(error)
  })
})
