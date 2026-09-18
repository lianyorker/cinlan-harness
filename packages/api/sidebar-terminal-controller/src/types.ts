/** Serializable integrated sidebar terminal requests, stream frames, and closed Remote failures. */
import type {} from '@deepseek-ai/dsh-typert-protocol'
import type {
  SidebarAgentTerminalId, SidebarAgentTerminalSnapshot, SidebarTerminalAttachmentId, SidebarTerminalCapability,
  SidebarTerminalFrame, SidebarTerminalOpenRequest, SidebarTerminalReleaseRequest, SidebarTerminalSessionId,
  SidebarTerminalTabId,
} from '@deepseek-ai/dsh-sidebar-terminals/types'
export type * from '@deepseek-ai/dsh-sidebar-terminals/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'sidebarTerminals/invalid-request': {}
    'sidebarTerminals/invalid-directory': {}
    'sidebarTerminals/unavailable': {}
    'sidebarTerminals/not-found': {}
    'sidebarTerminals/stale-attachment': {}
    'sidebarTerminals/output-overflow': {}
    'sidebarTerminals/ack-timeout': {}
    'sidebarTerminals/operation-failed': {}
  }
}

/** React-free terminal callbacks owned by one UI activation. */
export interface TerminalCallbacks {
  /**
   * @param request - immutable target and opening geometry.
   * @param onFrame - renderer completion callback.
   * @param onError - stream or sink failure.
   * @returns idempotent release.
   */
  connectTerminal(
    request: SidebarTerminalOpenRequest,
    onFrame: (frame: SidebarTerminalFrame) => Promise<void>,
    onError: (error: unknown) => void,
  ): (mode: SidebarTerminalReleaseRequest['mode']) => Promise<void>
  /** @param id - live attachment. @param data - input bytes. */
  terminalInput(id: SidebarTerminalAttachmentId, data: string): Promise<void>
  /** @param id - live attachment. @param cols - columns. @param rows - rows. */
  terminalResize(id: SidebarTerminalAttachmentId, cols: number, rows: number): Promise<void>
  /** @returns nonspawning shell capability. */
  terminalCapability(): Promise<SidebarTerminalCapability>
  /** @param sessionId - owning Session. @param onList - complete snapshot callback. @returns synchronous unsubscribe. */
  watchAgentTerminals(sessionId: SidebarTerminalSessionId, onList: (list: readonly SidebarAgentTerminalSnapshot[]) => void): () => void
  /** @param uuid - agent terminal identity. */
  terminalCloseAgent(uuid: SidebarAgentTerminalId): Promise<void>
  /** @param sessionId - owning Session. @param tabId - UI tab identity. */
  terminalCloseUi(sessionId: SidebarTerminalSessionId, tabId: SidebarTerminalTabId): Promise<void>
  /** @returns after streams, pending requests, and releases settle. */
  dispose(): Promise<void>
}
