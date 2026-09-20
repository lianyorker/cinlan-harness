/** Recorded native actions use real Loader Session queries and one retained execution lease. */
import { createTrustedConnectionAccess, HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { readFile, writeFile, mkdir, realpath, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { FsError } from '@deepseek-ai/dsh-fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { SessionId, SessionLogOffset, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHarness } from '../../../execution-host/execution-binding/tests/harness.ts'
import { createSessionTestController } from '../../../api/session-controller/tests/test-remote.ts'
import { registerPresentOpen } from '../src/present-open.ts'
import { presentedFileUrl, PRESENT_OPEN_PATH } from '../src/presented.ts'

vi.mock('@deepseek-ai/dsh-ssh', async () => {
  const { FixtureSsh } = await import('../../../execution-host/execution-binding/tests/fixture-ssh.ts')
  return { default: FixtureSsh, SshConnection: FixtureSsh }
})
afterEach(() => { vi.restoreAllMocks() })

async function fixture(recordedData?: unknown) {
  const h = await createHarness()
  const { ctx, localRoot: cwd } = h
  const file = { path: '日记模板.docx' }
  await writeFile(join(cwd, file.path), Uint8Array.of(80, 75, 0, 255))
  const publish = (id: string, sessionCwd: string | undefined, seed?: readonly SessionEvent[]): Session => {
    const session = ctx.sessions.prepare(SessionId(id), {
      ...(seed === undefined ? {} : { seed, inheritedEventCount: SessionLogOffset(seed.length) }),
      meta: { ...(sessionCwd === undefined ? {} : { cwd: sessionCwd }), ...(seed === undefined ? {} : { isSeeded: true, parentSession: SessionId('owner') }) },
    })
    ctx.effect(() => ctx.sessions.enter(session))
    return session
  }
  const session = publish('owner', cwd)
  const appendDelivery = (target: Session, path = file.path): number => {
    const event = target.append('deliverables/presented', { turn: 1, callId: ToolCallId('present-call'), files: [{ path }] })
    return event.seq
  }
  for (let index = 0; index < 7; index++) {
    session.append('session/title', { title: 'Fixture ' + String(index), messageSeqs: [], source: { kind: 'user' } })
  }
  const seq = recordedData === undefined ? appendDelivery(session)
    : session.append('deliverables/presented', recordedData as SessionEvent<'deliverables/presented'>['data']).seq
  const readEvent = vi.spyOn(ctx.sessionQuery, 'readEvent')
  const opener = vi.fn(async (_path: string, _signal: AbortSignal) => {})
  const reveal = vi.fn(async (_path: string, _signal: AbortSignal) => {})
  const controller = createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd, openPath: opener, revealPath: reveal, canOpenPath: () => true,
  })
  const resolveAgent = vi.spyOn(controller, 'resolveAgent')
  vi.spyOn(controller, 'workspaceDesktop').mockReturnValue({ name: 'desktop', available: true, fileManager: 'finder' })
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const fiber = ctx.plugin({ inject: ['connection', 'sessionQuery', 'sessionController', 'executionBindings'], apply: registerPresentOpen })
  await fiber
  const handler = connection.createSharedFetchHandler('/api', createTrustedConnectionAccess())
  const open = (query = '?sessionId=owner&seq=' + String(seq) + '&index=0', signal?: AbortSignal) => handler.fetch(new Request(
    'http://localhost' + PRESENT_OPEN_PATH + query, { method: 'POST', signal: signal ?? null },
  ))
  return { ...h, cwd, fiber, file, session, seq, publish, appendDelivery, readEvent, open, opener, reveal, handler, resolveAgent }
}

