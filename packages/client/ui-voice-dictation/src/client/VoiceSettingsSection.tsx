/**
 * The Voice settings section: one aligned panel for microphone permission,
 * native-addon status, and the two shipped model rows. Degraded engine state
 * includes a copyable repair command; model rows retain download and status.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCopyOutline16, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { voiceApi, type VoiceEngineStatus, type VoiceModelRow } from './api.ts'
import { readMicrophonePermission, requestMicrophonePermission, type MicrophonePermissionState } from './microphone.ts'
import css from './VoiceSettingsSection.module.css'

/** Injected face: nothing today (the component talks to /voice/api directly, like the Cinlan capability pages talk to pluginInventory). */
export interface VoiceSettingsInjected {}

/** Full component props. */
export type VoiceSettingsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.voice'>

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

/** The Models sub-section: shipped model rows with download control and live status. */
function ModelsSection({ t }: { t: VoiceSettingsSectionProps['t'] }): ReactNode {
  const [state, setState] = useState<ModelsViewState>({ phase: 'loading' })
  const [pendingDownload, setPendingDownload] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
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

  // Download and extraction are separate Host phases. Keep polling through
  // both, and while the originating request is still pending, without
  // replacing the current rows with a full-page loading state every two seconds.
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

  return (
    <section className={css.settingSection} data-voice-subsection="models">
      <div className={css.sectionHeader}>
        <h3 className={css.settingTitle}>{t('modelsSectionTitle')}</h3>
        <p className={css.settingDescription}>{t('modelsDescription')}</p>
      </div>
      {state.phase === 'loading' && <p className={css.stateRow}>{t('loading')}</p>}
      {state.phase === 'error' && <p className={css.stateRow}>{t('loadFailed')}</p>}
      {state.phase === 'ready' && (
        <ul className={css.modelList} data-model-count={state.models.length}>
          {state.models.map(model => (
            <li key={model.definition.id} className={css.modelRow}>
              <div className={css.modelInfo}>
                <div className={css.modelTitle} title={model.definition.name}>{model.definition.name}</div>
                <div className={css.modelMeta}>
                  {formatBytes(model.definition.approximateBytes)}
                  {model.status.state === 'downloading' && ` · ${formatBytes(model.status.receivedBytes)} / ${formatBytes(model.status.totalBytes)}`}
                  {model.status.state === 'extracting' && <span> · {formatBytes(model.status.receivedBytes)} / {formatBytes(model.status.totalBytes)} · {t('installing')}</span>}
                  {model.status.state === 'ready' && <span className={css.statusReady}> · {t('statusReady')}</span>}
                  {model.status.state === 'failed' && <span className={css.statusFailed}> · {t('statusFailed')}: {model.status.message}</span>}
                </div>
              </div>
              <div className={css.modelActions}>
                {model.status.state !== 'ready' && (
                  <button
                    className={css.actionButton}
                    type="button"
                    disabled={pendingDownload === model.definition.id || pendingRemove === model.definition.id || model.status.state === 'downloading' || model.status.state === 'extracting'}
                    onClick={() => { onDownload(model.definition.id) }}
                  >
                    {model.status.state === 'extracting'
                      ? t('installing')
                      : model.status.state === 'downloading'
                        ? t('downloading')
                        : t('download')}
                  </button>
                )}
                {(model.status.state === 'ready' || model.status.state === 'failed') && (
                  <button
                    className={css.actionButton}
                    type="button"
                    disabled={pendingRemove === model.definition.id}
                    onClick={() => { onRemove(model.definition.id) }}
                  >
                    {pendingRemove === model.definition.id ? t('removing') : t('remove')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Render the Voice settings section. */
export function VoiceSettingsSection({ t }: VoiceSettingsSectionProps): ReactNode {
  const [mic, setMic] = useState<MicrophonePermissionState>('unknown')

  useEffect(() => {
    let current = true
    void readMicrophonePermission().then((permission) => { if (current) setMic(permission) })
    return () => { current = false }
  }, [])

  const onRequestMic = (): void => {
    void requestMicrophonePermission().then(setMic)
  }

  return (
    <div className={css.section}>
      <div className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </div>
      <div className={css.panel} data-voice-settings-panel="true">
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
        <EngineSection t={t} />
        <ModelsSection t={t} />
      </div>
    </div>
  )
}
