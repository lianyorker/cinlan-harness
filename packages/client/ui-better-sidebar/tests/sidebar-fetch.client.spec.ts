/** Canonical sidebar URLs used by the production Client helpers. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, downloadUrl, htmlUrl, mediaUrl } from '../src/client/api.ts'
import { decodeHtmlUrl } from '../src/html-route.ts'

const scope = { sessionId: 'session fixture', cwd: '/workspace' }
afterEach(() => { vi.restoreAllMocks() })

describe('sidebar Client Fetch routing', () => {
  it('sends the Files listing and settings operations through canonical API URLs', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ ok: true, value: {} }))
    const lifetime = new AbortController()
    await api.fsTree(scope, '/workspace', lifetime.signal)
    expect(fetch).toHaveBeenLastCalledWith('/api/sidebar.api?method=fs.tree', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...scope, path: '/workspace' }), signal: lifetime.signal,
    })
    await api.settingsGet()
    expect(fetch.mock.lastCall?.[0]).toBe('/api/sidebar.api?method=settings.get')
    await api.settingsUpdate({ editorExplorer: true }, 7)
    expect(fetch.mock.lastCall?.[0]).toBe('/api/sidebar.api?method=settings.update')
    expect(JSON.parse(fetch.mock.lastCall?.[1]?.body as string)).toEqual({ patch: { editorExplorer: true }, expectedRevision: 7 })
  })

  it('uploads raw bytes with cancellation and encoded workspace scope', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ ok: true, value: { size: 3 } }))
    const body = new Blob(['abc'])
    const lifetime = new AbortController()
    await api.uploadFile(scope, '/workspace', 'folder/a b.txt', body, lifetime.signal)
    const [url, init] = fetch.mock.lastCall!
    if (typeof url !== 'string') throw new Error('Sidebar helper must supply a relative URL')
    const parsed = new URL(url, 'dsh-app://app')
    expect(parsed.pathname).toBe('/api/sidebar.upload')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ ...scope, dir: '/workspace', relativePath: 'folder/a b.txt' })
    expect(init?.body).toBe(body)
    expect(init?.signal).toBe(lifetime.signal)
  })

  it('routes media, downloads, and relative HTML assets through the Desktop API carrier', () => {
    const media = new URL(mediaUrl(scope, '/workspace/image #1.png'), 'dsh-app://app')
    expect(media.pathname).toBe('/api/sidebar.file')
    expect(media.searchParams.get('path')).toBe('/workspace/image #1.png')
    const download = new URL(downloadUrl(scope, '/workspace/file.pdf'), 'dsh-app://app')
    expect(download.pathname).toBe('/api/sidebar.file')
    expect(download.searchParams.get('download')).toBe('1')
    const document = new URL(htmlUrl(scope, '/workspace/site/index.html'), 'dsh-app://app')
    expect(document.pathname.startsWith('/api/sidebar/html/')).toBe(true)
    expect(decodeHtmlUrl(new URL('./image.png', document).pathname)).toEqual({
      ok: true, ref: { sessionId: scope.sessionId, path: '/workspace/site/image.png' },
    })
  })
})