describe('Presented workspace file native open route', () => {
  it('ignores client path parameters and opens only the recorded source', async () => {
    const { cwd, file, open, opener } = await fixture()
    expect((await open('?sessionId=owner&seq=7&index=0&path=C%3A%2Fnot-recorded.exe&cwd=C%3A%2F')).status).toBe(204)
    expect(opener.mock.lastCall?.[0]).toBe(await realpath(join(cwd, file.path)))
  })

  it('refuses provider-denied sources before invoking the desktop', async () => {
    const { ctx, open, opener } = await fixture()
    vi.spyOn(ctx.fs, 'lstat').mockRejectedValueOnce(new FsError('Provider denied path', 'FS_SANDBOX_DENIED'))
    expect((await open()).status).toBe(404)
    expect(opener).not.toHaveBeenCalled()
  })

  it('opens the source itself with current bytes and leaves it intact at disposal', async () => {
    const { cwd, open, file, fiber, opener, handler, ctx } = await fixture()
    const admit = vi.spyOn(ctx.attachments, 'admitPromptContent')
    const source = await realpath(join(cwd, file.path))
    expect(presentedFileUrl(SessionId('owner'), 7, 0)).toBe(`${PRESENT_OPEN_PATH}?sessionId=owner&seq=7&index=0`)
    expect((await handler.fetch(new Request(`http://localhost${PRESENT_OPEN_PATH}`))).status).toBe(404)
    expect((await handler.fetch(new Request('http://localhost/api/present.download?sessionId=owner&seq=7&index=0'))).status).toBe(404)
    for (const contents of ['current source', 'edited source']) {
      await writeFile(source, contents)
      const response = await open()
      expect(response.status).toBe(204)
      expect(response.headers.get('content-disposition')).toBeNull()
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(opener.mock.lastCall?.[0]).toBe(source)
      expect(await readFile(opener.mock.lastCall![0], 'utf8')).toBe(contents)
    }
    expect(admit).not.toHaveBeenCalled()
    await fiber.dispose()
    expect(await readFile(source, 'utf8')).toBe('edited source')
    expect((await open()).status).toBe(404)
  })

  it('resolves inherited declarations in the viewed fork workspace', async () => {
    const { root, file, publish, session, open, opener } = await fixture()
    const fork = join(root, 'fork')
    await mkdir(fork)
    await writeFile(join(fork, file.path), 'child source')
    publish('fork', fork, session.snapshotEvents())
    expect((await open('?sessionId=fork&seq=7&index=0')).status).toBe(204)
    expect(opener.mock.lastCall?.[0]).toBe(await realpath(join(fork, file.path)))
  })

  it.each(['', '?seq=7&index=0', '?sessionId=owner&index=0', '?sessionId=owner&seq=7',
    '?sessionId=owner&seq=-1&index=0', '?sessionId=owner&seq=7&index=0.1',
    '?sessionId=owner&seq=9007199254740992&index=0', '?sessionId=owner&seq=7&index=9007199254740992',
  ])('rejects invalid coordinates before reading: %s', async (query) => {
    const { open, readEvent } = await fixture()
    expect((await open(query)).status).toBe(400)
    expect(readEvent).not.toHaveBeenCalled()
  })

  it('refuses unrelated Sessions, absent events, and undeclared file indices', async () => {
    const { open, session, opener } = await fixture()
    expect((await open('?sessionId=other&seq=7&index=0')).status).toBe(404)
    expect((await open('?sessionId=owner&seq=8&index=0')).status).toBe(404)
    expect((await open('?sessionId=owner&seq=7&index=1')).status).toBe(404)
    const unrelated = session.append('session/title', { title: 'Unrelated event', messageSeqs: [], source: { kind: 'user' } })
    expect((await open('?sessionId=owner&seq=' + unrelated.seq + '&index=0')).status).toBe(404)
    expect(opener).not.toHaveBeenCalled()
  })

  it.each([null, [], 'invalid', {}, { turn: 1, callId: 'call', files: null },
    { turn: 1, callId: 'call', files: [null] }, { turn: 1, callId: 'call', files: [{ path: '' }] },
    { turn: 1, callId: 'call', files: [{ path: 'a', description: 1 }] },
  ])('refuses malformed recorded delivery data: %j', async (data) => {
    const { open, opener } = await fixture(data)
    expect((await open()).status).toBe(404)
    expect(opener).not.toHaveBeenCalled()
  })

  it('reports removed files and directories without launching', async () => {
    const { cwd, file, open, opener, appendDelivery, session } = await fixture()
    await unlink(join(cwd, file.path))
    expect((await open()).status).toBe(404)
    const seq = appendDelivery(session, '.')
    expect((await open('?sessionId=owner&seq=' + String(seq) + '&index=0')).status).toBe(404)
    expect(opener).not.toHaveBeenCalled()
  })

  it('opens external regular files through absolute and relative paths but refuses final symlinks', async () => {
    const { ctx, root, cwd, file, open, opener, appendDelivery, session } = await fixture()
    const outside = join(root, 'outside.txt')
    await writeFile(outside, 'outside')
    const entry = (await ctx.fs.lstat(file.path, { cwd }))!
    vi.spyOn(ctx.fs, 'lstat').mockResolvedValueOnce({ ...entry, type: 'symlink' })
    expect((await open()).status).toBe(404)
    expect(opener).not.toHaveBeenCalled()
    for (const path of ['../outside.txt', outside]) {
      const seq = appendDelivery(session, path)
      expect((await open('?sessionId=owner&seq=' + String(seq) + '&index=0')).status).toBe(204)
      expect(opener.mock.lastCall?.[0]).toBe(await realpath(outside))
    }
  })

  it('reports query and launcher failures without leaking Host paths and allows retry', async () => {
    const { open, readEvent, opener } = await fixture()
    readEvent.mockRejectedValueOnce(new SessionQueryError('corrupt', 'SESSION_QUERY_CORRUPT_SESSION'))
    expect((await open()).status).toBe(500)
    opener.mockRejectedValueOnce(new Error('/private/host/path'))
    const response = await open()
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('/private/host/path')
    expect((await open()).status).toBe(204)
  })

  it('honors cancellation before lookup', async () => {
    const { open, readEvent } = await fixture()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(open(undefined, controller.signal)).rejects.toThrow('cancelled')
    expect(readEvent).not.toHaveBeenCalled()
  })

  it('disposal aborts and awaits a pending native launch', async () => {
    const entered = Promise.withResolvers<undefined>()
    const aborted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const { open, fiber, opener } = await fixture()
    opener.mockImplementation(async (_request, signal) => {
      signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
      entered.resolve(undefined)
      await release.promise
      signal.throwIfAborted()
      return
    })
    const request = open().catch((error: unknown) => error)
    let disposal: Promise<void> | undefined
    try {
      await Promise.race([entered.promise, request.then(() => { throw new Error('Request settled before native launch') })])
      let disposed = false
      disposal = fiber.dispose().then(() => { disposed = true })
      await aborted.promise
      expect(disposed).toBe(false)
    } finally {
      release.resolve(undefined)
      await Promise.all([request, disposal])
    }
  })
})


