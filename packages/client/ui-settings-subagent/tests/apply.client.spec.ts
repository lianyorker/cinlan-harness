/** What the browser half registers, when, what refreshes the model catalogue, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, NS } from '../src/client/index.ts'
import type { SubagentLimitsCardFace, SubagentModelSelectionCardFace } from '../src/client/index.ts'
import { SubagentModelSelectionCardController } from '../src/client/subagent-model-selection-card-controller.ts'
import { apply as hostApply } from '../src/index.ts'

/** One Host view of a served namespace. */
function view(ns: string, revision = 0) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision }
}

/** @param served - namespaces the Host describes; omitted answers a failed read. */
async function bench(served?: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const models = vi.fn(() => Promise.resolve({ ok: true as const, value: { groups: [], failures: [] } }))
  const describeSettings = vi.fn(() => Promise.resolve(served === undefined
    ? { ok: false, error: new RemoteError('gateway/internal', 'no provider', {}) }
    : { ok: true, value: { writable: true, hasDocument: true, namespaces: served.map(ns => view(ns)) } }))
  const remote = new TestRemote(ctx, {
    session: { modelCatalog: models },
    settings: { describe: describeSettings },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describeSettings, models, remote }
}

/** The settings shell's section slot, as its owner declares it. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-settings-subagent apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.session', 'configForms', 'settingsMetadata'])
  })

  it('registers one page per served namespace, titled in the active locale', async () => {
    const { ctx, slots } = await bench(['subagent', 'subagent-model-selection-settings'])
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(2) })
    const metadata = ctx.settingsMetadata.getSnapshot()
    expect(metadata.sections).toHaveLength(2)
    expect(metadata.sections).toEqual(expect.arrayContaining([
      { sectionId: 'subagent', groupId: 'ai', description: expect.any(Function) },
      { sectionId: 'subagent-limits', groupId: 'ai', description: expect.any(Function) },
    ]))
    expect(metadata.items.find(item => item.sectionId === 'subagent')).toMatchObject({
      id: 'subagent-model-selection', anchorId: 'subagent-model-selection',
    })
    expect(metadata.items.find(item => item.sectionId === 'subagent-limits')).toMatchObject({
      id: 'subagent-limits', anchorId: 'subagent-limits',
    })
    const byId = (id: string) => slots.entries('settings.section').find(entry => entry.options.id === id)!
    expect(byId('subagent').options).toMatchObject({ order: 21 })
    expect(byId('subagent-limits').options).toMatchObject({ order: 22 })
    expect(byId('subagent').locale).toBe(NS)
    expect(byId('subagent-limits').locale).toBe(NS)
    const modelsFace = (byId('subagent').inject as () => Pick<SubagentModelSelectionCardFace, 'hooks'>)()
    expect(Object.keys(modelsFace.hooks)).toEqual(['subagentModelSelectionCard'])
    const limitsFace = (byId('subagent-limits').inject as () => Pick<SubagentLimitsCardFace, 'hooks'>)()
    expect(Object.keys(limitsFace.hooks)).toEqual(['subagentLimitsCard'])
  })

  it('registers each page only while its own namespace is served, and withdraws it when the Host stops', async () => {
    const { ctx, slots, describeSettings, remote } = await bench(['subagent-model-selection-settings'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    expect(slots.entries('settings.section')[0]?.options).toMatchObject({ id: 'subagent' })

    describeSettings.mockResolvedValue({
      ok: true, value: { writable: true, hasDocument: true, namespaces: [view('subagent', 1)] },
    })
    remote.emit('settings/document-updated', ['subagent', 1])
    await vi.waitFor(() => {
      expect(slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['subagent-limits'])
    })

    describeSettings.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } })
    remote.emit('settings/document-updated', ['subagent', 2])
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(0) })
    expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
  })

  it('refreshes the model catalogue after model inputs change or the connection resets', async () => {
    const refresh = vi.spyOn(SubagentModelSelectionCardController.prototype, 'refreshCatalog')
    const reset = vi.spyOn(SubagentModelSelectionCardController.prototype, 'resetConnection')
    const { ctx, slots, remote } = await bench(['subagent-model-selection-settings'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    refresh.mockClear()
    reset.mockClear()

    remote.emit('llm/adapters-updated', [])
    expect(refresh).toHaveBeenCalledTimes(1)
    remote.emit('settings/document-updated', ['llm-deepseek', 1])
    expect(refresh).toHaveBeenCalledTimes(2)
    ctx.emit('connection/reset')
    expect(reset).toHaveBeenCalledTimes(1)
    refresh.mockRestore()
    reset.mockRestore()
  })

  it('collapses the pages on teardown', async () => {
    const { ctx, slots } = await bench(['subagent'])
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
  })
})
