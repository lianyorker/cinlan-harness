/** Editable text fields retain their opening revision and optional bridge overrides. */
import type { McpServerInput, McpServerRecord, McpSaveRequest, McpServerId } from '@deepseek-ai/dsh-api-mcp-controller/types'

/** One reference row contains variable names, never credential values. */
export interface ReferenceDraft { name: string; ref: string; prefix: string }

/** Form state survives readback changes without rebasing its compare-and-swap revision. */
export interface McpDraft {
  id?: McpServerId
  expectedRevision: number
  serverName: string
  enabled: boolean
  transport: McpServerInput['transport']
  command: string
  args: string
  originalArgs?: string[]
  cwd: string
  url: string
  env: ReferenceDraft[]
  headers: ReferenceDraft[]
  toolCallTimeoutMs?: number
  reconnect?: McpServerInput['reconnect']
}

/**
 * Build a draft without filling omitted timing overrides.
 * @param revision - opening revision.
 * @param record - saved record when editing.
 * @returns independent form fields.
 */
export function openDraft(revision: number, record?: McpServerRecord): McpDraft {
  return {
    expectedRevision: revision, serverName: record?.serverName ?? '', enabled: record?.enabled ?? false,
    transport: record?.transport ?? 'stdio', command: record?.transport === 'stdio' ? record.command : '',
    args: record?.transport === 'stdio' ? record.args.join('\n') : '', cwd: record?.transport === 'stdio' ? record.cwd : '',
    url: record?.transport === 'streamable-http' ? record.url : '',
    ...(record?.transport === 'stdio' ? { originalArgs: [...record.args] } : {}),
    env: record?.transport === 'stdio' ? Object.entries(record.env).map(([name, ref]) => ({ name, ref, prefix: '' })) : [],
    headers: record?.transport === 'streamable-http'
      ? Object.entries(record.headers).map(([name, { ref, prefix }]) => ({ name, ref, prefix })) : [],
    ...(record === undefined ? {} : { id: record.id }),
    ...(record?.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: record.toolCallTimeoutMs }),
    ...(record?.reconnect === undefined ? {} : { reconnect: { ...record.reconnect } }),
  }
}

/**
 * Parse form text and reject unsafe endpoint components.
 * @param draft - current user input.
 * @returns a validated request, or undefined for invalid fields.
 */
export function draftRequest(draft: McpDraft): McpSaveRequest | undefined {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(draft.serverName)) return
  const refs = draft.transport === 'stdio' ? draft.env : draft.headers
  const names = new Set<string>()
  for (const row of refs) {
    const name = draft.transport === 'stdio' ? row.name : row.name.toLowerCase()
    if (names.has(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.ref)) return
    if (draft.transport === 'stdio' ? !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) : !/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name)) return
    if (/[\r\n]/.test(row.prefix)) return
    names.add(name)
  }
  const common = {
    serverName: draft.serverName, enabled: draft.enabled,
    ...(draft.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: draft.toolCallTimeoutMs }),
    ...(draft.reconnect === undefined ? {} : { reconnect: draft.reconnect }),
  }
  let record: McpServerInput
  if (draft.transport === 'stdio') {
    if (draft.command.trim() === '') return
    record = { ...common, transport: 'stdio', command: draft.command,
      args: draft.originalArgs !== undefined && draft.args === draft.originalArgs.join('\n')
        ? [...draft.originalArgs] : draft.args === '' ? [] : draft.args.split('\n'), cwd: draft.cwd,
      env: Object.fromEntries(draft.env.map(row => [row.name, row.ref])) as Extract<McpServerInput, { transport: 'stdio' }>['env'] }
  } else {
    let url: URL
    try { url = new URL(draft.url) } catch { return }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || draft.url.includes('?') || draft.url.includes('#') || /^https?:[/][/][^/]*@/i.test(draft.url)) return
    record = { ...common, transport: 'streamable-http', url: draft.url,
      headers: Object.fromEntries(draft.headers.map(row => [row.name, { ref: row.ref, prefix: row.prefix }])) as Extract<McpServerInput, { transport: 'streamable-http' }>['headers'] }
  }
  return { ...(draft.id === undefined ? {} : { id: draft.id }), expectedRevision: draft.expectedRevision, record }
}
