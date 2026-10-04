/** Read-only Host data and plain callbacks consumed by the SSH host settings page. */
import type {
  CreateTargetRequest, ImportableHostsValue, ListTargetsValue, SshConfigHost, TargetRequest,
  TargetRevisionRequest, TargetTestValue, TargetValue, UpdateTargetRequest,
} from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Saved target edit values; credentials and key contents stay on the managing Host. */
export type HostDraft = CreateTargetRequest
/** Revision fence captured before an operation on saved configuration. */
export type TargetRevision = TargetRevisionRequest
/** Saved target CRUD, connectivity probe and observation callbacks. */
export interface HostsCallbacks {
  list: (signal?: AbortSignal) => Promise<ListTargetsValue>
  follow: (signal?: AbortSignal) => AsyncIterable<ListTargetsValue>
  create: (request: CreateTargetRequest, signal?: AbortSignal) => Promise<TargetValue>
  update: (request: UpdateTargetRequest, signal?: AbortSignal) => Promise<TargetValue>
  removeTarget: (request: TargetRevisionRequest, signal?: AbortSignal) => Promise<Record<string, never>>
  connect: (request: TargetRevisionRequest, signal?: AbortSignal) => Promise<TargetValue>
  disconnect: (request: TargetRequest, signal?: AbortSignal) => Promise<TargetValue>
  test: (request: TargetRevisionRequest, signal?: AbortSignal) => Promise<TargetTestValue>
  listImportableHosts: (signal?: AbortSignal) => Promise<ImportableHostsValue>
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
export interface HostsInjected extends Omit<HostsCallbacks, 'list' | 'follow'> {
  hooks: { hosts: ObservableSnapshot<HostsSnapshot> }
  refresh: (signal?: AbortSignal) => Promise<ListTargetsValue>
}
/** One editable target draft; every value is presentation text until it is submitted. */
export interface TargetDraft {
  readonly label: string
  /** The single host-or-alias field; the account and port it carries move into their own fields. */
  readonly destination: string
  readonly username: string
  readonly port: string
  readonly identityFile: string
  readonly proxyCommand: string
  readonly jumpHost: string
  /** OpenSSH connection reuse; on by default, matching the capability's own default. */
  readonly connectionReuse: boolean
  /** The saved connection deadline in seconds; empty keeps the plugin's own default. */
  readonly connectTimeoutSeconds: string
}
/** A Host entry prefill offered by the import dialog. */
export type ImportCandidate = SshConfigHost
/** Framework-derived settings inputs. */
export type HostsProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.hosts'> & InjectFace<HostsInjected>
/** The page's typed translator, also supplied to local presentation components. */
export type HostsTranslate = PropsLocale<'settings.hosts'>['t']
