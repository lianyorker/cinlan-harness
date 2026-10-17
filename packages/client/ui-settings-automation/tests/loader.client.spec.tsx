// @vitest-environment jsdom
/** Loader composition registers the Schedule entry point and binds the layout action. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import * as plugin from '../src/client/index.ts'
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
    '- id: ui', "  name: '@deepseek-ai/dsh-client-ui-settings-automation'", '',
  ].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  const selectPanel = vi.fn()
  let locale!: LocaleRuntime
  const host = { apply(context: Context) {
    locale = new LocaleRuntime(context)
    locale.setLocale('en')
    context.provide('locale', locale)
    new SettingsMetadataService(context)
    context.provide('layout', { selectPanel } as never)
  } }
  const modules = new Map<string, unknown>([['test-slots', SlotRegistry], ['test-host', host],
    ['@deepseek-ai/dsh-client-ui-settings-automation', plugin]])
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
  ctx.slots.installScope('session', { current: { getSnapshot: () => absent, subscribe: () => () => {} }, bindingSource: () => undefined as never, renderArea: () => null } as never)
  const owner = { inject: ['slots'], apply(context: Context) {
    context.effect(() => context.slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' }, 'settings.section.icon': { kind: 'keyed', scope: 'root' },
    } } as never, (props: PropsRenderSlots<'settings.section' | 'settings.section.icon'>) =>
      <>{props.renderSlot('settings.section', { close: () => { closed() } })}</>))
  } }
  const closed = vi.fn()
  return { ctx, selectPanel, closed, locale, owner }
}

describe('automation settings Loader composition', () => {
  it('waits for the Settings declaration, registers the Schedule entry, and opens the manager panel', async () => {
    const b = await load()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    const owner = b.ctx.plugin(b.owner)
    await owner.await()
    await vi.waitFor(() => { expect(b.ctx.slots.entries('settings.section')).toHaveLength(1) })
    const view = render(<>{b.ctx.slots.renderSlot('root', {})}</>)
    await screen.findByRole('button', { name: en.openAutomation })
    expect(b.selectPanel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en.openAutomation }))
    expect(b.selectPanel).toHaveBeenCalledWith('schedules')
    expect(b.closed).toHaveBeenCalledOnce()

    const metadata = b.ctx.settingsMetadata.getSnapshot()
    expect(metadata.sections).toEqual([{
      sectionId: 'schedule', groupId: 'execution', description: expect.any(Function),
    }])
    expect(metadata.items.map(item => item.anchorId)).toEqual(['tasks'])
    expect(b.ctx.slots.entries('settings.section.icon')[0]?.options).toMatchObject({ key: 'schedule' })

    view.unmount()
    await owner.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    expect(b.ctx.settingsMetadata.getSnapshot().sections).toEqual([])
    const replacement = b.ctx.plugin(b.owner)
    await replacement.await()
    await vi.waitFor(() => { expect(b.ctx.slots.entries('settings.section')).toHaveLength(1) })
    b.locale.setLocale('zh')
    expect(b.ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe('任务计划')
    const ui = [...b.ctx.loader.entries()].find(row => row.options.name === '@deepseek-ai/dsh-client-ui-settings-automation')!
    await ui.fiber!.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    expect(b.ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(b.ctx.slots.entries('settings.section.icon')).toHaveLength(0)
  })
})
