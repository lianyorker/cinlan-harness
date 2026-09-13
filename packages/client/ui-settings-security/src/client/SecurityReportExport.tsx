/** User-triggered local downloads; report contents never enter the rendered DOM. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SecurityResearchReportRequest, SecurityResearchReportValue } from '@deepseek-ai/dsh-api-remotes/client'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import css from './CapabilitySection.module.css'

/**
 * Prepare a local save link only after the Host returns complete report bytes.
 * @param props - Authorized Remote callback and localized copy.
 * @returns Session/format controls and an inert report download.
 */
export function SecurityReportExport({ exportReport, t }: {
  exportReport: (request: SecurityResearchReportRequest, signal: AbortSignal) => Promise<SecurityResearchReportValue>
  t: CapabilitySectionProps['t']
}): ReactNode {
  const [sessionId, setSessionId] = useState('')
  const [format, setFormat] = useState<SecurityResearchReportRequest['format']>('json')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState<{ url: string; name: string }>()
  const pending = useRef<AbortController>()
  useEffect(() => () => { pending.current?.abort() }, [])
  useEffect(() => () => { if (saved !== undefined) URL.revokeObjectURL(saved.url) }, [saved])
  const submit = async (): Promise<void> => {
    const value = sessionId.trim()
    if (!value || pending.current !== undefined) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true); setError(false); setSaved(undefined)
    try {
      const report = await exportReport({ sessionId: value as SecurityResearchReportRequest['sessionId'], format }, controller.signal)
      controller.signal.throwIfAborted()
      const bytes = Uint8Array.from(atob(report.base64), char => char.charCodeAt(0))
      if (bytes.byteLength !== report.bytes) throw new Error('Security report byte length mismatch')
      setSaved({ url: URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })), name: report.fileName })
    } catch (_reportFailure) {
      if (!controller.signal.aborted) setError(true)
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      pending.current = undefined
    }
  }
  return <form className={css.securityReport} onSubmit={(event) => { event.preventDefault(); void submit() }}>
    <h4>{t('securityReportTitle')}</h4><p>{t('securityReportDescription')}</p>
    <label><span>{t('securityReportSession')}</span><input type="text" required value={sessionId} disabled={busy}
      onChange={(event) => { setSessionId(event.currentTarget.value); setSaved(undefined); setError(false) }} /></label>
    <label><span>{t('securityReportFormat')}</span><select value={format} disabled={busy} onChange={(event) => {
      setFormat(event.currentTarget.value as SecurityResearchReportRequest['format']); setSaved(undefined); setError(false)
    }}><option value="json">{t('securityFormatJson')}</option><option value="markdown">{t('securityFormatMarkdown')}</option>
      <option value="sarif">{t('securityFormatSarif')}</option></select></label>
    <button className={css.recheckButton} type="submit" disabled={busy || !sessionId.trim()}>
      {t(busy ? 'securityReportSaving' : 'securityReportDownload')}
    </button>
    {saved !== undefined && <a href={saved.url} download={saved.name}>{t('securityReportSave', { name: saved.name })}</a>}
    {error && <p role="alert" className={css.failure}>{t('securityReportFailed')}</p>}
  </form>
}
