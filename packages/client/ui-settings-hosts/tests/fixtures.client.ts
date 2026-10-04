/** Typed external Remote fixtures; no HTTP or framework replacement. */
import type { ExecutionHostInfo, ImportableHostsValue, ListTargetsValue, TargetErrorCode, TargetView } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { HostsRemote } from '../src/client/callbacks.ts'

export const current: ExecutionHostInfo = {
  hostId: 'local-process-17' as ExecutionHostInfo['hostId'], hostname: 'workstation', pid: 1701,
  platform: 'win32', createdAt: '2026-09-01T10:00:00.000Z',
}
export const target: TargetView = {
  id: 'saved-target-3' as TargetView['id'], revision: 3, label: 'Development', sshAlias: 'dev-server',
  createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', state: { phase: 'disconnected' },
}
/** Saved target carrying the editable connection refinements the host form writes. */
export const connectionTarget: TargetView = {
  ...target, label: 'Build host', sshAlias: 'build-host',
  connection: { port: 2222, username: 'deploy', privateKeyFile: '~/.ssh/id_ed25519',
    connectTimeoutSeconds: 3600, multiplex: false },
}
/** Import read: one concrete Host entry with every importable destination detail. */
export const importable: ImportableHostsValue = {
  source: 'C:/Users/operator/.ssh/config', exists: true,
  entries: [{
    alias: 'build-host', host: '10.0.0.9', username: 'deploy', port: 2222, identityFile: '~/.ssh/id_ed25519',
    proxyCommand: 'cloudflared access ssh --hostname %h', jumpHost: 'bastion.example.com',
  }],
}
export const readyTarget: TargetView = {
  ...target, state: {
    phase: 'ready', generation: 4, checkedAt: '2026-09-02T10:00:00.000Z', info: {
      protocolVersion: 1, executionHost: { ...current, hostId: 'remote-process-8' as ExecutionHostInfo['hostId'], hostname: 'remote-host', platform: 'linux', pid: 801 },
      roots: [{ id: 'project', label: 'Project', path: '/srv/project' }, { id: 'data', label: 'Data', path: '/srv/data' }],
      capabilities: ['directory-inspection'],
    },
  },
}
export const baseline: ListTargetsValue = { current, targets: [target] }

export function failure(code: `execution-host/${TargetErrorCode}`, message = 'Host diagnostic') {
  return { code, message, details: {} }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse })
  return { promise, resolve, reject }
}

export function feed<T>(initial: T) {
  const queue: ({ value: T } | { error: unknown })[] = []
  let wake: (() => void) | undefined
  let ended = false
  let closed = 0
  return {
    push(value: T) { queue.push({ value }); wake?.() },
    fail(error: unknown) { queue.push({ error }); wake?.() },
    end() { ended = true; wake?.() },
    get closed() { return closed },
    async *open(signal?: AbortSignal): AsyncIterable<T> {
      const abort = (): void => { wake?.() }
      signal?.addEventListener('abort', abort)
      try {
        if (signal?.aborted) return
        yield initial
        while (!signal?.aborted) {
          const value = queue.shift()
          if (value !== undefined) {
            if ('error' in value) throw value.error
            yield value.value
            continue
          }
          if (ended) return
          await new Promise<void>((resolve) => { wake = resolve })
        }
      } finally {
        wake = undefined
        signal?.removeEventListener('abort', abort)
        closed++
      }
    },
  }
}

export function remoteFixture(value: ListTargetsValue = baseline) {
  const frames = feed(value)
  const remote: HostsRemote = {
    list: async () => ({ ok: true, value }),
    follow: signal => frames.open(signal),
    create: async () => ({ ok: true, value: { target } }),
    update: async () => ({ ok: true, value: { target } }),
    removeTarget: async () => ({ ok: true, value: {} }),
    connect: async () => ({ ok: true, value: { target: readyTarget } }),
    disconnect: async () => ({ ok: true, value: { target } }),
    test: async () => ({ ok: true, value: { target, rootCount: 2 } }),
    listImportableHosts: async () => ({ ok: true, value: importable }),
  }
  return { remote, frames }
}
