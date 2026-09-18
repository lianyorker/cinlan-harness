/** Native settings rows over the owner's framework-bound preferences and app-window facts. */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FloatingActions, FloatingSnapshot, FloatingWindowPhase } from './contract.ts'
import type { FloatingWorkspaceSettings, ToggleButtonPosition } from '../types.ts'
import type { FloatingWorkspaceSettingsKey } from './locales.ts'
import css from './FloatingWorkspaceSection.module.css'

/** Private runtime facts and callbacks; no settings service reaches the component. */
export interface FloatingWorkspaceSectionInjected {
  /** The renderer binds the stable source as useFloating. */
  hooks: { floating: ObservableSnapshot<FloatingSnapshot> }
  /** Persist a schema-valid preference; the source echoes accepted writes. */
  set: FloatingActions['set']
  /** Open or close the owning app window. */
  toggle: FloatingActions['toggle']
  /** Close the app window, distinct from the settings owner's close callback. */
  closeWindow: FloatingActions['close']
}

/** Framework-derived owner, locale and private-source shares for this section. */
export type FloatingWorkspaceSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.floatingWorkspace'> & InjectFace<FloatingWorkspaceSectionInjected>

interface DimensionProps {
  anchor: string
  label: string
  description: string
  invalid: string
  unit: string
  value: number
  min: number
  max: number
  disabled: boolean
  commit: (value: number) => Promise<void>
}

function DimensionRow({ anchor, label, description, invalid, unit, value, min, max, disabled, commit }: DimensionProps) {
  const id = useId()
  const [draft, setDraft] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const text = draft ?? String(value)
  const numeric = Number(text)
  const valid = text.trim() !== '' && Number.isInteger(numeric) && numeric >= min && numeric <= max
  useEffect(() => {
    setDraft(current => current === String(value) ? undefined : current)
  }, [value])
  const save = async (): Promise<void> => {
    if (disabled || submitting || draft === undefined || !valid) return
    if (numeric === value) {
      setDraft(undefined)
      return
    }
    setSubmitting(true)
    await commit(numeric)
    setSubmitting(false)
  }
  return <div className={css.row} data-settings-anchor={anchor}>
    <div className={css.rowText}>
      <label className={css.rowTitle} htmlFor={id}>{label}</label>
      <p className={css.rowDesc} id={id + '-help'}>{description}</p>
    </div>
    <div className={css.dimensionControl}>
      <div className={css.dimensionInput}>
        <Input id={id} type="number" inputMode="numeric" min={min} max={max} step={1}
          value={text} disabled={disabled || submitting} aria-invalid={!valid}
          aria-describedby={id + (valid ? '-help' : '-error')}
          onChange={(event) => { setDraft(event.currentTarget.value) }}
          onBlur={() => { void save() }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void save()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(undefined)
            }
          }} />
        <span className={css.unit}>{unit}</span>
      </div>
      {!valid && <p id={id + '-error'} className={css.error} role="alert">{invalid}</p>}
    </div>
  </div>
}

interface DirectoryProps {
  value: string
  rawValue: string | undefined
  label: string
  description: string
  placeholder: string
  disabled: boolean
  commit: (value: string) => Promise<void>
}

function DirectoryRow({ value, rawValue, label, description, placeholder, disabled, commit }: DirectoryProps) {
  const id = useId()
  const [draft, setDraft] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    setDraft(current => current === value || current === rawValue ? undefined : current)
  }, [value, rawValue])
  const save = async (): Promise<void> => {
    if (disabled || submitting || draft === undefined) return
    if (draft === value || draft === rawValue) {
      setDraft(undefined)
      return
    }
    setSubmitting(true)
    await commit(draft)
    setSubmitting(false)
  }
  return <div className={css.row} data-settings-anchor="floating-directory">
    <div className={css.rowText}>
      <label className={css.rowTitle} htmlFor={id}>{label}</label>
      <p className={css.rowDesc} id={id + '-help'}>{description}</p>
    </div>
    <div className={css.directory}>
      <Input id={id} type="text" value={draft ?? value} disabled={disabled || submitting}
        aria-describedby={id + '-help'} placeholder={placeholder}
        onChange={(event) => { setDraft(event.currentTarget.value) }}
        onBlur={() => { void save() }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void save()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(undefined)
          }
        }} />
    </div>
  </div>
}

const phaseKeys: Record<FloatingWindowPhase, FloatingWorkspaceSettingsKey> = {
  closed: 'closed', open: 'opened', blocked: 'blocked', unavailable: 'unavailable',
}

/**
 * Render accepted preferences and observed app-window state without inventing defaults.
 * @param props - framework locale/source hooks and plain preference/window callbacks.
 * @returns single-column native settings rows with explicit save and runtime feedback.
 */
