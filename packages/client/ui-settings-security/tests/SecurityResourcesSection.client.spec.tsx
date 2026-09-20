// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SecuritySkillResourceStatus, SecuritySkillOperationId, SecuritySkillGenerationId } from '@deepseek-ai/dsh-security-skills/types'
import { SecurityResourcesSection, type SecurityResourcesProps } from '../src/client/SecurityResourcesSection.tsx'
import type { SecurityResourceRead } from '../src/client/resource-observer.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const empty = (): SecuritySkillResourceStatus => ({ resourceId: 'security-skills', state: 'not-installed', download: { available: false } })
const installed = (): SecuritySkillResourceStatus => ({ ...empty(), state: 'installed', installed: {
  version: '1.0.0', generation: 'g1' as SecuritySkillGenerationId, source: { kind: 'bundled' }, installedAt: 0, skillCount: 1,
} })
const operation = (): NonNullable<SecuritySkillResourceStatus['operation']> => ({
  id: 'operation-1' as SecuritySkillOperationId, kind: 'install', phase: 'downloading', bytesReceived: 40, totalBytes: 100,
})
function mount(value: SecurityResourceRead = { status: 'ready', value: empty() }, language: 'en' | 'zh' = 'en') {
  let snapshot = value
  const unsubscribe = vi.fn()
  const unused = (): never => { throw new Error('Unused standard hook') }
  const props: SecurityResourcesProps = {
    close: vi.fn(), useSessions: unused, useWorkspaces: unused, useSessionPendingInteraction: unused, useResource: unused,
    useSecurityResources: selector => selector(snapshot), watch: vi.fn(() => unsubscribe), refresh: vi.fn(),
    run: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    t: language === 'en' ? makeTranslate(en, commonEn) : makeTranslate(zh, commonZh),
  }
  const view = render(<SecurityResourcesSection {...props} />)
  return { ...view, props, unsubscribe, publish(next: SecurityResourceRead) {
    snapshot = next
    view.rerender(<SecurityResourcesSection {...props} />)
  } }
}

