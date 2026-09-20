// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useEffect, useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsRootComponentProps, SettingsSectionRow } from '../src/client/shell-contract.ts'
import { SettingsRoot } from '../src/client/SettingsRoot.tsx'
import { en } from '../src/client/locales.ts'

const settingsCss = readFileSync(join(
  process.cwd(),
  'packages/client/ui-settings-general/src/client/SettingsRoot.module.css',
), 'utf8')

const scrollIntoView = vi.fn()
beforeEach(() => {
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

type Row = Pick<SettingsSectionRow, 'id' | 'order' | 'label'> & Partial<Pick<SettingsSectionRow, 'groupId' | 'items'>>
const resolveRows = (rows: Row[]): SettingsSectionRow[] => rows.map(row => ({ ...row, groupId: row.groupId ?? (row.id === 'general' ? 'personal' : 'ai'), items: row.items ?? [] }))
type Step = { id: string; order: number }

/** Slot-content stand-ins: the shell renders whatever the seats contribute. */
const SEAT_CONTENT: Record<string, string> = {
  'settings.trigger': 'Settings',
  'settings.header': 'Settings Title',
  'settings.action': 'Open configuration file',
  'settings.close': 'Back to app',
}

// Global standard kit stubs: SettingsRoot does not consume these hooks.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
type AttentionSnapshot = Parameters<Parameters<GlobalStandardProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: GlobalStandardProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function DraftControl() {
  const [value, setValue] = useState('')
  return <input aria-label="Pending setting" value={value} onChange={(event) => { setValue(event.currentTarget.value) }} />
}

function mount({
  wide = true,
  onboardingActive = true,
  rows = [
    { id: 'general', order: 0, label: 'General' },
    { id: 'models', order: 10, label: 'Models' },
    { id: 'agent-presets', order: 20, label: 'Agent presets' },
  ],
  steps = [
    { id: 'welcome', order: -100 },
    { id: 'credential', order: 0 },
  ],
}: { wide?: boolean; onboardingActive?: boolean; rows?: Row[]; steps?: Step[] } = {}) {
  // Mutable row source standing in for the bound useSections hook; bump()
  // plays a ledger change through the same observable contract.
  let current = resolveRows(rows)
  const listeners = new Set<() => void>()
  const renderSlot = vi.fn(
    ((key: string, _owner: unknown, opts?: {
      only?: string
      entryKey?: string
      fallback?: ReactNode
    }) => {
      if (key === 'settings.section') return <div data-testid={`section-${opts?.only ?? 'all'}`}><div data-settings-anchor="appearance"><button type="button">Choose appearance</button></div><DraftControl /></div>
      if (key === 'settings.section.extension') return <div data-testid={`extension-${opts?.entryKey ?? 'none'}`}>
        <div data-settings-anchor="feature-preference"><button type="button">Feature preference</button></div>
      </div>
      if (key === 'settings.section.icon') {
        return opts?.entryKey === 'missing'
          ? opts.fallback
          : <i data-testid={`icon-${opts?.entryKey ?? 'none'}`} />
      }
      return SEAT_CONTENT[key]
    }) as SettingsRootComponentProps['renderSlot'],
  )
  const useSessions = ((select: (state: unknown) => unknown) => select(onboardingActive
    ? { phase: 'ready', current: undefined, byId: {} }
    : {
      phase: 'ready',
      current: 'active-session',
      byId: { 'active-session': { blank: false } },
    })) as never
  const unusedHook = (() => { throw new Error('unused by SettingsRoot') }) as never
  const props: SettingsRootComponentProps = {
    useSessions,
    useSessionPendingInteraction,
    useResource,
    useWorkspaces: unusedHook,
    wide,
    useOnboardingSteps: select => select(steps),
    useNarrowViewport: select => select(false),
    useSections: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }, [])
      return select(current)
    },
    t: key => (en as Record<string, string>)[key] ?? key,
    renderSlot,
  }
  const view = render(<SettingsRoot {...props} />)
  const bump = (next: Row[]) => {
    act(() => {
      current = resolveRows(next)
      for (const fn of [...listeners]) fn()
    })
  }
  return { view, renderSlot, bump, listeners }
}

