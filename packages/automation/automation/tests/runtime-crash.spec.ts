/** Source-path Loader subprocesses exercise OS crash recovery without built artifacts. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import type { AutomationSnapshot } from '../src/types.ts'
import { bootRuntimeFixture } from './fixtures/runtime.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  try { for (const dispose of cleanup.splice(0).reverse()) await dispose() }
  finally { vi.unstubAllEnvs() }
})

interface Message {
  type: 'ready' | 'barrier'
  phase?: 'starting' | 'running'
  calls: number
  snapshot: AutomationSnapshot
}

function nextMessage(child: ChildProcess): Promise<Message> {
  return new Promise((resolve, reject) => {
    const remove = () => {
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    const onMessage = (message: unknown) => { remove(); resolve(message as Message) }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => { remove(); reject(new Error('Fixture exited before handshake: ' + String(code) + '/' + String(signal))) }
    const onError = (error: Error) => { remove(); reject(error) }
    child.once('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

it.each(['starting', 'running'] as const)('quarantines a crashed %s claim and never replays its prompt', async (phase) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-automation-crash-'))
  cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 5 }))
  vi.stubEnv('DSH_HOME', home)
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm', fileURLToPath(new URL('./fixtures/crash-process.ts', import.meta.url)), home, phase,
  ], { env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('exit', (code, signal) => { resolve({ code, signal }) })
    child.once('error', reject)
  })
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited
  })
  const ready = await nextMessage(child)
  expect(ready).toMatchObject({ type: 'ready', calls: 0, snapshot: { status: 'ready', definitions: [], activeRuns: [] } })
  const barrier = nextMessage(child)
  child.send({ type: 'run' })
  const stopped = await barrier
  expect(stopped).toMatchObject({ type: 'barrier', phase, calls: phase === 'starting' ? 0 : 1 })
  if (stopped.snapshot.status !== 'ready') throw new Error('Missing committed snapshot')
  const [definition] = stopped.snapshot.definitions
  const [claim] = stopped.snapshot.activeRuns
  if (definition === undefined || claim === undefined) throw new Error('Missing durable claim')
  expect(definition.enabled).toBe(true)
  expect(claim.status).toBe(phase)
  child.kill()
  await exited
  const reopened = await bootRuntimeFixture({ home })
  cleanup.push(reopened.dispose)
  const runtime = reopened.ctx.automationRuntime
  expect(runtime.snapshot()).toMatchObject({
    status: 'ready', activeRuns: [], definitions: [expect.objectContaining({ id: definition.id, enabled: false, needsReview: true })],
  })
  const [recovered] = runtime.runs(definition.id, null, 10).runs
  expect(recovered).toMatchObject({ id: claim.id, sessionId: claim.sessionId, messageId: claim.messageId, status: phase === 'starting' ? 'ambiguous' : 'interrupted', reason: 'owner-interrupted' })
  expect(recovered?.finishedAt).not.toBeNull()
  expect(reopened.model.requests).toEqual([])
  expect(await runtime.run({ id: definition.id, expectedRevision: definition.revision, requestId: claim.requestId! })).toEqual(recovered)
  expect(reopened.model.requests).toEqual([])
})
