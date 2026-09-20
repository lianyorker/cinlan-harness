/** Slot adapter for the existing sidebar-right comparison tab. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { parseChangesReviewAddress } from '../changes.ts'
import type { ReviewReader } from './review-read.ts'
import type { ChangesReviewParams } from './review-definition.ts'
import { ReviewPanel } from './ReviewPanel.tsx'
import type { NS } from './locales.ts'

/** Slot-owned tab information and package-owned read callbacks. */
export type ReviewTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<typeof NS> & ReviewReader

/**
 * Adapt tab navigation to a comparison without changing the sidebar's tab domain.
 * @param props - framework-owned tab state and request callbacks.
 * @returns the shared review panel.
 */
export function ReviewTab({ useTabInfo, useSessions, summary, diff, t }: ReviewTabProps) {
  const { tab } = useTabInfo()
  const coordinates = parseChangesReviewAddress(tab.contentId)
  if (coordinates === undefined) throw new Error('ui-deliverables: invalid review tab address')
  const cwd = useSessions(sessions => sessions.byId[coordinates.sessionId]?.cwd)
  const index = (tab.navigation.params as ChangesReviewParams | undefined)?.index ?? 0
  return <ReviewPanel key={tab.contentId} {...coordinates} initialIndex={index} summary={summary} diff={diff} t={t}
    openFile={(path) => { tab.actions.openResource(fileAddressFor(coordinates.sessionId, cwd, path)) }} />
}