function openPage() {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
}

describe('SettingsRoot trigger', () => {
  it('renders the trigger seat content as the accessible name (no aria-label of its own)', () => {
    const { renderSlot } = mount()
    const trigger = screen.getByRole('button', { name: 'Settings' })
    expect(trigger.hasAttribute('aria-label')).toBe(false)
    expect(trigger.hasAttribute('aria-haspopup')).toBe(false)
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide: true })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(screen.getByRole('region')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings', expanded: true })).toBeTruthy()
  })

  it('hands the rail state to the trigger seat', () => {
    const { renderSlot } = mount({ wide: false })
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide: false })
  })
})

describe('SettingsPage chrome seats', () => {
  it('keeps contributed controls under their owning page and reveals search targets', async () => {
    const { renderSlot } = mount({ rows: [
      { id: 'git-source-control', order: 0, label: 'Git', groupId: 'development', items: [{
        sectionId: 'git-source-control', id: 'feature-preference', anchorId: 'feature-preference',
        title: 'Git panel preference', keywords: [],
      }] },
      { id: 'files', order: 1, label: 'Files', groupId: 'tools' },
    ] })
    openPage()
    expect(screen.getByTestId('extension-git-source-control')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.queryByTestId('extension-git-source-control')).toBeNull()
    expect(screen.getByTestId('extension-files')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Git panel preference' } })
    fireEvent.click(screen.getByRole('button', { name: /Git panel preference/ }))
    expect(renderSlot).toHaveBeenCalledWith('settings.section.extension', {
      close: expect.any(Function) as unknown, target: { itemId: 'feature-preference', anchorId: 'feature-preference' },
    }, { entryKey: 'git-source-control' })
    await waitFor(() => {
      expect(document.activeElement?.closest('[data-settings-anchor]')?.getAttribute('data-settings-anchor')).toBe('feature-preference')
    })
  })

  it('aligns the back command with the content header and paints only interaction feedback', () => {
    expect(settingsCss).toMatch(/\.navHeader\s*\{[^}]*min-height:\s*64px;[^}]*align-items:\s*center;[^}]*border-bottom:/su)
    const backRule = new RegExp(
      '\\.back\\s*\\{[^}]*height:\\s*34px;[^}]*border:\\s*none;'
      + '[^}]*border-radius:\\s*999px;[^}]*background:\\s*'
      + 'var\\(--dsw-alias-settings-control-bg\\);', 'su',
    )
    expect(settingsCss).toMatch(backRule)
    expect(settingsCss).toMatch(/\.back:hover\s*\{[^}]*background:\s*var\(--dsw-alias-settings-control-bg-hover\);/su)
    expect(settingsCss).toMatch(/\.back:active\s*\{[^}]*background:\s*var\(--dsw-alias-settings-control-bg-active\);/su)
    expect(settingsCss).toMatch(/\.nav\s*\{(?:(?!border-right|box-shadow)[\s\S])*?\}/u)
  })

  it('names the page via aria-labelledby pointing at the header seat node', () => {
    mount()
    openPage()
    const page = screen.getByRole('region')
    const titleId = page.getAttribute('aria-labelledby')!
    expect(titleId).toBeTruthy()
    const title = document.getElementById(titleId)!
    expect(title.textContent).toBe('Settings Title')
    expect(screen.getByRole('region', { name: 'Settings Title' })).toBeTruthy()
  })

  it('renders the back command with the close seat text', () => {
    mount()
    openPage()
    const close = screen.getByRole('button', { name: 'Back to app' })
    expect(close.hasAttribute('aria-label')).toBe(false)
    expect(close.textContent).toContain('Back to app')
  })

  it('renders contributed actions in the content toolbar', () => {
    const { renderSlot } = mount()
    openPage()
    expect(screen.getByText('Open configuration file')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('settings.action', {})
  })
})

