/** Browser-owned image and page values used by capture consumer tests. */
import type {
  BrowserElementCaptureValue, BrowserElementSelectionValue, BrowserPagesValue,
} from '@deepseek-ai/dsh-api-remotes/client'

/** A page-local one-use selection returned after human input. */
export const selection: BrowserElementSelectionValue = {
  pageId: 'capture-page' as BrowserElementSelectionValue['pageId'],
  selectionId: 'capture-selection' as BrowserElementSelectionValue['selectionId'],
  tagName: 'BUTTON', role: 'button', name: 'Capture', text: 'Capture',
  rect: { x: 0, y: 0, width: 1, height: 1 },
}

/** A canonical one-pixel PNG already checked by the Host. */
export const capture: BrowserElementCaptureValue = {
  pageId: selection.pageId, selectionId: selection.selectionId, verified: true,
  image: {
    attachmentId: 'capture-image' as BrowserElementCaptureValue['image']['attachmentId'],
    mediaType: 'image/png', bytes: 68, width: 1, height: 1, name: 'browser-element.png',
  },
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=',
}

/** The existing native page list; it contains no browser filesystem paths. */
export const pages: BrowserPagesValue = {
  profileName: 'default', maxFileBytes: 1024,
  pages: [{ pageId: selection.pageId, index: 0, title: 'Documentation', url: 'https://example.test/docs', active: true }],
}
