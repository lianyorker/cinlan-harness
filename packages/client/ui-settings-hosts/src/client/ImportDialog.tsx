/** Read-only import of concrete Host entries from the managing Host's OpenSSH configuration. */
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImportableHostsValue } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { HostDiagnostic, HostsTranslate, ImportCandidate } from './types.ts'
import { diagnosticLabel } from './diagnostics.ts'
import css from './HostsSection.module.css'

/** Observation of one import read; the page owns it so failures keep their Remote codes. */
export type ImportState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: ImportableHostsValue }
  | { readonly status: 'error'; readonly error: HostDiagnostic }

/** One Host entry offered for import, rendered from its destination facts. */
function candidateSummary(entry: ImportCandidate): string {
  const account = entry.username === undefined ? '' : entry.username + '@'
  const port = entry.port === undefined ? '' : ':' + String(entry.port)
  return account + (entry.host ?? entry.alias) + port
}

/**
 * Render the import chooser.
 * @param props - current read observation, localized copy and the pick action.
 * @returns the import dialog; it never writes the configuration file.
 */
export function ImportDialog({ state, t, onPick, onClose }: {
  state: ImportState
  t: HostsTranslate
  onPick: (entry: ImportCandidate) => void
  onClose: () => void
}): ReactNode {
  return <Modal open onClose={onClose} title={t('importTitle')} description={t('importDescription')}
    closeLabel={t('close')} className={css.importDialog ?? ''}
    footer={<div className={css.actions}><Button variant="outline" onClick={onClose}>{t('close')}</Button></div>}>
    <div className={css.importBody}>
      {state.status === 'loading' && <p role="status">{t('importBusy')}</p>}
      {state.status === 'error' && <div className={css.error} role="alert">
        <p>{diagnosticLabel(state.error, t)}</p>
        {state.error.code !== '' && <code>{state.error.code}</code>}
        {state.error.message !== '' && <p>{state.error.message}</p>}
      </div>}
      {state.status === 'ready' && <>
        <p className={css.note}>{t('importSource', { path: state.value.source })}</p>
        {!state.value.exists && <p className={css.note}>{t('importMissing', { path: state.value.source })}</p>}
        {state.value.exists && state.value.entries.length === 0 && <p className={css.note}>{t('importEmpty')}</p>}
        {state.value.entries.length > 0 && <>
          <ul className={css.importList}>
            {state.value.entries.map(entry => <li key={entry.alias}>
              <button type="button" className={css.importEntry} aria-label={t('importEntry', { alias: entry.alias })}
                onClick={() => { onPick(entry) }}>
                <span className={css.importAlias}>{entry.alias}</span>
                <span className={css.note}>{candidateSummary(entry)}</span>
              </button>
            </li>)}
          </ul>
          <p className={css.note}>{t('importSkipped')}</p>
        </>}
      </>}
    </div>
  </Modal>
}
