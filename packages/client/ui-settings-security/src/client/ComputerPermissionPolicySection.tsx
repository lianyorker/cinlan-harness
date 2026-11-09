/** Settings page for live Computer Use permission decisions. */
import { useEffect, useState, type ReactNode } from 'react'
import type { ComputerPermissionStatus } from '@deepseek-ai/dsh-computer-use/types'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CapabilityDefinition, CapabilitySlotProps } from './CapabilitySection.tsx'
import type { CapabilitySettingsKey } from './locales.ts'
import css from './CapabilitySection.module.css'

/** Computer Use decisions resolved by the Host policy plugin. */
export interface ComputerUsePermissionSettings {
  readonly native: PermissionDecision
  readonly observe: PermissionDecision
  readonly pointer: PermissionDecision
  readonly keyboard: PermissionDecision
  readonly accessibilityAction: PermissionDecision
}

type PermissionDecision = 'allow' | 'ask' | 'deny'
type PermissionField = keyof ComputerUsePermissionSettings

/** Scope and page metadata supplied by the registration fiber. */
export interface ComputerPermissionPolicyInjected {
  readonly definition: CapabilityDefinition
  readonly hooks: { readonly permissionSettings: SettingsScope<ComputerUsePermissionSettings> }
  readonly permissionSettings: SettingsScope<ComputerUsePermissionSettings>
  readonly osPermissions: {
    readonly read: (signal: AbortSignal) => Promise<ComputerPermissionStatus>
    readonly request: (signal: AbortSignal) => Promise<ComputerPermissionStatus>
    readonly openScreenRecordingSettings: (signal: AbortSignal) => Promise<boolean>
  }
}

/** Props for the Computer Use permission section. */
export type ComputerPermissionPolicySectionProps = CapabilitySlotProps<ComputerPermissionPolicyInjected>

const PERMISSIONS = [
  ['native', 'computerPermissionNative'],
  ['observe', 'computerPermissionObserve'],
  ['pointer', 'computerPermissionPointer'],
  ['keyboard', 'computerPermissionKeyboard'],
  ['accessibilityAction', 'computerPermissionAccessibility'],
] as const satisfies readonly (readonly [PermissionField, CapabilitySettingsKey])[]

const DECISIONS = ['allow', 'ask', 'deny'] as const

