import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/client/api.ts'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('terminal capability probe', () => {
  it('reports an unsupported browser scheme without contacting the Host', async () => {
    vi.stubGlobal('location', { protocol: 'file:' })
    const probe = vi.spyOn(api, 'terminalDeps')
    const service = createBetterSidebarService(createSidebarStore())
    await expect(service.getTerminalCapability()).resolves.toEqual({ status: 'unavailable', reason: 'unsupported-scheme' })
    expect(probe).not.toHaveBeenCalled()
  })

  it('projects real Host availability and distinguishes missing dependencies from a failed probe', async () => {
    vi.stubGlobal('location', { protocol: 'https:' })
    const probe = vi.spyOn(api, 'terminalDeps').mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, cause: 'missing', command: 'repair', profile: 'web' })
      .mockRejectedValueOnce(new Error('network'))
    const service = createBetterSidebarService(createSidebarStore())
    await expect(service.getTerminalCapability()).resolves.toEqual({ status: 'available' })
    await expect(service.getTerminalCapability()).resolves.toEqual({ status: 'unavailable', reason: 'missing-dependencies' })
    await expect(service.getTerminalCapability()).resolves.toEqual({ status: 'unavailable', reason: 'probe-failed' })
    expect(probe).toHaveBeenCalledTimes(3)
  })
})