it('reports the serving desktop and reveals only an authorized declared source', async () => {
  const { cwd, file, open, opener, reveal, handler, session, appendDelivery } = await fixture()
  const info = await handler.fetch(new Request('http://localhost/api/present.host'))
  expect(await info.json()).toEqual({ name: 'desktop', available: true, fileManager: 'finder' })
  expect((await open('?sessionId=owner&seq=7&index=0&action=reveal')).status).toBe(204)
  expect(reveal).toHaveBeenCalledWith(await realpath(join(cwd, file.path)), expect.any(AbortSignal))
  expect(opener).not.toHaveBeenCalled()
  expect((await open('?sessionId=owner&seq=7&index=0&action=delete')).status).toBe(400)
  const seq = appendDelivery(session, '..')
  expect((await open('?sessionId=owner&seq=' + String(seq) + '&index=0&action=reveal')).status).toBe(404)
  expect(reveal).toHaveBeenCalledOnce()
})

it('refuses native actions when the configured Host desktop is unavailable', async () => {
  const { ctx, open, opener, handler } = await fixture()
  vi.spyOn(ctx.sessionController, 'workspaceDesktop').mockReturnValue({ name: 'desktop', available: false, fileManager: 'finder' })
  expect(await (await handler.fetch(new Request('http://localhost/api/present.host'))).json()).toMatchObject({ available: false })
  for (const action of ['open', 'reveal']) {
    expect((await open(`?sessionId=owner&seq=7&index=0&action=${action}`)).status).toBe(409)
  }
  expect(opener).not.toHaveBeenCalled()
})


