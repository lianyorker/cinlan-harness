// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { MobileResourceRevision } from '@deepseek-ai/dsh-mobile-device-runtime/types'
import { MobileResourcesSection, type MobileResourcesProps } from '../src/client/MobileResourcesSection.tsx'
import type { MobileResourceRead } from '../src/client/mobile-resources.ts'
import { mobileEn, mobileZh } from '../src/client/mobile-locales.ts'
import { en, zh } from '../src/client/locales.ts'
import { mobileResource, mobileStatus, mobileTask, mirrorId } from './mobile-runtime-fixture.ts'

afterEach(cleanup)
function mount(value: MobileResourceRead = { status: 'ready', value: mobileStatus() }, language: 'en' | 'zh' = 'en') {
  let snapshot = value
  const release = vi.fn()
  const props: MobileResourcesProps = {
    useMobileResources: selector => selector(snapshot), watchMobileResources: vi.fn(() => release),
    refreshMobileResources: vi.fn(), runMobileResource: vi.fn(async () => {}), cancelMobileResource: vi.fn(async () => {}),
    startMobileMirror: vi.fn(async () => {}), closeMobileMirror: vi.fn(async () => {}),
    t: language === 'en' ? makeTranslate({ ...en, ...mobileEn }, commonEn) : makeTranslate({ ...zh, ...mobileZh }, commonZh),
  }
  const view = render(<MobileResourcesSection {...props} />)
  return { ...view, props, release, publish(next: MobileResourceRead) {
    snapshot = next; view.rerender(<MobileResourcesSection {...props} />)
  } }
}
const installed = () => mobileResource({ installedVersion: '35.0', installedPath: 'C:/managed/platform-tools', integrity: 'verified' })

