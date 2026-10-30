/** Shared accepted-value presentation for Host-backed boolean preferences. */
import { useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DeveloperToolsRow.module.css'

/**
 * Render a boolean preference without optimistic value publication.
 * @param props - accepted value, write availability, localized copy, and writer.
 * @returns a switch with pending-write protection and inline retry feedback.
 */
export function BooleanPreferenceControl({ enabled, writable, title, description, error, anchor, setEnabled }: {
  enabled: boolean
  writable: boolean
  title: string
  description: string
  error: string
  anchor: string
  setEnabled: (enabled: boolean) => Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className={css.row} data-settings-anchor={anchor}>
    <div>
      <div className={css.title}>{title}</div>
      <div className={css.description}>{description}</div>
      {failed && <div role="alert">{error}</div>}
    </div>
    <Switch checked={enabled} label={title} disabled={busy || !writable}
      onChange={(value) => {
        setFailed(false)
        setBusy(true)
        void setEnabled(value).then((accepted) => { setFailed(!accepted) }, () => { setFailed(true) })
          .finally(() => { setBusy(false) })
      }} />
  </div>
}
