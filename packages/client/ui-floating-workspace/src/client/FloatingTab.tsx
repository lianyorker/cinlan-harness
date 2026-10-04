/** Right-Sidebar tab body: the embedded Conversation occurrence, docked. */
import type { ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './FloatingPanel.module.css'

/** Props of the docked tab body: the session-scoped seat plus its chat occurrence. */
export type FloatingTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<'floatingWorkspace.tab.chat'>

/**
 * Render the docked Chat for the Session the tab belongs to.
 * @param props - the declared occurrence seat.
 * @returns the transcript and composer inside the right-Sidebar tab.
 */
export function FloatingTab({ renderSlot }: FloatingTabProps): ReactNode {
  return <div className={css.body}>{renderSlot('floatingWorkspace.tab.chat', {})}</div>
}
