/** Pure process provenance and diagnostic presentation shared within this page. */
import type { ReactNode } from 'react'
import type { ListTargetsValue } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { HostDiagnostic, HostsTranslate } from './types.ts'
import { diagnosticLabel } from './diagnostics.ts'
import css from './HostsSection.module.css'

/**
 * Render a process identity without treating it as saved target configuration.
 * @param props - read-only process provenance and locale.
 * @returns labeled process facts.
 */
export function ProcessDetails({ info, t }: { info: NonNullable<ListTargetsValue['current']>; t: HostsTranslate }): ReactNode {
  return <dl className={css.facts}>
    <dt>{t('processHostId')}</dt><dd><code>{info.hostId}</code></dd>
    <dt>{t('hostname')}</dt><dd>{info.hostname}</dd>
    <dt>{t('pid')}</dt><dd>{info.pid}</dd>
    <dt>{t('platform')}</dt><dd>{info.platform}</dd>
    <dt>{t('createdAt')}</dt><dd>{info.createdAt}</dd>
  </dl>
}

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
