/** Durable Work Items provider preferences shared by the Host settings provider and browser UI. */

import s from '@deepseek-ai/schemastery'

/** Settings namespace owned by the work-items UI plugin. */
export const WORK_ITEMS_NAMESPACE = 'work-items'

/** User-controlled Work Items provider visibility preferences. */
export interface WorkItemsSettings {
  githubVisible: boolean
  gitlabVisible: boolean
  linearVisible: boolean
}

/** Schema used by Host registration and Client settings decoding. */
export const WorkItemsSettingsSchema: s<WorkItemsSettings> = s.object({
  githubVisible: s.boolean().default(true),
  gitlabVisible: s.boolean().default(true),
  linearVisible: s.boolean().default(true),
})
