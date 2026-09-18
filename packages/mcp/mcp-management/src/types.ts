/** Desired MCP configuration and redacted current-profile management views. */
import type { CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import type { McpConnectionSnapshot, McpConnectionState, McpServerId, ReconnectConfig } from '@deepseek-ai/dsh-mcp-client/types'

/** One header assembled privately from a credential reference and a non-secret prefix. */
export interface McpHeaderReference {
  ref: CredentialRef
  prefix: string
}

/** Shared desired configuration; omitted timing fields use the bridge's resolved defaults. */
export interface McpServerCommon {
  serverName: string
  enabled: boolean
  toolCallTimeoutMs?: number
  reconnect?: ReconnectConfig
}

/** Spawn arguments are literal values; secrets belong in environment credential references. */
export interface McpStdioServer extends McpServerCommon {
  transport: 'stdio'
  command: string
  args: string[]
  cwd: string
  env: Record<string, CredentialRef>
}

/** Endpoint credentials use headers; URLs exclude userinfo, query strings, and fragments. */
export interface McpHttpServer extends McpServerCommon {
  transport: 'streamable-http'
  url: string
  headers: Record<string, McpHeaderReference>
}

/** The configuration editable through the manager, without a durable identity. */
export type McpServerInput = McpStdioServer | McpHttpServer
/** One committed configuration record; identity survives changes to its public namespace. */
export type McpServerRecord = McpServerInput & { id: McpServerId }

/** Independent desired and observed state for one manager-owned record. */
export interface McpManagedServerView {
  record: McpServerRecord
  observed: McpConnectionState
  applying: boolean
}

/** Root connection owned by an external composition; management never grants it mutation authority. */
export type McpExternalServerView = Omit<McpConnectionSnapshot, 'owner'> & {
  owner: Extract<McpConnectionSnapshot['owner'], { kind: 'composition' }>
}

/** Complete current-profile readback; external entries are observational only. */
export interface McpManagementSnapshot {
  profile: string
  revision: number
  reconciling: boolean
  servers: readonly McpManagedServerView[]
  external: readonly McpExternalServerView[]
}

/** Create when id is absent; otherwise replace the identified desired record. */
export interface McpSaveRequest {
  id?: McpServerId
  record: McpServerInput
  expectedRevision: number
}
/** Result identifies a newly created record without matching on user-supplied text. */
export interface McpSaveResult {
  id: McpServerId
  snapshot: McpManagementSnapshot
}
/** Mutations compare the revision of the complete current-profile desired collection. */
export interface McpRemoveRequest { id: McpServerId; expectedRevision: number }
/** Persist the desired switch before applying it to the owned child lifetime. */
export interface McpSetEnabledRequest extends McpRemoveRequest { enabled: boolean }
/** Address only a manager-owned record in the current profile. */
export interface McpServerRequest { id: McpServerId }
/** Fixed operation failures safe for Remote errors and localized UI copy. */
export type McpManagementErrorCode = 'conflict' | 'invalid-config' | 'not-found' | 'disabled' | 'not-ready'
  | 'storage-failed' | 'stopped' | 'probe-failed' | 'close-failed'
