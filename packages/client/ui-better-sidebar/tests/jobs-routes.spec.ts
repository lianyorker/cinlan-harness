/**
 * Host route tests for the background-job API ('jobs.output' / 'jobs.kill').
 * Output uses the registry's independent retained reader, preserves owner
 * authorization, and applies a UTF-8 response cap without touching job_output.
 */
import { describe, expect, it, vi } from 'vitest'
import { buildJobsApi } from '../src/jobs-routes.ts'
import { SidebarError } from '../src/wire.ts'
import type { Context } from '../src/context-types.ts'

/** A context whose get() serves only the jobs and agents faces. */
function ctxWith(jobs: unknown, agents: unknown): Context {
  return {
    get: (key: string) => (key === 'jobs' ? jobs : key === 'agents' ? agents : undefined),
  } as unknown as Context
}

/** A stub live agent (the registry fence compares id only). */
const agent = (id: string) => ({ id, session: { header: { cwd: '/p' } } })

describe('jobs.output route', () => {
  it('returns retained output through the exact live owner without consuming model output', () => {
    const jobs = {
      peekOutput: vi.fn(() => ({ text: 'clone complete', truncated: false })),
      kill: vi.fn(),
    }
    const agents = { get: vi.fn((id: string) => agent(id)) }
    const api = buildJobsApi(ctxWith(jobs, agents), 512 * 1024)

    expect(api.output({ sessionId: 's1', id: 'pwsh-1' })).toEqual({
      text: 'clone complete',
      truncated: false,
    })
    expect(jobs.peekOutput).toHaveBeenCalledWith('pwsh-1', agent('s1'))
    expect(jobs.kill).not.toHaveBeenCalled()
  })

  it('reports registry omission and caps the response on a UTF-8 boundary', () => {
    const jobs = {
      peekOutput: vi.fn(() => ({ text: '你ab', truncated: true })),
      kill: vi.fn(),
    }
    const api = buildJobsApi(ctxWith(jobs, undefined), 4)

    expect(api.output({ sessionId: 's1', id: 'pwsh-1' })).toEqual({
      text: '你a',
      truncated: true,
    })
  })

  it('returns an empty independent snapshot before any output arrives', () => {
    const jobs = {
      peekOutput: vi.fn(() => ({ text: '', truncated: false })),
      kill: vi.fn(),
    }
    const api = buildJobsApi(ctxWith(jobs, undefined), 100)
    expect(api.output({ sessionId: 's1', id: 'pwsh-1' })).toEqual({ text: '', truncated: false })
  })

  it('rejects missing scope or job ids as bad requests', () => {
    const jobs = { peekOutput: vi.fn(), kill: vi.fn() }
    const api = buildJobsApi(ctxWith(jobs, undefined), 100)
    expect(() => api.output({ id: 'pwsh-1' })).toThrowError(
      expect.objectContaining<Partial<SidebarError>>({ code: 'bad-request' }),
    )
    expect(() => api.output({ sessionId: 's1' })).toThrowError(
      expect.objectContaining<Partial<SidebarError>>({ code: 'bad-request' }),
    )
  })

  it('maps unknown and foreign job refusals to a 404 job-error', () => {
    const jobs = {
      peekOutput: vi.fn(() => { throw new Error('unknown job pwsh-9') }),
      kill: vi.fn(),
    }
    const api = buildJobsApi(ctxWith(jobs, undefined), 100)
    expect(() => api.output({ sessionId: 's1', id: 'pwsh-9' })).toThrowError(
      expect.objectContaining<Partial<SidebarError>>({ code: 'job-error', status: 404 }),
    )
  })
})

describe('jobs.kill route', () => {
  it('kills with the forwarded reason and the live caller', () => {
    const jobs = { peekOutput: vi.fn(), kill: vi.fn(() => 'requested' as const) }
    const agents = { get: vi.fn((id: string) => agent(id)) }
    const api = buildJobsApi(ctxWith(jobs, agents), 100)
    expect(api.kill({ sessionId: 's1', id: 'pwsh-1', reason: 'user pressed stop' }))
      .toEqual({ ok: true, outcome: 'requested' })
    expect(jobs.kill).toHaveBeenCalledWith('pwsh-1', agent('s1'), 'user pressed stop')
  })

  it('defaults the reason when none is supplied', () => {
    const jobs = { peekOutput: vi.fn(), kill: vi.fn(() => 'already-finished' as const) }
    const api = buildJobsApi(ctxWith(jobs, undefined), 100)
    expect(api.kill({ sessionId: 's1', id: 'pwsh-1' })).toEqual({ ok: true, outcome: 'already-finished' })
    expect(jobs.kill).toHaveBeenCalledWith('pwsh-1', undefined, 'user requested via sidebar')
  })

  it('maps registry refusals to a 404 job-error', () => {
    const jobs = {
      peekOutput: vi.fn(),
      kill: vi.fn(() => { throw new Error('unknown job pwsh-9') }),
    }
    const api = buildJobsApi(ctxWith(jobs, undefined), 100)
    expect(() => api.kill({ sessionId: 's1', id: 'pwsh-9' })).toThrowError(
      expect.objectContaining<Partial<SidebarError>>({ code: 'job-error', status: 404 }),
    )
  })

  it('returns 503 for both operations when the registry is absent', () => {
    const api = buildJobsApi(ctxWith(undefined, undefined), 100)
    expect(() => api.output({ sessionId: 's1', id: 'pwsh-1' })).toThrowError(
      expect.objectContaining<Partial<SidebarError>>({ code: 'job-error', status: 503 }),
    )
    expect(() => api.kill({ sessionId: 's1', id: 'pwsh-1' })).toThrowError(
      expect.objectContaining<Partial<SidebarError>>({ code: 'job-error', status: 503 }),
    )
  })
})
