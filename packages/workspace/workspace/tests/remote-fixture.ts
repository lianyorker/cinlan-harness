import { vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ExecutionBinding, ExecutionTargetId, SshExecutionSnapshot } from '@deepseek-ai/dsh-execution-host-targets/types'
import type { ExecutionIncarnation, ExecutionLease } from '@deepseek-ai/dsh-execution-binding/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { FsInfo, FsVersion } from '@deepseek-ai/dsh-fs'

export function remoteBinding(revision = 1): SshExecutionSnapshot {
  return {
    kind: 'ssh', targetId: '00000000-0000-4000-8000-000000000011' as ExecutionTargetId, revision,
    endpoint: { host: 'remote.invalid', port: 22, username: 'user', hostKeySHA256: 'a'.repeat(64) },
    node: '/usr/bin/node', helper: '/opt/helper', helperHash: 'b'.repeat(64),
    workspace: '/configured-link', bootstrapPath: '/opt/bootstrap', bootstrapHash: 'c'.repeat(64),
  }
}

export function remoteBindings(
  bindings: ReadonlyMap<SessionId, ExecutionBinding> = new Map(),
  sessionCwds: ReadonlyMap<SessionId, string> = new Map(),
) {
  const remote = new Context()
  const stat = vi.fn(async (): Promise<FsInfo | undefined> => ({ type: 'directory', version: 'remote-v1' as FsVersion }))
  const resolve = vi.fn(async (path: string) => ({ targetKey: path, displayPath: path }))
  const processPath = vi.fn((target: { targetKey: string }) => target.targetKey)
  remote.provide('fs', { stat, resolve, processPath } as never)
  const release = vi.fn(async () => {})
  const assertCurrent = vi.fn(() => {})
  const lease = (binding: ExecutionBinding, cwd: string): ExecutionLease => ({
    binding, ctx: remote, cwd: cwd === '/configured-link' ? '/canonical/project' : cwd,
    platform: 'linux', incarnation: 'test-incarnation' as ExecutionIncarnation, signal: new AbortController().signal,
    assertCurrent, release,
  })
  const acquire = vi.fn(async (binding: ExecutionBinding, cwd: string): Promise<ExecutionLease> => lease(binding, cwd))
  const bindingForSession = vi.fn(async (id: SessionId): Promise<ExecutionBinding> => {
    const binding = bindings.get(id)
    if (binding === undefined) throw new Error('missing Session execution fixture')
    return binding
  })
  const forSession = vi.fn(async (id: SessionId): Promise<ExecutionLease> => {
    const binding = bindings.get(id)
    if (binding === undefined) throw new Error('missing Session execution fixture')
    return lease(binding, sessionCwds.get(id) ?? '/canonical/project')
  })
  return { acquire, bindingForSession, forSession, release, assertCurrent, stat, resolve, processPath }
}
