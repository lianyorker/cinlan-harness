/**
 * The Voice settings section: one aligned panel for microphone permission,
 * native-addon status, and the two shipped model rows. Degraded engine state
 * includes a copyable repair command; model rows retain download and status.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCopyOutline16, Switch, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { voiceApi, type VoiceEngineStatus, type VoiceModelRow } from './api.ts'
import { readMicrophonePermission, requestMicrophonePermission, type MicrophonePermissionState } from './microphone.ts'
import type { DictationMode, VoiceSettings } from './voice-settings.ts'
import css from './VoiceSettingsSection.module.css'

/** Injected face: the voice settings store and its updater. */
export interface VoiceSettingsInjected {
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

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`
}

/** The Engine sub-section: native-addon load state, with a copyable repair command when degraded. */
function EngineSection({ t }: { t: VoiceSettingsSectionProps['t'] }): ReactNode {
  const [state, setState] = useState<EngineViewState>({ phase: 'loading' })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let current = true
    void voiceApi.engineStatus().then(
      (status) => { if (current) setState({ phase: 'ready', status }) },
      () => { if (current) setState({ phase: 'error' }) },
    )
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => { setCopied(false) }, 2000)
    return () => { clearTimeout(timer) }
  }, [copied])

  return (
    <section className={css.settingSection} data-voice-subsection="engine">
      <div className={css.settingRow}>
        <div className={css.settingCopy}>
          <h3 className={css.settingTitle}>{t('engineSectionTitle')}</h3>
          <p className={css.settingDescription}>{t('engineDescription')}</p>
        </div>
        <div className={css.settingControl}>
          {state.phase === 'loading' && <span className={css.statusMuted}>{t('engineLoading')}</span>}
          {state.phase === 'error' && <span className={css.statusFailed}>{t('loadFailed')}</span>}
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
        </div>
      </div>
      {state.phase === 'ready' && !state.status.ok && (() => {
        const command = state.status.command
        return (
          <div className={css.engineDegraded}>
            <p className={css.missing}>{t('engineRepairHint')}</p>
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

/** Unified speech-model section: dropdown listing all models with inline download/delete (orca-style). */
function SpeechModelSection({ settings, updateSettings, t }: {
  settings: VoiceSettings
  updateSettings: (patch: Partial<VoiceSettings>) => void
  t: VoiceSettingsSectionProps['t']
}): ReactNode {
  const [state, setState] = useState<ModelsViewState>({ phase: 'loading' })
  const [pendingDownload, setPendingDownload] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)

  const refresh = useCallback((showLoading = false) => {
    const generation = ++refreshGeneration.current
    if (showLoading) setState({ phase: 'loading' })
    void voiceApi.modelsList().then(
      ({ models }) => {
        if (mounted.current && generation === refreshGeneration.current) setState({ phase: 'ready', models })
      },
      () => {
        if (!mounted.current || generation !== refreshGeneration.current) return
        setState(current => current.phase === 'ready' ? current : { phase: 'error' })
      },
    )
  }, [])

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

  const setModelFailure = (modelId: string, error: unknown): void => {
    if (!mounted.current) return
    const message = error instanceof Error ? error.message : String(error)
    setState(current => current.phase !== 'ready' ? current : {
      phase: 'ready',
      models: current.models.map(model => model.definition.id !== modelId ? model : {
        ...model,
        status: { state: 'failed', message },
      }),
    })
  }

  const onDownload = (modelId: string): void => {
    setPendingDownload(modelId)
    setState(current => current.phase !== 'ready' ? current : {
      phase: 'ready',
      models: current.models.map(model => model.definition.id !== modelId ? model : {
        ...model,
        status: { state: 'downloading', receivedBytes: 0, totalBytes: model.definition.approximateBytes },
      }),
    })
    void voiceApi.modelsDownload(modelId).catch((error: unknown) => {
      setModelFailure(modelId, error)
    }).finally(() => {
      if (!mounted.current) return
      setPendingDownload(null)
      refresh()
    })
  }

  const onRemove = (modelId: string): void => {
    if (!window.confirm(t('removeConfirm'))) return
    setPendingRemove(modelId)
    void voiceApi.modelsRemove(modelId).then(
      () => { refresh() },
      (error: unknown) => { setModelFailure(modelId, error) },
    ).finally(() => {
      if (mounted.current) setPendingRemove(null)
    })
  }

  const models = state.phase === 'ready' ? state.models : []
  const selectedModel = models.find(model => model.definition.id === settings.sttModel)
  const selectedIsReady = selectedModel !== undefined && selectedModel.status.state === 'ready'

  return (
    <section className={css.settingSection} data-voice-subsection="speech-model">
      <div className={css.settingRow}>
        <div className={css.settingCopy}>
          <h3 className={css.settingTitle}>{t('selectModel')}</h3>
          <p className={css.settingDescription}>
            {selectedModel && selectedIsReady
              ? selectedModel.definition.name
              : t('selectModelDescription')}
          </p>
        </div>
        <div className={css.settingControl}>
          {state.phase === 'loading' && <span className={css.statusMuted}>{t('loading')}</span>}
          {state.phase === 'error' && <span className={css.statusFailed}>{t('loadFailed')}</span>}
          {state.phase === 'ready' && (
            <div className={css.dropdown}>
              <button
                type="button"
                className={css.dropdownTrigger}
                onClick={() => { setDropdownOpen(open => !open) }}
              >
                {selectedModel && selectedIsReady
                  ? selectedModel.definition.name
                  : t('noModelSelected')}
                <span className={css.dropdownChevron} aria-hidden="true">▾</span>
              </button>
              {dropdownOpen && (
                <>
                  <div className={css.dropdownBackdrop} onClick={() => { setDropdownOpen(false) }} />
                  <div className={css.dropdownMenu}>
                    {models.map((model) => {
                      const isReady = model.status.state === 'ready'
                      const isDownloading = model.status.state === 'downloading' || model.status.state === 'extracting'
                      const isActive = settings.sttModel === model.definition.id
                      return (
                        <div
                          key={model.definition.id}
                          className={css.dropdownItem}
                          data-active={isActive && isReady}
                          data-disabled={isDownloading}
                          onClick={() => {
                            if (isReady) {
                              updateSettings({ sttModel: model.definition.id })
                              setDropdownOpen(false)
                            }
                          }}
                        >
                          <div className={css.dropdownItemBody}>
                            <div className={css.dropdownItemInfo}>
                              <div className={css.dropdownItemTitleRow}>
                                <span className={css.dropdownItemTitle} title={model.definition.name}>{model.definition.name}</span>
                                {model.definition.recommended && (
                                  <span className={css.recommendedTag}>{t('recommended')}</span>
                                )}
                              </div>
                              <div className={css.dropdownItemDesc}>{model.definition.description}</div>
                              <div className={css.dropdownItemMeta}>
                                {formatBytes(model.definition.approximateBytes)}
                                {model.status.state === 'downloading' && ` · ${t('downloading')} ${formatBytes(model.status.receivedBytes)} / ${formatBytes(model.status.totalBytes)}`}
                                {model.status.state === 'extracting' && ` · ${t('installing')} ${formatBytes(model.status.receivedBytes)} / ${formatBytes(model.status.totalBytes)}`}
                                {isReady && ` · ${t('modelReady')}`}
                                {model.status.state === 'failed' && ` · ${t('statusFailed')}: ${model.status.message}`}
                              </div>
                            </div>
                            <div className={css.dropdownItemActions}>
                              {!isReady && !isDownloading && (
                                <button
                                  type="button"
                                  className={css.dropdownItemButton}
                                  disabled={pendingDownload === model.definition.id}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onDownload(model.definition.id)
                                  }}
                                >
                                  {t('modelDownload')}
                                </button>
                              )}
                              {isDownloading && (
                                <button
                                  type="button"
                                  className={css.dropdownItemButton}
                                  disabled={pendingRemove === model.definition.id}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onRemove(model.definition.id)
                                  }}
                                >
                                  {pendingRemove === model.definition.id ? t('removing') : t('modelCancel')}
                                </button>
                              )}
                              {(isReady || model.status.state === 'failed') && (
                                <button
                                  type="button"
                                  className={css.dropdownItemButton}
                                  disabled={pendingRemove === model.definition.id}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onRemove(model.definition.id)
                                  }}
                                >
                                  {pendingRemove === model.definition.id ? t('removing') : t('modelRemove')}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** The enable/disable and dictation-mode sub-section. */
function EnableSection({ settings, updateSettings, t }: {
  settings: VoiceSettings
  updateSettings: (patch: Partial<VoiceSettings>) => void
  t: VoiceSettingsSectionProps['t']
}): ReactNode {
  const onModeChange = (mode: DictationMode): void => {
    updateSettings({ dictationMode: mode })
  }

  return (
    <section className={css.settingSection} data-voice-subsection="enable">
      <div className={css.settingRow}>
        <div className={css.settingCopy}>
          <h3 className={css.settingTitle}>{t('enableDictation')}</h3>
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
      {settings.enabled && (
        <div className={css.settingRow} data-voice-setting="dictation-mode">
          <div className={css.settingCopy}>
            <h3 className={css.settingTitle}>{t('dictationModeTitle')}</h3>
            <p className={css.settingDescription}>{t('dictationModeDescription')}</p>
          </div>
          <div className={css.settingControl}>
            <div className={css.modeGroup} role="radiogroup" aria-label={t('dictationModeTitle')}>
              <button
                type="button"
                role="radio"
                aria-checked={settings.dictationMode === 'toggle'}
                className={css.modeButton}
                data-active={settings.dictationMode === 'toggle'}
                onClick={() => { onModeChange('toggle') }}
              >
                {t('modeToggle')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={settings.dictationMode === 'hold'}
                className={css.modeButton}
                data-active={settings.dictationMode === 'hold'}
                onClick={() => { onModeChange('hold') }}
              >
                {t('modeHold')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/** The microphone device selection sub-section: dropdown of available audio inputs. */
function MicrophoneDeviceSection({ settings, updateSettings, t }: {
  settings: VoiceSettings
  updateSettings: (patch: Partial<VoiceSettings>) => void
  t: VoiceSettingsSectionProps['t']
}): ReactNode {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) return
    const mediaDevices = navigator.mediaDevices
    let current = true
    const enumerate = async (): Promise<void> => {
      try {
        const list = await mediaDevices.enumerateDevices()
        if (!current) return
        setDevices(list.filter(device => device.kind === 'audioinput'))
      } catch {
        if (current) setDevices([])
      }
    }
    void enumerate()
    if (typeof mediaDevices.addEventListener === 'function') {
      mediaDevices.addEventListener('devicechange', enumerate)
    }
    return () => {
      current = false
      if (typeof mediaDevices.removeEventListener === 'function') {
        mediaDevices.removeEventListener('devicechange', enumerate)
      }
    }
  }, [])

  return (
    <section className={css.settingSection} data-voice-subsection="microphone-device">
      <div className={css.settingRow}>
        <div className={css.settingCopy}>
          <h3 className={css.settingTitle}>{t('microphoneDevice')}</h3>
          <p className={css.settingDescription}>{t('microphoneDeviceDescription')}</p>
        </div>
        <div className={css.settingControl}>
          <select
            className={css.modelSelect}
            value={settings.microphoneDeviceId ?? ''}
            onChange={(event) => {
              const value = event.target.value
              updateSettings({ microphoneDeviceId: value === '' ? null : value })
            }}
          >
            <option value="">{t('microphoneDeviceDefault')}</option>
            {devices.length === 0 && <option value="" disabled>{t('microphoneDeviceNone')}</option>}
            {devices.map(device => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Device ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  )
}

/** Render the Voice settings section. */
export function VoiceSettingsSection({ t, useSettings, updateSettings }: VoiceSettingsSectionProps): ReactNode {
  const settings = useSettings(value => value)
  const [mic, setMic] = useState<MicrophonePermissionState>('unknown')

  useEffect(() => {
    let current = true
    void readMicrophonePermission().then((permission) => { if (current) setMic(permission) })
    return () => { current = false }
  }, [])

  const onRequestMic = (): void => {
    void requestMicrophonePermission().then(setMic)
  }

  const disabled = !settings.enabled

  return (
    <div className={css.section}>
      <div className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </div>
      <div className={css.panel} data-voice-settings-panel="true">
        <EnableSection settings={settings} updateSettings={updateSettings} t={t} />
        {disabled && <p className={css.stateRow}>{t('disabledHint')}</p>}
        {!disabled && (
          <>
            <div className={css.settingRow} data-voice-setting="microphone">
              <div className={css.settingCopy}>
                <h3 className={css.settingTitle}>{t('microphoneTitle')}</h3>
                <p className={css.settingDescription}>{t('microphoneDescription')}</p>
              </div>
              <div className={css.settingControl}>
                <span className={css.statusBadge} data-microphone-status={mic}>
                  <span className={css.statusDot} aria-hidden="true" />
                  {t(mic === 'granted' ? 'micGranted' : mic === 'denied' ? 'micDenied' : 'micUnknown')}
                </span>
                <button className={css.actionButton} type="button" onClick={onRequestMic}>
                  {t('micRequest')}
                </button>
              </div>
            </div>
            <MicrophoneDeviceSection settings={settings} updateSettings={updateSettings} t={t} />
            <EngineSection t={t} />
            <SpeechModelSection settings={settings} updateSettings={updateSettings} t={t} />
          </>
        )}
      </div>
    </div>
  )
}