describe('SettingsPage close paths', () => {
  it('returns via the navigation command', () => {
    mount()
    openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('uses a full-page region without dialog or mask semantics', () => {
    mount()
    openPage()
    const page = screen.getByRole('region', { name: 'Settings Title' })
    expect(page.getAttribute('data-dsh-settings-page')).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
    fireEvent.click(page)
    expect(screen.getByRole('region', { name: 'Settings Title' })).toBeTruthy()
  })

  it('closes via document-level Escape and unhooks the listener with the page', () => {
    mount()
    openPage()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region')).toBeNull()
    // Ignored while closed (listener removed with the panel) and non-Escape
    // keys are ignored while open.
    fireEvent.keyDown(document, { key: 'Escape' })
    openPage()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('region')).toBeTruthy()
  })

  it('isolates the covered app and restores its prior inert state and trigger focus', () => {
    const { view } = mount()
    view.container.id = 'root'
    view.container.inert = false
    const trigger = screen.getByRole('button', { name: 'Settings' })
    fireEvent.click(trigger)
    expect(view.container.inert).toBe(true)
    expect(view.container.contains(screen.getByRole('region'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))
    expect(view.container.inert).toBe(false)
    expect(document.activeElement).toBe(trigger)
    view.container.inert = true
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))
    expect(view.container.inert).toBe(true)
  })

  it('lands focus on the back command when the page opens', () => {
    mount()
    openPage()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to app' }))
  })
})

