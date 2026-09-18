/** Actual slot and metadata lifetimes release MCP contributions and observable readers. */
import { expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import * as browser from '../src/client/index.ts'
import * as host from '../src/index.ts'
import { McpSettingsSection } from '../src/client/McpSettingsSection.tsx'
import { pluginFixture, snapshot, record, failure } from './fixture.client.ts'
import { en, zh } from '../src/client/locales.ts'

it('keeps browser exports limited to the plugin and interaction-store factory', () => {
  expect(Object.keys(browser).sort()).toEqual(['apply', 'createMcpSettingsStore', 'inject'])
  expect(Object.keys(host)).toEqual(['apply'])
  host.apply()
})

it('registers localized value-free metadata for each declaration lifetime and disposes its stream', async () => {
  const bench = await pluginFixture(snapshot({ servers: [{ record: record({ serverName: 'PRIVATE_SERVER' }),
    observed: { phase: 'ready', attempt: 0, tools: [{ name: 'PRIVATE_TOOL', description: 'PRIVATE_DESCRIPTION', inputSchema: {} }] }, applying: false }] }), false)
  expect(bench.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
  const release = bench.declare()
  const { entry, face } = bench.bind()
  expect(entry.component).toBe(McpSettingsSection)
  expect(entry.options).toMatchObject({ id: 'mcp', order: 17 })
  expect(entry.locale).toBe('settings.mcp')
  expect(resolveSlotLabel(entry.options.label)).toBe('MCP')
  const metadata = bench.ctx.settingsMetadata
  expect(metadata.getSnapshot().sections).toEqual([{ sectionId: 'mcp', groupId: 'experimental' }])
  expect(metadata.getSnapshot().items.map(item => item.anchorId)).toEqual([
    'mcp-server-list', 'mcp-add-server', 'mcp-transport', 'mcp-credentials', 'mcp-tools',
  ])
  expect(JSON.stringify(metadata.getSnapshot())).not.toContain('PRIVATE_')
  expect(metadata.getSnapshot().items[0]?.title).toBe(en.serverList)
  bench.locale.setLocale('zh')
  expect(metadata.getSnapshot().items[0]?.title).toBe(zh.serverList)
  const source = face.hooks.mcp
  expect(bench.bind().face.hooks.mcp).toBe(source)
  release()
  expect(metadata.getSnapshot()).toEqual({ sections: [], items: [] })
  bench.declare()
  expect(metadata.getSnapshot().items).toHaveLength(5)
  await bench.fiber.dispose()
  expect(metadata.getSnapshot()).toEqual({ sections: [], items: [] })
  expect(bench.slots.entries('settings.section')).toEqual([])
  expect(bench.signals.every(signal => signal.aborted)).toBe(true)
  expect(bench.subscribers.size).toBe(0)
})

it('preserves failed draft CAS in the shipped injection and clears only accepted operations', async () => {
  const bench = await pluginFixture()
  const { store, face } = bench.bind()
  await vi.waitFor(() =>{  expect(face.hooks.mcp.getSnapshot().status).toBe('ready') })
  store.actions.open(1, record())
  bench.push(snapshot({ revision: 2 }))
  await vi.waitFor(() =>{  expect(face.hooks.mcp.getSnapshot().snapshot?.revision).toBe(2) })
  bench.remote.save.mockResolvedValueOnce(failure('conflict'))
  expect(await face.save(store.getSnapshot().draft!)).toBe(false)
  expect(store.getSnapshot().draft?.expectedRevision).toBe(1)
  expect(bench.remote.save.mock.calls[0]?.[0].expectedRevision).toBe(1)
  store.actions.cancel()
  store.actions.open(2)
  expect(await face.save(store.getSnapshot().draft!)).toBe(false)
  expect(face.hooks.mcp.getSnapshot().actionError).toBe('invalid-config')
  store.actions.patch({ serverName: 'added', command: 'node' })
  expect(await face.save(store.getSnapshot().draft!)).toBe(true)
  expect(store.getSnapshot().draft).toBeNull()
  store.actions.confirmRemove({ id: record().id, expectedRevision: 2 })
  bench.remote.removeServer.mockResolvedValueOnce(failure('storage-failed'))
  expect(await face.remove(store.getSnapshot().removing!)).toBe(false)
  expect(store.getSnapshot().removing).not.toBeNull()
  expect(await face.remove(store.getSnapshot().removing!)).toBe(true)
  expect(store.getSnapshot().removing).toBeNull()
})
