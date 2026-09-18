/** Service definition for the existing integrated sidebar PTY provider. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { SidebarTerminalUiTarget, SidebarTerminalCloseUiRequest, SidebarTerminalProcessId, SidebarTerminalAckRequest, SidebarTerminalCapability, SidebarTerminalErrorCode, SidebarTerminalFrame, SidebarTerminalInputRequest, SidebarTerminalOpenRequest, SidebarTerminalReleaseRequest, SidebarTerminalResizeRequest, SidebarAgentTerminalId, SidebarAgentTerminalSnapshot, SidebarTerminalSessionId } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { sidebarTerminals: SidebarTerminals }
}

/** Operational failure carrying a stable, serializable code. */
export class SidebarTerminalError extends Error {
  /** Create a failure with a stable terminal error code.
   * @param code - terminal operation failure.
   * @param message - diagnostic details.
   */
  constructor(readonly code: SidebarTerminalErrorCode, message: string) {
    super(message)
    this.name = 'SidebarTerminalError'
  }
}

/** Sidebar PTY ownership; the provider reuses the UI and agent terminal managers. */
export abstract class SidebarTerminals extends Service {
  /** Register the terminal provider.
   * @param ctx - owner of the provider lifetime.
   */
  constructor(ctx: Context) { super(ctx, 'sidebarTerminals') }
  /** Read native availability without spawning a shell.
   * @returns Current availability.
   */
  abstract capability(): SidebarTerminalCapability
  /** Attach to a process and observe its output.
   * @param request - immutable target and initial geometry.
   * @param signal - attachment lifetime.
   * @returns bounded terminal frames until exit or release.
   */
  abstract open(request: SidebarTerminalOpenRequest, signal: AbortSignal): AsyncIterable<SidebarTerminalFrame>
  /** Write input to the attached process.
   * @param request - input for a live attachment.
   */
  abstract input(request: SidebarTerminalInputRequest): void
  /** Resize the attached process display.
   * @param request - updated display geometry.
   */
  abstract resize(request: SidebarTerminalResizeRequest): void
  /** Acknowledge output after the renderer consumes it.
   * @param request - highest data sequence rendered by xterm.
   */
  abstract ack(request: SidebarTerminalAckRequest): void
  /** Release a view of its captured process.
   * @param request - disposition for this attachment's process generation.
   */
  abstract release(request: SidebarTerminalReleaseRequest): void
  /** Observe an existing UI process without spawning or extending its lifetime.
   * @param request - existing UI tab.
   * @returns its native process identity, or null; never spawns or extends its lifetime.
   */
  abstract inspectUi(request: SidebarTerminalUiTarget): SidebarTerminalProcessId | null
  /** Request termination of an observed UI process and reject replacement generations.
   * @param request - exact observed native generation; missing processes are already closed, replacements are rejected.
   */
  abstract closeUi(request: SidebarTerminalCloseUiRequest): void
  /** Observe the agent terminals owned by a Session.
   * @param sessionId - owning Session.
   * @param signal - consumer lifetime.
   * @returns current agent terminal list and later updates.
   */
  abstract watch(sessionId: SidebarTerminalSessionId, signal: AbortSignal): AsyncIterable<readonly SidebarAgentTerminalSnapshot[]>
  /** Request termination of an agent terminal.
   * @param uuid - agent-owned terminal explicitly closed by its user.
   */
  abstract closeAgent(uuid: SidebarAgentTerminalId): void
}

export default SidebarTerminals
