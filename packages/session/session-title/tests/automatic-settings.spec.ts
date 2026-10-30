/** Loader-backed automatic title changes preserve the active service and existing titles. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { expect, it, onTestFinished, vi } from 'vitest'
import SessionTitleService, { SessionTitleProviderId } from '../src/index.ts'
import type { SessionTitleProviderRequest, SessionTitleProviderResult } from '../src/index.ts'

it('cancels automatic work on a live disable while preserving explicit refresh and future re-enable', async () => {
  const ctx = new Context()
  const release = Promise.withResolvers<SessionTitleProviderResult>()
  onTestFinished(async () => {
    release.resolve({ title: 'Late title', messageSeqs: [] })
    await ctx.fiber.dispose()
  })
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.sessions = SessionStore
  ctx.loader.builtins.projections = SessionProjectionRegistry
  ctx.loader.builtins.title = SessionTitleService
  const config = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80, automaticEnabled: true }
  await ctx.loader.root.update([
    { id: 'sessions', name: 'cordis:sessions' },
    { id: 'projections', name: 'cordis:projections' },
    { id: 'session-title', name: 'cordis:title', config },
  ])
  await ctx.loader.await()
  const serviceUid = ctx.loader.resolve('session-title').fiber!.uid
  const requests: SessionTitleProviderRequest[] = []
  ctx.sessionTitle.register({
    id: SessionTitleProviderId('settings-fixture'), automatic: 'all-prompts',
    async generate(request) {
      requests.push(request)
      if (requests.length === 1) return release.promise
      return { title: 'Selected title', messageSeqs: request.messages.map(message => message.seq) }
    },
  })
  const session = ctx.sessions.create(SessionId('automatic-settings'))
  session.append('turn/start', { turn: 1 })
  const prompt = (text: string) => session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const route = () => session.append('request/header', {
    header: { config: { provider: 'fixture', model: 'fixture' } }, reason: 'change',
  })
  const first = prompt('Original fallback')
  route()
  await vi.waitFor(() => { expect(requests).toHaveLength(1) })
  await ctx.loader.update('session-title', { config: { ...config, automaticEnabled: false } })
  await ctx.loader.await()
  expect(ctx.loader.resolve('session-title').fiber!.uid).toBe(serviceUid)
  expect(requests[0]!.signal.aborted).toBe(true)
  release.resolve({ title: 'Do not commit', messageSeqs: [first.seq] })
  await vi.waitFor(() => { expect(ctx.sessionTitle.get(session)?.source.kind).toBe('fallback') })
  prompt('No automatic request')
  route()
  await ctx.sessionTitle.refresh(session)
  expect(requests).toHaveLength(2)
  expect(ctx.sessionTitle.get(session)?.title).toBe('Selected title')
  await ctx.loader.update('session-title', { config })
  await ctx.loader.await()
  expect(ctx.loader.resolve('session-title').fiber!.uid).toBe(serviceUid)
  expect(requests).toHaveLength(2)
  prompt('Queued before disable')
  await ctx.loader.update('session-title', { config: { ...config, automaticEnabled: false } })
  await ctx.loader.await()
  route()
  await ctx.sessionTitle.refresh(session)
  expect(requests).toHaveLength(3)
  await ctx.loader.update('session-title', { config })
  await ctx.loader.await()
  prompt('Enabled again')
  route()
  await vi.waitFor(() => { expect(requests).toHaveLength(4) })
  ctx.sessionTitle.rename(session, 'Pinned by hand')
  prompt('Keep the manual name')
  route()
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await ctx.fiber.dispose()
  expect(requests).toHaveLength(4)
  expect(session.snapshotEvents().filter(event => event.type === 'session/title').at(-1)?.data)
    .toMatchObject({ title: 'Pinned by hand', source: { kind: 'user' } })
  expect(session.snapshotEvents().filter(event => event.type === 'session/title').some(event => event.data.title === 'Do not commit'))
    .toBe(false)
})
