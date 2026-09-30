import type { SessionId } from '@deepseek-ai/dsh-session/types'

export type BrowserPageId = string

export interface BrowserPagesValue {
  readonly pages: readonly {
    readonly pageId: BrowserPageId
    readonly url: string
    readonly title?: string
  }[]
}

export interface BrowserElementSelectionValue {
  readonly pageId: BrowserPageId
  readonly selectionId: string
  readonly tagName?: string
  readonly role?: string
  readonly name?: string
  readonly text?: string
  readonly rect?: { x: number; y: number; width: number; height: number }
}

export interface BrowserElementCaptureCommand {
  readonly pageId: BrowserPageId
  readonly selectionId: string
}

export interface BrowserElementCaptureValue {
  readonly pageId: BrowserPageId
  readonly selectionId: string
  readonly verified: boolean
  readonly image: {
    readonly attachmentId: string
    readonly mediaType: string
    readonly bytes: number
    readonly width: number
    readonly height: number
    readonly name?: string
  }
  readonly data: string
}

/** Operations injected by the capture plugin's apply closure. */
export interface CaptureInjected {
  /** List native pages after an explicit refresh. */
  pages(signal: AbortSignal): Promise<BrowserPagesValue>
  /** Wait for the human's one-use element selection. */
  select(pageId: BrowserPageId, signal: AbortSignal): Promise<BrowserElementSelectionValue>
  /** Capture a selected element and return verified canonical image bytes. */
  capture(request: BrowserElementCaptureCommand, signal: AbortSignal): Promise<BrowserElementCaptureValue>
  /** Append to the named existing draft; failures leave the preview available for retry. */
  attach(sessionId: SessionId, value: BrowserElementCaptureValue): void
}
