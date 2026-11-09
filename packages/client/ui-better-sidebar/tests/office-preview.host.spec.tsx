/** Office files use the real registry and Files host; the converter is the transport boundary. */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '../src/context-types.ts'
import { EditorHost } from '../src/client/EditorHost.tsx'
import { builtinViewers } from '../src/client/builtins/viewers.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { attachLocale } from '../src/client/locales.ts'
import { OfficePreview } from '../src/client/office/OfficePreview.tsx'
import { createOfficeReader, OfficePreviewError, type OfficePreviewFile, type ReadOfficePreview } from '../src/client/office/read-office.ts'

const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
const file: OfficePreviewFile = { data: btoa(pdf), missingFonts: [] }
const originalCreateUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const createUrl = vi.fn<(blob: Blob) => string>()
const revokeUrl = vi.fn<(url: string) => void>()
const unmounts: (() => void)[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  attachLocale({ getSnapshot: () => ({ active: 'en' }) })
  createUrl.mockReset().mockImplementation(() => `blob:office-${createUrl.mock.calls.length}`)
  revokeUrl.mockReset()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl })
})

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount()
  if (originalCreateUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateUrl)
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevokeUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeUrl)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
  attachLocale(undefined)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mount(element: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let disposed = false
  const unmount = () => {
    if (disposed) return
    disposed = true
    act(() => { root.unmount() })
    container.remove()
  }
  unmounts.push(unmount)
  const render = async (next: ReactElement) => { await act(async () => { root.render(next) }) }
  await render(element)
  return { container, render, unmount }
}

