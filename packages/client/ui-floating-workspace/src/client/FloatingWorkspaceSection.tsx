/** Floating Workspace settings card backed by accepted preferences. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { IconFolderOpenOutline16, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FloatingActions, FloatingSnapshot } from './contract.ts'
import type { FloatingWorkspaceSettings, ToggleButtonPosition } from '../types.ts'
import css from './FloatingWorkspaceSection.module.css'

/** Private runtime facts and callbacks; no settings service reaches the component. */
export interface FloatingWorkspaceSectionInjected {
  /** The renderer binds the stable source as useFloating. */
  hooks: { floating: ObservableSnapshot<FloatingSnapshot> }
  /** Persist a schema-valid preference; the source echoes accepted writes. */
  set: FloatingActions['set']
  /** Open the Host directory picker without changing the current preference on cancellation. */
  pickDirectory: () => Promise<string | null>
}

/** Framework-derived owner, locale and private-source shares for this section. */
export type FloatingWorkspaceSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.floatingWorkspace'> & InjectFace<FloatingWorkspaceSectionInjected>

interface DirectoryProps {
  value: string
  rawValue: string | undefined
  label: string
  description: string
  placeholder: string
  pickLabel: string
  pickFailed: string
  disabled: boolean
  pick: () => Promise<string | null>
  commit: (value: string) => Promise<void>
}

function DirectoryRow({
  value, rawValue, label, description, placeholder, pickLabel, pickFailed, disabled, pick, commit,
}: DirectoryProps) {
  const id = useId()
  const [draft, setDraft] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [pickerFailed, setPickerFailed] = useState(false)
  const busy = useRef(false)
  useEffect(() => {
    setDraft(current => current === value || current === rawValue ? undefined : current)
  }, [value, rawValue])
  const save = async (): Promise<void> => {
    if (disabled || busy.current || draft === undefined) return
    if (draft === value || draft === rawValue) {
      setDraft(undefined)
      return
    }
    busy.current = true
    setSubmitting(true)
    try {
      await commit(draft)
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }
  const choose = async (): Promise<void> => {
    if (disabled || busy.current) return
    busy.current = true
    setSubmitting(true)
    setPickerFailed(false)
    try {
      const selected = await pick()
      if (selected !== null) {
        setDraft(selected)
        await commit(selected)
      }
    } catch {
      setPickerFailed(true)
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }
  return <div className={css.row} data-settings-anchor="floating-directory">
    <div className={css.rowText}>
      <label className={css.rowTitle} htmlFor={id}>{label}</label>
      <p className={css.rowDesc} id={id + '-help'}>{description}</p>
    </div>
    <div className={css.directoryControl} onBlur={(event) => {
      const next = event.relatedTarget
      if (next instanceof Node && event.currentTarget.contains(next)) return
      void save()
    }}>
      <Input id={id} type="text" value={draft ?? value} disabled={disabled || submitting}
        aria-describedby={id + '-help'} placeholder={placeholder}
        onChange={(event) => { setDraft(event.currentTarget.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void save()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(undefined)
          }
        }} />
      <button type="button" className={css.directoryButton} disabled={disabled || submitting}
        aria-label={pickLabel} title={pickLabel} onClick={() => { void choose() }}>
        <IconFolderOpenOutline16 size={16} />
      </button>
      {pickerFailed && <p className={css.controlError} role="alert">{pickFailed}</p>}
    </div>
  </div>
}

const positions: readonly ToggleButtonPosition[] = ['header', 'sidebar', 'floating']

/**
 * Render accepted preferences without inventing defaults.
 * @param props - framework locale/source hooks and preference callbacks.
 * @returns a page heading and one three-row settings card.
 */
export function FloatingWorkspaceSection({
  useFloating, set, pickDirectory, t,
}: FloatingWorkspaceSectionProps): ReactNode {
  const snapshot = useFloating(value => value)
  const { settings } = snapshot
  const value = settings.status === 'ready' ? settings.value : undefined
  const locked = !settings.writable || snapshot.writing
  const positionName = useId()
  const rawSettings = settings.user as Partial<FloatingWorkspaceSettings> | undefined
  return <section className={css.section} data-floating-workspace-section>
    <header className={css.pageHeading}>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
    </header>
    {settings.status === 'loading' && <p className={css.message} role="status">{t('loading')}</p>}
    {settings.status !== 'loading' && value === undefined && <p className={css.error} role="status">{t('error')}</p>}
    {snapshot.writeFailed && <p className={css.error} role="alert">{t('writeFailed')}</p>}
    {snapshot.writing && <p className={css.message} role="status">{t('saving')}</p>}
    {value !== undefined && <>
      {!settings.writable && <p className={css.message}>{t('readOnly')}</p>}
      <div className={css.card}>
        <div className={css.row} data-settings-anchor="floating-enabled">
          <div className={css.rowText}>
            <span className={css.rowTitle}>{t('enable')}</span>
            <p className={css.rowDesc}>{t('enableDescription')}</p>
          </div>
          <Switch checked={value.enabled} disabled={locked} label={t('enable')}
            onChange={(next) => { void set('enabled', next) }} />
        </div>
        <DirectoryRow value={value.terminalDirectory} rawValue={rawSettings?.terminalDirectory}
          label={t('terminalDirectory')} placeholder={t('terminalDirectoryPlaceholder')}
          description={t(snapshot.directorySupported ? 'terminalDirectoryDescription' : 'terminalDirectoryUnavailable')}
          pickLabel={t('terminalDirectoryPick')} pickFailed={t('terminalDirectoryPickFailed')} pick={pickDirectory}
          disabled={!snapshot.directorySupported || locked || !value.enabled}
          commit={next => set('terminalDirectory', next)} />
        <div className={css.row} data-settings-anchor="floating-position">
          <div className={css.rowText}>
            <span className={css.rowTitle} id={positionName}>{t('toggleButtonPosition')}</span>
            <p className={css.rowDesc} id={positionName + '-help'}>{t('toggleButtonPositionDescription')}</p>
          </div>
          <fieldset className={css.segmented} aria-labelledby={positionName} aria-describedby={positionName + '-help'}>
            {positions.map(position => <label className={css.segment} key={position}>
              <input type="radio" name={positionName} value={position}
                checked={value.toggleButtonPosition === position} disabled={locked || !value.enabled}
                onChange={() => { void set('toggleButtonPosition', position) }} />
              <span>{t(position === 'header' ? 'toggleButtonPositionHeader'
                : position === 'sidebar' ? 'toggleButtonPositionSidebar' : 'toggleButtonPositionFloating')}</span>
            </label>)}
          </fieldset>
        </div>
      </div>
    </>}
  </section>
}
