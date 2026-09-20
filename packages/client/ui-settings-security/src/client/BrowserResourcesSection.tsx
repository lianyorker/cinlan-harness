/** Native Browser runtime resources; activation and launch preferences retain their existing owners. */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { BrowserRuntimeTask, BrowserRuntimeTaskId } from '@deepseek-ai/dsh-browser-playwright/types'
import { Button, IconGlobeOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BrowserResourceRead } from './browser-resources.ts'
import type { BrowserResourcesKey } from './browser-locales.ts'
import css from './BrowserResourcesSection.module.css'

/** Registration-private observation and human runtime commands. */
export interface BrowserResourcesInjected {
  /** Observe while mounted; releasing this watch never cancels a Host task. */
  watchBrowserResources: () => () => void
  /** Read authoritative status again after a request or reconnect. */
  refreshBrowserResources: () => void
  /** Start a Host-owned operation; resolve when the start request is accepted. */
  runBrowserResource: (operation: BrowserRuntimeTask['operation']) => Promise<void>
  /** Request cancellation of the exact task displayed to the user. */
  cancelBrowserResource: (taskId: BrowserRuntimeTaskId) => Promise<void>
  /** Close the provider-owned persistent context before replacing its runtime. */
  closeBrowserRuntime: () => Promise<void>
  /** The slot renderer binds this source to useBrowserResources. */
  hooks: { browserResources: SnapshotStore<BrowserResourceRead> }
}

/** Framework-derived props passed by the owning Browser settings section. */
export type BrowserResourcesProps = InjectFace<BrowserResourcesInjected> & PropsLocale<'settings.cinlanCapabilities'>

const PHASES = {
  preparing: 'browserRuntimeQueued', downloading: 'browserRuntimeDownloading',
  committing: 'browserRuntimeCommitting', complete: 'browserRuntimeComplete',
} as const satisfies Record<BrowserRuntimeTask['phase'], BrowserResourcesKey>
const SOURCES = { system: 'browserRuntimeSystem', managed: 'browserRuntimeManaged', custom: 'browserRuntimeCustom' } as const

/** Show Host installation facts and explicit runtime operations without launching a browser.
 * @param props - Renderer-bound observations and callbacks closed over the generated Browser Remote.
 * @returns Runtime facts, progress, retry, cancellation, and confirmed removal controls.
 */