/** Render live policy controls; each choice is serialized by its settings scope. */
export function ComputerPermissionPolicySection(props: ComputerPermissionPolicySectionProps): ReactNode {
  const { definition, permissionSettings, osPermissions, t, usePermissionSettings } = props
  const snapshot = usePermissionSettings(value => value)
  const [failedField, setFailedField] = useState<PermissionField>()
  const [savingField, setSavingField] = useState<PermissionField>()
  const [osStatus, setOsStatus] = useState<{ readonly kind: 'loading' | 'failed' } | { readonly kind: 'ready'; readonly value: ComputerPermissionStatus }>({ kind: 'loading' })
  const [osBusy, setOsBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const busy = snapshot.status === 'loading'
  const value = snapshot.value
  useEffect(() => {
    const controller = new AbortController()
    const read = async (): Promise<void> => {
      setOsStatus({ kind: 'loading' })
      try {
        setOsStatus({ kind: 'ready', value: await osPermissions.read(controller.signal) })
      } catch (_permissionStatusUnavailable) {
        if (!controller.signal.aborted) setOsStatus({ kind: 'failed' })
      }
    }
    const onFocus = (): void => { setRefresh(current => current + 1) }
    void read()
    window.addEventListener('focus', onFocus)
    return () => { controller.abort(); window.removeEventListener('focus', onFocus) }
  }, [osPermissions, refresh])
  const requestOsPermissions = async (): Promise<void> => {
    const controller = new AbortController()
    setOsBusy(true)
    try {
      setOsStatus({ kind: 'ready', value: await osPermissions.request(controller.signal) })
    } catch (_permissionRequestRejected) {
      setOsStatus({ kind: 'failed' })
    } finally {
      setOsBusy(false)
    }
  }
  const openScreenRecordingSettings = async (): Promise<void> => {
    const controller = new AbortController()
    setOsBusy(true)
    try {
      const opened = await osPermissions.openScreenRecordingSettings(controller.signal)
      if (!opened) setOsStatus({ kind: 'failed' })
    } catch (_settingsOpenRejected) {
      setOsStatus({ kind: 'failed' })
    } finally {
      setOsBusy(false)
    }
  }
  const change = async (field: PermissionField, decision: PermissionDecision): Promise<void> => {
    if (!writable || savingField !== undefined) return
    setSavingField(field)
    setFailedField(undefined)
    try {
      await permissionSettings.set(field, decision)
    } catch (_permissionWriteRejected) {
      setFailedField(field)
    } finally {
      setSavingField(undefined)
    }
  }
  return <section className={css.section} data-capability={definition.id} aria-busy={busy || savingField !== undefined}>
    <div className={css.setupCard}>
      <section>
        <h2>{t('computerPolicyTitle')}</h2>
        <p>{t('computerPolicyDescription')}</p>
        {snapshot.status !== 'ready' && <p role="status">{t(busy ? 'preferencesLoading' : 'preferencesUnavailable')}</p>}
        <div className={css.settingList}>
          {PERMISSIONS.map(([field, label]) => <label className={css.settingLine} key={field} data-settings-anchor={`computer-permission-${field === 'accessibilityAction' ? 'accessibility' : field}`}>
            <span>{t(label)}<small>{t(`${label}Help`)}</small></span>
            <select aria-label={t(label)} disabled={!writable || savingField !== undefined}
              value={value?.[field] ?? 'ask'} onChange={(event) => { void change(field, event.currentTarget.value as PermissionDecision) }}>
              {DECISIONS.map(decision => <option key={decision} value={decision}>{t(`computerPermission${decision.charAt(0).toUpperCase()}${decision.slice(1)}` as CapabilitySettingsKey)}</option>)}
            </select>
          </label>)}
        </div>
        {failedField !== undefined && <p className={css.failure} role="alert">{t('computerPermissionSaveFailed')}</p>}
        {!snapshot.writable && snapshot.status === 'ready' && <p role="status">{t('preferencesReadOnly')}</p>}
      </section>
      <section>
        <h2>{t('computerOsPermissionsTitle')}</h2>
        <p>{t('computerOsPermissionsDescription')}</p>
        {osStatus.kind === 'loading' && <p role="status">{t('computerOsPermissionLoading')}</p>}
        {osStatus.kind === 'failed' && <p className={css.failure} role="alert">{t('computerOsPermissionFailed')}</p>}
        {osStatus.kind === 'ready' && osStatus.value.kind === 'unsupported' && <p role="status">{t('computerOsPermissionUnsupported')}</p>}
        {osStatus.kind === 'ready' && osStatus.value.kind === 'macos' && <>
          <dl className={css.securitySummary}>
            <div><strong>{t('computerOsAccessibility')}</strong><span>{t(osStatus.value.accessibility ? 'computerOsPermissionGranted' : 'computerOsPermissionMissing')}</span></div>
            <div><strong>{t('computerOsScreenRecording')}</strong><span>{t(osStatus.value.screenRecording ? 'computerOsPermissionGranted' : 'computerOsPermissionMissing')}</span></div>
          </dl>
          <div className={css.browserActions}>
            <button className={css.recheckButton} type="button" disabled={osBusy} onClick={() => { setRefresh(current => current + 1) }}>{t('computerOsPermissionRefresh')}</button>
            <button className={css.recheckButton} type="button" disabled={osBusy} onClick={() => { void requestOsPermissions() }}>{t('computerOsPermissionRequest')}</button>
            {!osStatus.value.screenRecording && <button className={css.recheckButton} type="button" disabled={osBusy} onClick={() => { void openScreenRecordingSettings() }}>{t('computerOsScreenRecordingSettings')}</button>}
          </div>
        </>}
        {osStatus.kind === 'ready' && osStatus.value.kind === 'unsupported' && <button className={css.recheckButton} type="button" disabled={osBusy} onClick={() => { setRefresh(current => current + 1) }}>{t('computerOsPermissionRefresh')}</button>}
      </section>
    </div>
  </section>
}
