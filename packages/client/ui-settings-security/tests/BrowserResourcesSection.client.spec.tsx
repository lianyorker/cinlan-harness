// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { BrowserResourcesSection, type BrowserResourcesProps } from '../src/client/BrowserResourcesSection.tsx'
import type { BrowserResourceRead } from '../src/client/browser-resources.ts'
import { browserEn, browserZh } from '../src/client/browser-locales.ts'
import { en, zh } from '../src/client/locales.ts'
import { runtimeStatus, runtimeTask } from './browser-runtime-fixture.ts'

afterEach(cleanup)
function mount(value: BrowserResourceRead = { status: 'ready', value: runtimeStatus() }, language: 'en' | 'zh' = 'en') {
  let snapshot = value
  const release = vi.fn()
  const props: BrowserResourcesProps = {
    useBrowserResources: selector => selector(snapshot), watchBrowserResources: vi.fn(() => release),
    refreshBrowserResources: vi.fn(), runBrowserResource: vi.fn(async () => {}), cancelBrowserResource: vi.fn(async () => {}),
    closeBrowserRuntime: vi.fn(async () => {}),
    t: language === 'en' ? makeTranslate({ ...en, ...browserEn }, commonEn) : makeTranslate({ ...zh, ...browserZh }, commonZh),
  }
  const view = render(<BrowserResourcesSection {...props} />)
  return { ...view, props, release, publish(next: BrowserResourceRead) {
    snapshot = next; view.rerender(<BrowserResourcesSection {...props} />)
  } }
}
const ready = () => runtimeStatus({ installed: true, managedInstalled: true })

