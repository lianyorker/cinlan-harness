// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it, vi } from 'vitest'
import { apply, BrowserElementCaptureSection, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  await ctx.plugin(SlotRegistry).await()
  return { ctx, locale, slots: ctx.slots }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-browser-element-capture registration', () => {
  it('declares only the presentation services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
    expect(hostApply).not.toThrow()
  })

  it('registers one localized section without a removed icon slot', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const section = b.slots.entries('settings.section')[0]!
    expect(section.component).toBe(BrowserElementCaptureSection)
    expect(section.options).toMatchObject({ id: 'browser-element-capture', order: 70 })
    expect(section.locale).toBe('browserElementCapture')
    expect(resolveSlotLabel(section.options.label)).toBe('元素捕获')
    expect(b.slots.entries('settings.section.icon' as never)).toEqual([])

    b.locale.setLocale('en')
    expect(resolveSlotLabel(section.options.label)).toBe('Element capture')
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toEqual([])
    await b.ctx.fiber.dispose()
  })

  it('follows a late Settings declaration and its lifetime', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toEqual([])

    const release = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    release()
    expect(b.slots.entries('settings.section')).toEqual([])
    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toEqual([])
    await b.ctx.fiber.dispose()
  })
})
