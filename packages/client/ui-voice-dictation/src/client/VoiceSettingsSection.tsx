/** Native voice settings for browser preferences, microphone access, and host model resources. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCopyOutline16, Switch, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoiceApi, VoiceEngineStatus, VoiceModelRow } from './api.ts'
import { readMicrophonePermission, requestMicrophonePermission, type MicrophonePermissionState } from './microphone.ts'
import type { DictationMode, VoiceSettings } from './voice-settings.ts'
import css from './VoiceSettingsSection.module.css'

/** Browser preferences and plain host-operation callbacks provided by the plugin lifetime. */
export interface VoiceSettingsInjected extends Pick<VoiceApi, 'engineStatus' | 'modelsList' | 'modelsDownload' | 'modelsRemove'> {
  hooks: { settings: SnapshotStore<VoiceSettings> }
  updateSettings: (patch: Partial<VoiceSettings>) => void
}

/** Full component props. */
export type VoiceSettingsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.voice'> & InjectFace<VoiceSettingsInjected>

type EngineViewState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'error' }
  | { readonly phase: 'ready'; readonly status: VoiceEngineStatus }

type ModelsViewState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'error' }
  | { readonly phase: 'ready'; readonly models: readonly VoiceModelRow[] }

function formatBytes(bytes: number, t: VoiceSettingsSectionProps['t']): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? t('gigabytes', { value: (mb / 1024).toFixed(1) }) : t('megabytes', { value: mb.toFixed(0) })
}

/** The Engine sub-section: native-addon load state, with a copyable repair command when degraded. */
function EngineSection({ t, engineStatus }: Pick<VoiceSettingsSectionProps, 't' | 'engineStatus'>): ReactNode {
  const [state, setState] = useState<EngineViewState>({ phase: 'loading' })
  const [copied, setCopied] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let current = true
    setState({ phase: 'loading' })
    void engineStatus().then(
      (status) => { if (current) setState({ phase: 'ready', status }) },
      () => { if (current) setState({ phase: 'error' }) },
    )
    return () => { current = false }
  }, [engineStatus, revision])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => { setCopied(false) }, 2000)
    return () => { clearTimeout(timer) }
  }, [copied])

  return (
    <section className={css.settingSection} data-voice-subsection="engine" data-settings-anchor="voice-engine">
      <div className={css.settingRow}>
        <div className={css.settingCopy}>
          <h2 className={css.settingTitle}>{t('engineSectionTitle')}</h2>
          <p className={css.settingDescription}>{t('engineDescription')}</p>
        </div>
        <div className={css.settingControl}>
          {state.phase === 'loading' && <span className={css.statusMuted}>{t('engineLoading')}</span>}
          {state.phase === 'error' && <span className={css.statusFailed} role="alert">{t('engineLoadFailed')}</span>}
          {state.phase === 'ready' && state.status.ok && (
            <span className={css.statusBadge} data-engine-status="ok">
              <span className={css.statusDot} aria-hidden="true" />
              {t('engineOk')}
            </span>
          )}
          {state.phase === 'ready' && !state.status.ok && (
            <span className={css.statusBadge} data-engine-status="degraded">
              <span className={css.statusDot} aria-hidden="true" />
              {t('engineDegraded')}
            </span>
          )}
          <button type="button" className={css.actionButton} disabled={state.phase === 'loading'} onClick={() => { setRevision(value => value + 1) }}>
            {t('refreshStatus')}
          </button>
        </div>
      </div>
      {state.phase === 'ready' && !state.status.ok && (() => {
        const command = state.status.command
        return (
          <div className={css.engineDegraded}>
            <p>{t('engineRepairHint')}</p>
            <div className={css.installCommandRow}>
              <code className={css.installCommand}>{command}</code>
              <button
                className={css.copyButton}
                type="button"
                onClick={() => { void writeClipboard(command).then((ok) => { if (ok) setCopied(true) }) }}
              >
                <IconCopyOutline16 size={14} />
                <span>{copied ? t('copyCommandCopied') : t('copyCommand')}</span>
              </button>
            </div>
          </div>
        )
      })()}
    </section>
  )
}