describe('Native Browser runtime resources', () => {
  it.each(['en', 'zh'] as const)('starts installation only after an explicit %s action', async (language) => {
    const b = mount(undefined, language)
    const copy = language === 'en' ? browserEn : browserZh
    expect(b.props.runBrowserResource).not.toHaveBeenCalled()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText(copy.browserRuntimeActivation)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: copy.browserRuntimeInstall }))
    await waitFor(() => { expect(b.props.runBrowserResource).toHaveBeenCalledExactlyOnceWith('install') })
    expect(screen.queryByText(copy.browserRuntimeReady)).toBeNull()
    b.publish({ status: 'ready', value: ready() })
    expect(screen.getAllByText(copy.browserRuntimeReady)).toHaveLength(2)
  })

  it('shows loading and read failure while inactive plugins retain asset management', () => {
    const b = mount({ status: 'loading' })
    expect(screen.getByRole('status').textContent).toBe(browserEn.browserRuntimeLoading)
    b.publish({ status: 'ready', value: runtimeStatus({ providerActive: false }) })
    expect(screen.getByRole('status').textContent).toBe(browserEn.browserRuntimeInactive)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: browserEn.browserRuntimeInstall }).disabled).toBe(false)
    b.publish({ status: 'error' })
    expect(screen.getByRole('alert').textContent).toBe(browserEn.browserRuntimeReadFailed)
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeRefresh }))
    expect(b.props.refreshBrowserResources).toHaveBeenCalledOnce()
  })

  it('distinguishes system and custom browsers from managed assets without exposing private paths or URLs', () => {
    const b = mount({ status: 'ready', value: runtimeStatus({ installed: true, source: 'system', channel: 'chrome',
      executablePath: 'private-executable-path', downloadOrigins: ['https://download.invalid/archive?token=secret'] }) })
    expect(screen.getByText(browserEn.browserRuntimeSystem)).toBeTruthy()
    expect(screen.getByText(browserEn.browserRuntimeOtherSource)).toBeTruthy()
    expect(screen.queryByText('private-executable-path')).toBeNull()
    expect(b.container.textContent).not.toContain('token=secret')
    expect(screen.queryByRole('button', { name: browserEn.browserRuntimeRemove })).toBeNull()
    b.publish({ status: 'ready', value: runtimeStatus({ source: 'custom', channel: 'msedge' }) })
    expect(screen.getByText(browserEn.browserRuntimeCustom)).toBeTruthy()
  })

  it('repairs explicitly and confirms removal, including retry of a failed removal', async () => {
    const b = mount({ status: 'ready', value: ready() })
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeRepair }))
    await waitFor(() => { expect(b.props.runBrowserResource).toHaveBeenCalledExactlyOnceWith('reinstall') })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: browserEn.browserRuntimeRemove }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeRemove }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: browserEn.browserRuntimeKeep }))
    expect(b.props.runBrowserResource).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeRemove }))
    vi.mocked(b.props.runBrowserResource).mockRejectedValueOnce(new Error('secret remote detail'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: browserEn.browserRuntimeRemove }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', browserEn.browserRuntimeActionFailed)
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeRetry }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(b.props.runBrowserResource).toHaveBeenCalledTimes(2)
  })

  it.each(['starting', 'running'] as const)('refuses repair and removal while the browser is %s', (state) => {
    const b = mount({ status: 'ready', value: { ...ready(), browserState: state } })
    for (const name of [browserEn.browserRuntimeRepair, browserEn.browserRuntimeRemove]) {
      const button = screen.getByRole<HTMLButtonElement>('button', { name })
      expect(button.disabled).toBe(true); fireEvent.click(button)
    }
    expect(b.props.runBrowserResource).not.toHaveBeenCalled()
    expect(screen.getByText(browserEn.browserRuntimeStopFirst)).toBeTruthy()
  })

  it('cancels the observed task, supports unknown progress, and blocks commit cancellation', async () => {
    const b = mount({ status: 'ready', value: runtimeStatus({ task: runtimeTask() }) })
    expect(screen.getByRole<HTMLProgressElement>('progressbar').value).toBe(40)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: browserEn.browserRuntimeInstall }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeCancel }))
    await waitFor(() => { expect(b.props.cancelBrowserResource).toHaveBeenCalledExactlyOnceWith(runtimeTask().taskId) })
    b.publish({ status: 'ready', value: runtimeStatus({ task: runtimeTask({ phase: 'committing', progressPercent: null }) }) })
    expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: browserEn.browserRuntimeCancel }).disabled).toBe(true)
    b.unmount()
    expect(b.release).toHaveBeenCalledOnce()
    expect(b.props.cancelBrowserResource).toHaveBeenCalledOnce()
  })

  it('retains committed resources after a failed repair and retries the Host operation', async () => {
    const b = mount({ status: 'ready', value: { ...ready(), task: runtimeTask({ operation: 'reinstall', state: 'failed', errorCode: 'download-failed' }) } })
    expect(screen.getByRole('alert').textContent).toBe(browserEn.browserRuntimeTaskFailed)
    expect(screen.getAllByText(browserEn.browserRuntimeReady)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeRetry }))
    await waitFor(() => { expect(b.props.runBrowserResource).toHaveBeenCalledExactlyOnceWith('reinstall') })
    b.publish({ status: 'ready', value: { ...ready(), task: runtimeTask({ state: 'cancelled' }) } })
    expect(screen.getByRole('status').textContent).toBe(browserEn.browserRuntimeCancelled)
    b.publish({ status: 'ready', value: { ...ready(), task: runtimeTask({ state: 'succeeded', phase: 'complete' }) } })
    expect(screen.getByRole('status').textContent).toBe(browserEn.browserRuntimeComplete)
  })

  it('keeps runtime mutations single-flight while a start request is pending', async () => {
    const b = mount({ status: 'ready', value: runtimeStatus({ providerActive: false }) })
    let resolve!: () => void
    const request = new Promise<void>((done) => { resolve = done })
    vi.mocked(b.props.runBrowserResource).mockReturnValueOnce(request)
    const button = screen.getByRole<HTMLButtonElement>('button', { name: browserEn.browserRuntimeInstall })
    fireEvent.click(button); fireEvent.click(button)
    expect(button.disabled).toBe(true)
    expect(b.props.runBrowserResource).toHaveBeenCalledExactlyOnceWith('install')
    await act(async () => { resolve(); await request })
    expect(button.disabled).toBe(false)
  })

  it('closes the persistent browser explicitly and waits for Host status before enabling repair', async () => {
    const b = mount({ status: 'ready', value: { ...ready(), browserState: 'running' } })
    expect(b.props.closeBrowserRuntime).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeStop }))
    await waitFor(() => { expect(b.props.closeBrowserRuntime).toHaveBeenCalledOnce() })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: browserEn.browserRuntimeRepair }).disabled).toBe(true)
    b.publish({ status: 'ready', value: ready() })
    expect(screen.queryByRole('button', { name: browserEn.browserRuntimeStop })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: browserEn.browserRuntimeRepair }).disabled).toBe(false)
    expect(b.props.runBrowserResource).not.toHaveBeenCalled()
  })

  it('blocks installation during an active browser and stale removal confirmation during a task', () => {
    const b = mount({ status: 'ready', value: runtimeStatus({ browserState: 'running' }) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: browserEn.browserRuntimeInstall }).disabled).toBe(true)
    b.publish({ status: 'ready', value: ready() })
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeRemove }))
    b.publish({ status: 'ready', value: { ...ready(), task: runtimeTask({ operation: 'reinstall' }) } })
    const confirm = within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', { name: browserEn.browserRuntimeRemove })
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(b.props.runBrowserResource).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: browserEn.browserRuntimeClose }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('localizes rejected cancellation and leaves explicit cancellation available', async () => {
    const b = mount({ status: 'ready', value: runtimeStatus({ task: runtimeTask({ phase: 'preparing' }) }) })
    vi.mocked(b.props.cancelBrowserResource).mockRejectedValueOnce(new Error('private network URL'))
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeCancel }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', browserEn.browserRuntimeActionFailed)
    expect(screen.queryByRole('button', { name: browserEn.browserRuntimeRetry })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: browserEn.browserRuntimeCancel }).disabled).toBe(false)
  })

  it('retries the current failed Host operation after a different earlier user request', async () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeInstall }))
    await waitFor(() => { expect(b.props.runBrowserResource).toHaveBeenCalledWith('install') })
    b.publish({ status: 'ready', value: { ...ready(), task: runtimeTask({ operation: 'remove', state: 'failed', errorCode: 'filesystem-failed' }) } })
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeRetry }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: browserEn.browserRuntimeRemove }))
    await waitFor(() => { expect(b.props.runBrowserResource).toHaveBeenLastCalledWith('remove') })
  })

  it('contains a late rejected request after navigation without cancelling the Host task', async () => {
    const b = mount()
    let reject!: (reason: Error) => void
    const request = new Promise<void>((_resolve, fail) => { reject = fail })
    vi.mocked(b.props.runBrowserResource).mockReturnValueOnce(request)
    fireEvent.click(screen.getByRole('button', { name: browserEn.browserRuntimeInstall }))
    b.unmount()
    await act(async () => { reject(new Error('late failure')); await request.catch(() => {}) })
    expect(b.release).toHaveBeenCalledOnce()
    expect(b.props.cancelBrowserResource).not.toHaveBeenCalled()
  })
})
