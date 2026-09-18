/** Text parsing keeps CAS and timing values and admits only credential references. */
import { describe, expect, it } from 'vitest'
import { draftRequest, openDraft } from '../src/client/draft.ts'
import { createMcpSettingsStore } from '../src/client/store.ts'
import { record } from './fixture.client.ts'

describe('MCP drafts', () => {
  it('preserves optional timing overrides and literal argv when editing other fields', () => {
    const original = record({ toolCallTimeoutMs: 1234, reconnect: { enabled: false, maxAttempts: 7 }, args: ['', 'with\nnewline'] })
    const draft = openDraft(9, original)
    draft.serverName = 'changed'
    expect(draftRequest(draft)).toEqual({ id: original.id, expectedRevision: 9,
      record: { ...original, id: undefined, serverName: 'changed' } })
    expect(draftRequest(openDraft(0))).toBeUndefined()
    expect(draftRequest({ ...openDraft(0), serverName: 'valid_name' })).toBeUndefined()
    const fresh = { ...openDraft(0), serverName: 'new_server', command: 'node', args: 'first\nsecond' }
    expect(draftRequest(fresh)?.record).toEqual({ serverName: 'new_server', enabled: false,
      transport: 'stdio', command: 'node', args: ['first', 'second'], cwd: '', env: {} })
  })

  it('keeps failed edits and confirmation revisions until explicit cancellation', () => {
    const store = createMcpSettingsStore().create()
    store.actions.open(4, record())
    store.actions.patch({ serverName: 'edited' })
    store.actions.addReference('env')
    store.actions.changeReference('env', 0, { name: 'TOKEN', ref: 'MCP_TOKEN' })
    expect(draftRequest(store.getSnapshot().draft!)?.expectedRevision).toBe(4)
    const saved = draftRequest(store.getSnapshot().draft!)!.record
    expect(saved).toMatchObject({ env: { TOKEN: 'MCP_TOKEN' } })
    expect(openDraft(4, { ...saved, id: record().id }).env).toEqual([{ name: 'TOKEN', ref: 'MCP_TOKEN', prefix: '' }])
    store.actions.removeReference('env', 0)
    store.actions.confirmRemove({ id: record().id, expectedRevision: 3 })
    expect(store.getSnapshot().removing?.expectedRevision).toBe(3)
    store.actions.cancel()
    store.actions.confirmRemove(null)
    store.actions.patch({ command: 'ignored' })
    store.actions.changeReference('env', 0, { ref: 'ignored' })
    store.actions.removeReference('env', 0)
    store.actions.addReference('env')
    expect(store.getSnapshot()).toEqual({ draft: null, removing: null })
  })

  it('round trips HTTP header references with a trailing prefix space', () => {
    const draft = { ...openDraft(2), transport: 'streamable-http' as const, serverName: 'remote', url: 'https://mcp.example/service',
      headers: [{ name: 'Authorization', ref: 'MCP_TOKEN', prefix: 'Bearer ' }] }
    const request = draftRequest(draft)!
    expect(request.record).toMatchObject({ headers: { Authorization: { ref: 'MCP_TOKEN', prefix: 'Bearer ' } } })
    expect(draftRequest(openDraft(2, { ...request.record, id: record().id }))?.record).toEqual(request.record)
  })

  it.each(['https://user:secret@example.test', 'https://@example.test', 'https://example.test?token=x',
    'https://example.test?', 'https://example.test#fragment', 'https://example.test#', 'file:///tmp/mcp', 'invalid'])('rejects endpoint %s', (url) => {
    expect(draftRequest({ ...openDraft(0), serverName: 'remote', transport: 'streamable-http', url })).toBeUndefined()
  })

  it.each([
    [{ name: 'TOKEN', ref: 'secret-value', prefix: '' }],
    [{ name: 'BAD NAME', ref: 'MCP_TOKEN', prefix: '' }],
    [{ name: 'TOKEN', ref: 'MCP_TOKEN', prefix: '' }, { name: 'TOKEN', ref: 'OTHER_TOKEN', prefix: '' }],
  ])('rejects invalid environment reference rows', (...env) => {
    expect(draftRequest({ ...openDraft(0), serverName: 'local', command: 'node', env })).toBeUndefined()
  })

  it('rejects duplicate header names and line breaks without changing public prefixes', () => {
    const base = { ...openDraft(0), serverName: 'remote', transport: 'streamable-http' as const, url: 'https://example.test' }
    for (const headers of [
      [{ name: 'Bad Name', ref: 'TOKEN', prefix: '' }],
      [{ name: 'Authorization', ref: 'TOKEN', prefix: '' }, { name: 'authorization', ref: 'TOKEN', prefix: '' }],
      [{ name: 'Authorization', ref: 'TOKEN', prefix: '\r\nInjected: value' }],
    ]) expect(draftRequest({ ...base, headers })).toBeUndefined()
    expect(draftRequest({ ...base, serverName: 'bad.name' })).toBeUndefined()
  })
})