export function FloatingWorkspaceSection({
  useFloating, set, toggle, closeWindow, t,
}: FloatingWorkspaceSectionProps): ReactNode {
  const snapshot = useFloating(value => value)
  const { settings } = snapshot
  const value = settings.status === 'ready' ? settings.value : undefined
  const locked = !settings.writable || snapshot.writing
  const childControlsWindow = snapshot.child || snapshot.phase === 'open'
  const cannotOpen = value === undefined || !value.enabled || snapshot.writing || snapshot.phase === 'unavailable'
  const positionId = useId()
  const rawSettings = settings.user as Partial<FloatingWorkspaceSettings> | undefined
  return <section className={css.section} data-floating-workspace-section>
    <p className={css.intro}>{t('description')}</p>
    {settings.status === 'loading' && <p className={css.message} role="status">{t('loading')}</p>}
    {settings.status !== 'loading' && value === undefined && <p className={css.error} role="status">{t('error')}</p>}
    {snapshot.child && <p className={css.message}>{t('childWindow')}</p>}
    {snapshot.targetUnavailable && <p className={css.warning} role="status">{t('initialSessionUnavailable')}</p>}
    {snapshot.writeFailed && <p className={css.error} role="alert">{t('writeFailed')}</p>}
    {snapshot.writing && <p className={css.message} role="status">{t('saving')}</p>}
    {value !== undefined && <>
      {!settings.writable && <p className={css.message}>{t('readOnly')}</p>}
      <section className={css.group}>
        <h2>{t('workspaceEntry')}</h2>
        <div className={css.row} data-settings-anchor="floating-enabled">
          <div className={css.rowText}>
            <span className={css.rowTitle}>{t('enable')}</span>
            <p className={css.rowDesc}>{t('enableDescription')}</p>
          </div>
          <Switch checked={value.enabled} disabled={locked} label={t('enable')}
            onChange={(next) => { void set('enabled', next) }} />
        </div>
        <div className={css.row} data-settings-anchor="floating-position">
          <div className={css.rowText}>
            <label className={css.rowTitle} htmlFor={positionId}>{t('toggleButtonPosition')}</label>
            <p className={css.rowDesc} id={positionId + '-help'}>{t('toggleButtonPositionDescription')}</p>
          </div>
          <select id={positionId} className={css.select} value={value.toggleButtonPosition}
            disabled={locked || !value.enabled} aria-describedby={positionId + '-help'}
            onChange={(event) => { void set('toggleButtonPosition', event.currentTarget.value as ToggleButtonPosition) }}>
            <option value="header">{t('toggleButtonPositionHeader')}</option>
            <option value="sidebar">{t('toggleButtonPositionSidebar')}</option>
            <option value="floating">{t('toggleButtonPositionFloating')}</option>
          </select>
        </div>
        <DirectoryRow value={value.terminalDirectory} rawValue={rawSettings?.terminalDirectory}
          label={t('terminalDirectory')} placeholder={t('terminalDirectoryPlaceholder')}
          description={t(snapshot.directorySupported ? 'terminalDirectoryDescription' : 'terminalDirectoryUnavailable')}
          disabled={!snapshot.directorySupported || locked || !value.enabled}
          commit={next => set('terminalDirectory', next)} />
      </section>
      <section className={css.group}>
        <h2>{t('floatDefaultSize')}</h2>
        <p className={css.groupDescription}>{t('floatDefaultSizeDescription')}</p>
        <DimensionRow anchor="floating-width" label={t('floatDefaultWidth')} description={t('widthDescription')}
          invalid={t('widthInvalid')} unit={t('pixelUnit')} value={value.floatDefaultWidth} min={200} max={800}
          disabled={locked || !value.enabled} commit={next => set('floatDefaultWidth', next)} />
        <DimensionRow anchor="floating-height" label={t('floatDefaultHeight')} description={t('heightDescription')}
          invalid={t('heightInvalid')} unit={t('pixelUnit')} value={value.floatDefaultHeight} min={150} max={600}
          disabled={locked || !value.enabled} commit={next => set('floatDefaultHeight', next)} />
      </section>
    </>}
    <section className={css.group}>
      <div className={css.row} data-settings-anchor="floating-shortcut">
        <div className={css.rowText}>
          <span className={css.rowTitle}>{t('shortcut')}</span>
          <p className={css.rowDesc}>{t('shortcutDescription')}</p>
        </div>
      </div>
      <div className={css.row} data-settings-anchor="floating-open">
        <div className={css.rowText}>
          <span className={css.rowTitle}>{t('windowAction')}</span>
          <p className={css.rowDesc}>{t('windowActionDescription')}</p>
          <p className={css.runtimeStatus} role="status">
            {t(snapshot.phase === 'closed' && value !== undefined && !value.enabled && !snapshot.child
              ? 'disabled' : phaseKeys[snapshot.phase])}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={!childControlsWindow && cannotOpen}
          onClick={childControlsWindow ? closeWindow : toggle}>{t(childControlsWindow ? 'close' : 'open')}</Button>
      </div>
    </section>
  </section>
}
