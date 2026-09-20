// @vitest-environment jsdom
/** Native registration and injected callbacks run through the production slot renderer. */
import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError, SlotTestRuntime, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { HostsSection } from '../src/client/HostsSection.tsx'
import { en } from '../src/client/locales.ts'
import { baseline, remoteFixture } from './fixtures.client.ts'

const runtimes: SlotTestRuntime[] = []
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    try { await runtime.dispose() } finally { await runtime.ctx.fiber.dispose() }
  }
})
const children = {
  'settings.section': { kind: 'list', scope: 'root' },
  'settings.section.icon': { kind: 'keyed', scope: 'root' },
} as const
async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const { ctx, slots } = runtime
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  slots.installLocale(locale)
  locale.setLocale('en')
  const fixture = remoteFixture()
  new TestRemote(ctx, { executionHosts: fixture.remote })
  return { runtime, ctx, locale, slots, ...fixture }
}
async function declare(runtime: SlotTestRuntime): Promise<void> {
  await runtime.root.declare(children, () => null)
}

describe('native hosts registration', () => {
  it('keeps the Host entry inert and declares the Remote namespace injection', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['slots', 'locale', 'settingsMetadata', 'remote', 'remote.executionHosts'])
  })

  it.each([true, false])('tracks section declaration and disposal when declared first is %s', async (first) => {
    const b = await bench()
    if (first) await declare(b.runtime)
    const feature = await b.runtime.mount({ inject, apply })
    if (!first) {
      expect(b.slots.entries('settings.section')).toHaveLength(0)
      expect(b.ctx.settingsMetadata.getSnapshot().sections).toHaveLength(0)
      await declare(b.runtime)
    }
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(HostsSection)
    expect(entry.options).toMatchObject({ id: 'hosts', order: 140 })
    expect(resolveSlotLabel(entry.options.label)).toBe('Execution hosts')
    expect(b.ctx.settingsMetadata.getSnapshot().sections).toEqual([{ sectionId: 'hosts', groupId: 'experimental' }])
    expect(b.ctx.settingsMetadata.getSnapshot().items.map(item => item.anchorId)).toEqual(['current', 'hosts', 'ssh-alias', 'inspection', 'runtime', 'default', 'confirmSwitch', 'isolation'])
    expect(b.slots.entries('settings.section.icon')).toHaveLength(1)
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(entry.options.label)).toBe('执行主机')
    expect(b.ctx.settingsMetadata.getSnapshot().items.find(item => item.id === 'ssh-alias')?.title).toBe('SSH 别名')
    b.runtime.root.release()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    await declare(b.runtime)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    await feature.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.section.icon')).toHaveLength(0)
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    expect(b.frames.closed).toBe(1)
  })

  it('renders live Host facts and preserves a Remote failure from the injected create callback', async () => {
    const b = await bench()
    await b.runtime.declare(children)
    await b.runtime.mount({ inject, apply })
    const { view } = b.runtime.renderSlot('settings.section', { close: vi.fn() })
    await view.findByText(baseline.current.hostId)
    const error = new RemoteError('gateway/internal', 'Host diagnostic', {})
    b.remote.create = async () => ({ ok: false, error })
    vi.spyOn(b.remote, 'create')
    fireEvent.click(view.getByRole('button', { name: en.add }))
    fireEvent.change(view.getByRole('textbox', { name: en.label }), { target: { value: 'Draft' } })
    fireEvent.change(view.getByRole('textbox', { name: en.sshAlias }), { target: { value: 'dev' } })
    fireEvent.click(view.getByRole('button', { name: en.save }))
    expect(await view.findByText(en.errorUnknown)).toBeTruthy()
    expect(view.getByText(error.code)).toBeTruthy()
    expect(view.getByText(error.message)).toBeTruthy()
    expect(view.getByRole<HTMLInputElement>('textbox', { name: en.label }).value).toBe('Draft')
    expect(view.getByRole<HTMLInputElement>('textbox', { name: en.sshAlias }).value).toBe('dev')
    expect(b.remote.create).toHaveBeenCalledWith({ label: 'Draft', sshAlias: 'dev' }, expect.any(AbortSignal))
    const publicIndex = JSON.stringify(b.ctx.settingsMetadata.getSnapshot())
    expect(publicIndex).not.toContain('saved-target-3')
    expect(publicIndex).not.toContain('dev-server')
  })
})
