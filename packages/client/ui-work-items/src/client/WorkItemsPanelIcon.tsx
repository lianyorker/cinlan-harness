/** Icon for the global Work Items panel entry. */
import { IconChecklistOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the registered panel icon at the sidebar-requested size.
 * @param props - Size requested by the sidebar panel row.
 * @returns Decorative issue-list icon.
 */
export function WorkItemsPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconChecklistOutlineRegular size={size} />
}
