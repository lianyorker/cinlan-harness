/** Instance-local Remote boundary doubles with cancellable streams and real Cordis registration. */
import { Context } from '@deepseek-ai/cordis'
import { onTestFinished, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { McpManagementSnapshot, McpServerId, McpServerRecord, McpManagementErrorCode } from '@deepseek-ai/dsh-api-mcp-controller/types'
import type { McpRemote } from '../src/client/source.ts'
import type { McpSettingsInjected } from '../src/client/McpSettingsSection.tsx'
import { createMcpSettingsStore } from '../src/client/store.ts'
import { apply, inject } from '../src/client/index.ts'

export const serverId = 'server-a' as McpServerId
export const record = (patch: Partial<McpServerRecord> = {}): McpServerRecord => ({
  id: serverId, transport: 'stdio', serverName: 'reader', enabled: true,
  command: 'node', args: ['server.js'], cwd: '', env: {}, ...patch,
} as McpServerRecord)
export const snapshot = (patch: Partial<McpManagementSnapshot> = {}): McpManagementSnapshot => ({
  profile: 'web', revision: 1, reconciling: false, servers: [], external: [], ...patch,
})
export const failure = (code: McpManagementErrorCode): RemoteResult<never> => ({
  ok: false, error: new RemoteError('mcp/' + code as 'mcp/conflict', 'RAW_PRIVATE_TRANSPORT_TEXT', {}),
})

export function remoteFixture(initial = snapshot()) {
  let value = initial
  const subscribers = new Set<(frame: RemoteResult<McpManagementSnapshot>) => void>()
  const signals: AbortSignal[] = []
  const done: Promise<void>[] = []
  const remote = {
    snapshot: vi.fn<McpRemote['snapshot']>(async () => ({ ok: true, value })),
    save: vi.fn<McpRemote['save']>(async () => ({ ok: true, value: { id: serverId, snapshot: value } })),
    removeServer: vi.fn<McpRemote['removeServer']>(async () => ({ ok: true, value })),
    setEnabled: vi.fn<McpRemote['setEnabled']>(async () => ({ ok: true, value })),
    reconnect: vi.fn<McpRemote['reconnect']>(async () => ({ ok: true, value })),
    probe: vi.fn<McpRemote['probe']>(async () => ({ ok: true, value })),
    watch: vi.fn<McpRemote['watch']>(async function* (signal = new AbortController().signal) {
      signals.push(signal)
      const completion = Promise.withResolvers<undefined>()
      done.push(completion.promise)
      const queue: RemoteResult<McpManagementSnapshot>[] = [{ ok: true, value }]
      let wake = (): void => {}
      const push = (frame: RemoteResult<McpManagementSnapshot>): void => { queue.push(frame); wake() }
      const abort = (): void => { wake() }
      subscribers.add(push)
      signal.addEventListener('abort', abort, { once: true })
      try {
        while (!signal.aborted) {
          const frame = queue.shift()
          if (frame !== undefined) {
            if (!frame.ok) throw frame.error
            yield frame.value
            continue
          }
          await new Promise<void>((resolve) => { wake = resolve; if (signal.aborted) resolve() })
        }
      } finally {
        subscribers.delete(push)
        signal.removeEventListener('abort', abort)
        completion.resolve(undefined)
      }
    }),
  } satisfies McpRemote
  return {
    remote, signals, done, subscribers,
    push: (next: McpManagementSnapshot): void => { value = next; for (const send of subscribers) send({ ok: true, value }) },
    fail: (code: McpManagementErrorCode): void => { for (const send of subscribers) send(failure(code)) },
  }
}

export async function pluginFixture(initial = snapshot(), declareImmediately = true, connected = true) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const fixture = remoteFixture(initial)
  const generation = createSnapshotStore<ConnectionGeneration | undefined>(connected ? { id: 1, host: { home: '/host' } } : undefined)
  new SettingsMetadataService(ctx)
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  locale.setLocale('en')
  ctx.provide('remote', { mcp: fixture.remote } as never)
  ctx.provide('remote.mcp', fixture.remote as never)
  ctx.provide('connection', { generation } as never)
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => slots.register({ name: 'root', children: {
    'settings.section': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  const release = declareImmediately ? declare() : undefined
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  const bind = () => {
    const entry = slots.entries('settings.section')[0]!
    const handle = entry.store as ReturnType<typeof createMcpSettingsStore>
    const store = handle.create()
    // StoredEntry erases inject arguments; this fixture binds the registered store actions.
    const face = entry.inject!(store.actions as never) as unknown as McpSettingsInjected
    return { entry, store, face }
  }
  return { ctx, slots, fiber, locale, generation, declare, release, bind, ...fixture }
}
