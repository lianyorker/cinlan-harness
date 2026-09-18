import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { KeyboardController } from '@deepseek-ai/dsh-client-keyboard/src/client/controller.ts'
import type { KeybindingsSettings } from '@deepseek-ai/dsh-client-keyboard/client'
import { apply, inject } from '../src/client/index.ts'

declare module '@deepseek-ai/dsh-client-keyboard/client' {
  interface KeyboardCommandMap { 'metadata.save': { scope: 'editor' } }
}

describe('shortcut metadata lifetime', () => {
  it('indexes real owner labels, waits for the slot, and removes dynamic rows on owner and slot disposal', async () => {
    const ctx = new Context()
    const slotsFiber = ctx.plugin(SlotRegistry)
    await slotsFiber.await()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('en')
    ctx.provide('locale', locale)
    const metadataFiber = ctx.plugin(SettingsMetadataService)
    await metadataFiber.await()
    const settings = stubSettingsScope<KeybindingsSettings>()
    settings.publish({ status: 'ready', writable: true,
      value: { overrides: [{ commandId: 'private.user.action', binding: { key: 'PrivateKey', modifiers: {} } }] } })
    const keyboard = new KeyboardController(settings.scope, false)
    ctx.provide('keyboard', keyboard)
    const feature = ctx.plugin({ inject: [...inject], apply })
    await feature.await()
    const slots = ctx.get('slots') as SlotRegistry
    let releaseSlot = () => {}
    let releaseCommand = () => {}
    try {
      expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
      releaseSlot = slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
      await vi.waitFor(() => { expect(ctx.settingsMetadata.getSnapshot().items).toHaveLength(1) })
      releaseCommand = keyboard.register({ id: 'metadata.save', scope: 'editor', label: () => 'Save file', description: () => 'Persist edits.',
        defaultBindings: [{ key: 's', modifiers: { mod: true } }] })
      expect(ctx.settingsMetadata.getSnapshot().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'metadata.save', title: 'Save file', anchorId: 'keybinding-metadata.save' }),
      ]))
      expect(JSON.stringify(ctx.settingsMetadata.getSnapshot())).not.toMatch(/private.user.action|PrivateKey|Ctrl/)
      releaseCommand()
      expect(ctx.settingsMetadata.getSnapshot().items).toHaveLength(1)
      releaseSlot()
      await vi.waitFor(() => { expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] }) })
      releaseSlot = slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
      await vi.waitFor(() => { expect(ctx.settingsMetadata.getSnapshot().items).toHaveLength(1) })
      await feature.dispose()
      expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
      expect(slots.entries('settings.section')).toEqual([])
    } finally {
      releaseCommand(); releaseSlot(); await feature.dispose()
      keyboard.dispose(); await metadataFiber.dispose(); await slotsFiber.dispose()
    }
  })
})