function preview(read?: ReadOfficePreview, path = '/workspace/report.docx') {
  return createElement(OfficePreview, { read, scope: { sessionId: 'office-session' }, path, title: path.split('/').at(-1)! })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Office previews in Files', () => {
  it.each(['docx', 'xlsx', 'pptx'])('opens a %s through the registry and EditorHost as PDF', async (extension) => {
    const read = vi.fn<ReadOfficePreview>().mockResolvedValue(file)
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    for (const viewer of builtinViewers(undefined, read)) service.registerFileViewer(viewer)
    const path = `/workspace/report.${extension}`
    const { container, unmount } = await mount(createElement(EditorHost, {
      ctx: { betterSidebar: service } as Context, store, scope: { sessionId: 'office-session' },
      tab: { id: 'file', type: 'editor', path, title: `report.${extension}` },
      expanded: [], onToggleDir: () => {}, onReferenceFile: () => {},
    }))
    const iframe = container.querySelector('iframe')
    expect(read).toHaveBeenCalledWith('office-session', path, expect.any(AbortSignal))
    expect(iframe?.getAttribute('src')).toBe('blob:office-1')
    expect(iframe?.title).toBe(`report.${extension}`)
    const blob = createUrl.mock.calls.at(0)![0]
    expect(blob.type).toBe('application/pdf')
    const bytes = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => { resolve(reader.result as string) }
      reader.onerror = reject
      reader.readAsText(blob)
    })
    expect(bytes).toBe(pdf)
    const download = container.querySelector<HTMLAnchorElement>('a[download]')!
    expect(new URL(download.href).searchParams.get('path')).toBe(path)
    expect(container.querySelector('[data-office-preview]')?.getAttribute('data-office-preview')).toBe('ready')
    unmount()
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:office-1')
    expect(read.mock.calls.at(0)![2].aborted).toBe(true)
  })

  it('shows missing fonts without replacing or hiding the preview', async () => {
    const { container } = await mount(preview(async () => ({ ...file, missingFonts: ['Missing Serif', 'Missing Sans'] })))
    expect(container.querySelector('summary')?.textContent).toBe('2 fonts unavailable; layout may differ')
    expect(Array.from(container.querySelectorAll('li')).map(item => item.textContent)).toEqual(['Missing Serif', 'Missing Sans'])
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(container).toMatchSnapshot('Office preview with missing fonts')
  })

  it('keeps converter failure copy localized and retries the same source', async () => {
    const read = vi.fn<ReadOfficePreview>().mockRejectedValueOnce(new OfficePreviewError('officeInvalid')).mockResolvedValue(file)
    const mounted = await mount(preview(read))
    expect(mounted.container.querySelector('[role=alert]')?.textContent).toContain('password protected')
    attachLocale({ getSnapshot: () => ({ active: 'zh' }) })
    await mounted.render(preview(read))
    expect(mounted.container.querySelector('[role=alert]')?.textContent).toContain('受密码保护')
    await act(async () => { mounted.container.querySelector('button')!.click() })
    expect(read).toHaveBeenCalledTimes(2)
    expect(mounted.container.querySelector('iframe')).not.toBeNull()
  })

  it('cancels a replaced file and ignores a late conversion after unmount', async () => {
    const first = deferred<OfficePreviewFile>()
    const second = deferred<OfficePreviewFile>()
    const read = vi.fn<ReadOfficePreview>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const mounted = await mount(preview(read))
    expect(mounted.container.querySelector('[role=status]')?.textContent).toBe('Preparing Office preview…')
    expect(mounted.container.querySelector('button')?.disabled).toBe(true)
    await mounted.render(preview(read, '/workspace/slides.pptx'))
    expect(read.mock.calls.at(0)![2].aborted).toBe(true)
    mounted.unmount()
    expect(read.mock.calls.at(1)![2].aborted).toBe(true)
    await act(async () => { first.resolve(file); second.resolve(file) })
    expect(createUrl).not.toHaveBeenCalled()
    expect(revokeUrl).not.toHaveBeenCalled()
  })

  it('releases the previous PDF before refreshing and offers download without a converter', async () => {
    const read = vi.fn<ReadOfficePreview>().mockResolvedValue(file)
    const mounted = await mount(preview(read))
    await act(async () => { mounted.container.querySelector('button')!.click() })
    expect(revokeUrl).toHaveBeenCalledWith('blob:office-1')
    expect(mounted.container.querySelector('iframe')?.src).toBe('blob:office-2')
    await mounted.render(preview(undefined, '/workspace/unavailable.xlsx'))
    expect(revokeUrl).toHaveBeenCalledWith('blob:office-2')
    expect(mounted.container.querySelector('[role=alert]')?.textContent).toContain('Office previews are unavailable')
    expect(mounted.container.querySelector('a[download]')?.textContent).toBe('Download original')
  })

  it('contains browser rendering failures inside the file and retries', async () => {
    const createElement = document.createElement.bind(document)
    let rendererUnavailable = true
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
      if (tag === 'iframe' && rendererUnavailable) throw new Error('PDF frame unavailable')
      return createElement(tag, options)
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const read = vi.fn<ReadOfficePreview>().mockResolvedValue(file)
    const { container } = await mount(preview(read))
    expect(container.querySelector('[role=alert]')?.textContent).toContain('did not produce a usable preview')
    expect(container.querySelector('a[download]')).not.toBeNull()
    expect(revokeUrl).toHaveBeenCalledWith('blob:office-1')
    expect(report).toHaveBeenCalled()
    rendererUnavailable = false
    await act(async () => { container.querySelector('button')!.click() })
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('keeps tab dragging usable over the native PDF frame', async () => {
    const { container } = await mount(preview(async () => file))
    const iframe = container.querySelector('iframe')!
    document.dispatchEvent(new Event('dragstart', { bubbles: true }))
    expect(iframe.style.pointerEvents).toBe('none')
    document.dispatchEvent(new Event('drop', { bubbles: true }))
    expect(iframe.style.pointerEvents).toBe('')
  })
})

describe('Office Remote reader', () => {
  it('requests foreground conversion with the owning Session and cancellation signal', async () => {
    const render = vi.fn().mockResolvedValue({ ok: true, value: file })
    const signal = new AbortController().signal
    const read = createOfficeReader({ render } as Parameters<typeof createOfficeReader>[0])
    expect(await read('office-session', 'report.docx', signal)).toEqual(file)
    expect(render).toHaveBeenCalledExactlyOnceWith('office-session', 'report.docx', 'foreground', signal)
  })

  it.each([
    ['document-render/failed', { reason: 'invalid-document' }, 'officeInvalid'],
    ['document-render/failed', { reason: 'busy' }, 'officeBusy'],
    ['document-render/failed', { reason: 'timeout' }, 'officeTimeout'],
    ['document-render/failed', { reason: 'source-changed' }, 'officeChanged'],
    ['document-render/failed', { reason: 'input-too-large' }, 'officeTooLarge'],
    ['workspace-file/not-found', {}, 'officeNotFound'],
    ['workspace-file/outside-workspace', {}, 'officeOutsideWorkspace'],
    ['gateway/service-unavailable', {}, 'officeUnavailable'],
  ])('reports %s %j as localized recovery', async (code, details, key) => {
    const remote = { render: async () => ({ ok: false, error: { code, details } }) }
    const read = createOfficeReader(remote as unknown as Parameters<typeof createOfficeReader>[0])
    await expect(read('office-session', 'report.docx', new AbortController().signal)).rejects.toMatchObject({ key })
  })
})
