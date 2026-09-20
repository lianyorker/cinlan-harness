// @vitest-environment jsdom
/** Feature pages preserve native preference writes and custom descriptor settings. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SidebarPreferencesController } from '../src/client/preferences-controller.ts'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SidebarPrefs } from '../src/prefs-shared.ts'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { createSidebarStore, type SidebarStore } from '../src/client/state.ts'
// The copy assertions below are English; pin the browser language so the
// module-level t()/isZh() resolve en regardless of the host system locale
// (vitest 4.1.11+/jsdom follow the OS locale — zh-CN on this machine).
beforeAll(() => {
  Object.defineProperty(navigator, 'language', {
    value: 'en-US',
    configurable: true,
  })
})
import { createBetterSidebarService, type BetterSidebarService } from '../src/client/service.ts'
import type { TabDescriptor } from '../src/client/service.ts'
import { FeatureSettingsRows, mergePluginSetting, SettingsBody, SideCardSection, type SideCardSectionProps } from '../src/client/SideCardSection.tsx'
import { SIDEBAR_PREFS_DEFAULTS } from '../src/prefs-shared.ts'

/** One tab + one viewer + the subagent-style nested toggle under a tab. */
function mount(): { store: SidebarStore; service: BetterSidebarService } {
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  service.registerTab({
    id: 'explorer',
    title: () => 'Explorer',
    icon: () => createElement('svg', { 'data-icon': 'explorer' }),
    order: 10,
    component: () => null,
  })
  service.registerTab({
    id: 'subagent',
    title: () => 'Subagents',
    icon: () => createElement('svg', { 'data-icon': 'subagent' }),
    order: 30,
    settings: {
      toggles: [{
        key: 'autoOpenSubagent',
        title: () => 'Auto-open Subagents',
        desc: () => 'Expand on new subagent',
      }],
    },
    component: () => null,
  })
  service.registerFileViewer({
    id: 'image',
    title: () => 'Image',
    icon: () => createElement('svg', { 'data-icon': 'image' }),
    exts: ['png', 'jpg'],
    fetchStrategy: 'mediaUrl',
    component: () => null,
  })
  return { store, service }
}

function renderSection(store: SidebarStore, service: BetterSidebarService, featureId?: string, embedded = false): string {
  return renderToString(createElement(
    SideCardSection,
    { store, service, featureId, embedded, close: () => {} } as unknown as SideCardSectionProps,
  ))
}

afterEach(cleanup)

function renderLive(
  store: SidebarStore, service: BetterSidebarService, featureId?: string,
  patch = vi.fn(async () => {}), close = vi.fn(),
) {
  const preferences = { patch } as unknown as SidebarPreferencesController
  const props = { store, service, preferences, featureId, close } as unknown as SideCardSectionProps
  return { ...render(createElement(SideCardSection, props)), patch, close }
}

