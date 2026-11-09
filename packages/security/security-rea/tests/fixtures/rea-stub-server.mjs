/**
 * Deterministic stand-in for the `rea-agents` MCP stdio server. Exposes a small
 * representative subset of `mcp__rea__*` tools with fixed results so session
 * snapshots stay portable: no real REA process, no version lock, no absolute
 * paths. Used by the `rea-routing` snapshot and by security-rea unit tests.
 *
 * Protocol: newline-delimited JSON-RPC 2.0 on stdio.
 * Run: `node rea-stub-server.mjs [mcp]` — the extra arg mirrors the real CLI and
 * is ignored.
 */

const TOOLS = [
  {
    name: 'binary_overview',
    description: 'Return the bound document and exhaustive procedure/string counts, plus every segment and segment_count.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'open_binary',
    description: 'Open a local executable, application bundle, archive, JavaScript, source map, plist, or analysis database after validation.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute local filesystem path for the analysis target' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'inspect_binary_layout',
    description: 'Inspect an explicit local binary without launching it as a host process. Returns file-backed section/segment ranges.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute filesystem path to the selected binary' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'inspect_pe_imports',
    description: 'Inspect one explicit local PE32/PE32+ image\'s import and delay-load tables without executing it.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute filesystem path to a PE image' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_function',
    description: 'Build a dossier for one native function identified by symbol or provider-returned address.',
    inputSchema: {
      type: 'object',
      properties: {
        procedure: { type: 'string', description: 'Symbol name or provider-normalized address' },
        detail: { type: 'string', enum: ['complete', 'summary'] },
      },
      required: ['procedure'],
      additionalProperties: false,
    },
  },
  {
    // Dynamic-lane tool: absent from REA_DEFAULT_TOOL_NAMES, so the default
    // allowlist filters it out and `additionalTools` must re-admit it.
    name: 'instrument_with_frida',
    description: 'Run one caller-authored Frida script against an explicitly selected process and detach when the observation window ends.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['attach', 'spawn'] },
        source: { type: 'string', description: 'Frida script source' },
        source_kind: { type: 'string', enum: ['inline', 'file'] },
      },
      required: ['mode', 'source', 'source_kind'],
      additionalProperties: false,
    },
  },
]

/** Fixed tool results; recorded into snapshots, so keep them stable forever. */
const RESULTS = {
  binary_overview: { document: 'reveal.exe', procedures: 12, strings: 87, segments: 4, segmentCount: 4 },
  open_binary: { opened: true, provider: 'stub', target: 'reveal.exe' },
  inspect_binary_layout: { sections: ['.text', '.rdata', '.data', '.rsrc'], imageBase: '0x400000' },
  inspect_pe_imports: { dlls: ['KERNEL32.dll', 'USER32.dll'], imphash: 'stubstubstubstubstubstubstubstub01' },
  analyze_function: { pseudocode: 'int sub_401000(void) { return stub_constant(); }', basicBlocks: 3 },
  instrument_with_frida: { session: 'stub-session-0001', instrumented: true },
}

const send = (payload) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const replyError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

const toolResult = (name) => {
  const body = RESULTS[name]
  const text = body === undefined
    ? `Error: {"error":{"code":"unknown_tool","message":"stub server has no ${name}"}}`
    : JSON.stringify(body)
  return { content: [{ type: 'text', text }], isError: body === undefined }
}

const handle = (message) => {
  const { id, method, params } = message
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'rea-stub', version: '0.0.0-stub' },
      })
      return
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return
    case 'ping':
      reply(id, {})
      return
    case 'tools/list':
      reply(id, { tools: TOOLS })
      return
    case 'tools/call':
      reply(id, toolResult(params?.name ?? ''))
      return
    case 'prompts/list':
      reply(id, { prompts: [] })
      return
    case 'resources/list':
      reply(id, { resources: [] })
      return
    default:
      if (id !== undefined) replyError(id, -32601, `method not implemented: ${String(method)}`)
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line.length === 0) continue
    try {
      handle(JSON.parse(line))
    } catch {
      // Malformed frame; keep serving.
    }
  }
})
