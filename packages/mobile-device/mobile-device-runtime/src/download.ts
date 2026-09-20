/** Bounded official archive transport with exact bytes and SHA-256 verification. */
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { fetch, ProxyAgent } from 'undici'
import type { MobileResourceDefinition } from './types.ts'
/** Download only the catalog URL and validate its complete contents before extraction.
 * @param definition - Reviewed release bytes and digest.
 * @param destination - Exclusive private archive file.
 * @param proxyUrl - Explicit proxy choice, empty for direct transport.
 * @param signal - Host task deadline or explicit cancellation.
 * @param progress - Numeric received bytes; owned callback must not throw.
 */
export async function downloadArchive(definition: MobileResourceDefinition, destination: string, proxyUrl: string,
  signal: AbortSignal, progress: (bytes: number) => void): Promise<void> {
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    const response = await fetch(definition.url, { signal, ...(dispatcher ? { dispatcher } : {}) })
    if (!response.ok || !response.body) throw new Error('Official resource download failed')
    const length = response.headers.get('content-length')
    if (length !== null && Number(length) !== definition.bytes) { await response.body.cancel(); throw new Error('Resource size differs from release metadata') }
    file = await open(destination, 'wx', 0o600)
    const hash = createHash('sha256')
    let count = 0
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      signal.throwIfAborted()
      count += chunk.byteLength
      if (count > definition.bytes) throw new Error('Resource download exceeds pinned byte limit')
      hash.update(chunk)
      await file.writeFile(chunk)
      progress(count)
    }
    if (count !== definition.bytes || hash.digest('hex') !== definition.sha256) throw new Error('Resource checksum verification failed')
  } finally {
    await file?.close()
    await dispatcher?.close()
  }
}
