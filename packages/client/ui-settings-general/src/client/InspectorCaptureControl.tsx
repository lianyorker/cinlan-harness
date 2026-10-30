/** Explicit request for unredacted Host fetch capture in an already loaded Inspector. */
import { useEffect, useState } from 'react'
import { RiskConfirmation, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './DeveloperToolsRow.module.css'

/** Host-owned requested capture state; not a runtime-readiness claim. */
export interface InspectorCaptureSettings {
  captureFetch: boolean
}

/**
 * Gate an enabling write behind explicit acknowledgement of sensitive capture.
 * @param props - accepted configuration, ordered writer, and localized copy.
 * @returns no control for an unavailable backend, otherwise the preference and acknowledgement.
 */
export function InspectorCaptureControl({ state, setCapture, t }: PropsLocale<'settings'> & {
  state: ConfigFormSnapshot<InspectorCaptureSettings>
  setCapture: (enabled: boolean) => Promise<boolean>
}) {
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const served = state.status !== 'unavailable' && state.value !== undefined
  const writable = state.status === 'ready' && state.writable
  useEffect(() => {
    if (!served || !writable || state.value?.captureFetch !== false) {
      setConfirming(false)
      setAcknowledged(false)
    }
  }, [served, writable, state.value?.captureFetch])
  const save = (enabled: boolean) => {
    setFailed(false)
    setBusy(true)
    void setCapture(enabled).then((accepted) => { setFailed(!accepted) }, () => { setFailed(true) })
      .finally(() => { setBusy(false) })
  }
  return <>
    {served && <div className={css.row} data-settings-anchor="inspector-capture">
      <div>
        <div className={css.title}>{t('inspectorCapture.title')}</div>
        <div className={css.description}>{t('inspectorCapture.description')}</div>
        {failed && <div role="alert">{t('inspectorCapture.error')}</div>}
      </div>
      <Switch checked={state.value?.captureFetch === true} label={t('inspectorCapture.title')}
        disabled={!writable || busy} onChange={(enabled) => {
          setFailed(false)
          if (enabled) { setAcknowledged(false); setConfirming(true) }
          else save(false)
        }} />
    </div>}
    <RiskConfirmation open={confirming && served && writable && state.value?.captureFetch === false}
      title={t('inspectorCapture.confirmTitle')} description={t('inspectorCapture.confirmDescription')}
      acknowledgeLabel={t('inspectorCapture.acknowledge')} cancelLabel={t('inspectorCapture.cancel')}
      closeLabel={t('inspectorCapture.close')} confirmLabel={t('inspectorCapture.confirm')}
      acknowledged={acknowledged} disabled={busy || !writable}
      onAcknowledgedChange={setAcknowledged} onCancel={() => { setConfirming(false); setAcknowledged(false) }}
      onConfirm={() => {
        if (!acknowledged || busy || !served || !writable || state.value?.captureFetch !== false) return
        setConfirming(false)
        setAcknowledged(false)
        save(true)
      }} />
  </>
}
