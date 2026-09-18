/**
 * Browser-safe codec for /api/sidebar/html/<session>/<absolute file path>.
 * Path segments retain Session scope when the browser resolves relative assets.
 * The decoder also accepts the original /sidebar/html Web alias. A double slash
 * after the Session id marks a UNC path; Windows drive paths keep their colon.
 * Host callers must apply requireAbsolute and the Session workspace fence.
 */

/** One decoded route reference. */
export interface HtmlRouteRef {
  sessionId: string
  /** Absolute file path (leading slash; Windows drives keep their colon). */
  path: string
}

/** Decode outcome: the reference, or a client-error description. */
export type HtmlDecodeResult =
  | { ok: true; ref: HtmlRouteRef }
  | { ok: false; status: 400 | 404; message: string }

/** The route prefix both encoders/decoders agree on. */
export const HTML_ROUTE_PREFIX = '/api/sidebar/html/'
const LEGACY_HTML_ROUTE_PREFIX = '/sidebar/html/'

/** Build the route URL for one absolute file path (client + tests). */
export function encodeHtmlUrl(sessionId: string, path: string): string {
  const unc = /^[\\/]{2}[^\\/]/.test(path)
  const segments = path.split(/[\\/]+/).filter(segment => segment !== '')
  return `${HTML_ROUTE_PREFIX}${encodeURIComponent(sessionId)}/${unc ? '/' : ''}${segments.map(encodeURIComponent).join('/')}`
}

/**
 * Decode a route pathname into the session + absolute file path. Rejects
 * a wrong prefix (404), an empty path, malformed percent encoding, and a
 * missing sessionId or file path (400). The caller still must bound the
 * decoded path with requireAbsolute + isWithin(cwd) — a decoded `..`
 * segment resolves outside the cwd and is refused there.
 */
export function decodeHtmlUrl(pathname: string): HtmlDecodeResult {
  const prefix = [HTML_ROUTE_PREFIX, LEGACY_HTML_ROUTE_PREFIX].find(value => pathname.startsWith(value))
  if (prefix === undefined) return { ok: false, status: 404, message: 'not an html route' }
  const rest = pathname.slice(prefix.length)
  if (rest === '') {
    return { ok: false, status: 400, message: 'invalid html route path' }
  }
  let segments: string[]
  try {
    segments = rest.split('/').map(segment => decodeURIComponent(segment))
  } catch {
    return { ok: false, status: 400, message: 'malformed URL encoding' }
  }
  const [sessionId, ...pathSegments] = segments
  if (sessionId === undefined || sessionId === '') {
    return { ok: false, status: 400, message: 'sessionId and file path are required' }
  }
  // An empty FIRST path segment is the UNC marker (encodeHtmlUrl emits
  // '<sid>//server/share/...' for UNC paths); the encoder filters empty
  // segments everywhere else, so an empty segment can only be the marker or
  // a malformed URL — both handled here.
  const unc = pathSegments[0] === ''
  const tail = unc ? pathSegments.slice(1) : pathSegments
  if (tail.length === 0 || tail.some(segment => segment === '')) {
    return { ok: false, status: 400, message: 'sessionId and file path are required' }
  }
  let path: string
  if (unc) {
    // Rebuild the platform-neutral forward-slash form `//server/share/...`;
    // requireAbsolute() resolves it to the platform's own UNC/POSIX spelling.
    path = `//${tail.join('/')}`
  } else if (/^[A-Za-z]:$/.test(tail[0] ?? '')) {
    // A Windows drive segment ('D:') is the FIRST path segment of an encoded
    // drive path. Rejoining it with a leading slash would yield '/D:/work/...'
    // which node's path.resolve() mangles into 'D:\D:\work\...' on Windows —
    // the html route's isWithin(cwd) fence would then reject every drive path.
    // Keep the drive form slash-free so requireAbsolute() resolves it verbatim.
    path = tail.join('/')
  } else {
    path = `/${tail.join('/')}`
  }
  return { ok: true, ref: { sessionId, path } }
}
