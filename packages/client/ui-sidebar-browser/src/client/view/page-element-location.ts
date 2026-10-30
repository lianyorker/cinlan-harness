/** Resolve saved selectors against the currently readable Browser page. */
import type { InspectedElementData } from './element-inspector-utils.ts'
import { locateNativeElement } from './native-design.ts'

/**
 * Locate one matching visible element without using recorded coordinates.
 * @param viewportId - Browser-owned container.
 * @param element - recorded URL, selector and element identity.
 * @returns current window coordinates or null for changed, unreadable or clipped targets.
 */
export async function locatePageElement(viewportId: string, element: InspectedElementData): Promise<InspectedElementData['rect'] | null> {
  const host = document.getElementById(viewportId)
  const frame = host?.querySelector('iframe')
  const rect = frame ? locateIframeElement(frame, element) : await locateNativeElement(viewportId, element)
  if (!host || !rect || rect.x < 0 || rect.y < 0 || rect.x >= window.innerWidth || rect.y >= window.innerHeight) return null
  for (let ancestor = host.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX || style.overflow)
    const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY || style.overflow)
    if (!clipsX && !clipsY) continue
    const bounds = ancestor.getBoundingClientRect()
    if ((clipsX && (rect.x < bounds.left || rect.x >= bounds.right))
      || (clipsY && (rect.y < bounds.top || rect.y >= bounds.bottom))) return null
  }
  return rect
}

function locateIframeElement(frame: HTMLIFrameElement, element: InspectedElementData): InspectedElementData['rect'] | null {
  try {
    const doc = frame.contentDocument
    if (!doc || doc.URL !== element.pageUrl || doc.readyState !== 'complete') return null
    const matches = doc.querySelectorAll(element.selector)
    const target = matches.length === 1 ? matches.item(0) : null
    if (!target || target.tagName !== element.tagName
      || (element.text && target.textContent.trim().replace(/\s+/g, ' ').slice(0, 150) !== element.text)) return null
    const rect = target.getBoundingClientRect()
    const bounds = frame.getBoundingClientRect()
    if (frame.offsetWidth <= 0 || frame.offsetHeight <= 0 || rect.width <= 0 || rect.height <= 0
      || rect.x < 0 || rect.y < 0 || rect.x >= frame.clientWidth || rect.y >= frame.clientHeight) return null
    const sx = bounds.width / frame.offsetWidth
    const sy = bounds.height / frame.offsetHeight
    if (sx <= 0 || sy <= 0) return null
    return { x: bounds.x + (frame.clientLeft + rect.x) * sx, y: bounds.y + (frame.clientTop + rect.y) * sy,
      width: rect.width * sx, height: rect.height * sy }
  } catch (_error) {
    // Cross-origin documents and obsolete selectors have no current location.
    return null
  }
}
