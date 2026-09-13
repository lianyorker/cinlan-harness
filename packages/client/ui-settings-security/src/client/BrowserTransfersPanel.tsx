/** Explicit human file uploads and downloads scoped to one native Browser page. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BrowserObservationValue, BrowserDownloadsValue, BrowserPageId } from '@deepseek-ai/dsh-api-browser-controller/types'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import type { BrowserControlsCallbacks } from './BrowserControls.tsx'
import css from './CapabilitySection.module.css'

/** Render observed input selection and page-owned download receipts.
 * @param props - Open page, transfer limits, localized labels, and Host operations.
 * @returns File controls; no requests run until a person acts.
 */
export function BrowserTransfersPanel({ pageId, maxFileBytes, callbacks, t }: {
  pageId: BrowserPageId
  maxFileBytes: number
  callbacks: BrowserControlsCallbacks
  t: CapabilitySectionProps['t']
}): ReactNode {
  const [observation, setObservation] = useState<BrowserObservationValue['observation']>()
  const [element, setElement] = useState('')
  const [file, setFile] = useState<File>()
  const [downloads, setDownloads] = useState<BrowserDownloadsValue>()
  const [saved, setSaved] = useState<{ url: string; name: string }>()
  const [uploaded, setUploaded] = useState(false)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController>()
  useEffect(() => () => { pending.current?.abort() }, [])
  useEffect(() => () => { if (saved !== undefined) URL.revokeObjectURL(saved.url) }, [saved])
  const run = async (action: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    if (pending.current !== undefined && !pending.current.signal.aborted) return
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError(false)
    try { await action(controller.signal) } catch (_transferRejected) {
      if (!controller.signal.aborted) setError(true)
    } finally { if (!controller.signal.aborted) setBusy(false); controller.abort() }
  }
  return <details className={css.browserControls}>
    <summary>{t('browserTransfers')}</summary>
    <p>{t('browserTransferLimit', { bytes: maxFileBytes })}</p>
    <button type="button" className={css.recheckButton} disabled={busy} onClick={() => { void run(async (signal) => {
      const result = await callbacks.snapshot(pageId, signal); signal.throwIfAborted()
      setObservation(result.observation); setElement(''); setUploaded(false)
    }) }}>{t('browserObserveInputs')}</button>
    {observation !== undefined && <label><span>{t('browserInputElement')}</span><select value={element} disabled={busy} onChange={(event) => { setElement(event.currentTarget.value) }}>
      <option value="">{t('browserChooseInput')}</option>
      {observation.elements.filter(item => item.role === 'input').map(item => <option key={item.elementId} value={item.elementId}>{item.name || item.elementId}</option>)}
    </select></label>}
    <label><span>{t('browserUploadFile')}</span><input type="file" disabled={busy} onChange={(event) => { setFile(event.currentTarget.files?.[0]); setUploaded(false) }} /></label>
    <button type="button" className={css.recheckButton} disabled={busy || file === undefined || !element || observation === undefined} onClick={() => { void run(async (signal) => {
      if (file === undefined || observation === undefined || file.size > maxFileBytes) throw new Error('File exceeds upload limit')
      const input = observation.elements.find(item => item.elementId === element)
      if (input === undefined) return
      const bytes = new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted()
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      await callbacks.upload({
        pageId, observationId: observation.observationId, elementId: input.elementId, name: file.name, base64: btoa(binary),
      }, signal)
      signal.throwIfAborted(); setUploaded(true); setObservation(undefined); setElement('')
    }) }}>{t('browserUpload')}</button>
    {uploaded && <p role="status">{t('browserUploaded')}</p>}
    <button type="button" className={css.recheckButton} disabled={busy} onClick={() => { void run(async (signal) => {
      const result = await callbacks.downloads(pageId, signal); signal.throwIfAborted(); setDownloads(result)
    }) }}>{t('browserDownloads')}</button>
    {downloads?.truncated && <p role="status">{t('browserDownloadsTruncated')}</p>}
    {downloads !== undefined && <ul aria-label={t('browserDownloads')}>{downloads.items.map(item => <li key={item.id}>
      <span>{item.name} — {t(item.status === 'complete' ? 'browserDownloadComplete' : item.status === 'failed' ? 'browserRequestFailed' : 'browserRequestPending')}</span>
      <button type="button" className={css.recheckButton} disabled={busy || item.status !== 'complete'} onClick={() => { void run(async (signal) => {
        const result = await callbacks.download({ pageId, downloadId: item.id }, signal); signal.throwIfAborted()
        const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0))
        if (bytes.byteLength !== result.bytes || bytes.byteLength > maxFileBytes) throw new Error('Invalid download bytes')
        setSaved({ url: URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })), name: result.name })
      }) }}>{t('browserPrepareDownload')}</button>
    </li>)}</ul>}
    {saved !== undefined && <a href={saved.url} download={saved.name}>{t('browserSaveFile', { name: saved.name })}</a>}
    {error && <p role="alert" className={css.failure}>{t('browserOperationFailed')}</p>}
  </details>
}
