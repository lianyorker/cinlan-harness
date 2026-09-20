/** Browser-safe values shared by integrated sidebar terminals and their carriers. */
export type {} from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Session identity, shared with the Session service's brand. */
export type SidebarTerminalSessionId = Branded<'SessionId'>
/** Durable tab identity minted by the sidebar store. */
export type SidebarTerminalTabId = Branded<'SidebarTerminalTabId'>
/** Agent registry identity; unrelated to UI tab counters. */
export type SidebarAgentTerminalId = Branded<'SidebarAgentTerminalId'>
/** Server-issued identity for one attachment to one live process generation. */
export type SidebarTerminalAttachmentId = Branded<'SidebarTerminalAttachmentId'>
/** Server-issued identity retained for one native process across attachment reconnects. */
export type SidebarTerminalProcessId = Branded<'SidebarTerminalProcessId'>
/** Validated UUID identifying one floating app window. */
export type FloatingWorkspaceWindowId = Branded<'FloatingWorkspaceWindowId'>

/** Accepted floating preferences captured when a new UI terminal tab is created. */
export type FloatingWorkspaceTerminalContext =
  | { readonly windowId: FloatingWorkspaceWindowId; readonly status: 'ready'; readonly directory: string }
  | { readonly windowId: FloatingWorkspaceWindowId; readonly status: 'loading' | 'unavailable' }

/** Captured directory request for one new floating UI terminal. */
export interface SidebarFloatingTerminalDirectory {
  readonly windowId: FloatingWorkspaceWindowId
  readonly directory: string
}

/** Live floating context and consumer marker; neither creates a Host terminal. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    floatingWorkspaceContext: () => FloatingWorkspaceTerminalContext | undefined
    floatingTerminalConsumer: true
  }
}

/**
 * UI terminals belong to a session/tab; shellPath selects a discovered executable only when spawning.
 * Agent terminals retain their registry identity.
 */
export type SidebarTerminalTarget =
  | { readonly kind: 'ui'; readonly sessionId: SidebarTerminalSessionId; readonly tabId: SidebarTerminalTabId; readonly floating?: SidebarFloatingTerminalDirectory; readonly shellPath?: string }
  | { readonly kind: 'agent'; readonly uuid: SidebarAgentTerminalId }

/** Initial display geometry and immutable target for a physical attachment. */
export interface SidebarTerminalOpenRequest {
  readonly target: SidebarTerminalTarget
  readonly cols: number
  readonly rows: number
}

/** Installed local shell offered for a new UI terminal; paths are verified by the Host. */
export interface SidebarTerminalShell {
  readonly path: string
  readonly name: string
}

/** Nonspawning availability check and current configured shell label. */
export type SidebarTerminalCapability =
  | { readonly status: 'available'; readonly shellName: string }
  | { readonly status: 'unavailable'; readonly reason: 'missing-dependencies' }

/** One bounded frame; data credit is released only after the renderer acknowledges its sequence. */
export type SidebarTerminalFrame =
  | { readonly type: 'ready'; readonly attachmentId: SidebarTerminalAttachmentId; readonly processId: SidebarTerminalProcessId; readonly pid: number; readonly cwd: string; readonly shellName: string; readonly shellPath?: string; readonly title?: string }
  | { readonly type: 'data'; readonly attachmentId: SidebarTerminalAttachmentId; readonly sequence: number; readonly data: string }
  | { readonly type: 'exit'; readonly attachmentId: SidebarTerminalAttachmentId; readonly exitCode: number }

/** Input for an existing attachment; detached generations cannot write. */
export interface SidebarTerminalInputRequest {
  readonly attachmentId: SidebarTerminalAttachmentId
  readonly data: string
}
/** Geometry update for an existing attachment. */
export interface SidebarTerminalResizeRequest {
  readonly attachmentId: SidebarTerminalAttachmentId
  readonly cols: number
  readonly rows: number
}
/** Highest rendered data-frame sequence for an existing attachment. */
export interface SidebarTerminalAckRequest {
  readonly attachmentId: SidebarTerminalAttachmentId
  readonly sequence: number
}
/** Release disposition: switching sessions parks; closing a tab terminates its UI process. */
export interface SidebarTerminalReleaseRequest {
  readonly attachmentId: SidebarTerminalAttachmentId
  readonly mode: 'disconnect' | 'park' | 'close'
}
/** Existing UI terminal identity for read-only process lookup. */
export interface SidebarTerminalUiTarget {
  readonly sessionId: SidebarTerminalSessionId
  readonly tabId: SidebarTerminalTabId
}
/** Explicit close of a previously observed UI process, including while its view is disconnected. */
export interface SidebarTerminalCloseUiRequest extends SidebarTerminalUiTarget {
  readonly processId: SidebarTerminalProcessId
}
/** Rename only the previously observed UI process generation. */
export interface SidebarTerminalRenameUiRequest extends SidebarTerminalCloseUiRequest {
  /** At most 120 characters, without control characters; trimming must leave a nonempty title. */
  readonly title: string
}
/** Retained native UI terminal facts; enumeration never starts or extends a process. */
export interface SidebarUiTerminalSnapshot extends SidebarTerminalCloseUiRequest {
  readonly title: string
  readonly shellPath: string
  readonly cwd: string
  readonly pid: number
  readonly floating?: SidebarFloatingTerminalDirectory
}

/** Existing agent terminal state visible to the session's sidebar. */
export interface SidebarAgentTerminalSnapshot {
  readonly uuid: SidebarAgentTerminalId
  readonly title: string
  readonly command: string
  readonly exited: boolean
  readonly exitCode?: number | null
  readonly exitSignal?: string | null
}

/** Stable failures understood by terminal carriers and localized by their UI. */
export type SidebarTerminalErrorCode = 'invalid-request' | 'invalid-directory' | 'invalid-shell' | 'unavailable' | 'not-found' | 'stale-attachment' | 'output-overflow' | 'ack-timeout'
