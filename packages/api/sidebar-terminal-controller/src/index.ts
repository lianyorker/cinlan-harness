/** Sidebar terminal Remote adapter; Connection and Desktop carriers authorize callers. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-sidebar-terminals'
import { terminalFailure } from './errors.ts'
import { validateInspectUi, validateCloseUi, validateAck, validateAgentId, validateInput, validateOpen, validateRelease, validateResize, validateSessionId } from './validation.ts'
import type {
  SidebarAgentTerminalId, SidebarAgentTerminalSnapshot, SidebarTerminalAckRequest, SidebarTerminalCapability, SidebarTerminalShell,
  SidebarTerminalFrame, SidebarTerminalInputRequest, SidebarTerminalOpenRequest, SidebarTerminalReleaseRequest,
  SidebarTerminalResizeRequest, SidebarTerminalSessionId, SidebarTerminalUiTarget, SidebarTerminalCloseUiRequest, SidebarTerminalProcessId,
} from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { sidebarTerminalController: SidebarTerminalController }
}

/** Validated Remote calls over the sole sidebar terminal provider; owns no PTYs. */
export class SidebarTerminalController extends TypertRemoteService {
  static inject = ['typert', 'sidebarTerminals']
  private readonly lifetime = new AbortController()
  private readonly streams = new Set<() => Promise<void>>()

  constructor(ctx: Context) {
    super(ctx, 'sidebarTerminalController', { namespace: 'sidebarTerminals' })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.all([...this.streams].map(close => close()))
    }, 'sidebar-terminal-controller.streams')
  }

  /** Query native terminal availability.
   * @returns Availability without opening a terminal.
   */
  @Remote
  capability(): SidebarTerminalCapability {
    return this.invoke(() => this.ctx.sidebarTerminals.capability())
  }

  /** Discover installed local shells for a new UI tab.
   * @returns Verified executable paths and display names; does not create a process.
   */
  @Remote
  shells(): readonly SidebarTerminalShell[] {
    return this.invoke(() => this.ctx.sidebarTerminals.shells())
  }

  /**
   * Attach to a terminal and forward acknowledged output without buffering it.
   * @param request - Immutable target and integer geometry from 1 through 1024.
   * @param signal - Attachment lifetime; disposal also cancels and closes the provider iterator.
   * @returns Provider frames; operational failures use sidebarTerminals error codes.
   */
  @Remote({ mode: 'stream' })
  open(request: SidebarTerminalOpenRequest, signal: AbortSignal): AsyncIterable<SidebarTerminalFrame> {
    return this.stream(signal, (lifetime) => {
      validateOpen(request)
      return this.ctx.sidebarTerminals.open(request, lifetime)
    })
  }

  /** Forward input to the attached native process.
   * @param request - Live attachment and at most 64 KiB of UTF-8 input.
   */
  @Remote
  input(request: SidebarTerminalInputRequest): void {
    this.invoke(() => { validateInput(request); this.ctx.sidebarTerminals.input(request) })
  }

  /** Resize the attached native process.
   * @param request - Live attachment and integer geometry from 1 through 1024.
   */
  @Remote
  resize(request: SidebarTerminalResizeRequest): void {
    this.invoke(() => { validateResize(request); this.ctx.sidebarTerminals.resize(request) })
  }

  /** Acknowledge output consumed by the renderer.
   * @param request - Live attachment and highest rendered nonnegative safe sequence.
   */
  @Remote
  ack(request: SidebarTerminalAckRequest): void {
    this.invoke(() => { validateAck(request); this.ctx.sidebarTerminals.ack(request) })
  }

  /** Release the attachment with its requested disposition.
   * @param request - Attachment to disconnect, park, or close.
   */
  @Remote
  release(request: SidebarTerminalReleaseRequest): void {
    this.invoke(() => { validateRelease(request); this.ctx.sidebarTerminals.release(request) })
  }

  /** Observe an existing UI process without spawning or extending lifetime.
   * @param request - Existing UI tab.
   * @returns Its native generation or null.
   */
  @Remote
  inspectUi(request: SidebarTerminalUiTarget): SidebarTerminalProcessId | null {
    return this.invoke(() => { validateInspectUi(request); return this.ctx.sidebarTerminals.inspectUi(request) })
  }

  /** Close only the observed UI process generation.
   * @param request - Exact previously observed process; replacements cannot be closed by a stale request.
   */
  @Remote
  closeUi(request: SidebarTerminalCloseUiRequest): void {
    this.invoke(() => { validateCloseUi(request); this.ctx.sidebarTerminals.closeUi(request) })
  }

  /**
   * Observe the agent terminals owned by one Session.
   * @param sessionId - Nonempty opaque Session identity.
   * @param signal - Consumer lifetime; disposal also cancels and closes the provider iterator.
   * @returns Complete current lists and subsequent provider snapshots.
   */
  @Remote({ mode: 'stream' })
  watch(sessionId: SidebarTerminalSessionId, signal: AbortSignal): AsyncIterable<readonly SidebarAgentTerminalSnapshot[]> {
    return this.stream(signal, (lifetime) => {
      validateSessionId(sessionId)
      return this.ctx.sidebarTerminals.watch(sessionId, lifetime)
    })
  }

  /** Close the identified agent terminal.
   * @param uuid - Lowercase UUID of an agent terminal explicitly closed by the user.
   */
  @Remote
  closeAgent(uuid: SidebarAgentTerminalId): void {
    this.invoke(() => { validateAgentId(uuid); this.ctx.sidebarTerminals.closeAgent(uuid) })
  }

  private invoke<T>(operation: () => T): T {
    this.lifetime.signal.throwIfAborted()
    try { return operation() } catch (error) { throw terminalFailure(error) }
  }

  private async *stream<T>(signal: AbortSignal, operation: (signal: AbortSignal) => AsyncIterable<T>): AsyncIterable<T> {
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    lifetime.throwIfAborted()
    try {
      const iterator = operation(lifetime)[Symbol.asyncIterator]()
      let closing: Promise<void> | undefined
      const close = (): Promise<void> => closing ??= Promise.resolve().then(async () => { await iterator.return?.() })
      this.streams.add(close)
      try {
        while (true) {
          lifetime.throwIfAborted()
          const next = await iterator.next()
          lifetime.throwIfAborted()
          if (next.done === true) return
          yield next.value
        }
      } finally {
        try { await close() } finally { this.streams.delete(close) }
      }
    } catch (error) {
      lifetime.throwIfAborted()
      throw terminalFailure(error)
    }
  }
}

export default SidebarTerminalController
