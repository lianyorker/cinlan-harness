// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { BrowserElementCaptureSection } from '../src/client/BrowserElementCaptureSection.tsx'
import type { BrowserElementCaptureSectionProps } from '../src/client/BrowserElementCaptureSection.tsx'
import type { CaptureInjected } from '../src/client/contract.ts'
import { en, zh, type BrowserElementCaptureKey } from '../src/client/locales.ts'
import { capture, pages, selection } from './fixtures.client.ts'

const css = readFileSync(resolve('packages/client/ui-browser-element-capture/src/client/BrowserElementCaptureSection.module.css'), 'utf8')
afterEach(cleanup)

async function fixture(dictionary: Record<BrowserElementCaptureKey, string> = en, withSession = true) {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  if (withSession) await runtime.sessions.add({ id: 'source', summary: { displayTitle: 'Source Session' } })
  const callbacks = {
    pages: vi.fn<CaptureInjected['pages']>().mockResolvedValue(pages),
    select: vi.fn<CaptureInjected['select']>().mockResolvedValue(selection),
    capture: vi.fn<CaptureInjected['capture']>().mockResolvedValue(capture),
    attach: vi.fn<CaptureInjected['attach']>(),
  }
  const props: BrowserElementCaptureSectionProps = {
    close: vi.fn(), t: makeTranslate(dictionary, {}),
    useSessions: bindSnapshotSelector(runtime.sessions.list),
    useSessionPendingInteraction: bindSnapshotSelector(runtime.ctx.uiSession.pendingInteractions),
    useWorkspaces: bindSnapshotSelector(runtime.workspaces.list),
    useResource: () => { throw new Error('Resource hook is not used by this fixture') },
    ...callbacks,
  }
  return { runtime, callbacks, props }
}

async function start(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  await screen.findByRole('option', { name: /Documentation/ })
  fireEvent.click(screen.getByRole('button', { name: en.select }))
}

describe('BrowserElementCaptureSection', () => {
  it('renders localized instructions and requires an existing Session for selection', async () => {
    const b = await fixture(zh, false)
    render(<BrowserElementCaptureSection {...b.props} />)
    expect(screen.getByRole('heading', { name: zh.title })).not.toBeNull()
    expect(screen.getByText(zh.safetyBody)).not.toBeNull()
    expect(screen.getByText(zh.sessionRequired)).not.toBeNull()
    expect((screen.getByRole('button', { name: zh.select }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    await screen.findByRole('option', { name: /Documentation/ })
    expect((screen.getByRole('button', { name: zh.select }) as HTMLButtonElement).disabled).toBe(true)
    expect(b.callbacks.select).not.toHaveBeenCalled()
  })

  it('previews the verified image and retains its original draft when the current Session changes', async () => {
    const b = await fixture()
    let resolveCapture!: (value: typeof capture) => void
    const pending = new Promise<typeof capture>((resolve) => { resolveCapture = resolve })
    b.callbacks.capture.mockReturnValueOnce(pending)
    render(<BrowserElementCaptureSection {...b.props} />)
    await start()
    await waitFor(() => { expect(b.callbacks.capture).toHaveBeenCalledOnce() })
    await b.runtime.sessions.add({ id: 'other', summary: { displayTitle: 'Other Session' } })
    await act(async () => { resolveCapture(capture); await pending })
    const image = await screen.findByRole('img', { name: en.previewAlt })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,' + capture.data)
    const attach = screen.getByRole('button', { name: en.attach }) as HTMLButtonElement
    expect(attach.disabled).toBe(true)
    fireEvent.load(image)
    expect(attach.disabled).toBe(false)
    b.callbacks.attach.mockImplementationOnce(() => { throw new Error('Draft admission is busy') })
    fireEvent.click(attach)
    expect(screen.getByRole('alert').textContent).toContain('Draft admission is busy')
    expect(screen.getByRole('img', { name: en.previewAlt })).toBe(image)
    fireEvent.click(attach)
    expect(b.callbacks.attach).toHaveBeenLastCalledWith('source', capture)
    expect(screen.getByRole('status').textContent).toContain('Source Session')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('aborts selection on Cancel and ignores its late result', async () => {
    const b = await fixture()
    let resolveSelection!: (value: typeof selection) => void
    const pending = new Promise<typeof selection>((resolve) => { resolveSelection = resolve })
    b.callbacks.select.mockReturnValueOnce(pending)
    render(<BrowserElementCaptureSection {...b.props} />)
    await start()
    expect(b.callbacks.select).toHaveBeenCalledOnce()
    const signal = b.callbacks.select.mock.calls[0]![1]
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(signal.aborted).toBe(true)
    await act(async () => { resolveSelection(selection); await pending })
    expect(screen.getByRole('status').textContent).toBe(en.cancelled)
    expect(b.callbacks.capture).not.toHaveBeenCalled()
    expect(b.callbacks.attach).not.toHaveBeenCalled()
  })

  it('keeps capture and preview failures visible and aborts work on unmount', async () => {
    const b = await fixture()
    b.callbacks.capture.mockRejectedValueOnce(new Error('Page closed'))
    const view = render(<BrowserElementCaptureSection {...b.props} />)
    await start()
    expect((await screen.findByRole('alert')).textContent).toContain('Page closed')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    const image = await screen.findByRole('img', { name: en.previewAlt })
    fireEvent.error(image)
    expect(screen.getByRole('alert').textContent).toBe(en.previewFailed)
    expect((screen.getByRole('button', { name: en.attach }) as HTMLButtonElement).disabled).toBe(true)
    let finish!: (value: typeof pages) => void
    const pending = new Promise<typeof pages>((resolve) => { finish = resolve })
    b.callbacks.pages.mockReturnValueOnce(pending)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    const signal = b.callbacks.pages.mock.calls.at(-1)![0]
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(pages); await pending })
    expect(b.callbacks.attach).not.toHaveBeenCalled()
  })

  it('uses semantic theme tokens without literal colors', () => {
    expect(css).toContain('var(--dsw-alias-label-primary)')
    expect(css).toContain('var(--dsw-alias-border-l2)')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(css).not.toMatch(/rgba?[(]/i)
  })
})
