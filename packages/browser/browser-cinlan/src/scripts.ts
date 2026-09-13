/**
 * Plain-JavaScript source generators for `orca eval` scripts. Every script
 * runs inside the target page through the public CLI, so this module emits
 * literal ES2017-safe source text (no TypeScript, no host closures) with the
 * marker key embedded through `JSON.stringify` to stay quote-safe. Every
 * script resolves with a JSON-encoded element metadata string,
 * or the literal text `"null"` for cancellation or an unusable target, so
 * `orca eval`'s `result` field is always parseable JSON text.
 */

const FINGERPRINT_SNIPPET = `
function __dshFingerprint(node) {
  var tagName = node.tagName.toLowerCase();
  var role = node.getAttribute('role') || tagName;
  var name = node.getAttribute('aria-label') || node.getAttribute('title') || (node.textContent || '').trim().slice(0, 200);
  return { tagName: tagName, role: role, name: name, text: (node.textContent || '').trim().slice(0, 500) };
}
function __dshPayload(node, rect) {
  var fp = __dshFingerprint(node);
  return JSON.stringify({
    tagName: fp.tagName, role: fp.role, name: fp.name, text: fp.text,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: window.innerWidth, height: window.innerHeight }
  });
}
`

/**
 * Build the hover-overlay selection script. It shows a temporary highlight
 * that follows the pointer, marks the clicked element with a private data
 * attribute, and resolves with a JSON-encoded element metadata, or
 * the literal text `"null"` on Escape or an unusable target. `Escape` and an
 * external {@link clearOverlayScript} call both settle the same promise, so
 * only one caller ever waits on it.
 * @param key - Unique per-call marker used for the data attribute and the
 *   window-scoped cleanup handle.
 * @returns Complete script source for `orca eval --expression`.
 */
export function overlaySelectionScript(key: string): string {
  return `(function () {
  var key = ${JSON.stringify(key)};
  var attribute = 'data-dsh-browser-element';
  var overlayId = '__dsh_browser_element_capture_overlay__';
  ${FINGERPRINT_SNIPPET}
  var win = window;
  if (win.__dshBrowserElementCapture && win.__dshBrowserElementCapture.cleanup) win.__dshBrowserElementCapture.cleanup();
  return new Promise(function (resolve) {
    var overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.position = 'fixed';
    overlay.style.zIndex = '2147483647';
    overlay.style.pointerEvents = 'none';
    overlay.style.border = '2px solid #1677ff';
    overlay.style.background = 'rgba(22, 119, 255, 0.12)';
    overlay.style.boxSizing = 'border-box';
    overlay.style.display = 'none';
    document.documentElement.appendChild(overlay);
    var settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      if (win.__dshBrowserElementCapture && win.__dshBrowserElementCapture.key === key) delete win.__dshBrowserElementCapture;
      resolve(result);
    }
    function onMove(event) {
      if (!(event.target instanceof Element)) return;
      var hovered = event.target;
      var rect = hovered.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        overlay.style.display = 'block';
        overlay.style.left = rect.x + 'px';
        overlay.style.top = rect.y + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
      } else {
        overlay.style.display = 'none';
      }
    }
    function onClick(event) {
      if (!(event.target instanceof Element)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      var target = event.target;
      var rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) { finish('null'); return; }
      target.setAttribute(attribute, key);
      finish(__dshPayload(target, rect));
    }
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finish('null');
    }
    win.__dshBrowserElementCapture = { key: key, cleanup: function () { finish('null'); } };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
})()`
}

/**
 * Build the overlay-teardown script. Idempotent: it is a no-op when no
 * overlay for this exact key is active (already resolved, already cleared,
 * or the page navigated away and lost it naturally).
 * @param key - The exact key passed to {@link overlaySelectionScript}.
 * @returns Complete script source for `orca eval --expression`.
 */
export function clearOverlayScript(key: string): string {
  return `(function () {
  var key = ${JSON.stringify(key)};
  var win = window;
  if (win.__dshBrowserElementCapture && win.__dshBrowserElementCapture.key === key && win.__dshBrowserElementCapture.cleanup) {
    win.__dshBrowserElementCapture.cleanup();
  }
  return 'null';
})()`
}

/**
 * Build the best-effort marker-removal script used when selection or capture
 * fails before the marker can be consumed by a successful operation.
 * @param key - The exact key set by {@link overlaySelectionScript}.
 * @returns Complete script source for `orca eval --expression`.
 */
export function removeElementMarkerScript(key: string): string {
  return `(function () {
  var key = ${JSON.stringify(key)};
  var attribute = 'data-dsh-browser-element';
  var matches = document.querySelectorAll('[' + attribute + ']');
  for (var index = 0; index < matches.length; index += 1) {
    if (matches[index].getAttribute(attribute) === key) matches[index].removeAttribute(attribute);
  }
  return 'null';
})()`
}
/**
 * Build the marker re-verification script used before and after a viewport
 * screenshot. It requires the marker to identify exactly one visible element;
 * `removeMarker` strips the private data attribute once verification no
 * longer needs to relocate the element (the post-screenshot call).
 * @param key - The exact key set on the element by {@link overlaySelectionScript}.
 * @param removeMarker - Whether to remove the private marker attribute after reading it.
 * @returns Complete script source for `orca eval --expression`.
 */
export function verifyElementScript(key: string, removeMarker: boolean): string {
  return `(function () {
  var key = ${JSON.stringify(key)};
  var removeMarker = ${removeMarker ? 'true' : 'false'};
  var attribute = 'data-dsh-browser-element';
  ${FINGERPRINT_SNIPPET}
  var matches = document.querySelectorAll('[' + attribute + ']');
  var target = null;
  for (var index = 0; index < matches.length; index += 1) {
    if (matches[index].getAttribute(attribute) !== key) continue;
    if (target !== null) return 'null';
    target = matches[index];
  }
  if (target === null) return 'null';
  var rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 'null';
  var payload = __dshPayload(target, rect);
  if (removeMarker) target.removeAttribute(attribute);
  return payload;
})()`
}
