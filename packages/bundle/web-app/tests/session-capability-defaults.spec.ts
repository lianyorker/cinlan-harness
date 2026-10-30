/** Shipped session capabilities compose over base and remain profile-patchable. */
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import * as AllPrompts from '@deepseek-ai/dsh-session-title-all-prompts-llm'

function compose() {
  const paths = ['../../base/cordis.patch.yml', '../cordis.patch.yml', '../../cinlan-web/cordis.patch.yml']
  return paths.reduce<EntryOptions[]>((rows, path) => applyEntryPatches(rows,
    loadOverlayPatches('session-capability-defaults', fileURLToPath(new URL(path, import.meta.url))),
    (message) => { throw new Error(message) }), [])
}

it('loads one native read-only Session Inspector without a debugging or capture backend', () => {
  const rows = compose()
  expect(rows.filter(row => row.id === 'session-inspector')).toEqual([
    { id: 'session-inspector', name: '@deepseek-ai/dsh-client-ui-session-inspector' },
  ])
  expect(rows.some(row => row.name === '@deepseek-ai/dsh-experimental-inspector')).toBe(false)
  expect(rows.some(row => row.name === '@deepseek-ai/dsh-experimental-session-inspector')).toBe(false)
})

it('composes exactly one native Auto backend with bounded review configuration', () => {
  const rows = compose()
  expect(rows.filter(row => row.id === 'auto-review')).toEqual([{
    id: 'auto-review', name: '@deepseek-ai/dsh-auto-review',
    config: { maxInputBytes: 262144, maxOutputTokens: 1024, timeoutMs: 60000 },
  }])
  expect(rows.some(row => row.name === '@deepseek-ai/dsh-experimental-auto-review')).toBe(false)
})

it('loads exactly one all-prompts title provider over the base composition', () => {
  const rows = compose()
  const providers = rows.filter(row => row.disabled !== true && row.name?.includes('session-title-') && row.name.endsWith('-llm'))
  expect(providers).toHaveLength(1)
  expect(providers[0]).toMatchObject({ name: '@deepseek-ai/dsh-session-title-all-prompts-llm', config: {
    targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 60000,
  } })
})

class TitleAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'Loaded all prompts title' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('boots shipped title rows through Loader and persists automatic titles without overwriting a user rename', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.session = SessionStore
  ctx.loader.builtins.projections = SessionProjectionRegistry
  ctx.loader.builtins.llm = LlmRuntime
  ctx.loader.builtins.title = SessionTitleService
  ctx.loader.builtins.allPrompts = AllPrompts
  const rows = compose().filter(row => ['session-title', 'session-title-all-prompts-llm'].includes(row.id))
  await ctx.loader.root.update([
    { id: 'session', name: 'cordis:session' },
    { id: 'projections', name: 'cordis:projections' },
    { id: 'llm', name: 'cordis:llm' },
    ...rows.map(row => ({ ...row, name: row.id === 'session-title' ? 'cordis:title' : 'cordis:allPrompts' })),
  ])
  await ctx.loader.await()
  const adapter = new TitleAdapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  const session = ctx.sessions.create(SessionId('shipped-title-loader'))
  session.append('turn/start', { turn: 1 })
  const append = (text: string) => session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const first = append('First prompt')
  session.append('request/header', { header: { config: { provider: 'fixture', model: 'fixture' } }, reason: 'initial' })
  await vi.waitFor(() => { expect(ctx.sessionTitle.get(session)?.source.kind).toBe('provider') })
  const second = append('Follow-up prompt')
  session.append('request/header', { header: { config: { provider: 'fixture', model: 'fixture' } }, reason: 'change' })
  await vi.waitFor(() => { expect(ctx.sessionTitle.get(session)?.messageSeqs).toEqual([first.seq, second.seq]) })
  expect(adapter.requests).toHaveLength(2)
  ctx.sessionTitle.rename(session, 'Pinned by user')
  append('Keep the pinned title')
  session.append('request/header', { header: { config: { provider: 'fixture', model: 'fixture' } }, reason: 'change' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await ctx.fiber.dispose()
  expect(adapter.requests).toHaveLength(2)
  expect(session.snapshotEvents().filter(event => event.type === 'session/title').at(-1)?.data)
    .toMatchObject({ title: 'Pinned by user', source: { kind: 'user' } })
})

it('defers the in-memory search index and permits deployment opt-out', () => {
  const rows = compose()
  expect(rows.find(row => row.id === 'session-query-sqlite')?.config).toEqual({ path: ':memory:', openAt: 'first-search' })
  const overridden = applyEntryPatches(rows, [{ id: 'session-query-sqlite', config: { path: ':memory:', openAt: 'never' } }],
    (message) => { throw new Error(message) })
  expect(overridden.find(row => row.id === 'session-query-sqlite')?.config).toEqual({ path: ':memory:', openAt: 'never' })
})

it('configures the Host working directory before terminal capabilities', () => {
  const rows = compose()
  expect(rows.find(row => row.id === 'working-directory')).toMatchObject({
    name: '@deepseek-ai/dsh-working-directory',
    config: { defaultDirectory: { __jsExpr: 'process.cwd()' } },
  })
  expect(rows.find(row => row.id === 'terminal-controller')?.name)
    .toBe('@deepseek-ai/dsh-api-terminal-controller')
})

it('declares every Client service required by the terminal controller', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../../api/terminal-controller/package.json', import.meta.url), 'utf8')) as {
    dsh?: { client?: { inject?: string[] } }
  }
  expect(pkg.dsh?.client?.inject).toEqual(expect.arrayContaining([
    '@deepseek-ai/dsh-api-gateway',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-connection',
  ]))
})

function descendants(rows: EntryOptions[]): EntryOptions[] {
  return rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? descendants(row.config as EntryOptions[]) : [])])
}

it.each(['standard', 'ptc', 'cordis'])('requires the default-off Host policy in the %s preset', (preset) => {
  const rows = loadOverlayPatches('session-capability-defaults', fileURLToPath(new URL(
    '../presets/' + preset + '.patch.yml', import.meta.url))).flatMap(patch => patch.insert ?? [])
  const config = rows[0]!.config as { plugins: EntryOptions[] }
  const tools = descendants(config.plugins).filter(row => row.id === 'tool-ralph')
  expect(tools).toHaveLength(1)
  expect(tools[0]).toMatchObject({ name: '@deepseek-ai/dsh-tool-ralph', disabled: false, config: { requirePolicy: true } })
  expect(compose().find(row => row.id === 'ralph-policy')).toMatchObject({
    name: '@deepseek-ai/dsh-tool-ralph/settings', config: { enabled: false, maxRounds: 64 },
  })
})
