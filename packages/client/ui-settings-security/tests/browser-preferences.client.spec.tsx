// @vitest-environment jsdom
/** Native Browser Settings edits carry the draft revision and never launch external applications. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SIDEBAR_PREFS_DEFAULTS, type SidebarPrefs } from '@deepseek-ai/dsh-client-ui-better-sidebar/src/prefs-shared.ts'
import type { CapabilitySectionProps } from '../src/client/CapabilitySection.tsx'
import { BrowserPreferencesForm } from '../src/client/BrowserPreferencesForm.tsx'
import { BrowserRoutingForm } from '../src/client/BrowserRoutingForm.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
function bench(language: 'en' | 'zh' = 'en', writable = true) {
  const snapshot = { status: 'ready' as const, mode: 'host' as const, writable, revision: 7,
    value: { browserChannel: 'chrome' as const, headless: true, viewportWidth: 800, viewportHeight: 600, profileName: 'default', homePage: 'about:blank', searchEngine: 'google' as const },
    base: undefined, user: undefined,
  }
  const save = vi.fn<CapabilitySectionProps['saveBrowserPreferences']>(async () => {})
  const reset = vi.fn<CapabilitySectionProps['resetBrowserPreferences']>(async () => {})
  const props = { t: language === 'en' ? makeTranslate(en, commonEn) : makeTranslate(zh, commonZh),
    useBrowserPreferences: selector => selector(snapshot), saveBrowserPreferences: save, resetBrowserPreferences: reset,
  } satisfies Pick<CapabilitySectionProps, 'useBrowserPreferences' | 'saveBrowserPreferences' | 'resetBrowserPreferences' | 't'>
  const view = render(<BrowserPreferencesForm {...props} />)
  return { snapshot, save, reset, props, ...view }
}

function routingBench(language: 'en' | 'zh' = 'en', initial: Partial<SettingsScopeSnapshot<SidebarPrefs>> = {}) {
  const snapshot: SettingsScopeSnapshot<SidebarPrefs> = {
    status: 'ready', mode: 'host', writable: true, revision: 7, base: undefined, user: undefined,
    value: { ...SIDEBAR_PREFS_DEFAULTS, browserInterceptLinks: true, browserInterceptHttp: true, browserInterceptHttps: false },
    ...initial,
  }
  const save = vi.fn<CapabilitySectionProps['saveBrowserRouting']>(async () => {})
  const reset = vi.fn<CapabilitySectionProps['resetBrowserRouting']>(async () => {})
  const props: Parameters<typeof BrowserRoutingForm>[0] = {
    t: language === 'en' ? makeTranslate(en, commonEn) : makeTranslate(zh, commonZh),
    useBrowserRouting: selector => selector(snapshot), saveBrowserRouting: save, resetBrowserRouting: reset,
  }
  return { ...render(<BrowserRoutingForm {...props} />), snapshot, props, save, reset }
}

describe('Sidebar browser link routing', () => {
  it.each(['en', 'zh'] as const)('saves only changed %s routing fields at the first-edit revision', async (language) => {
    const b = routingBench(language)
    const copy = language === 'en' ? en : zh
    fireEvent.click(screen.getByRole('switch', { name: copy.browserRouteHttps }))
    b.snapshot.revision = 8
    b.rerender(<BrowserRoutingForm {...b.props} />)
    fireEvent.click(screen.getByRole('switch', { name: copy.browserRouteHttp }))
    fireEvent.click(screen.getByRole('switch', { name: copy.browserRouteHttp }))
    fireEvent.click(screen.getByRole('button', { name: copy.browserRoutingSave }))
    expect(await screen.findByText(copy.browserRoutingSaved)).toBeTruthy()
    expect(b.save).toHaveBeenCalledExactlyOnceWith({ browserInterceptHttps: true }, 7)
    expect(b.reset).not.toHaveBeenCalled()
    expect(screen.queryByText(copy.browserSettingsRestart)).toBeNull()
  })

  it('preserves a rejected routing draft until explicit discard', async () => {
    const b = routingBench()
    b.save.mockRejectedValueOnce(new Error('conflict'))
    fireEvent.click(screen.getByRole('switch', { name: en.browserRouteLinks }))
    fireEvent.click(screen.getByRole('button', { name: en.browserRoutingSave }))
    await screen.findByRole('alert')
    expect(screen.getByRole('switch', { name: en.browserRouteLinks }).getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText(en.browserRoutingSaved)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.preferencesDiscard }))
    expect(screen.getByRole('switch', { name: en.browserRouteLinks }).getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.browserRoutingSave }).disabled).toBe(true)
  })

  it('resets only through its routing callback at the draft revision and retains rejected edits', async () => {
    const b = routingBench()
    fireEvent.click(screen.getByRole('switch', { name: en.browserRouteHttps }))
    b.snapshot.revision = 9
    b.rerender(<BrowserRoutingForm {...b.props} />)
    b.reset.mockRejectedValueOnce(new Error('conflict'))
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    await screen.findByRole('alert')
    expect(screen.getByRole('switch', { name: en.browserRouteHttps }).getAttribute('aria-checked')).toBe('true')
    expect(b.reset).toHaveBeenLastCalledWith(7)
    expect(screen.queryByText(en.browserRoutingReset)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    await screen.findByText(en.browserRoutingReset)
    expect(b.reset).toHaveBeenLastCalledWith(7)
    expect(b.save).not.toHaveBeenCalled()
  })

  it('leaves no pending write after every switch returns to its opening value', () => {
    const b = routingBench()
    fireEvent.click(screen.getByRole('switch', { name: en.browserRouteHttps }))
    fireEvent.click(screen.getByRole('switch', { name: en.browserRouteHttps }))
    const save = screen.getByRole<HTMLButtonElement>('button', { name: en.browserRoutingSave })
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(b.save).not.toHaveBeenCalled()
  })

  it.each(['loading', 'unavailable'] as const)('keeps %s routing anchors without inventing toggle values', (status) => {
    const b = routingBench('en', { status, value: undefined, revision: undefined, writable: false })
    expect(screen.queryByRole('switch')).toBeNull()
    for (const anchor of ['browser-link-routing', 'browser-link-http', 'browser-link-https']) {
      expect(b.container.querySelector(`[data-settings-anchor="${anchor}"]`)).not.toBeNull()
    }
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    expect(b.reset).not.toHaveBeenCalled()
    expect(b.save).not.toHaveBeenCalled()
  })

  it.each(['host', 'memory'] as const)('refuses writes in a read-only %s connection', (mode) => {
    const b = routingBench('en', { mode, writable: false })
    expect(screen.getByText(en.preferencesReadOnly)).toBeTruthy()
    const master = screen.getByRole<HTMLButtonElement>('switch', { name: en.browserRouteLinks })
    expect(master.disabled).toBe(true)
    fireEvent.click(master)
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    expect(b.save).not.toHaveBeenCalled()
    expect(b.reset).not.toHaveBeenCalled()
  })
})

describe('Native browser preferences', () => {
  it.each(['en', 'zh'] as const)('persists the %s form with the revision from the first edit', async (language) => {
    const b = bench(language)
    const copy = language === 'en' ? en : zh
    fireEvent.change(screen.getByRole('combobox', { name: copy.browserChannelLabel }), { target: { value: 'msedge' } })
    b.snapshot.revision = 8
    b.rerender(<BrowserPreferencesForm {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: copy.browserSettingsSave }))
    expect(await screen.findByText(copy.browserSettingsSaved)).toBeTruthy()
    expect(b.save).toHaveBeenCalledWith({ browserChannel: 'msedge', headless: true, viewportWidth: 800, viewportHeight: 600, profileName: 'default', homePage: 'about:blank', searchEngine: 'google' }, 7)
  })
  it('preserves a rejected draft and allows explicit discard before retry', async () => {
    const b = bench()
    b.save.mockRejectedValueOnce(new Error('conflict'))
    fireEvent.change(screen.getByRole('spinbutton', { name: en.browserViewportWidth }), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: en.browserSettingsSave }))
    expect((await screen.findByRole('alert')).textContent).toContain(en.browserSettingsFailed)
    const width = screen.getByRole('spinbutton', { name: en.browserViewportWidth })
    if (!(width instanceof HTMLInputElement)) throw new Error('viewport width control is not an input')
    expect(width.value).toBe('900')
    fireEvent.click(screen.getByRole('button', { name: en.browserSettingsDiscard }))
    expect(width.value).toBe('800')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('does not write in a read-only connection', () => {
    const b = bench('en', false)
    expect(screen.getByText(en.browserSettingsReadOnly)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.browserSettingsSave }))
    expect(b.save).not.toHaveBeenCalled()
  })
  it('does not show editable settings when the local Provider is absent', () => {
    const b = bench()
    b.rerender(<BrowserPreferencesForm {...b.props} useBrowserPreferences={selector => selector({ ...b.snapshot, status: 'unavailable', value: undefined })} />)
    expect(screen.getByText(en.browserSettingsUnavailable)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
  it('resets overrides at the draft revision and preserves a draft if reset fails', async () => {
    const b = bench()
    fireEvent.change(screen.getByRole('spinbutton', { name: en.browserViewportWidth }), { target: { value: '900' } })
    b.snapshot.revision = 9
    b.reset.mockRejectedValueOnce(new Error('conflict'))
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    await screen.findByRole('alert')
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: en.browserViewportWidth }).value).toBe('900')
    expect(b.reset).toHaveBeenLastCalledWith(7)
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    await screen.findByText(en.browserSettingsReset)
    expect(b.save).not.toHaveBeenCalled()
  })
})
