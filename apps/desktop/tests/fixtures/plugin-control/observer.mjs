/** Probes only the fixed acceptance fixture and the installed production Office provider. */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

export const inject = ['connection', 'officeToPdf']

export function apply(ctx) {
  ctx.connection.fetch.register({
    path: '/api/desktop-acceptance/probe',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => {
      const marker = ctx.get('desktopAcceptanceMarker')
      return Response.json({ hostPid: process.pid, active: marker !== undefined, marker: marker ?? null })
    },
  })
  ctx.connection.fetch.register({
    path: '/api/desktop-acceptance/office',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)])
      const source = new URL('./sample.docx.base64', import.meta.url)
      if ((await stat(source)).size > 16_384) throw new Error('Office fixture exceeds the fixed test limit')
      const encoded = await readFile(source, { encoding: 'utf8', signal })
      const fixture = Buffer.from(encoded.trim(), 'base64')
      if (fixture.length === 0 || fixture.length > 12_288) throw new Error('Office fixture is empty or oversized')
      const fingerprint = createHash('sha256').update(fixture).digest('hex')
      const result = await ctx.officeToPdf.convert({
        extension: 'docx', priority: 'foreground', source: {
          key: 'desktop-acceptance-office', version: fingerprint, bytes: fixture.length,
          read: async (upstream, maxBytes) => {
            upstream.throwIfAborted()
            if (fixture.length > maxBytes) throw new Error('Office fixture exceeds provider admission')
            return { bytes: fixture, version: fingerprint }
          },
        },
      }, signal)
      signal.throwIfAborted()
      if (result.pdf.byteLength > 1_048_576) throw new Error('Office fixture PDF exceeds one MiB')
      return new Response(result.pdf, { headers: {
        'content-type': 'application/pdf', 'content-length': String(result.pdf.byteLength),
        'x-desktop-host-pid': String(process.pid), 'x-desktop-office-source-sha256': fingerprint,
        'x-desktop-office-pdf-sha256': createHash('sha256').update(result.pdf).digest('hex'),
      } })
    },
  })
}
