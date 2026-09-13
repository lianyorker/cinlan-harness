// @vitest-environment jsdom
/** Native Browser Settings edits carry the draft revision and never launch external applications. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapabilitySectionProps } from '../src/client/CapabilitySection.tsx'
import { BrowserPreferencesForm } from '../src/client/BrowserPreferencesForm.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
function bench(language: 'en' | 'zh' = 'en', writable = true) {
  const snapshot = { status: 'ready' as const, mode: 'host' as const, writable, revision: 7,
    value: { browserChannel: 'chrome' as const, headless: true, viewportWidth: 800, viewportHeight: 600, profileName: 'default', homePage: 'about:blank', searchEngine: 'google' as const },
    base: undefined, user: undefined,
  }
  const save = vi.fn<CapabilitySectionProps['saveBrowserPreferences']>(async () => {})
  const props = { t: key => ((language === 'en' ? en : zh) as Record<string, string>)[key] ?? key,
    useBrowserPreferences: selector => selector(snapshot), saveBrowserPreferences: save,
  } satisfies Pick<CapabilitySectionProps, 'useBrowserPreferences' | 'saveBrowserPreferences' | 't'>
  const view = render(<BrowserPreferencesForm {...props} />)
  return { snapshot, save, props, ...view }
}

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
})
