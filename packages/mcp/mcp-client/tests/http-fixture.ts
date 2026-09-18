/** Keyless stateless Streamable HTTP MCP fixture for integration tests. */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

/** Running HTTP fixture and the request headers it observed. */
export interface HttpMcpFixture {
  url: string
  authorization: Array<string | undefined>
  methods: string[]
  setAuthorization(value: string | undefined): void
  setTools(tools: readonly { name: string; description: string }[]): void
  close: () => Promise<void>
}

/** Start a local stateless MCP endpoint exposing one `ping` tool. */
export async function startHttpMcpFixture(): Promise<HttpMcpFixture> {
  const authorization: Array<string | undefined> = []
  const methods: string[] = []
  let requiredAuthorization: string | undefined
  let tools: readonly { name: string; description: string }[] = [{ name: 'ping', description: 'Replies pong.' }]
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    authorization.push(request.headers.authorization)
    if (requiredAuthorization !== undefined && request.headers.authorization !== requiredAuthorization) {
      response.writeHead(401).end('Authorization failed: ' + String(request.headers.authorization))
      return
    }
    let body: unknown
    if (request.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      if (body !== null && typeof body === 'object' && 'method' in body) methods.push(String(body.method))
    }
    const mcp = new McpServer(
      { name: 'http-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    for (const tool of tools) {
      mcp.registerTool(tool.name, { description: tool.description, inputSchema: {} }, async () => ({
        content: [{ type: 'text', text: 'pong' }],
      }))
    }
    if (tools.length === 0) mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))
    const transport = new StreamableHTTPServerTransport({})
    response.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport as Transport)
    await transport.handleRequest(request, response, body)
  }
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      response.writeHead(500).end(String(error))
    })
  })
  const listening: PromiseWithResolvers<void> = Promise.withResolvers()
  server.listen(0, '127.0.0.1', listening.resolve)
  await listening.promise
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP MCP fixture has no TCP address')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    authorization,
    methods,
    setAuthorization(value) { requiredAuthorization = value },
    setTools(value) { tools = value },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    }),
  }
}
