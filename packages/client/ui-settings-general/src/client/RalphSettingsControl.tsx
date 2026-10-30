/** Ralph availability and round budget; neither control starts a workflow. */
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { BooleanPreferenceControl } from './BooleanPreferenceControl.tsx'
import css from './DeveloperToolsRow.module.css'

/** Accepted Host Ralph admission and per-call budget. */
export interface RalphSettings {
  enabled: boolean
  maxRounds: number
}

/**
 * Render explicit Ralph availability and a saved round ceiling.
 * @param props - accepted policy, ordered writers, and locale-owned copy.
 * @returns nothing without a served policy, otherwise the policy controls.
 */
export function RalphSettingsControl({ state, setEnabled, setMaxRounds, t }: PropsLocale<'settings'> & {
  state: ConfigFormSnapshot<RalphSettings>
  setEnabled: (enabled: boolean) => Promise<boolean>
  setMaxRounds: (value: number) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (state.status === 'unavailable' || state.value === undefined) return null
  const writable = state.status === 'ready' && state.writable
  const text = draft ?? String(state.value.maxRounds)
  const parsed = text.trim() === '' ? NaN : Number(text)
  const valid = Number.isSafeInteger(parsed) && parsed >= 1
  return <div>
    <BooleanPreferenceControl enabled={state.value.enabled} writable={writable} anchor="ralph-enabled"
      setEnabled={setEnabled} title={t('ralph.title')} description={t('ralph.description')} error={t('ralph.error')} />
    <div className={css.row} data-settings-anchor="ralph-max-rounds">
      <div>
        <label htmlFor="ralph-max-rounds-input" className={css.title}>{t('ralph.maxRounds')}</label>
        <p className={css.description}>{t('ralph.maxRoundsHelp')}</p>
      </div>
      <div className={css.controls}>
        <Input id="ralph-max-rounds-input" type="number" min={1} step={1} value={text}
          disabled={!writable || busy} aria-invalid={draft !== null && !valid}
          onChange={(event) => { setDraft(event.target.value); setFailed(false) }} />
        <Button variant="outline" disabled={!writable || busy || draft === null || !valid}
          onClick={() => {
            setFailed(false)
            setBusy(true)
            void setMaxRounds(parsed).then((accepted) => {
              setFailed(!accepted)
              if (accepted) setDraft(null)
            }, () => { setFailed(true) }).finally(() => { setBusy(false) })
          }}>{t('ralph.save')}</Button>
      </div>
    </div>
    {draft !== null && !valid && <div role="alert">{t('ralph.invalidRounds')}</div>}
    {failed && <div role="alert">{t('ralph.error')}</div>}
  </div>
}
