// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SecurityResearchReportValue } from '@deepseek-ai/dsh-api-remotes/client'
import type { CapabilitySectionProps } from '../src/client/CapabilitySection.tsx'
import { en } from '../src/client/locales.ts'
import { SecurityScopeEditor } from '../src/client/SecurityScopeEditor.tsx'
import { SecurityReportExport } from '../src/client/SecurityReportExport.tsx'

const t = ((key: keyof typeof en, values?: Record<string, string | number>) => en[key].replace(/\{(\w+)\}/gu,
  (_, name: string) => String(values?.[name] ?? `{${name}}`))) as CapabilitySectionProps['t']
const urlDescriptors = ['createObjectURL', 'revokeObjectURL'].map(key => [key, Object.getOwnPropertyDescriptor(URL, key)] as const)
afterEach(() => {
  cleanup()
  for (const [key, descriptor] of urlDescriptors) {
    if (descriptor === undefined) Reflect.deleteProperty(URL, key)
    else Object.defineProperty(URL, key, descriptor)
  }
})

function scopeBench() {
  const snapshot = {
    status: 'ready' as const, writable: true, mode: 'host' as const, revision: 4,
    value: { root: {
      engagementId: 'engagement', grantId: 'grant', authorizationRef: 'auth', notBefore: 0, expiresAt: 100,
      executionHostIds: ['host'], targets: [{ id: 'target', kind: 'hostname', value: 'example.test' }], excludedTargetIds: [],
      actions: ['reconnaissance'], approvalRequiredActions: [], egress: [], credentials: [],
      evidence: { retainUntil: 100, minimumRedaction: 'sensitive', externalReporting: 'deny' },
    } }, base: undefined, user: undefined,
  }
  const save = vi.fn<CapabilitySectionProps['saveSecurityScope']>().mockResolvedValue(undefined)
  const useSecurityScope: CapabilitySectionProps['useSecurityScope'] = select => select(snapshot)
  const props = { useSecurityScope, saveSecurityScope: save, t }
  return { snapshot, save, props }
}

function reportBench() {
  const create = vi.fn(() => 'blob:test')
  const revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
  const report: SecurityResearchReportValue = {
    fileName: 'security-findings.json', mediaType: 'application/json', bytes: 2, base64: 'e30=', findingCount: 0,
  }
  const exportReport = vi.fn<NonNullable<CapabilitySectionProps['exportReport']>>().mockResolvedValue(report)
  const view = render(<SecurityReportExport exportReport={exportReport} t={t} />)
  fireEvent.change(screen.getByLabelText(en.securityReportSession), { target: { value: 'session-1' } })
  return { ...view, create, revoke, report, exportReport }
}

function submitReport(): void { fireEvent.click(screen.getByRole('button', { name: en.securityReportDownload })) }

describe('Security scope drafts', () => {
  it('pins the first-edit revision and preserves raw multiline input', async () => {
    const b = scopeBench()
    const view = render(<SecurityScopeEditor {...b.props} />)
    fireEvent.change(screen.getByLabelText(en.securityTargets), { target: { value: 'target|hostname|changed.test' } })
    fireEvent.change(screen.getByLabelText(en.securityExecutionHosts), { target: { value: 'host\n' } })
    expect((screen.getByLabelText<HTMLTextAreaElement>(en.securityExecutionHosts)).value).toBe('host\n')
    b.snapshot.revision = 9
    view.rerender(<SecurityScopeEditor {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.securityScopeSave }))
    await screen.findByText(en.securityScopeSaved)
    expect(b.save).toHaveBeenCalledWith(expect.objectContaining({
      targets: [{ id: 'target', kind: 'hostname', value: 'changed.test' }], executionHostIds: ['host'],
    }), 4)
  })

  it('keeps an invalid target draft without issuing a write', async () => {
    const b = scopeBench()
    render(<SecurityScopeEditor {...b.props} />)
    fireEvent.change(screen.getByLabelText(en.securityTargets), { target: { value: 'invalid' } })
    fireEvent.click(screen.getByRole('button', { name: en.securityScopeSave }))
    await screen.findByRole('alert')
    expect(b.save).not.toHaveBeenCalled()
    expect((screen.getByLabelText<HTMLTextAreaElement>(en.securityTargets)).value).toBe('invalid')
  })

  it('retains rejected drafts and discards explicitly to the latest Host value', async () => {
    const b = scopeBench()
    b.save.mockRejectedValueOnce(new Error('conflict'))
    const view = render(<SecurityScopeEditor {...b.props} />)
    fireEvent.change(screen.getByLabelText(en.securityGrantId), { target: { value: 'new-grant' } })
    fireEvent.click(screen.getByRole('button', { name: en.securityScopeSave }))
    await screen.findByRole('alert')
    expect(screen.queryByText(en.securityScopeSaved)).toBeNull()
    b.snapshot.value.root.grantId = 'remote-grant'
    view.rerender(<SecurityScopeEditor {...b.props} />)
    expect((screen.getByLabelText<HTMLInputElement>(en.securityGrantId)).value).toBe('new-grant')
    fireEvent.click(screen.getByRole('button', { name: en.securityScopeDiscard }))
    expect((screen.getByLabelText<HTMLInputElement>(en.securityGrantId)).value).toBe('remote-grant')
  })

  it('disables writes on a read-only connection', () => {
    const b = scopeBench()
    b.snapshot.writable = false
    render(<SecurityScopeEditor {...b.props} />)
    expect(screen.getByText(en.securityScopeReadOnly)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.securityScopeSave }))
    expect(b.save).not.toHaveBeenCalled()
  })
})

describe('Security report saves', () => {
  it('creates an inert download and releases it when the selected format changes', async () => {
    const b = reportBench()
    submitReport()
    const link = await screen.findByRole('link', { name: 'Save report: security-findings.json' })
    expect(link.getAttribute('download')).toBe('security-findings.json')
    expect(b.exportReport).toHaveBeenCalledWith({ sessionId: 'session-1', format: 'json' }, expect.any(AbortSignal))
    expect(b.create.mock.calls).toHaveLength(1)
    fireEvent.change(screen.getByLabelText(en.securityReportFormat), { target: { value: 'sarif' } })
    expect(screen.queryByRole('link')).toBeNull()
    expect(b.revoke).toHaveBeenCalledWith('blob:test')
    submitReport()
    await screen.findByRole('link')
    expect(b.exportReport.mock.calls[1]?.[0].format).toBe('sarif')
  })

  it.each(['denied', 'invalid-bytes'] as const)('returns no download after %s', async (reason) => {
    const b = reportBench()
    if (reason === 'denied') b.exportReport.mockRejectedValueOnce(new Error('denied'))
    else b.exportReport.mockResolvedValueOnce({ ...b.report, bytes: 3 })
    submitReport()
    await screen.findByRole('alert')
    expect(b.create).not.toHaveBeenCalled()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('cancels on unmount and ignores a late report response', async () => {
    const b = reportBench()
    const result = Promise.withResolvers<SecurityResearchReportValue>()
    b.exportReport.mockReturnValueOnce(result.promise)
    submitReport()
    await waitFor(() => { expect(b.exportReport).toHaveBeenCalledOnce() })
    const signal = b.exportReport.mock.calls[0]![1]
    b.unmount()
    expect(signal.aborted).toBe(true)
    result.resolve(b.report)
    await result.promise
    expect(b.create).not.toHaveBeenCalled()
  })
})
