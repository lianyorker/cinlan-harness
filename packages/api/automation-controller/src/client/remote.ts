/** Direct generated Remote instance consumed without importing the aggregate assembly. */
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AutomationCancelRequest, AutomationCatalog, AutomationDefinition, AutomationDelete, AutomationDraft,
  AutomationFollowFrame, AutomationPreviewRequest, AutomationRun, AutomationRunPage, AutomationRunRequest,
  AutomationRunsRequest, AutomationSnapshot, AutomationUpdate,
} from '../types.ts'

/** Business methods installed by this package's generated Remote descriptors. */
export interface AutomationRemote {
  snapshot(this: void): Promise<RemoteResult<AutomationSnapshot>>
  create(this: void, draft: AutomationDraft): Promise<RemoteResult<AutomationDefinition>>
  update(this: void, update: AutomationUpdate): Promise<RemoteResult<AutomationDefinition>>
  delete(this: void, request: AutomationDelete): Promise<RemoteResult<void>>
  run(this: void, request: AutomationRunRequest): Promise<RemoteResult<AutomationRun>>
  cancel(this: void, request: AutomationCancelRequest): Promise<RemoteResult<void>>
  runs(this: void, request: AutomationRunsRequest): Promise<RemoteResult<AutomationRunPage>>
  previewSchedule(this: void, request: AutomationPreviewRequest): Promise<RemoteResult<number[]>>
  catalog(this: void): Promise<RemoteResult<AutomationCatalog>>
  follow(this: void, signal?: AbortSignal): AsyncIterable<AutomationFollowFrame>
}
/** Gateway supervision and this controller's direct namespace only. */
export interface AutomationRemotes {
  readonly $stream: ClientRemote['$stream']
  readonly automation: AutomationRemote
}
