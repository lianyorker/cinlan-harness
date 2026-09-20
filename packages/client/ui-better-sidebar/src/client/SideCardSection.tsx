/** Workspace layout preferences and registered feature settings within the native Settings shell. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutline14,
  IconPlusOutline16,
  IconSettingsOutline16,
  Input,
  Menu,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
// Type-only: pulls the settings shell's SlotMap merges ('settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  clampWidthPercent,
  TITLE_BAR_STRIP_MAX,
  TITLE_BAR_STRIP_MIN,
  WIDTH_PERCENT_MAX,
  WIDTH_PERCENT_MIN,
  type SidebarPrefs,
} from '../prefs-shared.ts'
import { AddPluginModal } from './add-plugin-modal.tsx'
import type { SidebarPreferencesController } from './preferences-controller.ts'
import { t } from './locales.ts'
import { featureSettings } from './feature-settings.ts'
import { parseDesktopEnv } from './desktop-env.ts'
import { getShellPreset, getShellPresets } from './shell-presets.ts'
import type { SidebarStore } from './state.ts'
import type {
  BetterSidebarService,
  FileViewerDescriptor,
  SidebarSettingsRenderProps,
  SidebarSettingToggle,
  TabDescriptor,
} from './service.ts'
import css from './SideCardSection.module.css'

/** Scalar values accepted by text and number settings controls. */
function settingText(value: unknown): string {
  return typeof value === 'string' ? value
    : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

/** Injected business face: the shared store (prefs cache) + the sidebar service (registries). */
export interface SideCardSectionInjected {
  store: SidebarStore
  service: BetterSidebarService
  preferences: SidebarPreferencesController
  /** Registered tab to configure; omitted for general workspace layout. */
  featureId?: string
  /** Render as a smaller section within another feature's settings page. */
  embedded?: boolean
}

/** Full section props: the runtime share plus the injected face. */
export type SideCardSectionProps = PropsRuntime<'settings.section'> & SideCardSectionInjected

/** Map one wire failure to the inline message (the conflict gets friendly copy). */
function messageOf(error: unknown): string {
  if (error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'settings-conflict') {
    return `${t('settingsSaveFailed')} ${t('settingsConflict')}`
  }
  return `${t('settingsSaveFailed')} ${error instanceof Error ? error.message : String(error)}`
}

/** Resolve an i18n-friendly string-or-function value. */
function textOf(value: string | (() => string) | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'function' ? value() : value
}

/** Resolve a descriptor icon (ReactNode or size function). */
function iconOf(icon: ReactNode | ((size: number) => ReactNode) | undefined, size: number): ReactNode {
  if (icon === undefined) return null
  return typeof icon === 'function' ? icon(size) : icon
}

/**
 * The scheme dropdown's current value: the plain scheme, or `preset:<id>`
 * while a preset is active. Falls back to `auto` when the stored preset id
 * is no longer registered (the strip resolves to 0 then anyway).
 */
function titleBarSchemeValue(prefs: SidebarPrefs): string {
  if (prefs.titleBarScheme !== 'preset') return prefs.titleBarScheme
  const preset = getShellPreset(prefs.titleBarPresetId)
  return preset !== undefined ? `preset:${preset.id}` : 'auto'
}

/** Viewer inventory order: priority desc (the catch-all `code` comes last). */
function viewerOrder(a: FileViewerDescriptor, b: FileViewerDescriptor): number {
  return (b.priority ?? 0) - (a.priority ?? 0)
}

/** Resolve a feature's display name without exposing its registration id. */
function featureNameOf(feature: TabDescriptor | FileViewerDescriptor): string {
  return textOf(feature.title) || t('featureSettingsTitle')
}

/**
 * Merge one plugin-owned setting into a pluginSettings map (pure, v0.12.0+).
 * Sequential merges are additive: each call spreads the map it was GIVEN,
 * so building from the latest optimistic map keeps earlier keys intact
 * (two same-tick writes must not drop each other).
 */
export function mergePluginSetting(
  pluginSettings: Record<string, Record<string, unknown>>,
  descriptorId: string,
  key: string,
  value: unknown,
): Record<string, Record<string, unknown>> {
  return {
    ...pluginSettings,
    [descriptorId]: { ...(pluginSettings[descriptorId] ?? {}), [key]: value },
  }
}

/**
 * Render a custom settings panel (`settings.render`) with error containment:
 * a throwing panel shows an inline error line instead of breaking the whole
 * settings page.
 */
function SettingsRender(props: {
  render: (renderProps: SidebarSettingsRenderProps) => ReactNode
  renderProps: SidebarSettingsRenderProps
}) {
  let content: ReactNode
  try {
    content = props.render(props.renderProps)
  } catch (error) {
    content = (
      <div className={css.error} role="alert">
        {t('settingsSaveFailed')} {error instanceof Error ? error.message : String(error)}
      </div>
    )
  }
  return <>{content}</>
}

/**
 * The custom switch: a real checkbox (hidden, native semantics and focus)
 * driving a styled track/thumb. Used by the general toggle rows and the
 * secondary settings popup rows.
 */
function Switch(props: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  const { checked, onChange, label } = props
  return (
    <label className={css.switch}>
      <input
        type="checkbox"
        className={css.switchInput}
        checked={checked}
        aria-label={label}
        onChange={(event) => { onChange(event.currentTarget.checked) }}
      />
      <span className={css.switchTrack} aria-hidden="true">
        <span className={css.switchThumb} />
      </span>
    </label>
  )
}

/** Declarative preference rows, with text and number drafts committed on blur or Enter. */
export function FeatureSettingsRows(props: {
  toggles: readonly SidebarSettingToggle[]
  prefs: SidebarPrefs
  onToggle: (toggle: SidebarSettingToggle, next: boolean) => void
  /** Commit one text/number row; returns the canonical value the row should
   *  display (clamped for numbers, the current pref when the input is
   *  invalid). Optional: rows with no handler keep their draft. */
  onCommit?: (toggle: SidebarSettingToggle, raw: string) => string
  /** Commit one select row: the picked option's value (single) or the array
   *  of picked values (`multi: true`). Optional: rows with no handler are
   *  display-only. */
  onSelectValue?: (toggle: SidebarSettingToggle, next: unknown) => void
  /** Explicit value source (v0.12.0+): when given, rows read their values
   *  from it instead of the `prefs` face — plugin-owned rows read their
   *  own blob, so a plugin key can never collide with (or silently read)
   *  a host pref of the same name. (Named `valueSource`, not `valueOf`:
   *  the latter collides with the inherited Object.prototype.valueOf.) */
  valueSource?: (key: string) => unknown
  /** Search focus anchors share the feature page prefix. */
  anchorPrefix?: string
}) {
  const { toggles, prefs, onToggle, onCommit, onSelectValue, valueSource, anchorPrefix } = props
  const read = valueSource ?? ((key: string): unknown => (prefs as unknown as Record<string, unknown>)[key])
  return (
    <div className={css.popupRows}>
      {toggles.map((toggle) => {
        const title = textOf(toggle.title)
        const anchor = anchorPrefix === undefined ? undefined : `${anchorPrefix}-${toggle.key}`
        if (toggle.type === 'select') {
          return (
            <SelectRow
              key={toggle.key}
              toggle={toggle}
              title={title}
              value={read(toggle.key)}
              anchor={anchor}
              onSelectValue={onSelectValue}
            />
          )
        }
        if ((toggle.type ?? 'switch') === 'switch') {
          return (
            <div key={toggle.key} className={css.popupRow} data-settings-anchor={anchor} tabIndex={-1}>
              <span className={css.rowText}>
                <span className={css.title}>{title}</span>
                {textOf(toggle.desc) !== '' && <span className={css.desc}>{textOf(toggle.desc)}</span>}
              </span>
              <Switch
                label={title}
                checked={read(toggle.key) === true}
                onChange={(next) => { onToggle(toggle, next) }}
              />
            </div>
          )
        }
        const value = settingText(read(toggle.key))
        // Keyed by the committed value: a failed commit reverts prefs, the
        // key changes, and the row remounts with the stored value (typing
        // never changes the key, so mid-edit drafts survive re-renders).
        return (
          <TypedRow
            key={`${toggle.key}:${value}`}
            toggle={toggle}
            title={title}
            value={value}
            anchor={anchor}
            onCommit={onCommit}
          />
        )
      })}
    </div>
  )
}

/**
 * One text/number row: a controlled input whose draft is local state,
 * committed on blur/Enter through the parent's onCommit. The parent's
 * canonical return is adopted (clamped numbers, stored value for invalid
 * input); a `unit` suffix renders after the input (e.g. 'px').
 */
function TypedRow(props: {
  toggle: SidebarSettingToggle
  title: string
  value: string
  anchor?: string
  onCommit?: (toggle: SidebarSettingToggle, raw: string) => string
}) {
  const { toggle, title, value, onCommit, anchor } = props
  const [draft, setDraft] = useState(value)
  const commit = (): void => {
    const canonical = onCommit?.(toggle, draft) ?? draft
    setDraft(canonical)
  }
  const number = toggle.type === 'number'
  return (
    <div className={css.popupRow} data-settings-anchor={anchor} tabIndex={-1}>
      <span className={css.rowText}>
        <span className={css.title}>{title}</span>
        {textOf(toggle.desc) !== '' && <span className={css.desc}>{textOf(toggle.desc)}</span>}
      </span>
      <span className={css.control}>
        <Input
          type={number ? 'number' : 'text'}
          className={number ? css.typedInputNumber : css.typedInput}
          value={draft}
          min={toggle.min}
          max={toggle.max}
          step={1}
          placeholder={toggle.placeholder}
          aria-label={title}
          onChange={(event) => { setDraft(event.currentTarget.value) }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        {toggle.unit !== undefined && <span className={css.suffix}>{toggle.unit}</span>}
      </span>
    </div>
  )
}
/**
 * The multi-line custom-CSS input (scheme `custom`): a monospace textarea
 * whose draft is local state, committed on blur or Cmd/Ctrl+Enter through
 * the parent's handler. Keyed by the stored value so an external commit
 * remounts it with the canonical text (same pattern as TypedRow).
 */
function CssDraft(props: {
  value: string
  onCommit: (raw: string) => void
  label: string
  placeholder?: string
}) {
  const { value, onCommit, label, placeholder } = props
  const [draft, setDraft] = useState(value)
  return (
    <textarea
      className={css.cssTextArea}
      rows={6}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      onChange={(event) => { setDraft(event.currentTarget.value) }}
      onBlur={() => { onCommit(draft) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.blur()
      }}
    />
  )
}

/**
 * The reusable dropdown — the primitives Menu, NOT a native <select>: a
 * closed anchor button (picked option text + chevron) opening one Menu item
 * per option (big-icon cards when any option carries an icon). Single-pick
 * commits the option's value and closes; `multi` toggles membership and
 * commits the picked values as an array (in options order), staying open.
 * Shared by the declarative select rows (SelectRow) and the title-bar
 * scheme dropdown on the General row.
 */
function SelectMenu(props: {
  label: string
  value: unknown
  options: readonly {
    value: string | number | boolean
    title: string | (() => string)
    desc?: string | (() => string)
    icon?: ReactNode | ((size: number) => ReactNode)
  }[]
  multi?: boolean
  onSelect: (next: unknown) => void
  placeholder?: string
}) {
  const { label, value, options, multi, onSelect, placeholder } = props
  const [open, setOpen] = useState(false)
  const hasIcons = options.some(option => option.icon !== undefined)
  const picked: readonly unknown[] = multi ? (Array.isArray(value) ? value : []) : [value]
  const selected = options.filter(option => picked.includes(option.value))

  /** Commit one picked option (toggle semantics under multi). */
  const pick = (index: number): void => {
    const option = options[index]
    if (option === undefined) return
    if (!multi) {
      onSelect(option.value)
      setOpen(false)
      return
    }
    const current: unknown[] = Array.isArray(value) ? [...value as unknown[]] : []
    const at = current.indexOf(option.value)
    if (at >= 0) current.splice(at, 1)
    else current.push(option.value)
    // Stable wire order: follow the declared options order, not pick order.
    onSelect(options.filter(o => current.includes(o.value)).map(o => o.value))
  }

  const anchor = (
    <button
      type="button"
      className={css.selectAnchor}
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => { setOpen(now => !now) }}
    >
      {!multi && hasIcons && selected[0] !== undefined && (
        <span className={css.selectAnchorIcon}>{iconOf(selected[0].icon, 16)}</span>
      )}
      <span className={css.selectAnchorText}>
        {selected.length === 0 ? (placeholder ?? '—') : selected.map(option => textOf(option.title)).join(', ')}
      </span>
      <IconChevronDownOutline14 size={12} />
    </button>
  )

  return (
    <Menu
      open={open}
      anchor={anchor}
      items={options.map((option, index) => ({
        id: String(index),
        label: hasIcons
          ? (
            <span className={css.selectOption}>
              <span className={css.selectOptionIcon}>{iconOf(option.icon, 24)}</span>
              <span className={css.selectOptionText}>
                <span className={css.title}>{textOf(option.title)}</span>
                {textOf(option.desc) !== '' && <span className={css.desc}>{textOf(option.desc)}</span>}
              </span>
            </span>
          )
          : textOf(option.title),
      }))}
      selectedId={!multi && selected[0] !== undefined ? String(options.indexOf(selected[0])) : undefined}
      selectedIds={multi ? selected.map(option => String(options.indexOf(option))) : undefined}
      onSelect={(id) => { pick(Number(id)) }}
      onClose={() => { setOpen(false) }}
      portal
    />
  )
}

/**
 * One select row: a dropdown over the toggle's declared `options` (the
 * shared SelectMenu). When any option carries an icon, the dropdown renders
 * big-icon option cards (icon + title + desc) and the closed anchor shows
 * the selected option's icon as well; without icons both are a single line
 * of text. Single-pick commits the option's value and closes; `multi`
 * toggles membership, commits the picked values as an array (in options
 * order), and stays open.
 */
function SelectRow(props: {
  toggle: SidebarSettingToggle
  title: string
  value: unknown
  anchor?: string
  onSelectValue?: (toggle: SidebarSettingToggle, next: unknown) => void
}) {
  const { toggle, title, value, onSelectValue, anchor } = props
  return (
    <div className={css.popupRow} data-settings-anchor={anchor} tabIndex={-1}>
      <span className={css.rowText}>
        <span className={css.title}>{title}</span>
        {textOf(toggle.desc) !== '' && <span className={css.desc}>{textOf(toggle.desc)}</span>}
      </span>
      <span className={css.control}>
        <SelectMenu
          label={title}
          value={value}
          options={toggle.options ?? []}
          multi={toggle.multi === true}
          onSelect={(next) => { onSelectValue?.(toggle, next) }}
        />
      </span>
    </div>
  )
}

/**
 * The secondary settings popup body of one feature (tab or viewer):
 * - the host-prefs `toggles` rows, then the plugin-owned `pluginToggles`
 *   rows (their values live in `pluginSettings[feature.id]`, projected onto
 *   the prefs face so the shared row renderer reads them);
 * - `settings.render` (custom panel) AFTER those rows when declared — the
 *   custom panel is an extension of the row list, not a replacement, so a
 *   feature can keep its declarative rows (e.g. the editor's
 *   open-behavior picker) and still ship a custom configuration area.
 */
export function SettingsBody(props: {
  feature: TabDescriptor | FileViewerDescriptor
  prefs: SidebarPrefs
  store: SidebarStore
  service: BetterSidebarService
  anchorPrefix?: string
  onToggle: (toggle: SidebarSettingToggle, next: boolean) => void
  onCommit: (toggle: SidebarSettingToggle, raw: string) => string
  onSelectValue: (toggle: SidebarSettingToggle, next: unknown) => void
  onPluginToggle: (toggle: SidebarSettingToggle, next: boolean) => void
  onPluginCommit: (toggle: SidebarSettingToggle, raw: string) => string
  onPluginSelectValue: (toggle: SidebarSettingToggle, next: unknown) => void
  onPluginWrite: (key: string, value: unknown) => void
  onClose: () => void
}) {
  const {
    feature, prefs, store, service, anchorPrefix, onToggle, onCommit, onSelectValue,
    onPluginToggle, onPluginCommit, onPluginSelectValue, onPluginWrite, onClose,
  } = props
  const render = feature.settings?.render
  const toggles = feature.settings?.toggles ?? []
  const pluginToggles = feature.settings?.pluginToggles ?? []
  if (render === undefined && toggles.length === 0 && pluginToggles.length === 0) return null
  // Plugin rows read their values from the descriptor's OWN blob through
  // an explicit value source — no projection onto the prefs face, so a
  // plugin key can never collide with (or silently read) a host pref of
  // the same name.
  const pluginBlob = prefs.pluginSettings[feature.id] ?? {}
  return (
    <div>
      {(toggles.length > 0 || pluginToggles.length > 0) && (
        <div className={css.popupRows}>
          {toggles.length > 0 && (
            <FeatureSettingsRows
              toggles={toggles}
              anchorPrefix={anchorPrefix}
              prefs={prefs}
              onToggle={onToggle}
              onCommit={onCommit}
              onSelectValue={onSelectValue}
            />
          )}
          {pluginToggles.length > 0 && (
            <FeatureSettingsRows
              toggles={pluginToggles}
              anchorPrefix={anchorPrefix === undefined ? undefined : `${anchorPrefix}-plugin`}
              prefs={prefs}
              onToggle={onPluginToggle}
              onCommit={onPluginCommit}
              onSelectValue={onPluginSelectValue}
              valueSource={key => pluginBlob[key]}
            />
          )}
        </div>
      )}
      {render !== undefined && (
        <SettingsRender
          render={render}
          renderProps={{
            store,
            service,
            prefs,
            pluginSettings: prefs.pluginSettings[feature.id] ?? {},
            updatePluginSetting: onPluginWrite,
            close: onClose,
          }}
        />
      )}
    </div>
  )
}

/**
 * Render the Side card preferences section.
 * @param props - composed slot props (runtime share + injected store/service).
 * @returns the section element tree.
 */
export function SideCardSection({ store, service, preferences, featureId, embedded = false, close }: SideCardSectionProps) {
  const [prefs, setPrefs] = useState<SidebarPrefs>(() => store.getPrefs())
  const [widthDraft, setWidthDraft] = useState<string>(String(store.getPrefs().defaultWidthPercent))
  const [error, setError] = useState<string | null>(null)
  // Whether the position-compat strip popup (the gear on the 常规 row) is open.
  const [stripSettingsOpen, setStripSettingsOpen] = useState(false)
  // The parsed desktop environment (URL stamps — see desktop-env.ts). Used
  // ONLY to badge matching presets in the scheme dropdown ("已检测");
  // nothing is auto-applied.
  const detectedEnv = useMemo(() => parseDesktopEnv(), [])
  const [addViewersOpen, setAddViewersOpen] = useState(false)
  // The LATEST optimistic prefs, kept in sync with the state. Nested-map
  // merges (tabsEnabled / viewersEnabled / pluginSettings) MUST build from
  // this ref, not from the render-time `prefs`: two same-tick writes (e.g.
  // a settings panel updating several plugin keys at once) would otherwise
  // both spread the stale map and the later patch would drop the earlier
  // key even though the commits are serialized.
  const optimisticRef = useRef(prefs)
  useEffect(() => { optimisticRef.current = prefs }, [prefs])

  // The declarative inventory: the registered tab types and file viewers.
  // Local state + service.subscribe (registry changes are rare — plugin
  // load/unload — so a plain effect is enough; no external-store ceremony).
  const [tabs, setTabs] = useState<TabDescriptor[]>(() => [...service.getTabs()])
  const [viewers, setViewers] = useState<FileViewerDescriptor[]>(() => [...service.getFileViewers()].sort(viewerOrder))
  useEffect(() => service.subscribe(() => {
    setTabs([...service.getTabs()])
    setViewers([...service.getFileViewers()].sort(viewerOrder))
  }), [service])

  useEffect(() => store.subscribe(() => {
    const next = store.getPrefs()
    setPrefs(next)
    setWidthDraft(String(next.defaultWidthPercent))
  }), [store])

  /** Persist one patch through the shared standard settings scope. */
  const commit = (patch: Record<string, unknown>): Promise<SidebarPrefs> => {
    return preferences.patch(patch as Partial<SidebarPrefs>).then(
      () => store.getPrefs(),
      (caught: unknown) => {
        setError(messageOf(caught))
        return store.getPrefs()
      },
    )
  }

  /** Adopt controller recovery or its newer pending optimistic state. */
  const applyOutcome = (settled: SidebarPrefs): void => {
    optimisticRef.current = settled
    setPrefs(settled)
    setWidthDraft(String(settled.defaultWidthPercent))
  }

  /** Optimistically apply one pref patch, then commit (revert on failure). */
  const applyPref = (patch: Record<string, unknown>): void => {
    const previous = optimisticRef.current
    const next = { ...previous, ...patch }
    optimisticRef.current = next
    setPrefs(next)
    setError(null)
    void commit(patch).then(applyOutcome)
  }

  const onToggle = (next: boolean): void => {
    applyPref({ openByDefault: next })
  }

  /** Flip one per-tab enable switch (merge into the tabsEnabled map). */
  const onToggleTab = (id: string, next: boolean): void => {
    applyPref({ tabsEnabled: { ...optimisticRef.current.tabsEnabled, [id]: next } })
  }

  /** Flip one per-viewer enable switch (merge into the viewersEnabled map). */
  const onToggleViewer = (id: string, next: boolean): void => {
    applyPref({ viewersEnabled: { ...optimisticRef.current.viewersEnabled, [id]: next } })
  }

  /** Flip one declaratively-declared toggle (a SidebarPrefs boolean field). */
  const onToggleSetting = (toggle: SidebarSettingToggle, next: boolean): void => {
    applyPref({ [toggle.key]: next })
  }

  /** Commit one declaratively-declared select row (the option's value, or an
   *  array of values under `multi`). */
  const onSelectSetting = (toggle: SidebarSettingToggle, next: unknown): void => {
    applyPref({ [toggle.key]: next })
  }

  /**
   * Commit one declaratively-declared text/number row. Numbers are parsed
   * and clamped to the toggle's declared min/max (an unparsable input falls
   * back to the CURRENT stored value, mirroring the width row); text rows
   * persist as-is (empty is meaningful, e.g. the theme-default font).
   * Returns the canonical value the row should display.
   */
  const onCommitSetting = (toggle: SidebarSettingToggle, raw: string): string => {
    if (toggle.type === 'number') {
      const parsed = Number(raw)
      const fallback = settingText((prefs as unknown as Record<string, unknown>)[toggle.key])
      if (!Number.isFinite(parsed)) return fallback
      let clamped = Math.round(parsed)
      if (toggle.min !== undefined) clamped = Math.max(toggle.min, clamped)
      if (toggle.max !== undefined) clamped = Math.min(toggle.max, clamped)
      applyPref({ [toggle.key]: clamped })
      return String(clamped)
    }
    applyPref({ [toggle.key]: raw })
    return raw
  }

  /**
   * Pick the title-bar / shell compatibility scheme. Mirrors the legacy
   * `titleBarCompat` flag (true = anything but the conservative auto) so
   * documents stay readable by older plugin versions.
   */
  /**
   * Pick the title-bar / shell compatibility scheme from the dropdown. The
   * option values are `auto` | `web` | `custom` | `preset:<id>`; selecting
   * a preset stores both the scheme and its id. Mirrors the legacy
   * `titleBarCompat` flag (true for preset/custom) so documents stay
   * readable by older plugin versions.
   */
  const onSchemeSelect = (value: unknown): void => {
    if (typeof value !== 'string') return
    if (value === 'auto' || value === 'web' || value === 'custom') {
      applyPref({ titleBarScheme: value, titleBarCompat: value === 'custom' })
      return
    }
    if (value.startsWith('preset:') && getShellPreset(value.slice('preset:'.length)) !== undefined) {
      applyPref({
        titleBarScheme: 'preset',
        titleBarPresetId: value.slice('preset:'.length),
        titleBarCompat: true,
      })
    }
  }

  /** Commit the free-form custom CSS (scheme `custom`). */
  const commitCustomCss = (raw: string): void => {
    applyPref({ customCss: raw })
  }

  /** Persist one plugin-owned setting of one descriptor (merged into the pluginSettings blob). */
  const applyPluginSetting = (descriptorId: string, key: string, value: unknown): void => {
    applyPref({ pluginSettings: mergePluginSetting(optimisticRef.current.pluginSettings, descriptorId, key, value) })
  }

  /** Flip one plugin-owned switch row (same row shape, plugin-scoped key). */
  const onPluginToggle = (descriptorId: string, toggle: SidebarSettingToggle, next: boolean): void => {
    applyPluginSetting(descriptorId, toggle.key, next)
  }

  /** Commit one plugin-owned text/number row (clamped like the host rows). */
  const onPluginCommitSetting = (descriptorId: string, toggle: SidebarSettingToggle, raw: string): string => {
    if (toggle.type === 'number') {
      const parsed = Number(raw)
      const blob = prefs.pluginSettings[descriptorId] ?? {}
      const fallback = settingText(blob[toggle.key])
      if (!Number.isFinite(parsed)) return fallback
      let clamped = Math.round(parsed)
      if (toggle.min !== undefined) clamped = Math.max(toggle.min, clamped)
      if (toggle.max !== undefined) clamped = Math.min(toggle.max, clamped)
      applyPluginSetting(descriptorId, toggle.key, clamped)
      return String(clamped)
    }
    applyPluginSetting(descriptorId, toggle.key, raw)
    return raw
  }

  const commitWidth = (): void => {
    const parsed = Number(widthDraft)
    if (!Number.isFinite(parsed)) {
      setWidthDraft(String(prefs.defaultWidthPercent))
      return
    }
    const clamped = clampWidthPercent(parsed)
    const previous = prefs
    setPrefs({ ...previous, defaultWidthPercent: clamped })
    setWidthDraft(String(clamped))
    setError(null)
    void commit({ defaultWidthPercent: clamped }).then(applyOutcome)
  }

  const feature = tabs.find(tab => tab.id === featureId)
  const title = featureId === undefined ? t('workspaceLayoutNav') : feature === undefined ? t('featureSettingsTitle') : featureNameOf(feature)

  const settingsBody = (descriptor: TabDescriptor | FileViewerDescriptor, anchorPrefix = `better-sidebar-${descriptor.id}`) => {
    const scoped = featureSettings(descriptor, embedded)
    return (
      <div className={css.inlineSettings}>
        <SettingsBody
          feature={scoped}
          prefs={prefs}
          store={store}
          service={service}
          anchorPrefix={anchorPrefix}
          onToggle={onToggleSetting}
          onCommit={onCommitSetting}
          onSelectValue={onSelectSetting}
          onPluginToggle={(toggle, next) => { onPluginToggle(descriptor.id, toggle, next) }}
          onPluginCommit={(toggle, raw) => onPluginCommitSetting(descriptor.id, toggle, raw)}
          onPluginSelectValue={(toggle, next) => { applyPluginSetting(descriptor.id, toggle.key, next) }}
          onPluginWrite={(key, value) => { applyPluginSetting(descriptor.id, key, value) }}
          onClose={close}
        />
      </div>
    )
  }

  const enableRow = (descriptor: TabDescriptor | FileViewerDescriptor, viewer = false) => (
    <div className={css.row} data-settings-anchor={`better-sidebar-${viewer ? 'viewer-' : ''}${descriptor.id}-enabled`} tabIndex={-1}>
      <span className={css.rowText}>
        <span className={css.title}>{t('featureEnabled')}</span>
        <span className={css.desc}>{t('featureEnabledDesc', { feature: featureNameOf(descriptor) })}</span>
      </span>
      <Switch
        label={t('featureEnabled')}
        checked={(viewer ? prefs.viewersEnabled : prefs.tabsEnabled)[descriptor.id] !== false}
        onChange={(next) => { if (viewer) onToggleViewer(descriptor.id, next); else onToggleTab(descriptor.id, next) }}
      />
    </div>
  )

  return (
    <div className={clsx(css.section, embedded && css.embedded)}>
      {embedded ? <h2 className={css.embeddedHeading}>{title}</h2> : <h1 className={css.pageHeading}>{title}</h1>}
      {!embedded && (
        <p className={css.intro}>
          {featureId === undefined ? t('workspaceLayoutIntro') : t('featureSettingsIntro', { feature: title })}
        </p>
      )}

      {featureId === undefined && (
        <div className={css.group}>
          <div className={css.groupHeading}>{t('settingsGeneralTitle')}</div>
          <div className={css.row} data-settings-anchor="better-sidebar-open-by-default" tabIndex={-1}>
            <span className={css.rowText}>
              <span className={css.title}>{t('settingsOpenTitle')}</span>
              <span className={css.desc}>{t('settingsOpenDesc')}</span>
            </span>
            <Switch
              label={t('settingsOpenTitle')}
              checked={prefs.openByDefault}
              onChange={onToggle}
            />
          </div>
          <div className={css.row} data-settings-anchor="better-sidebar-default-width" tabIndex={-1}>
            <span className={css.rowText}>
              <span className={css.title}>{t('settingsWidthTitle')}</span>
              <span className={css.desc}>{t('settingsWidthDesc')}</span>
            </span>
            <span className={css.control}>
              <Input
                type="number"
                className={css.percentInput}
                value={widthDraft}
                min={WIDTH_PERCENT_MIN}
                max={WIDTH_PERCENT_MAX}
                step={1}
                aria-label={t('settingsWidthTitle')}
                onChange={(event) => { setWidthDraft(event.currentTarget.value) }}
                onBlur={commitWidth}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
              <span className={css.suffix}>{t('settingsWidthSuffix')}</span>
            </span>
          </div>
          <div className={css.row} data-settings-anchor="better-sidebar-title-bar-mode" tabIndex={-1}>
            <span className={css.rowText}>
              <span className={css.title}>{t('settingsTitleBarTitle')}</span>
              <span className={css.desc}>{t('settingsTitleBarDesc')}</span>
            </span>
            <span className={css.control}>
              {/*
                The scheme dropdown (the shared SelectMenu — NOT a native
                select): 自动检测 (default) / DSH官方Web / 各壳兼容方案 /
                自定义方案. Matching presets carry a 「已检测」 desc badge
                (suggestion only). The 自定义方案 row keeps its gear (the
                popup with the shift distance + custom CSS) — the other
                schemes need no further settings.
              */}
              <SelectMenu
                label={t('settingsTitleBarTitle')}
                value={titleBarSchemeValue(prefs)}
                options={[
                  { value: 'auto', title: t('settingsSchemeAutoTitle'), desc: t('settingsSchemeAutoDesc') },
                  { value: 'web', title: t('settingsSchemeWebTitle'), desc: t('settingsSchemeWebDesc') },
                  ...getShellPresets().map(preset => ({
                    value: `preset:${preset.id}`,
                    title: preset.title,
                    desc: preset.detect?.(detectedEnv) === true
                      ? `${preset.desc}（${t('settingsSchemeDetectedSuffix')}）`
                      : preset.desc,
                  })),
                  { value: 'custom', title: t('settingsSchemeCustomTitle'), desc: t('settingsSchemeCustomDesc') },
                ]}
                onSelect={onSchemeSelect}
              />
              {prefs.titleBarScheme === 'custom' && (
                <button
                  type="button"
                  className={css.rowGear}
                  aria-label={`${t('settingsTitleBarTitle')} ${t('settingsPopup')}`}
                  title={t('settingsPopup')}
                  onClick={() => { setStripSettingsOpen(true) }}
                >
                  <IconSettingsOutline16 size={14} />
                </button>
              )}
            </span>
          </div>
        </div>
      )}

      {featureId !== undefined && feature === undefined && (
        <p className={css.intro} role="status">{t('featureUnavailable')}</p>
      )}
      {feature !== undefined && (
        <div className={css.group}>
          {enableRow(feature)}
          {featureId === 'editor' && (
            <div className={css.row} data-settings-anchor="better-sidebar-editor-intercept-open-path" tabIndex={-1}>
              <span className={css.rowText}>
                <span className={css.title}>{t('settingsOpenPathTitle')}</span>
                <span className={css.desc}>{t('settingsOpenPathDesc')}</span>
              </span>
              <Switch label={t('settingsOpenPathTitle')} checked={prefs.interceptOpenPath} onChange={(next) => { applyPref({ interceptOpenPath: next }) }} />
            </div>
          )}
          {settingsBody(feature)}
        </div>
      )}
      {featureId === 'editor' && feature !== undefined && (
        <section className={css.viewerSection}>
          <h3 className={css.groupHeading}>{t('settingsViewersTitle')}</h3>
          {viewers.map(viewer => (
            <div className={css.group} key={viewer.id}>
              <h4 className={css.groupHeading}>{featureNameOf(viewer)}</h4>
              <p className={css.intro}>{viewer.exts.length === 0 ? t('settingsViewerCatchAll') : viewer.exts.join(' · ')}</p>
              {enableRow(viewer, true)}
              {settingsBody(viewer, `better-sidebar-viewer-${viewer.id}`)}
            </div>
          ))}
          <button type="button" className={css.addViewer} onClick={() => { setAddViewersOpen(true) }}>
            <IconPlusOutline16 size={16} />
            {t('addPluginsViewerCard')}
          </button>
        </section>
      )}

      {/* The custom-scheme popup (opened by the gear next to the scheme
          dropdown when 自定义方案 is active): the shift distance in px and
          the free-form custom CSS. The OTHER schemes (自动检测 / DSH官方Web /
          壳预设) need no further settings — the scheme itself is chosen on
          the 常规 row. Mounted only while open (the Modal SSR rule above). */}
      {featureId === undefined && stripSettingsOpen && (
        <Modal
          open
          onClose={() => { setStripSettingsOpen(false) }}
          title={t('settingsTitleBarTitle')}
          description={t('settingsPopupDesc', { feature: t('settingsTitleBarTitle') })}
          closeLabel={t('close')}
          className={css.popupDialog}
          footer={(
            <button type="button" className={css.done} onClick={() => { setStripSettingsOpen(false) }}>
              {t('settingsDone')}
            </button>
          )}
        >
          <div className={css.popupRows}>
            <FeatureSettingsRows
              toggles={[{
                key: 'titleBarStripPx',
                type: 'number',
                title: () => t('settingsTitleBarStripTitle'),
                desc: () => t('settingsTitleBarStripDesc'),
                min: TITLE_BAR_STRIP_MIN,
                max: TITLE_BAR_STRIP_MAX,
                unit: 'px',
              }]}
              prefs={prefs}
              onToggle={onToggleSetting}
              onCommit={onCommitSetting}
            />
            <CssDraft
              key={prefs.customCss}
              value={prefs.customCss}
              label={t('settingsCustomCssTitle')}
              placeholder={t('settingsCustomCssPlaceholder')}
              onCommit={commitCustomCss}
            />
          </div>
        </Modal>
      )}

      {featureId === 'editor' && addViewersOpen && (
        <AddPluginModal service={service} kind="viewer" onClose={() => { setAddViewersOpen(false) }} />
      )}

      {error !== null && (
        <div className={css.error} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
