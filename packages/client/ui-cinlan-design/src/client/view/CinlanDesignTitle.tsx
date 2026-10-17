/** Live Cinlan Design tab title. */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Cinlan Design title props assembled by the Sidebar title seat. */
export type CinlanDesignTitleProps = PropsRuntime<'sidebar.right.pane.tab.title'>

/** Cinlan Design icon and title. */
export function CinlanDesignTitle({ useTabInfo }: CinlanDesignTitleProps): ReactNode {
  const { tab } = useTabInfo()
  const displayTitle = tab.title.replace(/^Cinlan\s*/i, '')

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2 6.5H14" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="4.5" cy="4.75" r="0.75" fill="currentColor" />
        <circle cx="7" cy="4.75" r="0.75" fill="currentColor" />
      </svg>
      <span>{displayTitle}</span>
    </span>
  )
}
