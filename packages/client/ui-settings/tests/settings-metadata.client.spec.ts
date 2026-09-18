import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { LocaleFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, expectTypeOf, it, onTestFinished, vi } from 'vitest'
import type {
  SettingsNavigationTarget, SettingsPluginsTabOwnerProps, SettingsSectionOwnerProps,
} from '../src/client/index.ts'
import {
  SettingsMetadataService, type SettingsItemMetadata, type SettingsMetadataSnapshot,
} from '../src/client/settings-metadata.ts'

async function bench() {
  const ctx = new Context()
  const provider = ctx.plugin(SettingsMetadataService)
  onTestFinished(() => provider.dispose())
  await provider.await()
  return { ctx, provider, metadata: ctx.get('settingsMetadata')! }
}

function item(id: string, options: Partial<SettingsItemMetadata> = {}): SettingsItemMetadata {
  return { id, anchorId: id, title: () => id, ...options }
}

function localeSource() {
  const store = createSnapshotStore({ revision: 0, active: 'en', dictionary: 'initial' })
  const locale = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: vi.fn((listener: () => void) => store.subscribe(listener)),
    bind: () => (key: string) => key,
  } satisfies LocaleFace
  return { locale, store }
}

describe('settings metadata registrations', () => {
  it('publishes stable snapshots and preserves items before section registration and after its removal', async () => {
    const { metadata } = await bench()
    const empty = metadata.getSnapshot()
    expect(metadata.getSnapshot()).toBe(empty)
    const seen: SettingsMetadataSnapshot[] = []
    const unsubscribe = metadata.subscribe(() => { seen.push(metadata.getSnapshot()) })
    const removeItems = metadata.registerItems('general', [item('theme')])
    const withItems = metadata.getSnapshot()
    expect(withItems).toEqual({
      sections: [],
      items: [{ sectionId: 'general', id: 'theme', anchorId: 'theme', title: 'theme', keywords: [] }],
    })
    expect(withItems).not.toBe(empty)
    expect(metadata.getSnapshot()).toBe(withItems)
    const removeSection = metadata.registerSection({ sectionId: 'general', groupId: 'personal' })
    expect(metadata.getSnapshot().sections).toEqual([{ sectionId: 'general', groupId: 'personal' }])
    removeSection()
    expect(metadata.getSnapshot().sections).toEqual([])
    expect(metadata.getSnapshot().items).toBe(withItems.items)
    removeItems()
    expect(metadata.getSnapshot()).toEqual(empty)
    expect(seen).toHaveLength(4)
    const removed = metadata.getSnapshot()
    removeSection()
    removeItems()
    expect(metadata.getSnapshot()).toBe(removed)
    unsubscribe()
    unsubscribe()
    metadata.registerSection({ sectionId: 'models', groupId: 'ai' })
    expect(seen).toHaveLength(4)
  })

  it('rejects duplicate sections without replacing the active owner', async () => {
    const { metadata } = await bench()
    metadata.registerSection({ sectionId: 'general', groupId: 'personal' })
    const snapshot = metadata.getSnapshot()
    expect(() => metadata.registerSection({ sectionId: 'general', groupId: 'extensions' }))
      .toThrow('section "general" is already registered')
    expect(metadata.getSnapshot()).toBe(snapshot)
  })

  it.each(['id', 'anchorId'] as const)('rejects duplicate %s across tabs and within an entire new batch', async (key) => {
    const { metadata } = await bench()
    const original = item('existing', { anchorId: 'existing-anchor', tabId: 'configuration' })
    metadata.registerItems('plugins', [original])
    const snapshot = metadata.getSnapshot()
    const conflict = item('other', { anchorId: 'other-anchor', tabId: 'inventory', [key]: original[key] })
    expect(() => metadata.registerItems('plugins', [item('fresh'), conflict])).toThrow('already registered')
    expect(metadata.getSnapshot()).toBe(snapshot)
    expect(() => metadata.registerItems('general', [original, conflict])).toThrow('already registered')
    expect(metadata.getSnapshot()).toBe(snapshot)
    metadata.registerItems('general', [original])
    metadata.registerItems('plugins', [item('fresh')])
    expect(metadata.getSnapshot().items.map(entry => [entry.sectionId, entry.id])).toEqual([
      ['plugins', 'existing'], ['general', 'existing'], ['plugins', 'fresh'],
    ])
  })

  it('rejects a resolver failure without publishing or reserving any item in the batch', async () => {
    const { metadata } = await bench()
    const snapshot = metadata.getSnapshot()
    expect(() => metadata.registerItems('general', [
      item('theme'), item('language', { title: () => { throw new Error('missing dictionary') } }),
    ])).toThrow('missing dictionary')
    expect(metadata.getSnapshot()).toBe(snapshot)
    metadata.registerItems('general', [item('theme'), item('language')])
    expect(metadata.getSnapshot().items).toHaveLength(2)
  })

  it('detaches item identity and keyword arrays and publishes only declared public fields', async () => {
    const { metadata } = await bench()
    const keywords = ['appearance']
    const input = {
      id: 'theme', anchorId: 'theme-anchor', title: () => 'Theme', description: () => 'Choose appearance',
      keywords: () => keywords, tabId: 'preferences', value: 'private setting value', secret: 'private token',
    }
    const remove = metadata.registerItems('general', [input])
    input.id = 'mutated'
    input.anchorId = 'mutated-anchor'
    keywords.push('late change')
    const snapshot = metadata.getSnapshot()
    expect(snapshot.items).toEqual([{
      sectionId: 'general', id: 'theme', anchorId: 'theme-anchor', title: 'Theme',
      description: 'Choose appearance', keywords: ['appearance'], tabId: 'preferences',
    }])
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.items)).toBe(true)
    expect(Object.isFrozen(snapshot.items[0])).toBe(true)
    expect(Object.isFrozen(snapshot.items[0]!.keywords)).toBe(true)
    remove()
    expect(metadata.getSnapshot().items).toEqual([])
  })

  it('removes a contributing fiber and permits HMR replacement without stale disposer interference', async () => {
    const { ctx, metadata } = await bench()
    const disposers: Array<() => void> = []
    const owner = {
      inject: ['settingsMetadata'],
      apply(context: Context) {
        disposers.push(context.settingsMetadata.registerSection({ sectionId: 'plugins', groupId: 'extensions' }))
        disposers.push(context.settingsMetadata.registerItems('plugins', [item('configuration')]))
      },
    }
    const first = ctx.plugin(owner)
    onTestFinished(() => first.dispose())
    await first.await()
    metadata.registerItems('plugins', [item('inventory')])
    metadata.registerItems('general', [item('configuration')])
    await first.dispose()
    expect(metadata.getSnapshot().sections).toEqual([])
    expect(metadata.getSnapshot().items.map(entry => entry.id)).toEqual(['inventory', 'configuration'])
    const second = ctx.plugin(owner)
    onTestFinished(() => second.dispose())
    await second.await()
    const replacement = metadata.getSnapshot()
    disposers[0]!()
    disposers[1]!()
    expect(metadata.getSnapshot()).toBe(replacement)
    expect(replacement.items.map(entry => entry.sectionId)).toEqual(['plugins', 'general', 'plugins'])
  })

  it('continues notifying subscribers after one callback throws', async () => {
    const { metadata } = await bench()
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    onTestFinished(() => { diagnostic.mockRestore() })
    const failure = new Error('subscriber failed')
    metadata.subscribe(() => { throw failure })
    const seen: SettingsMetadataSnapshot[] = []
    metadata.subscribe(() => { seen.push(metadata.getSnapshot()) })
    metadata.registerSection({ sectionId: 'models', groupId: 'ai' })
    expect(seen).toEqual([metadata.getSnapshot()])
    expect(diagnostic).toHaveBeenCalledWith('settings metadata subscriber failed:', failure)
  })
})

