/** Private callbacks for the capture Settings entry; Session identity is explicit at draft intake. */
import type {
  BrowserElementCaptureCommand, BrowserElementCaptureValue, BrowserElementSelectionValue,
  BrowserPageId, BrowserPagesValue, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'

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
