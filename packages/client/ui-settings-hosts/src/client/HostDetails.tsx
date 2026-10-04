/** Diagnostic presentation shared within this page. */
import type { ReactNode } from 'react'
import type { HostDiagnostic, HostsTranslate } from './types.ts'
import { diagnosticLabel } from './diagnostics.ts'
import css from './HostsSection.module.css'

/**
 * Render localized recovery copy and preserve the Host's diagnostic.
 * @param props - diagnostic and locale.
 * @returns an accessible failure notice.
 */
export function HostErrorNotice({ error, t }: { error: HostDiagnostic; t: HostsTranslate }): ReactNode {
  return <div className={css.error} role="alert">
    <p>{diagnosticLabel(error, t)}</p>
    {error.code !== '' && <code>{error.code}</code>}
    {error.message !== '' && <p>{error.message}</p>}
  </div>
}
