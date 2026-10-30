/** Fixed, read-only DOM requests against the Browser-owned Electron guest. */
import type { InspectedElementData } from './element-inspector-utils.ts'

interface NativePage extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>
  getURL(): string
  isLoading(): boolean
}

function nativePage(viewportId: string): NativePage | null {
  const element = document.getElementById(viewportId)?.querySelector('webview[data-sidebar-browser-frame]')
  if (!(element instanceof HTMLElement)) return null
  const guest = element as NativePage
  if (typeof guest.executeJavaScript !== 'function' || typeof guest.getURL !== 'function'
    || typeof guest.isLoading !== 'function') return null
  return guest
}

async function read(guest: NativePage, script: string): Promise<unknown> {
  const generation = { changed: false }
  const invalidate = () => { generation.changed = true }
  const events = ['did-start-navigation', 'did-navigate-in-page', 'destroyed']
  for (const event of events) guest.addEventListener(event, invalidate)
  try {
    const url = guest.getURL()
    if (!/^https?:/.test(url) || guest.isLoading()) return null
    const result: unknown = await guest.executeJavaScript(script)
    return generation.changed || !guest.isConnected || guest.isLoading() || guest.getURL() !== url ? null : result
  } catch (_error) {
    // A loading, navigated or destroyed guest has no usable snapshot.
    return null
  } finally {
    for (const event of events) guest.removeEventListener(event, invalidate)
  }
}

/**
 * Locate a recorded selector in the current native document.
 * @param viewportId - Browser-owned container.
 * @param element - recorded element identity and URL.
 * @returns current window coordinates, or null when the target cannot be verified.
 */
export async function locateNativeElement(viewportId: string, element: InspectedElementData): Promise<InspectedElementData['rect'] | null> {
  const guest = nativePage(viewportId)
  if (!guest || guest.getURL() !== element.pageUrl) return null
  const result = await read(guest, `(() => {
    const saved = ${JSON.stringify(element)};
    if (location.href !== saved.pageUrl) return null;
    const matches = document.querySelectorAll(saved.selector);
    const el = matches.length === 1 ? matches[0] : null;
    if (!el || el.tagName !== saved.tagName
      || (saved.text && (el.textContent || '').trim().replace(/\\s+/g,' ').slice(0,150) !== saved.text)) return null;
    const rect = el.getBoundingClientRect();
    if (rect.x < 0 || rect.y < 0 || rect.x >= innerWidth || rect.y >= innerHeight) return null;
    return {tagName:el.tagName, selector:saved.selector, pageUrl:location.href,
      rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
  })()` )
  const current = inspection(result)
  if (!current || guest.clientWidth <= 0 || guest.clientHeight <= 0) return null
  const bounds = guest.getBoundingClientRect()
  const sx = bounds.width / guest.clientWidth
  const sy = bounds.height / guest.clientHeight
  if (sx <= 0 || sy <= 0) return null
  return { x: bounds.x + current.rect.x * sx, y: bounds.y + current.rect.y * sy,
    width: current.rect.width * sx, height: current.rect.height * sy }
}

/**
 * Read a bounded HTML snapshot, without exposing an arbitrary-script callback.
 * @param viewportId - Browser-owned page container.
 * @returns current document HTML, or null when loading, inaccessible or over 2,097,152 characters.
 */
export async function readNativeHTML(viewportId: string): Promise<string | null> {
  const guest = nativePage(viewportId)
  if (!guest) return null
  const result = await read(guest, `(() => {
    if (document.readyState !== 'complete' || !/^https?:/.test(location.href) || !document.body?.innerHTML.trim()) return null;
    const html = document.documentElement.outerHTML;
    return html.length <= 2097152 ? html : null;
  })()`)
  return typeof result === 'string' && result.length > 0 && result.length <= 2097152 ? result : null
}

function inspection(value: unknown): InspectedElementData | null {
  if (!value || typeof value !== 'object' || !('tagName' in value) || typeof value.tagName !== 'string'
    || !('selector' in value) || typeof value.selector !== 'string'
    || !('pageUrl' in value) || typeof value.pageUrl !== 'string' || !/^https?:/.test(value.pageUrl)
    || !('rect' in value) || !value.rect || typeof value.rect !== 'object') return null
  const rect = value.rect
  if (!('x' in rect) || typeof rect.x !== 'number' || !Number.isFinite(rect.x)
    || !('y' in rect) || typeof rect.y !== 'number' || !Number.isFinite(rect.y)
    || !('width' in rect) || typeof rect.width !== 'number' || !Number.isFinite(rect.width) || rect.width <= 0
    || !('height' in rect) || typeof rect.height !== 'number' || !Number.isFinite(rect.height) || rect.height <= 0) return null
  return { tagName: value.tagName.slice(0, 128), selector: value.selector.slice(0, 4096), pageUrl: value.pageUrl,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    text: 'text' in value && typeof value.text === 'string' ? value.text.slice(0, 150) : undefined,
    ariaLabel: 'ariaLabel' in value && typeof value.ariaLabel === 'string' ? value.ariaLabel.slice(0, 300) : undefined,
    role: 'role' in value && typeof value.role === 'string' ? value.role.slice(0, 128) : undefined }
}

/**
 * Hit-test a real guest element using window coordinates.
 * @param viewportId - Browser-owned page container.
 * @param clientX - window pointer X coordinate.
 * @param clientY - window pointer Y coordinate.
 * @returns validated element details, never the Harness shell.
 */
export async function inspectNativeElement(viewportId: string, clientX: number, clientY: number): Promise<InspectedElementData | null> {
  const guest = nativePage(viewportId)
  if (!guest) return null
  const bounds = guest.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0 || guest.clientWidth <= 0 || guest.clientHeight <= 0) return null
  const x = (clientX - bounds.left) * guest.clientWidth / bounds.width
  const y = (clientY - bounds.top) * guest.clientHeight / bounds.height
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= guest.clientWidth || y >= guest.clientHeight) return null
  const result = await read(guest, `(() => {
    if (document.readyState !== 'complete') return null;
    const el = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)});
    if (!el || !document.body.contains(el) || ['IFRAME','WEBVIEW','INPUT','TEXTAREA'].includes(el.tagName)
      || el.closest('[contenteditable]')) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const parts = [];
    for (let node = el; node && parts.length < 64; node = node.parentElement) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      const siblings = node.parentElement ? [...node.parentElement.children].filter(s => s.tagName === node.tagName) : [node];
      parts.unshift(node.tagName.toLowerCase() + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : ''));
    }
    return {tagName:el.tagName,selector:parts.join(' > '),pageUrl:location.href,
      text:(el.textContent || '').trim().replace(/\\s+/g,' ').slice(0,150),
      ariaLabel:el.getAttribute('aria-label') || undefined,role:el.getAttribute('role') || undefined,
      rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
  })()`)
  return inspection(result)
}
