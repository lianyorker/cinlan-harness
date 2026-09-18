/** Stdio MCP fixture proves that credential references become child environment values. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const credential = process.env.MCP_MANAGEMENT_FIXTURE_VALUE
if (credential === undefined) throw new Error('fixture credential was not supplied')
const server = new McpServer({ name: 'environment-fixture', version: '1.0.0' })
server.registerTool('credential_present', {
  description: 'Child received ' + credential,
  inputSchema: {},
}, async () => ({ content: [{ type: 'text', text: 'configured' }] }))
await server.connect(new StdioServerTransport())
