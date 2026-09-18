/** Renderer input declarations; business snapshots remain in the API Client object. */
import type { AutomationSource, AutomationCatalog } from '@deepseek-ai/dsh-api-automation-controller/types'
import type {
  AutomationDraft, AutomationDefinition, AutomationUpdate, AutomationDelete, AutomationRunRequest, AutomationRun,
} from '@deepseek-ai/dsh-automation/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Explicit callbacks and one bare observable, bound to useAutomation by the renderer. */
export interface AutomationInjected {
  hooks: { automation: AutomationSource }
  refresh: () => Promise<void>
  create: (draft: AutomationDraft) => Promise<AutomationDefinition>
  update: (request: AutomationUpdate) => Promise<AutomationDefinition>
  deleteTask: (request: AutomationDelete) => Promise<void>
  run: (request: AutomationRunRequest) => Promise<AutomationRun>
  cancel: (runId: AutomationRun['id']) => Promise<void>
  loadRuns: (id: AutomationDefinition['id']) => Promise<void>
  loadMoreRuns: () => Promise<void>
  openSession: (id: NonNullable<AutomationRun['sessionId']>) => void
}

/** Settings owner, locale, and derived injection shares. */
export type AutomationSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.automation'> & InjectFace<AutomationInjected>

/** Local incomplete input before a workspace is chosen. */
export type DraftFields = Omit<AutomationDraft, 'workspaceId'> & { readonly workspaceId: AutomationDraft['workspaceId'] | '' }

/** Original revision and enabled state survive external changes and rejected saves. */
export interface EditingDraft {
  readonly fields: DraftFields
  readonly original?: Pick<AutomationDefinition, 'id' | 'revision' | 'enabled'>
}

/** Form data is passed by the registered section, never obtained from a service. */
export type DraftFormProps = Pick<AutomationSettingsProps, 't'> & {
  readonly fields: DraftFields
  readonly catalog: AutomationCatalog
  readonly disabled: boolean
  readonly pending: boolean
  readonly onChange: (fields: DraftFields) => void
  readonly onSave: () => void
  readonly onDiscard: () => void
}