describe('Android managed resources and explicit device mirroring', () => {
  it.each(['en', 'zh'] as const)('requires explicit license acceptance before installation in %s', async (language) => {
    const b = mount(undefined, language)
    const copy = language === 'en' ? mobileEn : mobileZh
    const install = screen.getByRole<HTMLButtonElement>('button', { name: copy.mobileResourcesInstall })
    expect(install.disabled).toBe(true)
    expect(b.props.runMobileResource).not.toHaveBeenCalled()
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.test/license')
    fireEvent.click(screen.getByRole('checkbox', { name: copy.mobileResourcesAcceptLicense }))
    fireEvent.click(install)
    await waitFor(() => { expect(b.props.runMobileResource).toHaveBeenCalledExactlyOnceWith({
      resourceId: 'platform-tools', operation: 'install', expectedRevision: mobileResource().revision, acceptLicense: true,
    }) })
    expect(screen.queryByText(copy.mobileResourcesVerified)).toBeNull()
    expect(screen.getByText(copy.mobileResourcesIosUnsupported)).toBeTruthy()
  })

  it('resets license acceptance when the observed resource revision changes', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('checkbox'))
    b.publish({ status: 'ready', value: mobileStatus({ resources: [mobileResource({ revision: 'revision-2' as MobileResourceRevision })] }) })
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: mobileEn.mobileResourcesInstall }).disabled).toBe(true)
  })

  it('repairs and updates explicitly and removes only after a revision-bound confirmation', async () => {
    const b = mount({ status: 'ready', value: mobileStatus({ resources: [{ ...installed(), updateAvailable: true }] }) })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: mobileEn.mobileResourcesRepair }))
    await waitFor(() => { expect(b.props.runMobileResource).toHaveBeenCalledWith(expect.objectContaining({ operation: 'reinstall' })) })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: mobileEn.mobileResourcesUpdate }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: mobileEn.mobileResourcesUpdate }))
    await waitFor(() => { expect(b.props.runMobileResource).toHaveBeenCalledWith(expect.objectContaining({ operation: 'update' })) })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: mobileEn.mobileResourcesRemove }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: mobileEn.mobileResourcesRemove }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: mobileEn.mobileResourcesKeep }))
    expect(b.props.runMobileResource).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: mobileEn.mobileResourcesRemove }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: mobileEn.mobileResourcesRemove }))
    await waitFor(() => { expect(b.props.runMobileResource).toHaveBeenLastCalledWith({ resourceId: 'platform-tools',
      operation: 'remove', expectedRevision: installed().revision, acceptLicense: false }) })
  })

  it('blocks leased and unsupported resources and stale removal while a task is active', () => {
    const b = mount({ status: 'ready', value: mobileStatus({ resources: [{ ...installed(), leased: true }] }) })
    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: mobileEn.mobileResourcesRemove }).disabled).toBe(true)
    b.publish({ status: 'ready', value: mobileStatus({ resources: [mobileResource({ supported: false })] }) })
    expect(screen.getByText(mobileEn.mobileResourcesUnsupported)).toBeTruthy()
    b.publish({ status: 'ready', value: mobileStatus({ resources: [installed()] }) })
    fireEvent.click(screen.getByRole('button', { name: mobileEn.mobileResourcesRemove }))
    b.publish({ status: 'ready', value: mobileStatus({ resources: [installed()], task: mobileTask() }) })
    const confirm = within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', { name: mobileEn.mobileResourcesRemove })
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(b.props.runMobileResource).not.toHaveBeenCalled()
  })

  it('cancels exactly the observed task and releases only observation on navigation', async () => {
    const b = mount({ status: 'ready', value: mobileStatus({ task: mobileTask() }) })
    expect(screen.getByRole<HTMLProgressElement>('progressbar').value).toBe(40)
    fireEvent.click(screen.getByRole('button', { name: mobileEn.mobileResourcesCancel }))
    await waitFor(() => { expect(b.props.cancelMobileResource).toHaveBeenCalledExactlyOnceWith(mobileTask().id) })
    b.publish({ status: 'ready', value: mobileStatus({ task: mobileTask({ phase: 'committing', totalBytes: 0 }) }) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: mobileEn.mobileResourcesCancel }).disabled).toBe(true)
    expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false)
    b.unmount()
    expect(b.release).toHaveBeenCalledOnce()
    expect(b.props.cancelMobileResource).toHaveBeenCalledOnce()
    expect(b.props.closeMobileMirror).not.toHaveBeenCalled()
  })

  it('requires an available selected Android device and closes the exact mirror process', async () => {
    const scrcpy = mobileResource({ ...installed(), definition: { ...mobileResource().definition, id: 'scrcpy' } })
    const status = mobileStatus({ resources: [scrcpy], devices: [
      { id: 'android:selected', serial: 'selected', state: 'device', available: true, transportId: '3' },
      { id: 'android:locked', serial: 'locked', state: 'unauthorized', available: false, transportId: '4' },
    ] })
    const b = mount({ status: 'ready', value: status })
    const start = screen.getByRole<HTMLButtonElement>('button', { name: mobileEn.mobileResourcesMirrorStart })
    expect(start.disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'android:selected' } })
    fireEvent.click(start)
    await waitFor(() => { expect(b.props.startMobileMirror).toHaveBeenCalledExactlyOnceWith('android:selected') })
    b.publish({ status: 'ready', value: { ...status, mirror: { id: mirrorId, deviceId: 'android:selected', state: 'running', error: null } } })
    expect(start.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: mobileEn.mobileResourcesMirrorStop }))
    await waitFor(() => { expect(b.props.closeMobileMirror).toHaveBeenCalledExactlyOnceWith(mirrorId) })
    b.unmount()
    expect(b.props.closeMobileMirror).toHaveBeenCalledOnce()
  })

  it('shows read failures and contains a late rejected command after navigation', async () => {
    const b = mount({ status: 'error' })
    expect(screen.getByRole('alert').textContent).toBe(mobileEn.mobileResourcesReadFailed)
    fireEvent.click(screen.getByRole('button', { name: mobileEn.mobileResourcesRefresh }))
    expect(b.props.refreshMobileResources).toHaveBeenCalledOnce()
    b.publish({ status: 'ready', value: mobileStatus() })
    const receipt = Promise.withResolvers<undefined>()
    vi.mocked(b.props.runMobileResource).mockReturnValueOnce(receipt.promise)
    fireEvent.click(screen.getByRole('checkbox'))
    const install = screen.getByRole('button', { name: mobileEn.mobileResourcesInstall })
    fireEvent.click(install); fireEvent.click(install)
    expect(b.props.runMobileResource).toHaveBeenCalledOnce()
    b.unmount()
    await act(async () => { receipt.reject(new Error('private transport error')); await receipt.promise.catch(() => {}) })
    expect(b.props.cancelMobileResource).not.toHaveBeenCalled()
  })
})
