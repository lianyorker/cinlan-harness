import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'mcp/conflict': {}
    'mcp/invalid-config': {}
    'mcp/not-found': {}
    'mcp/disabled': {}
    'mcp/not-ready': {}
    'mcp/storage-failed': {}
    'mcp/stopped': {}
    'mcp/probe-failed': {}
    'mcp/close-failed': {}
  }
}

/** MCP Remote uses the manager's redacted views and revisioned operations verbatim. */
export type {
  McpHeaderReference, McpServerCommon, McpStdioServer, McpHttpServer, McpServerInput, McpServerRecord,
  McpManagedServerView, McpExternalServerView, McpManagementSnapshot, McpSaveRequest, McpSaveResult, McpRemoveRequest,
  McpSetEnabledRequest, McpServerRequest, McpManagementErrorCode,
} from '@deepseek-ai/dsh-mcp-management/types'
export type { McpServerId, McpConnectionSnapshot, McpConnectionState, McpToolDescriptor } from '@deepseek-ai/dsh-mcp-client/types'
