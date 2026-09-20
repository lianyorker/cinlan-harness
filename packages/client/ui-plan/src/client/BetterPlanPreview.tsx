/** Read-only plan body mounted by the local sidebar's public tab descriptor. */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PlanDocument } from './plan.ts'
import { PlanDocumentView } from './PlanPreview.tsx'
import { planFailureLine } from './failure-line.ts'
import { isReviewPreviewAddress } from './review-preview.ts'
import css from './PlanPreview.module.css'

/** One cancellable document read; undefined means a temporary preview has expired. */
export type ReadPlan = (address: string, signal: AbortSignal) => Promise<RemoteResult<PlanDocument> | undefined>

type BetterPlanPreviewProps = PropsLocale<'plan'> & { address: string; readPlan: ReadPlan }

/**
 * Recover a saved plan without passing the sidebar's Context or store into the viewer.
 * @param props - Persisted address, cancellable read callback, and localized copy.
 * @returns Complete Markdown or a localized loading, expired, or failure state.
 */
export function BetterPlanPreview({ address, readPlan, t }: BetterPlanPreviewProps) {
  const [loaded, setLoaded] = useState<{ address: string; result: Awaited<ReturnType<ReadPlan>> }>()
  useEffect(() => {
    const controller = new AbortController()
    void readPlan(address, controller.signal).then((result) => {
      if (!controller.signal.aborted) setLoaded({ address, result })
    })
    return () => { controller.abort() }
  }, [address, readPlan])
  if (loaded?.address !== address) return <div className={css.message} role="status">{t('preview.loading')}</div>
  const result = loaded.result
  if (result === undefined) return <div className={css.message} role="status">{t(isReviewPreviewAddress(address) ? 'preview.expired' : 'preview.unavailable')}</div>
  if (!result.ok) return <div className={css.message} role="status">{t('preview.failed')}<p>{planFailureLine(t, result.error)}</p></div>
  return <PlanDocumentView plan={result.value} identity={address} t={t} />
}