describe('settings metadata locale lifecycle', () => {
  it('invalidates localized copy on active-locale and dictionary revisions without a locale/change event', async () => {
    const { ctx, metadata } = await bench()
    const { locale, store } = localeSource()
    const text = () => {
      const { active, dictionary } = store.getSnapshot()
      return dictionary === '' ? 'language' : `${active}:${dictionary}`
    }
    metadata.registerItems('general', [item('language', {
      title: text, description: text, keywords: () => [text()],
    })])
    const initial = metadata.getSnapshot()
    const provider = ctx.plugin((context) => { context.provide('locale', locale) })
    onTestFinished(() => provider.dispose())
    await provider.await()
    await vi.waitFor(() => { expect(locale.subscribe).toHaveBeenCalledTimes(1) })
    expect(metadata.getSnapshot()).not.toBe(initial)
    const seen: string[] = []
    metadata.subscribe(() => { seen.push(metadata.getSnapshot().items[0]!.title) })
    store.set({ revision: 1, active: 'zh', dictionary: 'initial' })
    const chinese = metadata.getSnapshot()
    expect(chinese.items[0]).toMatchObject({
      title: 'zh:initial', description: 'zh:initial', keywords: ['zh:initial'],
    })
    expect(metadata.getSnapshot()).toBe(chinese)
    store.set({ revision: 2, active: 'zh', dictionary: 'language-pack' })
    expect(metadata.getSnapshot().items[0]!.title).toBe('zh:language-pack')
    expect(seen).toEqual(['zh:initial', 'zh:language-pack'])
    store.set({ revision: 3, active: 'zh', dictionary: '' })
    expect(metadata.getSnapshot().items[0]!.title).toBe('language')
    store.set({ revision: 4, active: 'zh', dictionary: 'replacement' })
    expect(metadata.getSnapshot().items[0]!.title).toBe('zh:replacement')
    expect(initial.items[0]!.title).toBe('en:initial')
  })

  it('retires items without evaluating their resolvers during owner teardown', async () => {
    const { ctx, metadata } = await bench()
    const { locale, store } = localeSource()
    const provider = ctx.plugin((context) => { context.provide('locale', locale) })
    onTestFinished(() => provider.dispose())
    await provider.await()
    await vi.waitFor(() => { expect(locale.subscribe).toHaveBeenCalledTimes(1) })
    const title = vi.fn(() => 'Theme')
    const remove = metadata.registerItems('general', [item('theme', { title })])
    title.mockImplementation(() => { throw new Error('owner already unloaded') })
    expect(remove).not.toThrow()
    store.set({ revision: 1, active: 'zh', dictionary: 'replacement' })
    expect(title).toHaveBeenCalledTimes(1)
    expect(metadata.getSnapshot().items).toEqual([])
  })

  it('unsubscribes on locale replacement and service disposal, including retained registration disposers', async () => {
    const { ctx, provider, metadata } = await bench()
    const first = localeSource()
    const firstProvider = ctx.plugin((context) => { context.provide('locale', first.locale) })
    onTestFinished(() => firstProvider.dispose())
    await firstProvider.await()
    await vi.waitFor(() => { expect(first.locale.subscribe).toHaveBeenCalledTimes(1) })
    const removeSection = metadata.registerSection({ sectionId: 'general', groupId: 'personal' })
    const removeItems = metadata.registerItems('general', [item('theme')])
    const listener = vi.fn()
    metadata.subscribe(listener)
    await firstProvider.dispose()
    const withoutLocale = metadata.getSnapshot()
    first.store.set({ revision: 1, active: 'zh', dictionary: 'retired' })
    expect(metadata.getSnapshot()).toBe(withoutLocale)
    expect(listener).not.toHaveBeenCalled()
    const second = localeSource()
    const secondProvider = ctx.plugin((context) => { context.provide('locale', second.locale) })
    onTestFinished(() => secondProvider.dispose())
    await secondProvider.await()
    await vi.waitFor(() => { expect(second.locale.subscribe).toHaveBeenCalledTimes(1) })
    expect(listener).toHaveBeenCalledTimes(1)
    await provider.dispose()
    expect(ctx.get('settingsMetadata')).toBeUndefined()
    expect(metadata.getSnapshot()).toEqual({ sections: [], items: [] })
    const disposed = metadata.getSnapshot()
    second.store.set({ revision: 1, active: 'zh', dictionary: 'retired' })
    removeSection()
    removeItems()
    expect(metadata.getSnapshot()).toBe(disposed)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('settings navigation owner types', () => {
  it('carries an optional destination through section and plugin-tab runtime props', () => {
    expectTypeOf<SettingsSectionOwnerProps['target']>().toEqualTypeOf<SettingsNavigationTarget | undefined>()
    expectTypeOf<SettingsPluginsTabOwnerProps['target']>().toEqualTypeOf<SettingsNavigationTarget | undefined>()
    expectTypeOf<PropsRuntime<'settings.section'>['target']>().toEqualTypeOf<SettingsNavigationTarget | undefined>()
    expectTypeOf<PropsRuntime<'settings.plugins.tab'>['target']>().toEqualTypeOf<SettingsNavigationTarget | undefined>()
  })
})