export function BrowserResourcesSection({ useBrowserResources, watchBrowserResources, refreshBrowserResources,
  runBrowserResource, cancelBrowserResource, closeBrowserRuntime, t }: BrowserResourcesProps) {
  const read = useBrowserResources(snapshot => snapshot)
  const [pending, setPending] = useState(false)
  const [requestError, setRequestError] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [attempt, setAttempt] = useState<BrowserRuntimeTask['operation']>()
  const active = useRef(false)
  const requestPending = useRef(false)
  useEffect(() => {
    active.current = true
    const release = watchBrowserResources()
    return () => { active.current = false; release() }
  }, [watchBrowserResources])
  const status = read.status === 'ready' ? read.value : undefined
  const task = status?.task
  const running = task?.state === 'running'
  const busy = pending || running
  const stopped = status?.browserState === 'stopped'
  const canCancel = running && task.phase !== 'committing' && !pending
  const canMutate = status !== undefined && stopped && !busy
  const failed = task?.state === 'failed'
  const retry = requestError ? attempt : task?.operation

  const request = async (action: () => Promise<void>): Promise<void> => {
    if (requestPending.current) return
    requestPending.current = true
    setPending(true)
    setRequestError(false)
    try { await action() } catch (_runtimeRequestRejected) {
      if (active.current) setRequestError(true)
    } finally {
      requestPending.current = false
      if (active.current) setPending(false)
    }
  }
  const perform = (operation: BrowserRuntimeTask['operation']): void => {
    if (!canMutate) return
    setAttempt(operation)
    void request(() => runBrowserResource(operation))
  }
  const retryOperation = (): void => {
    if (retry === undefined) return
    if (retry === 'remove') setConfirmRemove(true)
    else perform(retry)
  }

  return <section className={css.section} aria-label={t('browserRuntimeTitle')} data-settings-anchor="browser-readiness">
    <div className={css.title}><IconGlobeOutline14 aria-hidden="true" /><h2>{t('browserRuntimeTitle')}</h2>
      {status !== undefined && <span className={css.badge}>{t(status.installed ? 'browserRuntimeReady' : 'browserRuntimeMissing')}</span>}
    </div>
    <p>{t('browserRuntimeDescription')}</p><p>{t('browserRuntimeActivation')}</p>
    {read.status === 'loading' && <p role="status">{t('browserRuntimeLoading')}</p>}
    {read.status === 'error' && <p role="alert" className={css.error}>{t('browserRuntimeReadFailed')}</p>}
    {status !== undefined && <>
      {!status.providerActive && <p role="status">{t('browserRuntimeInactive')}</p>}
      <dl className={css.facts}>
        <div><dt>{t('browserRuntimeSource')}</dt><dd>{t(SOURCES[status.source])}</dd></div>
        <div><dt>{t('browserRuntimeChannel')}</dt><dd>{t(status.channel === 'chrome' ? 'browserChrome' : status.channel === 'msedge' ? 'browserEdge' : 'browserChromium')}</dd></div>
        <div><dt>{t('browserRuntimeVersion')}</dt><dd>{status.playwrightVersion}</dd></div>
        <div><dt>{t('browserRuntimeBrowserVersion')}</dt><dd>{status.browserVersion}</dd></div>
        <div><dt>{t('browserRuntimeRevision')}</dt><dd>{status.revision}</dd></div>
        <div><dt>{t('browserRuntimeManagedStatus')}</dt><dd>{t(status.managedInstalled ? 'browserRuntimeReady' : 'browserRuntimeMissing')}</dd></div>
      </dl>
      {status.source !== 'managed' && <p>{t('browserRuntimeOtherSource')}</p>}
      {!stopped && <p>{t('browserRuntimeStopFirst')}</p>}
      {running && <div className={css.progress} role="status">
        <span>{t(PHASES[task.phase])}</span>
        <progress aria-label={t('browserRuntimeProgress')} {...task.progressPercent === null ? {} : { value: task.progressPercent, max: 100 }} />
        <p>{t('browserRuntimeContinues')}</p>
      </div>}
      {task?.state === 'cancelled' && <p role="status">{t('browserRuntimeCancelled')}</p>}
      {task?.state === 'succeeded' && <p role="status">{t('browserRuntimeComplete')}</p>}
      {failed && <p role="alert" className={css.error}>{t('browserRuntimeTaskFailed')}</p>}
      <div className={css.actions}>
        {status.browserState === 'running' && <Button variant="outline" disabled={busy} onClick={() => {
          setAttempt(undefined); void request(closeBrowserRuntime)
        }}>{t('browserRuntimeStop')}</Button>}
        {!status.managedInstalled && <Button variant="outline" disabled={!canMutate} onClick={() => { perform('install') }}>{t('browserRuntimeInstall')}</Button>}
        {status.managedInstalled && <>
          <Button variant="outline" disabled={!canMutate} onClick={() => { perform('reinstall') }}>{t('browserRuntimeRepair')}</Button>
          <Button variant="outline" disabled={!canMutate} onClick={() => { setConfirmRemove(true) }}>{t('browserRuntimeRemove')}</Button>
        </>}
        {running && <Button variant="outline" disabled={!canCancel} onClick={() => {
          if (canCancel) { setAttempt(undefined); void request(() => cancelBrowserResource(task.taskId)) }
        }}>{t('browserRuntimeCancel')}</Button>}
        {(requestError || failed) && retry !== undefined && <Button variant="outline" disabled={!canMutate}
          onClick={retryOperation}>{t('browserRuntimeRetry')}</Button>}
      </div>
    </>}
    {requestError && <p role="alert" className={css.error}>{t('browserRuntimeActionFailed')}</p>}
    <div><Button variant="ghost" disabled={pending} onClick={refreshBrowserResources}>{t('browserRuntimeRefresh')}</Button></div>
    <Modal open={confirmRemove} title={t('browserRuntimeRemoveTitle')} description={t('browserRuntimeRemoveDescription')}
      closeLabel={t('browserRuntimeClose')} onClose={() => { setConfirmRemove(false) }} footer={<>
        <Button variant="outline" onClick={() => { setConfirmRemove(false) }}>{t('browserRuntimeKeep')}</Button>
        <Button variant="outline" disabled={!canMutate || !status.managedInstalled} onClick={() => {
          setConfirmRemove(false); perform('remove')
        }}>{t('browserRuntimeRemove')}</Button>
      </>} />
  </section>
}
