/** Real HTTP MCP endpoint with owned request barriers and upstream failure responses. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export async function startControlledHttpFixture() {
  let failing = false
  let toolName = 'ping'
  let gate: { requested: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> } | undefined
  const methods: string[] = []
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let body: unknown
    if (request.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    }
    const method = body !== null && typeof body === 'object' && 'method' in body ? String(body.method) : ''
    methods.push(method)
    if (method === 'tools/list') {
      gate?.requested.resolve()
      if (gate !== undefined) await gate.release.promise
      if (failing) { response.writeHead(503).end('fixture upstream credential=should-never-leak'); return }
    }
    const mcp = new McpServer({ name: 'controlled-http', version: '1.0.0' })
    mcp.registerTool(toolName, { description: 'Controlled fixture tool', inputSchema: {} }, async () => ({
      content: [{ type: 'text', text: 'done' }],
    }))
    const transport = new StreamableHTTPServerTransport({})
    response.on('close', () => { void transport.close(); void mcp.close() })
    await mcp.connect(transport as Transport)
    await transport.handleRequest(request, response, body)
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => { response.writeHead(500).end('fixture request failed') })
  })
  const listening: PromiseWithResolvers<void> = Promise.withResolvers()
  server.once('error', listening.reject)
  server.listen(0, '127.0.0.1', listening.resolve)
  await listening.promise
  server.off('error', listening.reject)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture has no listening address')
  return {
    url: 'http://127.0.0.1:' + String(address.port) + '/mcp', methods,
    failLists(value: boolean) { failing = value },
    setTool(name: string) { toolName = name },
    holdList() {
      const requested: PromiseWithResolvers<void> = Promise.withResolvers()
      const release: PromiseWithResolvers<void> = Promise.withResolvers()
      gate = { requested, release }
      return { requested: requested.promise, release: () => { release.resolve(); gate = undefined } }
    },
    async close(): Promise<void> {
      gate?.release.resolve()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
    },
  }
}