describe('SideCardSection feature pages', () => {
  it('keeps only layout defaults and compatibility on the workspace layout page', () => {
    const { store, service } = mount()
    const html = renderSection(store, service)
    expect(html).toContain('>Workspace layout</h1>')
    expect(html).toContain('Default width share')
    expect(html).toContain('better-sidebar-open-by-default')
    expect(html).not.toContain('>Explorer<')
    expect(html).not.toContain('Subagents')
    expect(html).not.toContain('File viewers')
    expect(html).not.toContain('Open chat files in the sidebar')
    expect(html).not.toContain('Add tab plugins')
    expect(html).not.toContain(service.version)
  })

  it('renders a selected feature inline without catalog or settings modal', () => {
    const { store, service } = mount()
    const html = renderSection(store, service, 'subagent')
    expect(html).toContain('>Subagents</h1>')
    expect(html).toContain('Auto-open Subagents')
    expect(html).toContain('better-sidebar-subagent-enabled')
    expect(html).toContain('better-sidebar-subagent-autoOpenSubagent')
    expect(html).not.toContain('Default width share')
    expect(html).not.toContain('>Explorer<')
    expect(html).not.toContain('Subagents Feature settings')
    expect(html).not.toContain('>subagent<')
    expect(html).not.toContain('role="dialog"')
    expect(renderSection(store, service, 'subagent', true)).toContain('>Subagents</h2>')
  })

  it('keeps disabled feature settings available for configuration', () => {
    const { store, service } = mount()
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { subagent: false } })
    renderLive(store, service, 'subagent')
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Enable feature' }).checked).toBe(false)
    expect(screen.getByRole('checkbox', { name: 'Auto-open Subagents' })).not.toBeNull()
  })

  it('contains live unregistering as unavailable and restores the descriptor on registration', () => {
    const { store, service } = mount()
    renderLive(store, service, 'plugin:reports')
    expect(screen.getByRole('status').textContent).toContain('This feature is unavailable')
    let dispose: (() => void) | undefined
    act(() => { dispose = service.registerTab({ id: 'plugin:reports', title: 'Reports', component: () => null }) })
    expect(screen.getByRole('heading', { name: 'Reports', level: 1 })).not.toBeNull()
    act(() => { dispose?.() })
    expect(screen.getByRole('status').textContent).toContain('This feature is unavailable')
  })

  it('keeps editor controls, viewer toggles, plugin settings, and custom panels inline', async () => {
    const { store, service } = mount()
    service.registerTab({
      id: 'editor', title: 'Files', component: () => null,
      settings: { toggles: [{ key: 'editorExplorer', title: 'Show explorer' }], render: () => createElement('div', {}, 'Open with configuration') },
    })
    service.registerFileViewer({
      id: 'plugin:pdf', title: 'PDF preview', exts: ['pdf'], component: () => null, fetchStrategy: 'mediaUrl',
      settings: { pluginToggles: [{ key: 'annotations', title: 'Annotations' }], render: props => createElement('button', { onClick: () => { props.close() } }, 'Close preview settings') },
    })
    const { container, patch, close } = renderLive(store, service, 'editor')
    expect(screen.getByRole('checkbox', { name: 'Open chat files in the sidebar' })).not.toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Show explorer' })).not.toBeNull()
    expect(screen.getByText('Open with configuration')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'File viewers' })).not.toBeNull()
    expect(screen.getByText('png · jpg')).not.toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Annotations' }))
    expect(patch).toHaveBeenCalledWith({ pluginSettings: { 'plugin:pdf': { annotations: true } } })
    const image = container.querySelector('[data-settings-anchor="better-sidebar-viewer-image-enabled"]') as HTMLElement
    fireEvent.click(within(image).getByRole('checkbox'))
    expect(patch).toHaveBeenCalledWith({ viewersEnabled: { image: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Close preview settings' }))
    expect(close).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {})
  })

  it('rolls back a rejected native write and surfaces its error inline', async () => {
    const { store, service } = mount()
    const patch = vi.fn(async () => { throw new Error('Settings could not be saved. Please try again.') })
    renderLive(store, service, 'subagent', patch)
    const enabled = screen.getByRole('checkbox', { name: 'Enable feature' }) as HTMLInputElement
    fireEvent.click(enabled)
    expect(enabled.checked).toBe(false)
    expect(patch).toHaveBeenCalledWith({ tabsEnabled: { subagent: false } })
    await waitFor(() => { expect(enabled.checked).toBe(true) })
    expect(screen.getByRole('alert').textContent).toContain('Settings could not be saved')
    expect(store.getPrefs().tabsEnabled.subagent).toBeUndefined()
  })

  it('shows authoritative recovery after a refused write even when it equals the requested value', async () => {
    const { store, service } = mount()
    const host = stubSettingsScope<SidebarPrefs>()
    host.publish({ status: 'ready', value: { ...SIDEBAR_PREFS_DEFAULTS } })
    host.scope.mutate = vi.fn(async () => {
      host.publish({ status: 'ready', value: { ...SIDEBAR_PREFS_DEFAULTS, tabsEnabled: { subagent: false } } })
      return false
    })
    const controller = new SidebarPreferencesController(host.scope, store)
    try {
      render(createElement(SideCardSection, { store, service, preferences: controller, featureId: 'subagent', close: () => {} } as SideCardSectionProps))
      const enabled = screen.getByRole('checkbox', { name: 'Enable feature' }) as HTMLInputElement
      fireEvent.click(enabled)
      await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Settings could not be saved') })
      expect(store.getPrefs().tabsEnabled.subagent).toBe(false)
      expect(enabled.checked).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('does not duplicate native terminal or browser controls when embedded', () => {
    const { store, service } = mount()
    service.registerTab({ id: 'terminal', title: 'Terminal', component: () => null, settings: {
      toggles: [{ key: 'terminalFontSize', type: 'number', title: 'Native font size' }, { key: 'agentTerminalTools', title: 'Agent terminal tools' }],
      pluginToggles: [{ key: 'customFlag', title: 'Plugin flag' }],
    } })
    service.registerTab({ id: 'browser', title: 'Browser', component: () => null, settings: {
      toggles: [{ key: 'browserInterceptLinks', title: 'Native routing' }, { key: 'browserNoSandbox', title: 'Disable browser sandbox' }],
    } })
    const terminal = renderSection(store, service, 'terminal', true)
    expect(terminal).not.toContain('Native font size')
    expect(terminal).toContain('Agent terminal tools')
    expect(terminal).toContain('Plugin flag')
    expect(renderSection(store, service, 'terminal')).toContain('Native font size')
    const browser = renderSection(store, service, 'browser', true)
    expect(browser).not.toContain('Native routing')
    expect(browser).toContain('Disable browser sandbox')
  })

  it('does not expose hidden diff as a Git feature toggle', () => {
    const { store, service } = mount()
    service.registerTab({ id: 'git', title: 'Git', component: () => null })
    service.registerTab({ id: 'diff', title: 'Diff', hidden: true, component: () => null })
    const html = renderSection(store, service, 'git', true)
    expect(html).toContain('better-sidebar-git-enabled')
    expect(html).not.toContain('better-sidebar-diff-enabled')
  })

  it('retains the custom title-bar compatibility settings', () => {
    const { store, service } = mount()
    let html = renderSection(store, service)
    expect(html).toContain('Position compatibility mode')
    expect(html).toContain('>Auto-detect<')
    expect(html.match(/type="checkbox"/g)?.length).toBe(1)
    expect(html).not.toContain('Position compatibility mode Feature settings')
    store.setPrefs({ ...store.getPrefs(), titleBarScheme: 'custom', titleBarCompat: true })
    html = renderSection(store, service)
    expect(html).toContain('>Custom<')
    expect(html).toContain('aria-label="Position compatibility mode Feature settings"')
  })
})

describe('FeatureSettingsRows (the secondary settings popup body)', () => {
  const prefs: typeof SIDEBAR_PREFS_DEFAULTS = {
    ...SIDEBAR_PREFS_DEFAULTS,
    autoOpenSubagent: false,
  }
  const toggles = [{
    key: 'autoOpenSubagent',
    title: () => 'Auto-open Subagents',
    desc: () => 'Expand on new subagent',
  }]

  it('renders one switch row per declared toggle with its current value', () => {
    const html = renderToString(createElement(FeatureSettingsRows, {
      toggles,
      prefs,
      onToggle: () => {},
    }))
    expect(html).toContain('Auto-open Subagents')
    expect(html).toContain('Expand on new subagent')
    // The row's switch is a real checkbox (aria-label = the toggle title)
    // reflecting the prefs value (false here → unchecked).
    expect(html).toContain('aria-label="Auto-open Subagents"')
    expect(html).not.toContain('checked=""')
  })

  it('checks the row when the pref is on', () => {
    const html = renderToString(createElement(FeatureSettingsRows, {
      toggles,
      prefs: { ...prefs, autoOpenSubagent: true },
      onToggle: () => {},
    }))
    expect(html).toContain('checked=""')
  })

  it('renders a text row as an input seeded with the pref value (empty = theme default)', () => {
    const html = renderToString(createElement(FeatureSettingsRows, {
      toggles: [{
        key: 'terminalFontFamily',
        type: 'text',
        title: () => 'Font family',
        desc: () => 'CSS stack',
        placeholder: '"JetBrains Mono", monospace',
      }],
      prefs: { ...prefs, terminalFontFamily: '"JetBrains Mono", monospace' },
      onToggle: () => {},
      onCommit: () => '',
    }))
    expect(html).toContain('Font family')
    expect(html).toContain('placeholder="&quot;JetBrains Mono&quot;, monospace"')
    // The input carries the pref value (no switch for text rows).
    expect(html).toContain('value="&quot;JetBrains Mono&quot;, monospace"')
    expect(html).not.toContain('type="checkbox"')
  })

  it('renders a number row with the pref value, the declared bounds and a unit suffix', () => {
    const html = renderToString(createElement(FeatureSettingsRows, {
      toggles: [{
        key: 'terminalFontSize',
        type: 'number',
        title: () => 'Font size',
        min: 9,
        max: 32,
        unit: 'px',
      }],
      prefs: { ...prefs, terminalFontSize: 18 },
      onToggle: () => {},
      onCommit: () => '18',
    }))
    expect(html).toContain('Font size')
    expect(html).toContain('type="number"')
    expect(html).toContain('value="18"')
    expect(html).toContain('min="9"')
    expect(html).toContain('max="32"')
    expect(html).toContain('px')
    expect(html).not.toContain('type="checkbox"')
  })

  it('renders the title-bar strip row: the pref value, the 0–120 bounds and the px suffix', () => {
    const html = renderToString(createElement(FeatureSettingsRows, {
      toggles: [{
        key: 'titleBarStripPx',
        type: 'number',
        title: () => 'Shift distance',
        desc: () => 'Title-bar strip height in px',
        min: 0,
        max: 120,
        unit: 'px',
      }],
      prefs: { ...prefs, titleBarStripPx: 64 },
      onToggle: () => {},
      onCommit: () => '64',
    }))
    expect(html).toContain('Shift distance')
    expect(html).toContain('Title-bar strip height in px')
    expect(html).toContain('type="number"')
    expect(html).toContain('value="64"')
    expect(html).toContain('min="0"')
    expect(html).toContain('max="120"')
    expect(html).toContain('px')
    expect(html).not.toContain('type="checkbox"')
  })
})

describe('mergePluginSetting (v0.12.0, codex review fix)', () => {
  it('sequential merges are additive — a later write never drops an earlier key', () => {
    // Simulates two same-tick updatePluginSetting calls: each merge spreads
    // the map it was GIVEN, so building from the latest optimistic map
    // preserves both keys (the pre-fix code spread the stale render-time
    // prefs twice and the second write dropped the first key).
    let map: Record<string, Record<string, unknown>> = {}
    map = mergePluginSetting(map, 'my-plugin:db', 'pageSize', 25)
    map = mergePluginSetting(map, 'my-plugin:db', 'theme', 'dark')
    expect(map['my-plugin:db']).toEqual({ pageSize: 25, theme: 'dark' })
    // A second descriptor's blob stays independent.
    map = mergePluginSetting(map, 'other:view', 'refresh', true)
    expect(map['my-plugin:db']).toEqual({ pageSize: 25, theme: 'dark' })
    expect(map['other:view']).toEqual({ refresh: true })
    // Overwriting one key keeps the sibling keys.
    map = mergePluginSetting(map, 'my-plugin:db', 'pageSize', 50)
    expect(map['my-plugin:db']).toEqual({ pageSize: 50, theme: 'dark' })
  })
})

describe('FeatureSettingsRows valueSource (v0.12.0, independent CR fix)', () => {
  it('plugin rows read from their OWN value source — a plugin key colliding with a host pref never reads the host value', () => {
    const prefs = { ...SIDEBAR_PREFS_DEFAULTS, openByDefault: true }
    const toggle = { key: 'openByDefault', title: 'My flag' }
    // valueOf returns undefined (the plugin never wrote this key): the row
    // must render UNCHECKED even though the host pref openByDefault is true.
    let html = renderToString(createElement(FeatureSettingsRows, {
      toggles: [toggle],
      prefs,
      onToggle: () => {},
      valueSource: () => undefined,
    }))
    expect(html).not.toContain('checked=""')
    // The plugin wrote `true` into its own blob: the row is checked.
    html = renderToString(createElement(FeatureSettingsRows, {
      toggles: [toggle],
      prefs,
      onToggle: () => {},
      valueSource: () => true,
    }))
    expect(html).toContain('checked=""')
    // Without valueOf the row falls back to the prefs face (host semantics).
    html = renderToString(createElement(FeatureSettingsRows, {
      toggles: [toggle],
      prefs,
      onToggle: () => {},
    }))
    expect(html).toContain('checked=""')
  })
})

describe('SettingsBody rows + custom render panel (open-with seam)', () => {
  it('renders the declarative rows AND the custom panel when both are declared', () => {
    const { store, service } = mount()
    const feature = {
      id: 'demo',
      title: () => 'Demo',
      component: () => null,
      settings: {
        toggles: [{
          key: 'autoOpenSubagent',
          title: () => 'Auto row',
          desc: () => 'row description',
        }],
        render: () => createElement('div', { 'data-custom-panel': true }, 'custom panel'),
      },
    } as unknown as TabDescriptor
    const html = renderToString(createElement(SettingsBody, {
      feature,
      prefs: SIDEBAR_PREFS_DEFAULTS,
      store,
      service,
      onToggle: () => {},
      onCommit: () => '',
      onSelectValue: () => {},
      onPluginToggle: () => {},
      onPluginCommit: () => '',
      onPluginSelectValue: () => {},
      onPluginWrite: () => {},
      onClose: () => {},
    }))
    expect(html).toContain('Auto row')
    expect(html).toContain('row description')
    expect(html).toContain('data-custom-panel')
    expect(html).toContain('custom panel')
  })

  it('renders ONLY the custom panel when no rows are declared (unchanged behavior)', () => {
    const { store, service } = mount()
    const feature = {
      id: 'demo',
      title: () => 'Demo',
      component: () => null,
      settings: {
        render: () => createElement('div', { 'data-custom-panel': true }, 'custom panel'),
      },
    } as unknown as TabDescriptor
    const html = renderToString(createElement(SettingsBody, {
      feature,
      prefs: SIDEBAR_PREFS_DEFAULTS,
      store,
      service,
      onToggle: () => {},
      onCommit: () => '',
      onSelectValue: () => {},
      onPluginToggle: () => {},
      onPluginCommit: () => '',
      onPluginSelectValue: () => {},
      onPluginWrite: () => {},
      onClose: () => {},
    }))
    expect(html).toContain('custom panel')
    expect(html).not.toContain('Auto row')
  })
})