/** Host model resources and the browser-local preferred model. */
function SpeechModelSection({ settings, updateSettings, t, modelsList, modelsDownload, modelsRemove }: {
  settings: VoiceSettings
} & Pick<VoiceSettingsSectionProps, 'updateSettings' | 't' | 'modelsList' | 'modelsDownload' | 'modelsRemove'>): ReactNode {
  const [state, setState] = useState<ModelsViewState>({ phase: 'loading' })
  const [pendingDownload, setPendingDownload] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)

  const refresh = useCallback((showLoading = false) => {
    const generation = ++refreshGeneration.current
    if (showLoading) setState({ phase: 'loading' })
    void modelsList().then(
      ({ models }) => {
        if (mounted.current && generation === refreshGeneration.current) setState({ phase: 'ready', models })
      },
      () => {
        if (!mounted.current || generation !== refreshGeneration.current) return
        setState(current => current.phase === 'ready' ? current : { phase: 'error' })
      },
    )
  }, [modelsList])

  useEffect(() => {
    mounted.current = true
    refresh(true)
    return () => {
      mounted.current = false
      refreshGeneration.current += 1
    }
  }, [refresh])

  useEffect(() => {
    const active = pendingDownload !== null || (state.phase === 'ready' && state.models.some(model =>
      model.status.state === 'downloading' || model.status.state === 'extracting'))
    if (!active) return
    const timer = setInterval(() => { refresh() }, 1000)
    return () => { clearInterval(timer) }
  }, [state, pendingDownload, refresh])

  const setModelFailure = (modelId: string, error: unknown): (void) => {
    if (!mounted.current) return
    const message = error instanceof Error ? error.message : String(error)
    setErrors(current => ({ ...current, [modelId]: message }))
  }

  const clearModelFailure = (modelId: string): (void) => {
    setErrors(current => ({ ...current, [modelId]: undefined }))
  }

  const onDownload = (modelId: string): (void) => {
    clearModelFailure(modelId)
    setPendingDownload(modelId)
    void modelsDownload(modelId).catch((error: unknown) => {
      setModelFailure(modelId, error)
    }).finally(() => {
      if (!mounted.current) return
      setPendingDownload(null)
      refresh()
    })
  }

  const onRemove = (modelId: string): (void) => {
    if (!window.confirm(t('removeConfirm'))) return
    clearModelFailure(modelId)
    setPendingRemove(modelId)
    void modelsRemove(modelId).then(
      () => { if (mounted.current) refresh() },
      (error: unknown) => { setModelFailure(modelId, error) },
    ).finally(() => {
      if (mounted.current) setPendingRemove(null)
    })
  }

  const models = state.phase === 'ready' ? state.models : []
  const selectedMissing = settings.sttModel !== null && !models.some(model => model.definition.id === settings.sttModel)

  return (
    <section className={css.settingSection} data-voice-subsection="speech-model" data-settings-anchor="voice-model">
      <div className={css.settingRow}>
        <div className={css.settingCopy}>
          <h2 className={css.settingTitle}><label htmlFor="voice-model">{t('selectModel')}</label></h2>
          <p className={css.settingDescription} id="voice-model-description">{t('selectModelDescription')}</p>
        </div>
        <div className={css.settingControl}>
          <select
            id="voice-model"
            className={css.modelSelect}
            value={settings.sttModel ?? ''}
            disabled={!settings.enabled || state.phase !== 'ready'}
            aria-describedby="voice-model-description"
            onChange={(event) => { updateSettings({ sttModel: event.target.value || null }) }}
          >
            <option value="">{t('automaticModel')}</option>
            {selectedMissing && <option value={settings.sttModel} disabled>{t('selectedModelUnavailable')}</option>}
            {models.map(model => (
              <option key={model.definition.id} value={model.definition.id} disabled={model.status.state !== 'ready'}>
                {model.definition.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {state.phase === 'loading' && <p className={css.stateRow} role="status">{t('loading')}</p>}
      {state.phase === 'error' && (
        <div className={css.resourceNotice}>
          <span className={css.statusFailed} role="alert">{t('loadFailed')}</span>
          <button type="button" className={css.actionButton} onClick={() => { refresh(true) }}>{t('retry')}</button>
        </div>
      )}
      {state.phase === 'ready' && models.length === 0 && <p className={css.stateRow}>{t('noModelReady')}</p>}
      {models.length > 0 && (
        <ul className={css.modelList} aria-label={t('modelsSectionTitle')}>
          {models.map((model) => {
            const isReady = model.status.state === 'ready'
            const isDownloading = model.status.state === 'downloading' || model.status.state === 'extracting'
            return (
              <li key={model.definition.id} className={css.modelRow}>
                <div className={css.modelInfo}>
                  <div className={css.modelTitle}>
                    {model.definition.name}
                    {model.definition.recommended && <span className={css.recommendedTag}>{t('recommended')}</span>}
                  </div>
                  <p className={css.settingDescription}>{model.definition.description}</p>
                  <p className={css.modelMeta} role="status">
                    {formatBytes(model.definition.approximateBytes, t)}
                    {model.status.state === 'downloading' && ' · ' + t('downloading') + ' ' + formatBytes(model.status.receivedBytes, t) + ' / ' + formatBytes(model.status.totalBytes, t)}
                    {model.status.state === 'extracting' && ' · ' + t('installing') + ' ' + formatBytes(model.status.receivedBytes, t) + ' / ' + formatBytes(model.status.totalBytes, t)}
                    {isReady && ' · ' + t('modelReady')}
                    {model.status.state === 'not-downloaded' && ' · ' + t('modelNotDownloaded')}
                    {model.status.state === 'failed' && ' · ' + t('statusFailed') + ': ' + model.status.message}
                  </p>
                  {errors[model.definition.id] !== undefined && <p className={css.statusFailed} role="alert">{errors[model.definition.id]}</p>}
                </div>
                <div className={css.modelActions}>
                  {!isReady && !isDownloading && (
                    <button type="button" className={css.actionButton}
                      disabled={!settings.enabled || pendingDownload !== null || pendingRemove === model.definition.id}
                      onClick={() => { onDownload(model.definition.id) }}
                    >
                      {pendingDownload === model.definition.id ? t('downloading') : t('modelDownload')}
                    </button>
                  )}
                  {(isDownloading || isReady || model.status.state === 'failed') && (
                    <button type="button" className={css.actionButton}
                      disabled={!settings.enabled || pendingRemove !== null}
                      onClick={() => { onRemove(model.definition.id) }}
                    >
                      {pendingRemove === model.definition.id ? t('removing') : isDownloading ? t('modelCancel') : t('modelRemove')}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** The enable/disable and dictation-mode sub-section. */
function EnableSection({ settings, updateSettings, t }: {
  settings: VoiceSettings
  updateSettings: (patch: Partial<VoiceSettings>) => void
  t: VoiceSettingsSectionProps['t']
}): ReactNode {
  const onModeChange = (mode: DictationMode): (void) => {
    updateSettings({ dictationMode: mode })
  }

  return (
    <section className={css.settingSection} data-voice-subsection="enable">
      <div className={css.settingRow} data-settings-anchor="voice-enabled">
        <div className={css.settingCopy}>
          <h2 className={css.settingTitle}>{t('enableDictation')}</h2>
          <p className={css.settingDescription}>{t('enableDictationDescription')}</p>
        </div>
        <div className={css.settingControl}>
          <Switch
            checked={settings.enabled}
            onChange={(next) => { updateSettings({ enabled: next }) }}
            label={t('enableDictation')}
          />
        </div>
      </div>
      <div className={css.settingRow} data-voice-setting="dictation-mode" data-settings-anchor="voice-mode">
        <div className={css.settingCopy}>
          <h2 className={css.settingTitle}>{t('dictationModeTitle')}</h2>
          <p className={css.settingDescription}>{t('dictationModeDescription')}</p>
        </div>
        <div className={css.settingControl}>
          <div className={css.modeGroup} role="radiogroup" aria-label={t('dictationModeTitle')}>
            <label className={css.modeOption}>
              <input className={css.modeInput} type="radio" name="voice-dictation-mode" value="toggle"
                checked={settings.dictationMode === 'toggle'} disabled={!settings.enabled}
                onChange={() => { onModeChange('toggle') }}
              />
              <span className={css.modeButton}>{t('modeToggle')}</span>
            </label>
            <label className={css.modeOption}>
              <input className={css.modeInput} type="radio" name="voice-dictation-mode" value="hold"
                checked={settings.dictationMode === 'hold'} disabled={!settings.enabled}
                onChange={() => { onModeChange('hold') }}
              />
              <span className={css.modeButton}>{t('modeHold')}</span>
            </label>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Audio-input enumeration refreshes after permission and device changes. */
function MicrophoneDeviceSection({ settings, updateSettings, permissionRevision, t }: {
  settings: VoiceSettings
  updateSettings: (patch: Partial<VoiceSettings>) => void
  permissionRevision: number
  t: VoiceSettingsSectionProps['t']
}): ReactNode {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [revision, setRevision] = useState(0)
  const supported = typeof (navigator as { mediaDevices?: MediaDevices }).mediaDevices?.enumerateDevices === 'function'

  useEffect(() => {
    if (!supported) return
    const mediaDevices = navigator.mediaDevices
    let current = true
    let generation = 0
    const enumerate = async (): Promise<void> => {
      const requested = ++generation
      try {
        const list = await mediaDevices.enumerateDevices()
        if (!current || requested !== generation) return
        setDevices(list.filter(device => device.kind === 'audioinput' && device.deviceId !== ''))
        setFailed(false)
        setLoaded(true)
      } catch {
        if (!current || requested !== generation) return
        setFailed(true)
        setLoaded(true)
      }
    }
    void enumerate()
    const onDeviceChange = (): void => { void enumerate() }
    if (typeof mediaDevices.addEventListener === 'function') mediaDevices.addEventListener('devicechange', onDeviceChange)
    return () => {
      current = false
      if (typeof mediaDevices.removeEventListener === 'function') mediaDevices.removeEventListener('devicechange', onDeviceChange)
    }
  }, [supported, permissionRevision, revision])

  const unavailable = settings.microphoneDeviceId !== null && !devices.some(device => device.deviceId === settings.microphoneDeviceId)

  return (
    <section className={css.settingSection} data-voice-subsection="microphone-device" data-settings-anchor="voice-device">
      <div className={css.settingRow}>
        <div className={css.settingCopy}>
          <h2 className={css.settingTitle}><label htmlFor="voice-device">{t('microphoneDevice')}</label></h2>
          <p className={css.settingDescription} id="voice-device-description">{t('microphoneDeviceDescription')}</p>
          {failed && <p className={css.statusFailed} role="alert">{t('microphoneDeviceFailed')}</p>}
          {supported && loaded && !failed && devices.length === 0 && <p className={css.settingDescription}>{t('microphoneDeviceNone')}</p>}
        </div>
        <div className={css.settingControl}>
          <select
            id="voice-device"
            className={css.modelSelect}
            value={settings.microphoneDeviceId ?? ''}
            disabled={!settings.enabled || !supported}
            aria-describedby="voice-device-description"
            onChange={(event) => { updateSettings({ microphoneDeviceId: event.target.value || null }) }}
          >
            <option value="">{t('microphoneDeviceDefault')}</option>
            {unavailable && <option value={settings.microphoneDeviceId} disabled>{t('microphoneDeviceUnavailable')}</option>}
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || t('microphoneDeviceUnnamed', { id: index + 1 })}
              </option>
            ))}
          </select>
          {failed && <button type="button" className={css.actionButton} onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</button>}
        </div>
      </div>
    </section>
  )
}

/**
 * Render stable field targets without enabling dictation during search navigation.
 * @param props - localized copy, browser preferences, their updater, and injected host operations.
 * @returns voice preferences, microphone access, and host resource controls.
 */
export function VoiceSettingsSection({
  t, useSettings, updateSettings, engineStatus, modelsList, modelsDownload, modelsRemove,
}: VoiceSettingsSectionProps): ReactNode {
  const settings = useSettings(value => value)
  const [mic, setMic] = useState<MicrophonePermissionState>('unknown')
  const [requestingMic, setRequestingMic] = useState(false)
  const [permissionRevision, setPermissionRevision] = useState(0)
  const mounted = useRef(false)
  const permissionGeneration = useRef(0)
  const microphoneAvailable = typeof (navigator as { mediaDevices?: MediaDevices }).mediaDevices?.getUserMedia === 'function'

  useEffect(() => {
    mounted.current = true
    const generation = ++permissionGeneration.current
    void readMicrophonePermission().then((permission) => {
      if (mounted.current && generation === permissionGeneration.current) setMic(permission)
    })
    return () => { mounted.current = false }
  }, [])

  const onRequestMic = (): (void) => {
    permissionGeneration.current += 1
    setRequestingMic(true)
    void requestMicrophonePermission().then((permission) => {
      if (!mounted.current) return
      setMic(permission)
      setRequestingMic(false)
      setPermissionRevision(value => value + 1)
    })
  }

  return (
    <div className={css.section}>
      <div className={css.heading}>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
      </div>
      <div className={css.panel} data-voice-settings-panel="true">
        <EnableSection settings={settings} updateSettings={updateSettings} t={t} />
        {!settings.enabled && <p className={css.stateRow}>{t('disabledHint')}</p>}
        <div className={css.settingRow} data-voice-setting="microphone" data-settings-anchor="voice-permission">
          <div className={css.settingCopy}>
            <h2 className={css.settingTitle}>{t('microphoneTitle')}</h2>
            <p className={css.settingDescription}>{t('microphoneDescription')}</p>
            {!microphoneAvailable && <p className={css.settingDescription}>{t('microphoneUnavailable')}</p>}
          </div>
          <div className={css.settingControl}>
            <span className={css.statusBadge} data-microphone-status={mic} role="status">
              <span className={css.statusDot} aria-hidden="true" />
              {t(mic === 'granted' ? 'micGranted' : mic === 'denied' ? 'micDenied' : 'micUnknown')}
            </span>
            <button className={css.actionButton} type="button" onClick={onRequestMic}
              disabled={!settings.enabled || !microphoneAvailable || requestingMic}
            >
              {requestingMic ? t('micRequesting') : t('micRequest')}
            </button>
          </div>
        </div>
        <MicrophoneDeviceSection settings={settings} updateSettings={updateSettings} permissionRevision={permissionRevision} t={t} />
        <EngineSection t={t} engineStatus={engineStatus} />
        <SpeechModelSection settings={settings} updateSettings={updateSettings} t={t}
          modelsList={modelsList} modelsDownload={modelsDownload} modelsRemove={modelsRemove}
        />
      </div>
    </div>
  )
}