describe('SettingsPage navigation', () => {
  it('projects rows, marks the first active, and renders only that section', () => {
    mount()
    openPage()
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
  })

  it('dispatches each nav glyph by section id and uses the gear fallback for an empty key', () => {
    const { renderSlot } = mount({
      rows: [
        { id: 'alpha', order: 0, label: 'Alpha' },
        { id: 'beta', order: 10, label: 'Beta' },
        { id: 'missing', order: 20, label: 'Missing' },
      ],
    })
    openPage()
    const iconCalls = renderSlot.mock.calls
      .filter(call => call[0] === 'settings.section.icon')
      .map(call => ({ owner: call[1], entryKey: call[2]?.entryKey }))
    expect(iconCalls).toEqual([
      { owner: { size: 16 }, entryKey: 'alpha' },
      { owner: { size: 16 }, entryKey: 'beta' },
      { owner: { size: 16 }, entryKey: 'missing' },
    ])
    expect(screen.getByRole('button', { name: 'Alpha' }).querySelector('[data-testid="icon-alpha"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Beta' }).querySelector('[data-testid="icon-beta"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Missing' }).querySelector('svg')).toBeTruthy()
  })

  it('switches the rendered section on nav click', () => {
    mount()
    openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('section-models')).toBeTruthy()
    expect(screen.queryByTestId('section-general')).toBeNull()
  })

  it('searches section labels without hiding navigation and restores the selected page when cleared', () => {
    mount()
    openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    const search = screen.getByRole('searchbox', { name: 'Search settings...' })

    fireEvent.change(search, { target: { value: 'AGENT' } })
    expect(screen.getByRole('button', { name: 'General' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: 'AI & models / Agent presets Agent presets' })).toBeTruthy()
    expect(screen.queryByTestId('section-agent-presets')).toBeNull()

    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('section-models')).toBeTruthy()
  })

  it('shows a localized empty state when no section label matches', () => {
    const { renderSlot } = mount()
    openPage()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings...' }), {
      target: { value: 'missing section' },
    })

    expect(screen.getByRole('status').textContent).toBe('No matching settings')
    expect(screen.getByRole('button', { name: 'General' })).toBeTruthy()
    const sectionCalls = renderSlot.mock.calls.filter(call => call[0] === 'settings.section')
    expect(sectionCalls.at(-1)?.[2]).toEqual({ only: 'general' })
    expect(screen.queryByRole('textbox', { name: 'Pending setting' })).toBeNull()
  })

  it('preserves an unsaved field while searching and returning to its page', () => {
    mount()
    openPage()
    fireEvent.change(screen.getByRole('textbox', { name: 'Pending setting' }), { target: { value: 'unsaved draft' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'models' } })
    expect(screen.queryByRole('textbox', { name: 'Pending setting' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Pending setting' }).value).toBe('unsaved draft')
  })

  it('groups live pages and preserves the active section while a group is collapsed', () => {
    mount()
    openPage()
    const group = screen.getByRole('button', { name: 'Personal preferences' })
    fireEvent.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'General' })).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
    fireEvent.click(group)
    expect(screen.getByRole('button', { name: 'General' })).toBeTruthy()
  })

  it('finds a feature field from keywords and focuses its control after opening its page', () => {
    const { renderSlot } = mount({ rows: [{ id: 'general', order: 0, label: 'General', items: [{
      sectionId: 'general', id: 'appearance', anchorId: 'appearance', title: 'Appearance',
      description: 'Choose a theme', keywords: ['dark mode'],
    }] }] })
    openPage()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const search = screen.getByRole('searchbox')
    expect(document.activeElement).toBe(search)
    fireEvent.change(search, { target: { value: 'dark mode' } })
    fireEvent.click(screen.getByRole('button', { name: 'Personal preferences / General Appearance Choose a theme' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose appearance' }))
    const sectionCalls = renderSlot.mock.calls.filter(call => call[0] === 'settings.section')
    expect(sectionCalls.at(-1)?.[1]).toMatchObject({ target: { itemId: 'appearance', anchorId: 'appearance' } })
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('clears the search on Escape before closing the settings page', () => {
    mount()
    openPage()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unknown' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('section-general')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('mounts onboarding steps in order and transfers ownership only on completion', () => {
    const { renderSlot } = mount()
    const first = renderSlot.mock.calls.find(call => call[0] === 'settings.onboarding')
    expect(first?.[1]).toMatchObject({ stepId: 'welcome' })
    expect(first?.[2]).toEqual({ only: 'welcome' })
    act(() => {
      (first?.[1] as { complete: () => void }).complete()
      ;(first?.[1] as { complete: () => void }).complete()
    })
    const onboardingCalls = renderSlot.mock.calls.filter(call => call[0] === 'settings.onboarding')
    const second = onboardingCalls.at(-1)
    expect(second?.[1]).toMatchObject({ stepId: 'credential' })
    expect(second?.[2]).toEqual({ only: 'credential' })

    act(() => {
      (second?.[1] as { openSection: (id: string) => void }).openSection('models')
    })
    expect(screen.getByRole('region')).toBeTruthy()
    expect(screen.getByTestId('section-models')).toBeTruthy()

    cleanup()
    const inactive = mount({ onboardingActive: false }).renderSlot.mock.calls
      .filter(call => call[0] === 'settings.onboarding')
    expect(inactive).toHaveLength(0)
  })

  it('paints no takeover chrome of its own around the mounted step', () => {
    // The chrome (mask, opaque stage, #root inert) belongs to the step via
    // the step-owned dialog surface — a mounted-but-deciding step that
    // renders null must show and block nothing (the reload white-flash fix;
    // onboarding-surface.spec.tsx pins the primitive's half).
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    const { view } = mount()
    expect(view.container.querySelector('[class*="onboarding"]')).toBeNull()
    expect(document.body.querySelector('[class*="onboarding"]')).toBeNull()
    expect(appRoot.inert).not.toBe(true)
    view.unmount()
    appRoot.remove()
  })

  it('falls back to the first row when the active entry unregisters', () => {
    const { bump } = mount()
    openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    bump([{ id: 'general', order: 0, label: 'General' }])
    expect(screen.queryByRole('button', { name: 'Models' })).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
  })

  it('renders an empty content column when the ledger is empty', () => {
    const { renderSlot } = mount({ rows: [] })
    openPage()
    expect(screen.getByRole('region')).toBeTruthy()
    const sectionCalls = renderSlot.mock.calls.filter(c => c[0] === 'settings.section')
    expect(sectionCalls).toHaveLength(0)
  })

  it('drops the ledger subscription on unmount', () => {
    const { view, listeners } = mount()
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(listeners.size).toBe(0)
  })
})
