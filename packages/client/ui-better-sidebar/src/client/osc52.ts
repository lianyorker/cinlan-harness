import type { IDisposable, Terminal } from '@xterm/xterm'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

const MAX_CLIPBOARD_BYTES = 1024 * 1024

/** Register a bounded OSC 52 clipboard writer whose permission is read live. */
export function registerOsc52(terminal: Terminal, isAllowed: () => boolean): IDisposable {
  return terminal.parser.registerOscHandler(52, (data) => {
    if (isAllowed()) {
      const text = decodeOsc52(data)
      if (text !== undefined) void writeClipboard(text)
    }
    return true
  })
}

function decodeOsc52(data: string): string | undefined {
  const separator = data.indexOf(';')
  if (separator < 0 || !/^(?:c|0|1)$/u.test(data.slice(0, separator))) return
  const encoded = data.slice(separator + 1)
  if (encoded === '?') return
  if (encoded.length > Math.ceil(MAX_CLIPBOARD_BYTES / 3) * 4) return
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) return
  try {
    const binary = atob(encoded)
    if (binary.length > MAX_CLIPBOARD_BYTES) return
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return
  }
}
