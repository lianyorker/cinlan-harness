/** Native voice settings for browser preferences, microphone access, and host model resources. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCopyOutline16, Modal, Switch, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoiceApi, VoiceEngineStatus, VoiceModelRow } from './api.ts'
import { readMicrophonePermission, requestMicrophonePermission, type MicrophonePermissionState } from './microphone.ts'
import type { DictationMode, VoiceSettings } from './voice-settings.ts'
import css from './VoiceSettingsSection.module.css'
import { VoiceTestSection } from './VoiceTestSection.tsx'

/** Browser preferences and plain host-operation callbacks provided by the plugin lifetime. */
export interface VoiceSettingsInjected extends Pick<VoiceApi, 'engineStatus' | 'modelsList' | 'modelsDownload' | 'modelsRemove' | 'modelsReinstall' | 'modelsUpdate' | 'modelsCancel' | 'transcribe'> {
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
function EngineSection({ t, state, refresh }: {
  t: VoiceSettingsSectionProps['t']
  state: EngineViewState
  refresh: () => void
}): ReactNode {
  const [copied, setCopied] = useState(false)

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
          <button type="button" className={css.actionButton} disabled={state.phase === 'loading'} onClick={refresh}>
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
function SpeechModelSection({
  settings, updateSettings, t, modelsList, modelsDownload, modelsRemove,
  modelsReinstall, modelsUpdate, modelsCancel, transcribe, engineReady,
}: {
  settings: VoiceSettings
  engineReady: boolean
} & Pick<VoiceSettingsSectionProps, 'updateSettings' | 't' | 'modelsList' | 'modelsDownload' | 'modelsRemove' | 'modelsReinstall' | 'modelsUpdate' | 'modelsCancel' | 'transcribe'>): ReactNode {
  const [state, setState] = useState<ModelsViewState>({ phase: 'loading' })
  const [pending, setPending] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<VoiceModelRow | null>(null)
  const [failedModel, setFailedModel] = useState<string | null>(null)
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)

  const refresh = useCallback((showLoading = false) => {
    const generation = ++refreshGeneration.current
    if (showLoading) setState({ phase: 'loading' })
    return modelsList().then(
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
    void refresh(true)
    return () => { mounted.current = false; refreshGeneration.current += 1 }
  }, [refresh])

  const taskRunning = state.phase === 'ready' && state.models.some(model => model.task?.state === 'running')
  useEffect(() => {
    if (!taskRunning && pending === null) return
    let current = true
    let timer: ReturnType<typeof setTimeout>
    const poll = (): void => {
      void refresh().finally(() => {
        if (current) timer = setTimeout(poll, 1000)
      })
    }
    timer = setTimeout(poll, 1000)
    return () => { current = false; clearTimeout(timer) }
  }, [taskRunning, pending, refresh])

  const perform = (modelId: string, operation: () => Promise<unknown>): void => {
    setFailedModel(null)
    setPending(modelId)
    void operation().catch(() => {
      if (mounted.current) setFailedModel(modelId)
    }).finally(() => {
      if (!mounted.current) return
      setPending(null)
      void refresh()
    })
  }

  const models = state.phase === 'ready' ? state.models : []
  const selectedMissing = settings.sttModel !== null && !models.some(model => model.definition.id === settings.sttModel)
  const readyModel = models.find(model => model.definition.id === settings.sttModel && model.status.state === 'ready')
    ?? models.find(model => model.status.state === 'ready')

  return (
    <section className={css.settingSection} data-voice-subsection="speech-model" data-settings-anchor="voice-model">
      <div className={css.settingRow}>
        <div className={css.settingCopy}>
          <h2 className={css.settingTitle}><label htmlFor="voice-model">{t('selectModel')}</label></h2>
          <p className={css.settingDescription} id="voice-model-description">{t('selectModelDescription')}</p>
        </div>
        <div className={css.settingControl}>
          <select id="voice-model" className={css.modelSelect} value={settings.sttModel ?? ''}
            disabled={!settings.enabled || state.phase !== 'ready'} aria-describedby="voice-model-description"
            onChange={(event) => { updateSettings({ sttModel: event.target.value || null }) }}>
            <option value="">{t('automaticModel')}</option>
            {selectedMissing && <option value={settings.sttModel} disabled>{t('selectedModelUnavailable')}</option>}
            {models.map(model => <option key={model.definition.id} value={model.definition.id} disabled={model.status.state !== 'ready'}>{model.definition.name}</option>)}
          </select>
          <button type="button" className={css.actionButton} onClick={() => { void refresh() }}>{t('checkVersions')}</button>
        </div>
      </div>
      {state.phase === 'loading' && <p className={css.stateRow} role="status">{t('loading')}</p>}
      {state.phase === 'error' && <div className={css.resourceNotice}>
        <span className={css.statusFailed} role="alert">{t('loadFailed')}</span>
        <button type="button" className={css.actionButton} onClick={() => { void refresh(true) }}>{t('retry')}</button>
      </div>}
      {state.phase === 'ready' && models.length === 0 && <p className={css.stateRow}>{t('noModelReady')}</p>}
      {models.length > 0 && <ul className={css.modelList} aria-label={t('modelsSectionTitle')}>
        {models.map((model) => {
          const task = model.task
          const running = task?.state === 'running'
          const ready = model.status.state === 'ready'
          const hasInstallation = model.resource.installedVersion !== null || model.resource.integrity !== 'missing'
          const blocked = !settings.enabled || pending !== null || running
          const progress = task?.state === 'running' ? task.progress : undefined
          return <li key={model.definition.id} className={css.modelRow}>
            <div className={css.modelInfo}>
              <div className={css.modelTitle}>{model.definition.name}
                {model.definition.recommended && <span className={css.recommendedTag}>{t('recommended')}</span>}
              </div>
              <p className={css.settingDescription}>{model.definition.description}</p>
              <p className={css.modelMeta} role="status">
                {formatBytes(model.definition.approximateBytes, t)}{' · '}
                {ready ? t('modelReady') : model.status.state === 'failed' ? t('statusFailed') : t('modelNotDownloaded')}
                {progress !== undefined && ' · ' + t(progress.state === 'downloading' ? 'downloading' : 'installing') + ' ' + formatBytes(progress.receivedBytes, t) + ' / ' + formatBytes(progress.totalBytes, t)}
                {running && ' · ' + t(task.operation === 'download' ? 'taskDownload' : task.operation === 'reinstall' ? 'taskReinstall' : 'taskUpdate')}
                {task?.state === 'cancelled' && ' · ' + t('taskCancelled')}
                {task?.state === 'failed' && ' · ' + t('operationFailed')}
              </p>
              <p className={css.modelMeta}>{t('installedVersion')}: {model.resource.installedVersion ?? t('notInstalled')}</p>
              <p className={css.modelMeta}>{t('availableVersion')}: {model.resource.availableVersion}</p>
              <p className={css.modelMeta}>{t('versionDescription')}</p>
              <p className={css.modelMeta}>{t('source')}: {model.resource.source.join(', ')}</p>
              <p className={css.modelMeta}>{t(model.resource.integrity === 'verified' ? 'integrityVerified' : model.resource.integrity === 'unverified' ? 'integrityUnverified' : model.resource.integrity === 'corrupt' ? 'integrityCorrupt' : 'integrityMissing')}</p>
              {failedModel === model.definition.id && <p className={css.statusFailed} role="alert">{t('operationFailed')}</p>}
            </div>
            <div className={css.modelActions}>
              {!ready && !hasInstallation && <button type="button" className={css.actionButton} disabled={blocked} onClick={() => { perform(model.definition.id, () => modelsDownload(model.definition.id)) }}>{t('modelDownload')}</button>}
              {hasInstallation && <button type="button" className={css.actionButton} disabled={blocked} onClick={() => { perform(model.definition.id, () => modelsReinstall(model.definition.id)) }}>{t('modelReinstall')}</button>}
              {model.resource.installedVersion !== null && <button type="button" className={css.actionButton} disabled={blocked || !model.resource.updateAvailable} onClick={() => { perform(model.definition.id, () => modelsUpdate(model.definition.id)) }}>{t('modelUpdate')}</button>}
              {running && <button type="button" className={css.actionButton} disabled={!settings.enabled || pending !== null} onClick={() => { perform(model.definition.id, () => modelsCancel(model.definition.id, task.taskId)) }}>{t('modelCancel')}</button>}
              {(ready || hasInstallation || model.status.state === 'failed') && <button type="button" className={css.actionButton} disabled={blocked} onClick={() => { setRemoveTarget(model) }}>{t('modelRemove')}</button>}
            </div>
          </li>
        })}
      </ul>}
      <Modal open={removeTarget !== null} title={t('removeTitle')} closeLabel={t('closeDialog')} onClose={() => { setRemoveTarget(null) }}
        description={t('removeConfirm')} footer={<>
          <button type="button" className={css.actionButton} onClick={() => { setRemoveTarget(null) }}>{t('modelCancel')}</button>
          <button type="button" className={css.actionButton} onClick={() => {
            if (removeTarget === null) return
            const modelId = removeTarget.definition.id
            setRemoveTarget(null)
            perform(modelId, () => modelsRemove(modelId))
          }}>{t('confirmRemove')}</button>
        </>} />
      <VoiceTestSection settings={settings} t={t} transcribe={transcribe}
        modelId={engineReady ? readyModel?.definition.id ?? null : null} />
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
  modelsReinstall, modelsUpdate, modelsCancel, transcribe,
}: VoiceSettingsSectionProps): ReactNode {
  const settings = useSettings(value => value)
  const [engine, setEngine] = useState<EngineViewState>({ phase: 'loading' })
  const [engineRevision, setEngineRevision] = useState(0)
  useEffect(() => {
    let current = true
    setEngine({ phase: 'loading' })
    void engineStatus().then(
      (status) => { if (current) setEngine({ phase: 'ready', status }) },
      () => { if (current) setEngine({ phase: 'error' }) },
    )
    return () => { current = false }
  }, [engineStatus, engineRevision])
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
        <EngineSection t={t} state={engine} refresh={() => { setEngineRevision(value => value + 1) }} />
        <SpeechModelSection settings={settings} updateSettings={updateSettings} t={t}
          modelsList={modelsList} modelsDownload={modelsDownload} modelsRemove={modelsRemove} transcribe={transcribe}
          modelsReinstall={modelsReinstall} modelsUpdate={modelsUpdate} modelsCancel={modelsCancel}
          engineReady={engine.phase === 'ready' && engine.status.ok}
        />
      </div>
    </div>
  )
}
