/** Read-only Host data and plain callbacks consumed by native execution-host settings. */
import type {
  CreateTargetRequest, InspectDirectoryRequest, InspectionValue, ListTargetsValue,
  TargetRequest, TargetRevisionRequest, TargetValue, UpdateTargetRequest,
  RuntimeInspection, RuntimeLocation, RuntimeStartRequest, RuntimeTaskRequest, RuntimeTasksValue, RuntimeTaskValue, RuntimeTask,
} from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Target editor values; SSH configuration and authentication remain Host-owned. */
export type HostDraft = CreateTargetRequest
/** Revision fence captured before an operation on saved configuration. */
export type TargetRevision = TargetRevisionRequest
/** Remote operations, with their successful result unwrapped and errors preserved. */
export interface RuntimeCallbacks {
  detectRuntime: (request: RuntimeLocation, signal?: AbortSignal) => Promise<RuntimeInspection>
  startRuntime: (request: RuntimeStartRequest, signal?: AbortSignal) => Promise<RuntimeTaskValue>
  getRuntimeTask: (request: RuntimeTaskRequest, signal?: AbortSignal) => Promise<RuntimeTaskValue>
  listRuntimeTasks: (signal?: AbortSignal) => Promise<RuntimeTasksValue>
  followRuntimeTask: (request: RuntimeTaskRequest, signal?: AbortSignal) => AsyncIterable<RuntimeTaskValue>
  cancelRuntimeTask: (request: RuntimeTaskRequest, signal?: AbortSignal) => Promise<RuntimeTaskValue>
}
/** Observed task inventory; installation lifetime belongs to the Host. */
export interface RuntimesSnapshot {
  readonly status: 'loading' | 'ready' | 'error'
  readonly tasks: readonly RuntimeTask[]
  readonly error: HostDiagnostic | undefined
}
/** Saved target CRUD and observation callbacks. */
export interface HostsCallbacks extends RuntimeCallbacks {
  list: (signal?: AbortSignal) => Promise<ListTargetsValue>
  follow: (signal?: AbortSignal) => AsyncIterable<ListTargetsValue>
  create: (request: CreateTargetRequest, signal?: AbortSignal) => Promise<TargetValue>
  update: (request: UpdateTargetRequest, signal?: AbortSignal) => Promise<TargetValue>
  removeTarget: (request: TargetRevisionRequest, signal?: AbortSignal) => Promise<Record<string, never>>
  connect: (request: TargetRevisionRequest, signal?: AbortSignal) => Promise<TargetValue>
  disconnect: (request: TargetRequest, signal?: AbortSignal) => Promise<TargetValue>
  inspectDirectory: (request: InspectDirectoryRequest, signal?: AbortSignal) => Promise<InspectionValue>
}
/** Serializable diagnostic retained for rendering after a rejected operation. */
export interface HostDiagnostic { readonly code: string; readonly message: string }
/** Last complete observation and its transport availability. */
export interface HostsSnapshot {
  readonly status: 'loading' | 'ready' | 'error'
  readonly value: ListTargetsValue | undefined
  readonly error: HostDiagnostic | undefined
}
/** Entry-private source; the renderer provides useHosts to the component. */
export interface HostsInjected extends Omit<HostsCallbacks, 'list' | 'follow' | 'getRuntimeTask' | 'listRuntimeTasks' | 'followRuntimeTask'> {
  hooks: { hosts: ObservableSnapshot<HostsSnapshot>; runtimes: ObservableSnapshot<RuntimesSnapshot> }
  refreshRuntimes: () => Promise<void>
  refresh: (signal?: AbortSignal) => Promise<ListTargetsValue>
}
/** Framework-derived settings inputs. */
export type HostsProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.hosts'> & InjectFace<HostsInjected>
/** The page's typed translator, also supplied to local presentation components. */
export type HostsTranslate = PropsLocale<'settings.hosts'>['t']
