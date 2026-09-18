# MCP native settings

## Empty

h1: MCP
p: Manage servers for the current profile and inspect the tools they publish.
p: Profile: web
h2: Server list
p: Saved enabled state and live connection status are shown separately.
button: Add server
p: No managed MCP servers.
h2: Transport
p: Use stdio to run a command, or Streamable HTTP for an endpoint.
h2: Credential references
p: Enter a credential variable name, such as MCP_TOKEN, never its value. The Host resolves references when connecting.
h2: Tools
p: Descriptors come from tools/list. Refresh tools asks an active managed connection to list tools; it never invokes a tool or starts a disabled server.
p: No discovered tools.

## Error

h1: MCP
p: Manage servers for the current profile and inspect the tools they publish.
p: Profile: web
p: The MCP manager stopped. Retry after reconnecting to the Host.
button: Retry readback
h2: Server list
p: Saved enabled state and live connection status are shown separately.
button: Add server
p: No managed MCP servers.
h2: Transport
p: Use stdio to run a command, or Streamable HTTP for an endpoint.
h2: Credential references
p: Enter a credential variable name, such as MCP_TOKEN, never its value. The Host resolves references when connecting.
h2: Tools
p: Descriptors come from tools/list. Refresh tools asks an active managed connection to list tools; it never invokes a tool or starts a disabled server.
p: No discovered tools.

## Native managed server

h1: MCP
p: Manage servers for the current profile and inspect the tools they publish.
p: Profile: web
h2: Server list
p: Saved enabled state and live connection status are shown separately.
button: Add server
h3: reader
p: stdio
p: Saved state: Enabled
p: Connection: Ready
button: Enable reader
button: Edit reader
button: Reconnect
button: Refresh tools
button: Remove reader
h2: Transport
p: Use stdio to run a command, or Streamable HTTP for an endpoint.
h2: Credential references
p: Enter a credential variable name, such as MCP_TOKEN, never its value. The Host resolves references when connecting.
h2: Tools
p: Descriptors come from tools/list. Refresh tools asks an active managed connection to list tools; it never invokes a tool or starts a disabled server.
h3: reader
h3: read_document
p: Read one document.
summary: Input schema
