/** Pure browser-fixture observations shared with the Host-side browser driver. */
import type {
  SidebarTerminalAttachmentId, SidebarTerminalOpenRequest, SidebarTerminalReleaseRequest,
} from '@deepseek-ai/dsh-sidebar-terminals/types'

/** Callback observations exposed by the renderer fixture. */
export interface TerminalRendererFixture {
  requests: SidebarTerminalOpenRequest[]
  inputs: [SidebarTerminalAttachmentId, string][]
  resizes: [SidebarTerminalAttachmentId, number, number][]
  closes: SidebarTerminalReleaseRequest['mode'][]
  closed: SidebarTerminalReleaseRequest['mode'][]
  ready(): Promise<void>
  write(data: string): Promise<{ inputsAtCompletion: string; sequence: number }>
  invalidDirectory(): void
  capturedDirectory(): string | undefined
  unmount(action: 'close-tab' | 'switch-session' | 'keep-tab'): Promise<void>
}

declare global {
  interface Window { terminalRenderer: TerminalRendererFixture }
}