describe('Security resources', () => {
  it.each(['en', 'zh'] as const)('shows bundled installation honestly without scan or preset controls (%s)', async (language) => {
    const reason = 'No security skill release manifest URL is configured.'
    const b = mount({ status: 'ready', value: { ...empty(), download: { available: false, reason } } }, language)
    const copy = language === 'en' ? en : zh
    expect(screen.getByText(copy.resourceNoRelease)).toBeTruthy()
    expect(screen.queryByText(reason)).toBeNull()
    expect(screen.queryByRole('button', { name: copy.resourceInstall })).toBeNull()
    expect(screen.queryByText(copy.securityScopeTitle)).toBeNull()
    expect(screen.queryByText(copy.securityReportTitle)).toBeNull()
    expect(b.props.run).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: copy.resourceInstallBundled }))
    await waitFor(() => { expect(b.props.run).toHaveBeenCalledExactlyOnceWith('install-bundled') })
  })

  it('shows loading, missing manager, and failed observation with a reconnect action', () => {
    const b = mount({ status: 'loading' })
    expect(screen.getByRole('status').textContent).toBe(en.resourceLoading)
    b.publish({ status: 'ready', value: { state: 'unavailable', reason: 'component-missing' } })
    expect(screen.getByRole('status').textContent).toBe(en.resourceMissing)
    expect(screen.queryByRole('button', { name: en.resourceInstallBundled })).toBeNull()
    b.publish({ status: 'error' })
    expect(screen.getByRole('alert').textContent).toBe(en.resourceReadFailed)
    fireEvent.click(screen.getByRole('button', { name: en.resourceRefresh }))
    expect(b.props.refresh).toHaveBeenCalledOnce()
  })

  it('downloads from a configured source and waits for Host state before showing installed', async () => {
    const b = mount({ status: 'ready', value: { ...empty(), download: { available: true } } })
    fireEvent.click(screen.getByRole('button', { name: en.resourceInstall }))
    await waitFor(() => { expect(b.props.run).toHaveBeenCalledExactlyOnceWith('install') })
    expect(screen.getByText(en.resourceNotInstalled)).toBeTruthy()
    b.publish({ status: 'ready', value: installed() })
    expect(screen.getByText('1.0.0')).toBeTruthy()
    expect(screen.getByText(en.resourceInstalled)).toBeTruthy()
    expect(screen.getByText(en.resourceBundled)).toBeTruthy()
  })

  it('offers check, redownload, and update only for a configured network source', async () => {
    const current = installed()
    const b = mount({ status: 'ready', value: { ...current, download: { available: true },
      available: { version: '2.0.0', bytes: 100, sha256: 'fixture-sha256' } } })
    expect(screen.getByText('2.0.0')).toBeTruthy()
    for (const [label, action] of [[en.resourceCheck, 'check-update'], [en.resourceReinstall, 'reinstall'], [en.resourceUpdate, 'update']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      await waitFor(() => { expect(b.props.run).toHaveBeenLastCalledWith(action) })
      await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: label }).disabled).toBe(false) })
    }
    b.publish({ status: 'ready', value: { ...current, download: { available: true }, available: { version: '1.0.0', bytes: 100, sha256: 'fixture' } } })
    expect(screen.queryByRole('button', { name: en.resourceUpdate })).toBeNull()
  })

  it('requires explicit removal confirmation and can keep installed resources', async () => {
    const b = mount({ status: 'ready', value: installed() })
    fireEvent.click(screen.getByRole('button', { name: en.resourceRemove }))
    expect(b.props.run).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.resourceKeep }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.resourceRemove }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.resourceRemove }))
    await waitFor(() => { expect(b.props.run).toHaveBeenCalledExactlyOnceWith('remove') })
  })

  it('shows Host progress, disables conflicting actions, and cancels the exact operation', async () => {
    const b = mount({ status: 'ready', value: { ...empty(), operation: operation() } })
    const progress = screen.getByRole('progressbar') as HTMLProgressElement
    expect(progress.value).toBe(40)
    expect(progress.max).toBe(100)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.resourceInstallBundled }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.resourceCancel }))
    await waitFor(() => { expect(b.props.cancel).toHaveBeenCalledExactlyOnceWith(operation().id) })
    b.publish({ status: 'ready', value: { ...empty(), operation: { ...operation(), phase: 'cancelling' } } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.resourceCancel }).disabled).toBe(true)
  })

  it('disables cancellation during the atomic commit and shows the committed installation', () => {
    const b = mount({ status: 'ready', value: { ...empty(), operation: { ...operation(), phase: 'committing' } } })
    const cancelButton = screen.getByRole<HTMLButtonElement>('button', { name: en.resourceCancel })
    expect(cancelButton.disabled).toBe(true)
    fireEvent.click(cancelButton)
    expect(b.props.cancel).not.toHaveBeenCalled()
    expect(screen.getByText(en.resourceCommitting)).toBeTruthy()
    b.publish({ status: 'ready', value: installed() })
    expect(screen.getByText(en.resourceInstalled)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.resourceCancel })).toBeNull()
  })

  it('unsubscribes on navigation without cancelling the Host operation', () => {
    const b = mount({ status: 'ready', value: { ...empty(), operation: operation() } })
    b.unmount()
    expect(b.unsubscribe).toHaveBeenCalledOnce()
    expect(b.props.cancel).not.toHaveBeenCalled()
  })

  it('keeps a committed version visible after an update fails and retries the requested action', async () => {
    const value = { ...installed(), download: { available: true }, available: { version: '2.0.0', bytes: 100, sha256: 'fixture' } }
    const b = mount({ status: 'ready', value })
    fireEvent.click(screen.getByRole('button', { name: en.resourceUpdate }))
    await waitFor(() => { expect(b.props.run).toHaveBeenCalledWith('update') })
    b.publish({ status: 'ready', value: { ...value, lastError: 'Archive verification failed' } })
    expect(screen.getByText('1.0.0')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Archive verification failed')
    fireEvent.click(screen.getByRole('button', { name: en.resourceRetry }))
    await waitFor(() => { expect(b.props.run).toHaveBeenLastCalledWith('update') })
  })

  it('allows retry after a rejected start and does not leave the button busy', async () => {
    const b = mount()
    vi.mocked(b.props.run).mockRejectedValueOnce(new Error('transport rejected'))
    fireEvent.click(screen.getByRole('button', { name: en.resourceInstallBundled }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.resourceActionFailed)
    fireEvent.click(screen.getByRole('button', { name: en.resourceRetry }))
    await waitFor(() => { expect(b.props.run).toHaveBeenCalledTimes(2) })
    expect(b.props.run).toHaveBeenLastCalledWith('install-bundled')
  })
})