it('refuses native opening without a matching Host mapping even when a same-name Host file exists', async () => {
  const { ctx, open, opener } = await fixture()
  const mapping = vi.spyOn(ctx.fs, 'processPathFromHostPath').mockReturnValue(undefined)
  expect((await open()).status).toBe(422)
  mapping.mockReturnValue('/another-filesystem/file')
  expect((await open()).status).toBe(422)
  expect(opener).not.toHaveBeenCalled()
})

it('opens a viewed child Session without activating an Agent', async () => {
  const { session, publish, cwd, open, opener, resolveAgent } = await fixture()
  publish('child', cwd, session.snapshotEvents())
  expect((await open('?sessionId=child&seq=7&index=0')).status).toBe(204)
  expect(opener).toHaveBeenCalledOnce()
  expect(resolveAgent).not.toHaveBeenCalled()
})

it('refuses Sessions without an execution directory instead of opening the deployment workspace', async () => {
  const { publish, appendDelivery, ctx, open, opener } = await fixture()
  const session = publish('no-cwd', undefined)
  const seq = appendDelivery(session)
  const stat = vi.spyOn(ctx.fs, 'stat')
  const lstat = vi.spyOn(ctx.fs, 'lstat')
  expect((await open('?sessionId=no-cwd&seq=' + String(seq) + '&index=0')).status).toBe(500)
  expect(opener).not.toHaveBeenCalled()
  expect(stat).not.toHaveBeenCalled()
  expect(lstat).not.toHaveBeenCalled()
})

it('retains exactly one real lease through recorded-file verification and native dispatch', async () => {
  const { ctx, open, opener } = await fixture()
  const lease = vi.spyOn(ctx.executionBindings, 'forSession')
  const dispatch = vi.spyOn(ctx.sessionController, 'openExecutionPath')
  expect((await open()).status).toBe(204)
  expect(lease).toHaveBeenCalledOnce()
  const result = lease.mock.results[0]!
  if (result.type !== 'return') throw new Error('Execution lease acquisition did not return')
  const captured = await result.value
  expect(dispatch.mock.calls[0]?.[0]).toBe(captured)
  expect(opener).toHaveBeenCalledOnce()
  expect(captured.signal.aborted).toBe(true)
})

it.each(['open', 'reveal'] as const)('refuses remote %s before any local filesystem or native dispatch', async (action) => {
  const h = await fixture()
  const peer = await h.remote('remote file')
  const session = h.publish('remote-owner', '/project')
  session.append('execution/bound', { binding: peer.binding })
  const seq = h.appendDelivery(session, 'shared.txt')
  const stat = vi.spyOn(h.ctx.fs, 'stat')
  const lstat = vi.spyOn(h.ctx.fs, 'lstat')
  const resolve = vi.spyOn(h.ctx.fs, 'resolve')
  const dispatch = vi.spyOn(h.ctx.sessionController, 'openExecutionPath')
  const response = await h.open('?sessionId=remote-owner&seq=' + String(seq) + '&index=0&action=' + action)
  expect(response.status).toBe(501)
  expect(stat).not.toHaveBeenCalled()
  expect(lstat).not.toHaveBeenCalled()
  expect(resolve).not.toHaveBeenCalled()
  expect(dispatch).not.toHaveBeenCalled()
  expect(h.opener).not.toHaveBeenCalled()
  expect(h.reveal).not.toHaveBeenCalled()
  expect(h.ctx.agents.list()).toEqual([])
})
