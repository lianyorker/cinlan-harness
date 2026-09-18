// @vitest-environment jsdom
/** Loader composition binds the real API source, renderer hooks, metadata and command callbacks. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { RemoteStream, type RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client'
import AutomationClient from '@deepseek-ai/dsh-api-automation-controller/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { AutomationRemote } from '@deepseek-ai/dsh-api-automation-controller/src/client/remote.ts'
import * as plugin from '../src/client/index.ts'
import type { AutomationInjected } from '../src/client/types.ts'
import { definition, run, snapshot, catalog } from './fixtures.client.ts'
import { definitionDraft } from '../src/client/presentation.ts'
import { en } from '../src/client/locales.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  cleanup()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function load() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automation-ui-'))
  roots.push(root)
  const config = join(root, 'cordis.yml')
  await writeFile(config, [
    '- id: slots', '  name: test-slots', '- id: host', '  name: test-host',
    '- id: client', "  name: '@deepseek-ai/dsh-api-automation-controller'",
    '- id: ui', "  name: '@deepseek-ai/dsh-client-ui-settings-automation'", '',
  ].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  const remote: AutomationRemote = {
    snapshot: async () => ok(snapshot().runtime!), catalog: async () => ok(catalog()),
    create: vi.fn(async () => ok(definition())), update: vi.fn(async () => ok(definition())), delete: vi.fn(async () => ok(undefined)),
    run: vi.fn(async () => ok(run())), cancel: vi.fn(async () => ok(undefined)),
    runs: vi.fn(async () => ok({ runs: [run()], nextCursor: null })),
    previewSchedule: async () => ok([]),
    async *follow(signal = new AbortController().signal) {
      yield { type: 'baseline', value: snapshot().runtime! }
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    },
  }
  const generation = { id: 1, host: { home: '/fixture' } }
  const connection = { isLoopback: true, generation: { getSnapshot: () => generation, subscribe: () => () => {} } }
  const opened = vi.fn()
  let locale!: LocaleRuntime
  const host = { apply(context: Context) {
    locale = new LocaleRuntime(context)
    locale.setLocale('en')
    context.provide('locale', locale)
    new SettingsMetadataService(context)
    context.provide('sessions', { open: opened } as never)
    context.provide('connection', connection as never)
    context.provide('remote', { automation: remote, $stream: <T,>(options: RemoteStreamOptions<T>) => new RemoteStream(connection, options) } as never)
    context.provide('remote.automation', remote as never)
  } }
  const modules = new Map<string, unknown>([['test-slots', SlotRegistry], ['test-host', host],
    ['@deepseek-ai/dsh-api-automation-controller', AutomationClient], ['@deepseek-ai/dsh-client-ui-settings-automation', plugin]])
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(name: string) {
    if (!modules.has(name)) throw new Error('Unknown test module: ' + name)
    return modules.get(name)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  ctx.slots.install(createSlotRenderer())
  ctx.slots.installLocale(locale)
  const absent = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  ctx.slots.installScope('session', { current: { getSnapshot: () => absent, subscribe: () => () => {} }, resolve: () => undefined })
  await vi.waitFor(() => { expect(ctx.automationClient.getSnapshot().catalogLoading).toBe(false) })
  const owner = { inject: ['slots'], apply(context: Context) {
    context.effect(() => context.slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' }, 'settings.section.icon': { kind: 'keyed', scope: 'root' },
    } } as never, (props: PropsRenderSlots<'settings.section' | 'settings.section.icon'>) => <>{props.renderSlot('settings.section', { close() {} })}</>))
  } }
  return { ctx, remote, opened, locale, owner }
}

describe('automation settings Loader composition', () => {
  it('waits for Settings declaration and binds actual API commands and framework source hook', async () => {
    const b = await load()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    const owner = b.ctx.plugin(b.owner)
    await owner.await()
    await vi.waitFor(() => { expect(b.ctx.slots.entries('settings.section')).toHaveLength(1) })
    const view = render(<>{b.ctx.slots.renderSlot('root', {})}</>)
    await screen.findByRole('heading', { name: en.title, level: 1 })
    fireEvent.click(screen.getByRole('button', { name: en.run }))
    await waitFor(() => {
      expect(b.remote.run).toHaveBeenCalledWith(expect.objectContaining({ id: definition().id, expectedRevision: 7 }))
    })
    fireEvent.click(screen.getByRole('button', { name: en.showRuns }))
    await screen.findByText(en.completedHelp)
    fireEvent.click(screen.getByRole('button', { name: en.openSession }))
    expect(b.opened).toHaveBeenCalledWith(run().sessionId)
    const entry = b.ctx.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => AutomationInjected)()
    expect(injected.hooks.automation).toBe(b.ctx.automationClient.source)
    await injected.create(definitionDraft(definition()))
    await injected.update({ id: definition().id, expectedRevision: 7, enabled: false, draft: definitionDraft(definition()) })
    await injected.cancel(run().id)
    await injected.deleteTask({ id: definition().id, expectedRevision: 7 })
    await injected.refresh()
    await injected.loadMoreRuns()
    expect(b.remote.cancel).toHaveBeenCalledWith({ runId: run().id })
    expect(b.remote.delete).toHaveBeenCalledWith({ id: definition().id, expectedRevision: 7 })
    const metadata = b.ctx.settingsMetadata.getSnapshot()
    expect(metadata.items.map(item => item.anchorId)).toEqual(['tasks', 'draft', 'journal'])
    for (const value of ['Private prompt', 'private/workspace', 'Check workspace']) expect(JSON.stringify(metadata)).not.toContain(value)
    view.unmount()
    await owner.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    expect(b.ctx.settingsMetadata.getSnapshot().sections).toEqual([])
    const replacement = b.ctx.plugin(b.owner)
    await replacement.await()
    await vi.waitFor(() => { expect(b.ctx.slots.entries('settings.section')).toHaveLength(1) })
    expect(b.ctx.settingsMetadata.getSnapshot().items).toHaveLength(3)
    b.locale.setLocale('zh')
    expect(b.ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe('任务计划')
    const ui = [...b.ctx.loader.entries()].find(row => row.options.name === '@deepseek-ai/dsh-client-ui-settings-automation')!
    await ui.fiber!.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    expect(b.ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(b.ctx.slots.entries('settings.section.icon')).toHaveLength(0)
  })
})
