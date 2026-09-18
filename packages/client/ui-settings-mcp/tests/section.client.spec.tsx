// @vitest-environment jsdom
/** The native section exercises actual plugin injection over scripted Remote results. */
import { readFileSync } from 'node:fs'
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { McpExternalServerView, McpManagementSnapshot, McpSaveResult } from '@deepseek-ai/dsh-api-mcp-controller/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { McpSettingsSection, type McpSettingsSectionProps } from '../src/client/McpSettingsSection.tsx'
import { en } from '../src/client/locales.ts'
import { pluginFixture, record, snapshot, failure, serverId } from './fixture.client.ts'

afterEach(cleanup)

async function view(initial = snapshot(), connected = true) {
  const bench = await pluginFixture(initial, true, connected)
  const { face, store } = bench.bind()
  const { hooks, ...callbacks } = face
  const props = {
    ...callbacks, actions: store.actions,
    useStore: select => select(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
    useMcp: select => select(useSyncExternalStore(
      listener => hooks.mcp.subscribe(listener), () => hooks.mcp.getSnapshot())),
    t: bench.locale.bind('settings.mcp'),
  } as McpSettingsSectionProps
  const rendered = render(<McpSettingsSection {...props} />)
  if (connected) await waitFor(() => { expect(screen.getByRole('button', { name: en.add })).toHaveProperty('disabled', false) })
  return { ...bench, ...rendered, store, face, props }
}

const managed = (patch: Partial<McpManagementSnapshot> = {}) => snapshot({ servers: [{
  record: record(), applying: false, observed: { phase: 'ready', attempt: 0, tools: [
    { name: 'read_document', description: 'Read one document.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
  ] },
}], ...patch })

describe('native MCP settings', () => {
  it('retains page anchors before any Host connection is available', async () => {
    const v = await view(snapshot(), false)
    expect(screen.getByText(en.offline)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.add })).toHaveProperty('disabled', true)
    expect(v.container.querySelectorAll('[data-settings-anchor]')).toHaveLength(5)
    expect(screen.queryByText(en.empty)).toBeNull()
  })

  it('shows stopped HTTP records and lets removal confirmation be dismissed without a request', async () => {
    const httpRecord = { id: serverId, serverName: 'http-reader', enabled: false, transport: 'streamable-http' as const,
      url: 'https://example.test', headers: {} }
    const v = await view(snapshot({ servers: [{ record: httpRecord, applying: false,
      observed: { phase: 'stopped', attempt: 0, tools: [] } }], external: [{
      id: 'external-http' as McpExternalServerView['id'], serverName: 'composition-http', transport: 'streamable-http',
      owner: { kind: 'composition', label: 'team-http' }, phase: 'stopped', attempt: 0, tools: [],
    }] }))
    expect(screen.getAllByText(en.http)).toHaveLength(2)
    expect(screen.getAllByText('Connection: Stopped')).toHaveLength(2)
    expect(screen.getByText('Owner: team-http')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove http-reader' }))
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('group', { name: en.confirmRemove })).toBeNull()
    expect(v.remote.removeServer).not.toHaveBeenCalled()
  })

  it('keeps Add and every static search target available in an empty list', async () => {
    const v = await view()
    expect(screen.getByText(en.empty)).toBeTruthy()
    const anchors = Array.from(v.container.querySelectorAll('[data-settings-anchor]')).map(node => node.getAttribute('data-settings-anchor'))
    expect(anchors).toEqual(v.ctx.settingsMetadata.getSnapshot().items.map(item => item.anchorId))
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    expect(screen.getByRole('form', { name: en.newServer })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.add })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('form')).toBeNull()
    expect(v.remote.save).not.toHaveBeenCalled()
  })

  it('renders desired enablement, applying and observed readiness independently', async () => {
    const v = await view(managed({ reconciling: true, servers: [{ record: record({ enabled: false }), applying: true,
      observed: { phase: 'ready', attempt: 0, tools: [] } }] }))
    const row = within(screen.getByRole('article', { name: 'reader' }))
    expect(row.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(row.getByText('Connection: Ready')).toBeTruthy()
    expect(row.getByText(en.applying)).toBeTruthy()
    expect(screen.getByText(en.reconciling)).toBeTruthy()
    expect(row.getByRole('button', { name: en.refreshTools })).toHaveProperty('disabled', true)
    await act(async () => { v.push(managed({ servers: [{ record: record(), applying: false,
      observed: { phase: 'backoff', attempt: 3, errorCode: 'connection-failed', tools: [] } }] })); await Promise.resolve() })
    expect(row.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(row.getByText(en['connection-failed'])).toBeTruthy()
    expect(row.getByRole('button', { name: en.refreshTools })).toHaveProperty('disabled', true)
    expect(row.getByRole('button', { name: en.reconnect })).toHaveProperty('disabled', false)
  })

  it('shows actual external owner and tool descriptors without write controls', async () => {
    const external: McpExternalServerView = {
      id: 'external-1' as McpExternalServerView['id'], serverName: 'composition-reader',
      owner: { kind: 'composition', label: 'team composition' },
      transport: 'stdio', phase: 'error', attempt: 0, errorCode: 'authentication-failed',
      tools: [{ name: 'external_tool', description: 'An external tool.', inputSchema: { type: 'object' } }],
    }
    await view(snapshot({ external: [external] }))
    const row = within(screen.getByRole('article', { name: 'composition-reader' }))
    expect(row.getByText('Owner: team composition')).toBeTruthy()
    expect(row.queryAllByRole('button')).toEqual([])
    expect(row.queryAllByRole('switch')).toEqual([])
    expect(screen.getByText('external_tool')).toBeTruthy()
    expect(screen.getByText('An external tool.')).toBeTruthy()
    expect(screen.getByText(en['authentication-failed'])).toBeTruthy()
  })

  it('retains a failed stale draft and sends its opening CAS instead of a newer watch revision', async () => {
    const v = await view(managed())
    fireEvent.click(screen.getByRole('button', { name: 'Edit reader' }))
    const input = screen.getByLabelText<HTMLInputElement>(en.serverName)
    fireEvent.change(input, { target: { value: 'my_edit' } })
    await act(async () => { v.push(managed({ revision: 2 })); await Promise.resolve() })
    v.remote.save.mockResolvedValueOnce(failure('conflict'))
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.conflict)
    expect(input.value).toBe('my_edit')
    expect(v.remote.save.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: 1, record: { serverName: 'my_edit' } })
    expect(v.container.textContent).not.toContain('RAW_PRIVATE')
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('form')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit reader' }))
    expect(v.store.getSnapshot().draft?.expectedRevision).toBe(2)
  })

  it('creates HTTP desired configuration with reference names and literal prefix space', async () => {
    const v = await view()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'remote' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'streamable-http' } })
    fireEvent.change(screen.getByLabelText(en.url), { target: { value: 'https://mcp.example/service' } })
    fireEvent.click(screen.getByRole('button', { name: en.addReference }))
    fireEvent.change(screen.getByLabelText(en.headerName), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByLabelText(en.referenceName), { target: { value: 'MCP_TOKEN' } })
    fireEvent.change(screen.getByLabelText(en.prefix), { target: { value: 'Bearer ' } })
    fireEvent.click(screen.getByRole('switch', { name: en.enabled }))
    const pending = Promise.withResolvers<RemoteResult<McpSaveResult>>()
    v.remote.save.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    try {
      expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
      expect(screen.getByText(en.pending)).toBeTruthy()
      expect(v.remote.save.mock.calls[0]?.[0]).toEqual({ expectedRevision: 1, record: {
        serverName: 'remote', enabled: true, transport: 'streamable-http', url: 'https://mcp.example/service',
        headers: { Authorization: { ref: 'MCP_TOKEN', prefix: 'Bearer ' } },
      } })
    } finally {
      await act(async () => {
        pending.resolve({ ok: true, value: { id: serverId, snapshot: snapshot({ revision: 2 }) } })
        await pending.promise
      })
    }
    expect(screen.queryByRole('form')).toBeNull()
  })

  it('edits stdio args and reference rows, shows local validation and allows offline cancel', async () => {
    const v = await view()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'local' } })
    fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'node' } })
    fireEvent.change(screen.getByLabelText(en.args), { target: { value: 'server.js' } })
    fireEvent.change(screen.getByLabelText(en.cwd), { target: { value: '/workspace' } })
    fireEvent.click(screen.getByRole('button', { name: en.addReference }))
    fireEvent.change(screen.getByLabelText(en.envName), { target: { value: 'TOKEN' } })
    fireEvent.change(screen.getByLabelText(en.referenceName), { target: { value: 'not-a-variable' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en['invalid-config'])
    expect(v.remote.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove reference 1' }))
    expect(screen.queryByLabelText(en.referenceName)).toBeNull()
    await act(async () => { v.generation.set(undefined); await Promise.resolve() })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.cancel })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  })

  it('uses actual saved enable, reconnect, probe and remove operations with visible failures', async () => {
    const v = await view(managed())
    v.remote.setEnabled.mockResolvedValueOnce(failure('storage-failed'))
    fireEvent.click(screen.getByRole('switch', { name: 'Enable reader' }))
    await screen.findByText(en['storage-failed'])
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(v.remote.setEnabled).toHaveBeenCalledWith({ id: serverId, expectedRevision: 1, enabled: false })
    v.remote.reconnect.mockResolvedValueOnce(failure('not-ready'))
    fireEvent.click(screen.getByRole('button', { name: en.reconnect }))
    await screen.findByText(en['not-ready'])
    v.remote.probe.mockResolvedValueOnce(failure('probe-failed'))
    fireEvent.click(screen.getByRole('button', { name: en.refreshTools }))
    await screen.findByText(en['probe-failed'])
    expect(screen.getByText('read_document')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove reader' }))
    const confirmation = within(screen.getByRole('group', { name: en.confirmRemove }))
    v.remote.removeServer.mockResolvedValueOnce(failure('conflict'))
    fireEvent.click(confirmation.getByRole('button', { name: en.remove }))
    await screen.findByText(en.conflict)
    expect(screen.getByRole('group', { name: en.confirmRemove })).toBeTruthy()
    fireEvent.click(confirmation.getByRole('button', { name: en.remove }))
    await waitFor(() =>{  expect(screen.queryByRole('group', { name: en.confirmRemove })).toBeNull() })
  })

  it('pins owner-local visible empty, error and native states without credentials or a model', async () => {
    const v = await view()
    const visible = () => Array.from(v.container.querySelectorAll('h1,h2,h3,p,button,summary')).map(node =>
      node.tagName.toLowerCase() + ': ' + (node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '')).join('\n')
    const empty = visible()
    await act(async () => { v.fail('stopped'); await Promise.resolve() })
    await screen.findByText(en.stopped)
    const error = visible()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() =>{  expect(screen.getByRole('button', { name: en.add })).toHaveProperty('disabled', false) })
    await act(async () => { v.push(managed()); await Promise.resolve() })
    await screen.findByText('read_document')
    const output = '# MCP native settings\n\n## Empty\n\n' + empty + '\n\n## Error\n\n' + error + '\n\n## Native managed server\n\n' + visible() + '\n'
    expect(output).toBe(readFileSync('packages/client/ui-settings-mcp/tests/expected/native-states.expected.md', 'utf8'))
  })
})
