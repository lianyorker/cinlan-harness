/** Model-facing tools and deterministic exporters for durable findings. */

import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  ArtifactEngagementId,
  ArtifactId,
  ArtifactProducerId,
  ArtifactScopeRef,
  ArtifactSessionId,
  ArtifactTaskId,
} from '@deepseek-ai/dsh-artifact'
import type { ArtifactRef } from '@deepseek-ai/dsh-artifact'
import {
  FindingCursor,
  FindingError,
  FindingId,
  FindingRuleId,
  FindingTargetId,
} from '@deepseek-ai/dsh-finding'
import type {
  FindingCodeLocation,
  FindingDependencyLocation,
  FindingEvidence,
  FindingLocation,
  FindingProvenance,
  FindingQueryRequest,
  FindingReachability,
  FindingRecordRequest,
  FindingSnapshot,
  FindingTarget,
  FindingTransitionRequest,
} from '@deepseek-ai/dsh-finding'
import { ExecutionHostId } from '@deepseek-ai/dsh-execution-host'
import type {} from '@deepseek-ai/dsh-execution-host'
import type {} from '@deepseek-ai/dsh-assessment-scope-session'
import type {} from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, InferArgs, InferValue } from '@deepseek-ai/dsh-tools'
import { exportFindingsJson } from './export/json.ts'
import { exportFindingsMarkdown } from './export/markdown.ts'
import { exportFindingsSarif } from './export/sarif.ts'

const { version: packageVersion } = createRequire(import.meta.url)('../package.json') as { version: string }
const PACKAGE_NAME = '@deepseek-ai/dsh-tool-finding'
const REPORT_PRODUCER = ArtifactProducerId(PACKAGE_NAME)
const CONFIG_KEYS = new Set([
  'reportExecutionHostId',
  'defaultQueryLimit',
  'maxQueryLimit',
  'maxQueryResultBytes',
  'maxExportBytes',
])

/** Cordis plugin name. */
export const name = 'tool-finding'
/** Required Service Definition, provider, Artifact, and tool registries. */
export const inject = ['findings', 'artifacts', 'tools', 'executionHost']

/** Deployment policy for model-visible pages and report publication. */
export interface Config {
  /** Execution host attributed to report Artifacts. */
  readonly reportExecutionHostId?: string
  /** Default page size used by model-facing finding queries. */
  readonly defaultQueryLimit?: number
  /** Maximum page size accepted from finding query and export tools. */
  readonly maxQueryLimit?: number
  /** Maximum UTF-8 bytes returned to the model by one finding query. */
  readonly maxQueryResultBytes?: number
  /** Maximum report bytes published by one finding export. */
  readonly maxExportBytes?: number
}

interface ResolvedConfig {
  readonly reportExecutionHostId: ReturnType<typeof ExecutionHostId>
  readonly defaultQueryLimit: number
  readonly maxQueryLimit: number
  readonly maxQueryResultBytes: number
  readonly maxExportBytes: number
}

const DEFAULT_QUERY_LIMIT = 20
const DEFAULT_MAX_QUERY_LIMIT = 100
const DEFAULT_MAX_QUERY_RESULT_BYTES = 262_144
const DEFAULT_MAX_EXPORT_BYTES = 8_388_608

/** Schemastery configuration for model and report bounds. */
export const Config: z<Config> = z.object({
  reportExecutionHostId: z.string(),
  defaultQueryLimit: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_QUERY_LIMIT),
  maxQueryLimit: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_QUERY_LIMIT),
  maxQueryResultBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_QUERY_RESULT_BYTES),
  maxExportBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_EXPORT_BYTES),
})

const ARTIFACT_PROVENANCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    producerId: { type: 'string', required: true },
    executionHostId: { type: 'string', required: true },
    sessionId: { type: 'string' },
    taskId: { type: 'string' },
    engagementId: { type: 'string' },
    scopeRef: { type: 'string' },
    source: { type: 'string' },
  },
} as const

const ARTIFACT_REF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    artifactId: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    sha256: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
    provenance: { ...ARTIFACT_PROVENANCE_SCHEMA, required: true },
    retention: {
      type: 'string',
      required: true,
      enum: ['ephemeral', 'session', 'task', 'engagement', 'pinned', 'managed'],
    },
    redaction: { type: 'string', required: true, enum: ['none', 'redacted', 'unknown'] },
    name: { type: 'string' },
  },
} as const

const TARGET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: {
      type: 'string',
      required: true,
      enum: ['host', 'service', 'url', 'repository', 'package', 'file', 'component', 'other'],
    },
    displayName: { type: 'string', required: true },
  },
} as const

const CODE_LOCATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['code'] },
    targetId: { type: 'string', required: true },
    uri: { type: 'string', required: true },
    startLine: { type: 'integer' },
    startColumn: { type: 'integer' },
    endLine: { type: 'integer' },
    endColumn: { type: 'integer' },
  },
} as const

const DEPENDENCY_LOCATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['dependency'] },
    targetId: { type: 'string', required: true },
    ecosystem: { type: 'string', required: true },
    packageName: { type: 'string', required: true },
    version: { type: 'string' },
    manifestUri: { type: 'string' },
  },
} as const

const LOCATION_SCHEMA = { oneOf: [CODE_LOCATION_SCHEMA, DEPENDENCY_LOCATION_SCHEMA] } as const
const EVIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: {
      type: 'string',
      required: true,
      enum: ['observation', 'reproduction', 'remediation-validation', 'supporting'],
    },
    artifact: { ...ARTIFACT_REF_SCHEMA, required: true },
    note: { type: 'string' },
  },
} as const
const CVSS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'string', required: true, enum: ['3.1', '4.0'] },
    vector: { type: 'string', required: true },
    score: { type: 'number', required: true },
  },
} as const
const REACHABILITY_SCHEMA = {
  oneOf: [
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, enum: ['unknown'] } } },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, enum: ['unreachable'] },
        reason: { type: 'string', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, enum: ['reachable'] },
        entrypoint: { type: 'string', required: true },
        pathEvidence: ARTIFACT_REF_SCHEMA,
      },
    },
  ],
} as const

const PROVENANCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pluginId: { type: 'string', required: true },
    pluginVersion: { type: 'string', required: true },
    toolName: { type: 'string', required: true },
  },
} as const

const IDENTITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ruleId: { type: 'string', required: true },
    targetIds: { type: 'array', required: true, items: { type: 'string' } },
    locations: { type: 'array', required: true, items: LOCATION_SCHEMA },
  },
} as const

const SNAPSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    fingerprint: { type: 'string', required: true },
    identity: { ...IDENTITY_SCHEMA, required: true },
    ruleId: { type: 'string', required: true },
    title: { type: 'string', required: true },
    summary: { type: 'string', required: true },
    state: {
      type: 'string',
      required: true,
      enum: ['observation', 'hypothesis', 'reproduced-vulnerability', 'remediation', 'unresolved'],
    },
    severity: { type: 'string', required: true, enum: ['informational', 'low', 'medium', 'high', 'critical'] },
    confidence: { type: 'string', required: true, enum: ['low', 'medium', 'high'] },
    targets: { type: 'array', required: true, items: TARGET_SCHEMA },
    locations: { type: 'array', required: true, items: LOCATION_SCHEMA },
    cweIds: { type: 'array', required: true, items: { type: 'string' } },
    cveIds: { type: 'array', required: true, items: { type: 'string' } },
    cvss: CVSS_SCHEMA,
    assumptions: { type: 'array', required: true, items: { type: 'string' } },
    reachability: { ...REACHABILITY_SCHEMA, required: true },
    evidence: { type: 'array', required: true, items: EVIDENCE_SCHEMA },
    provenance: { type: 'array', required: true, items: PROVENANCE_SCHEMA },
    fixGuidance: { type: 'string' },
    occurrences: { type: 'integer', required: true },
    createdAt: { type: 'integer', required: true },
    updatedAt: { type: 'integer', required: true },
  },
} as const

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    ruleId: { type: 'string', required: true },
    title: { type: 'string', required: true },
    state: {
      type: 'string',
      required: true,
      enum: ['observation', 'hypothesis', 'reproduced-vulnerability', 'remediation', 'unresolved'],
    },
    severity: { type: 'string', required: true, enum: ['informational', 'low', 'medium', 'high', 'critical'] },
    confidence: { type: 'string', required: true, enum: ['low', 'medium', 'high'] },
    targetIds: { type: 'array', required: true, items: { type: 'string' } },
    evidenceCount: { type: 'integer', required: true },
    occurrences: { type: 'integer', required: true },
    updatedAt: { type: 'integer', required: true },
  },
} as const

const QUERY_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    detail: { type: 'string', required: true, enum: ['summary'] },
    items: { type: 'array', required: true, items: SUMMARY_SCHEMA },
    nextCursor: { type: 'string' },
  },
} as const
const QUERY_FULL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    detail: { type: 'string', required: true, enum: ['full'] },
    items: { type: 'array', required: true, items: SNAPSHOT_SCHEMA },
    nextCursor: { type: 'string' },
  },
} as const
const QUERY_OUTPUT_SCHEMA = { oneOf: [QUERY_SUMMARY_SCHEMA, QUERY_FULL_SCHEMA] } as const
const EXPORT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    format: { type: 'string', required: true, enum: ['json', 'markdown', 'sarif'] },
    findingCount: { type: 'integer', required: true },
    artifact: { ...ARTIFACT_REF_SCHEMA, required: true },
  },
} as const

const FILTER_PARAMETERS = {
  ids: { type: 'array', items: { type: 'string' } },
  states: {
    type: 'array',
    items: {
      type: 'string',
      enum: ['observation', 'hypothesis', 'reproduced-vulnerability', 'remediation', 'unresolved'],
    },
  },
  severities: {
    type: 'array',
    items: { type: 'string', enum: ['informational', 'low', 'medium', 'high', 'critical'] },
  },
  ruleIds: { type: 'array', items: { type: 'string' } },
  targetIds: { type: 'array', items: { type: 'string' } },
} as const

const RECORD_PARAMETERS = {
  ruleId: { type: 'string', required: true, description: 'Stable detector or rule identifier.' },
  title: { type: 'string', required: true },
  summary: { type: 'string', required: true },
  state: {
    type: 'string',
    required: true,
    enum: ['observation', 'hypothesis', 'reproduced-vulnerability'],
  },
  severity: { type: 'string', required: true, enum: ['informational', 'low', 'medium', 'high', 'critical'] },
  confidence: { type: 'string', required: true, enum: ['low', 'medium', 'high'] },
  targets: { type: 'array', required: true, items: TARGET_SCHEMA },
  locations: { type: 'array', required: true, items: LOCATION_SCHEMA },
  cweIds: { type: 'array', items: { type: 'string' } },
  cveIds: { type: 'array', items: { type: 'string' } },
  cvss: CVSS_SCHEMA,
  assumptions: { type: 'array', items: { type: 'string' } },
  reachability: { ...REACHABILITY_SCHEMA, required: true },
  evidence: { type: 'array', items: EVIDENCE_SCHEMA },
} as const

const TRANSITION_PARAMETERS = {
  findingId: { type: 'string', required: true },
  revision: { type: 'integer', required: true },
  to: {
    type: 'string',
    required: true,
    enum: ['hypothesis', 'reproduced-vulnerability', 'remediation', 'unresolved'],
  },
  evidence: { type: 'array', items: EVIDENCE_SCHEMA },
  fixGuidance: { type: 'string' },
} as const

const QUERY_PARAMETERS = {
  ...FILTER_PARAMETERS,
  cursor: { type: 'string' },
  limit: { type: 'integer' },
  detail: { type: 'string', enum: ['summary', 'full'] },
} as const

const EXPORT_PARAMETERS = {
  ...FILTER_PARAMETERS,
  format: { type: 'string', required: true, enum: ['json', 'markdown', 'sarif'] },
} as const

type ArtifactValue = InferValue<typeof ARTIFACT_REF_SCHEMA>
type LocationValue = InferValue<typeof LOCATION_SCHEMA>
type EvidenceValue = InferValue<typeof EVIDENCE_SCHEMA>
type ReachabilityValue = InferValue<typeof REACHABILITY_SCHEMA>
type RecordArgs = InferArgs<typeof RECORD_PARAMETERS>
type TransitionArgs = InferArgs<typeof TRANSITION_PARAMETERS>
type QueryArgs = InferArgs<typeof QUERY_PARAMETERS>
type ExportArgs = InferArgs<typeof EXPORT_PARAMETERS>
type SnapshotValue = InferValue<typeof SNAPSHOT_SCHEMA>
type QueryValue = InferValue<typeof QUERY_OUTPUT_SCHEMA>
type ExportValue = InferValue<typeof EXPORT_OUTPUT_SCHEMA>

/** Resolve config even when apply is called without Loader normalization. */
function resolveConfig(config: Config, actualHostId: ReturnType<typeof ExecutionHostId>): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-finding: unsupported config key ${JSON.stringify(key)}`)
  }
  const input: Partial<Config> = config
  const requestedHost = input.reportExecutionHostId?.trim()
  if (requestedHost !== undefined && requestedHost.length === 0) {
    throw new TypeError('tool-finding: reportExecutionHostId cannot be empty')
  }
  if (requestedHost !== undefined && requestedHost !== actualHostId) {
    throw new TypeError('tool-finding: reportExecutionHostId must match the active execution host')
  }
  const resolved = {
    reportExecutionHostId: actualHostId,
    defaultQueryLimit: config.defaultQueryLimit ?? DEFAULT_QUERY_LIMIT,
    maxQueryLimit: config.maxQueryLimit ?? DEFAULT_MAX_QUERY_LIMIT,
    maxQueryResultBytes: config.maxQueryResultBytes ?? DEFAULT_MAX_QUERY_RESULT_BYTES,
    maxExportBytes: config.maxExportBytes ?? DEFAULT_MAX_EXPORT_BYTES,
  }
  for (const [key, value] of Object.entries(resolved).filter(([key]) => key !== 'reportExecutionHostId')) {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new TypeError(`tool-finding: ${key} must be a positive safe integer`)
    }
  }
  if (resolved.defaultQueryLimit > resolved.maxQueryLimit) {
    throw new TypeError('tool-finding: defaultQueryLimit cannot exceed maxQueryLimit')
  }
  return resolved
}

/** Convert model JSON to one branded ArtifactRef. */
function artifactRef(value: ArtifactValue): ArtifactRef {
  return {
    artifactId: ArtifactId(value.artifactId),
    mediaType: value.mediaType,
    kind: value.kind,
    bytes: value.bytes,
    sha256: value.sha256,
    createdAt: value.createdAt,
    provenance: {
      producerId: ArtifactProducerId(value.provenance.producerId),
      executionHostId: ExecutionHostId(value.provenance.executionHostId),
      ...value.provenance.sessionId === undefined ? {} : { sessionId: ArtifactSessionId(value.provenance.sessionId) },
      ...value.provenance.taskId === undefined ? {} : { taskId: ArtifactTaskId(value.provenance.taskId) },
      ...value.provenance.engagementId === undefined
        ? {}
        : { engagementId: ArtifactEngagementId(value.provenance.engagementId) },
      ...value.provenance.scopeRef === undefined ? {} : { scopeRef: ArtifactScopeRef(value.provenance.scopeRef) },
      ...value.provenance.source === undefined ? {} : { source: value.provenance.source },
    },
    retention: value.retention,
    redaction: value.redaction,
    ...value.name === undefined ? {} : { name: value.name },
  }
}

/** Convert model JSON to one branded location. */
function location(value: LocationValue): FindingLocation {
  if (value.kind === 'dependency') {
    return {
      kind: 'dependency',
      targetId: FindingTargetId(value.targetId),
      ecosystem: value.ecosystem,
      packageName: value.packageName,
      ...value.version === undefined ? {} : { version: value.version },
      ...value.manifestUri === undefined ? {} : { manifestUri: value.manifestUri },
    } satisfies FindingDependencyLocation
  }
  return {
    kind: 'code',
    targetId: FindingTargetId(value.targetId),
    uri: value.uri,
    ...value.startLine === undefined ? {} : { startLine: value.startLine },
    ...value.startColumn === undefined ? {} : { startColumn: value.startColumn },
    ...value.endLine === undefined ? {} : { endLine: value.endLine },
    ...value.endColumn === undefined ? {} : { endColumn: value.endColumn },
  } satisfies FindingCodeLocation
}

/** Convert model JSON to one Artifact-backed evidence record. */
function evidence(value: EvidenceValue): FindingEvidence {
  return {
    role: value.role,
    artifact: artifactRef(value.artifact),
    ...value.note === undefined ? {} : { note: value.note },
  }
}

/** Convert model JSON to typed reachability. */
function reachability(value: ReachabilityValue): FindingReachability {
  if (value.kind === 'unknown') return { kind: 'unknown' }
  if (value.kind === 'unreachable') return { kind: 'unreachable', reason: value.reason }
  return {
    kind: 'reachable',
    entrypoint: value.entrypoint,
    ...value.pathEvidence === undefined ? {} : { pathEvidence: artifactRef(value.pathEvidence) },
  }
}

/** Build one trusted Consumer attribution. */
function source(toolName: string): FindingProvenance {
  return { pluginId: PACKAGE_NAME, pluginVersion: packageVersion, toolName }
}

/** Convert one model record to the Service Definition request. */
function recordRequest(args: RecordArgs): FindingRecordRequest {
  return {
    ruleId: FindingRuleId(args.ruleId),
    title: args.title,
    summary: args.summary,
    state: args.state,
    severity: args.severity,
    confidence: args.confidence,
    targets: args.targets.map((target): FindingTarget => ({
      id: FindingTargetId(target.id),
      kind: target.kind,
      displayName: target.displayName,
    })),
    locations: args.locations.map(location),
    ...args.cweIds === undefined ? {} : { cweIds: args.cweIds },
    ...args.cveIds === undefined ? {} : { cveIds: args.cveIds },
    ...args.cvss === undefined ? {} : { cvss: args.cvss },
    ...args.assumptions === undefined ? {} : { assumptions: args.assumptions },
    reachability: reachability(args.reachability),
    ...args.evidence === undefined ? {} : { evidence: args.evidence.map(evidence) },
  }
}

/** Convert one model transition to the Service Definition request. */
function transitionRequest(args: TransitionArgs): FindingTransitionRequest {
  return {
    to: args.to,
    ...args.evidence === undefined ? {} : { evidence: args.evidence.map(evidence) },
    ...args.fixGuidance === undefined ? {} : { fixGuidance: args.fixGuidance },
  }
}

/** Convert shared model filters to branded Service Definition filters. */
function queryRequest(
  args: QueryArgs | ExportArgs,
  limit: number,
  cursor?: string,
): FindingQueryRequest {
  return {
    ...args.ids === undefined ? {} : { ids: args.ids.map(FindingId) },
    ...args.states === undefined ? {} : { states: args.states },
    ...args.severities === undefined ? {} : { severities: args.severities },
    ...args.ruleIds === undefined ? {} : { ruleIds: args.ruleIds.map(FindingRuleId) },
    ...args.targetIds === undefined ? {} : { targetIds: args.targetIds.map(FindingTargetId) },
    ...cursor === undefined ? {} : { cursor: FindingCursor(cursor) },
    limit,
  }
}

/** Detach readonly domain snapshots into canonical JSON output values. */
function snapshotValue(snapshot: FindingSnapshot): SnapshotValue {
  return structuredClone(snapshot) as unknown as SnapshotValue
}

/** Detach one Artifact reference into the declared JSON output. */
function artifactValue(artifact: ArtifactRef): ArtifactValue {
  return structuredClone(artifact)
}

/** Build one compact model-facing summary. */
function summaryValue(snapshot: FindingSnapshot): InferValue<typeof SUMMARY_SCHEMA> {
  return {
    id: snapshot.id,
    revision: snapshot.revision,
    ruleId: snapshot.ruleId,
    title: snapshot.title,
    state: snapshot.state,
    severity: snapshot.severity,
    confidence: snapshot.confidence,
    targetIds: [...snapshot.identity.targetIds],
    evidenceCount: snapshot.evidence.length,
    occurrences: snapshot.occurrences,
    updatedAt: snapshot.updatedAt,
  }
}

/** Render canonical tool values as compact JSON model content. */
function renderJson(_args: unknown, value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Return a generic args-only UI card. */
function present(title: string, kind: 'read' | 'other', rawInput: unknown): GenericCallView {
  return { card: 'generic', title, kind, rawInput }
}

/** Reject an oversized complete model result. */
function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new FindingError(
      `complete finding tool result is ${bytes} bytes; limit is ${maxBytes}`,
      'FINDING_RESULT_LIMIT_EXCEEDED',
    )
  }
}

/** Require the live Agent identity carried by top-level tool execution. */
function executionAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new FindingError('finding tools require an Agent execution', 'FINDING_AGENT_NOT_LIVE')
  return agent
}

/**
 * Register the four finding tools.
 * @param ctx - Cordis context with finding and Artifact services.
 * @param config - Bounded tool and exporter configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config, ctx.executionHost.current().hostId)

  ctx.tools.register(defineTool({
    name: 'finding_record',
    description: 'Record a typed same-session security finding. The service derives id and fingerprint; repeated identities add one occurrence without promoting state.',
    parameters: RECORD_PARAMETERS,
    output: { schema: SNAPSHOT_SCHEMA, render: renderJson },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const finding = await ctx.findings.record(
        executionAgent(exec.agent),
        recordRequest(args),
        source('finding_record'),
        { signal: exec.signal },
      )
      return snapshotValue(finding)
    },
    presentCall: args => present('Record finding', 'other', args.title),
  }))

  ctx.tools.register(defineTool({
    name: 'finding_transition',
    description: 'Transition one exact finding revision. Reproduction and remediation states require their typed evidence prerequisites.',
    parameters: TRANSITION_PARAMETERS,
    output: { schema: SNAPSHOT_SCHEMA, render: renderJson },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const finding = await ctx.findings.transition(
        executionAgent(exec.agent),
        { id: FindingId(args.findingId), revision: args.revision },
        transitionRequest(args),
        source('finding_transition'),
        { signal: exec.signal },
      )
      return snapshotValue(finding)
    },
    presentCall: args => present('Transition finding', 'other', args.findingId),
  }))

  ctx.tools.register(defineTool({
    name: 'finding_query',
    description: 'Read a bounded deterministic page of same-session findings. Use exact ids and revisions before a transition.',
    parameters: QUERY_PARAMETERS,
    output: { schema: QUERY_OUTPUT_SCHEMA, render: renderJson },
    async execute(args, exec): Promise<QueryValue> {
      const agent = executionAgent(exec.agent)
      const limit = args.limit ?? resolved.defaultQueryLimit
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > resolved.maxQueryLimit) {
        throw new FindingError(`limit must be between 1 and ${resolved.maxQueryLimit}`, 'FINDING_LIMIT_EXCEEDED')
      }
      const detail = args.detail ?? 'summary'
      const page = await ctx.findings.query(
        agent,
        queryRequest(args, limit, args.cursor),
        { signal: exec.signal },
      )
      const value: QueryValue = detail === 'full'
        ? {
          detail: 'full',
          items: page.items.map(snapshotValue),
          ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor },
        }
        : {
          detail: 'summary',
          items: page.items.map(summaryValue),
          ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor },
        }
      enforceResultBytes(value, resolved.maxQueryResultBytes)
      return value
    },
    presentCall: args => present('Query findings', 'read', args),
  }))

  ctx.tools.register(defineTool({
    name: 'finding_export',
    description: 'Export every matching same-session finding as deterministic JSON, Markdown, or SARIF 2.1.0 and publish one report Artifact.',
    parameters: EXPORT_PARAMETERS,
    output: { schema: EXPORT_OUTPUT_SCHEMA, render: renderJson },
    async execute(args, exec): Promise<ExportValue> {
      const agent = executionAgent(exec.agent)
      const findings: FindingSnapshot[] = []
      let cursor: ReturnType<typeof FindingCursor> | undefined
      do {
        exec.signal.throwIfAborted()
        const page = await ctx.findings.query(
          agent,
          queryRequest(args, resolved.maxQueryLimit, cursor),
          { signal: exec.signal },
        )
        findings.push(...page.items)
        cursor = page.nextCursor
      } while (cursor !== undefined)
      const data = args.format === 'json'
        ? exportFindingsJson(findings)
        : args.format === 'markdown'
          ? exportFindingsMarkdown(findings)
          : exportFindingsSarif(findings, packageVersion)
      if (data.byteLength > resolved.maxExportBytes) {
        throw new FindingError(
          `complete ${args.format} report is ${data.byteLength} bytes; limit is ${resolved.maxExportBytes}`,
          'FINDING_LIMIT_EXCEEDED',
        )
      }
      exec.signal.throwIfAborted()
      const scopeSessions = ctx.get('assessmentScopeSessions')
      if (scopeSessions !== undefined) {
        const grant = scopeSessions.require(agent.session)
        const targetIds = new Set(findings.flatMap(finding => finding.targets.map(target => String(target.id))))
        if (targetIds.size === 0) {
          const target = grant.targets.find(item => !grant.excludedTargetIds.includes(item.id))
          if (target === undefined) throw new FindingError('finding export requires an authorized target', 'FINDING_SCOPE_DENIED')
          targetIds.add(String(target.id))
        }
        for (const targetId of [...targetIds].sort()) {
          const decision = scopeSessions.authorize(agent.session, {
            action: 'report-download', targetId: targetId as never, executionHostId: resolved.reportExecutionHostId,
            evidence: { retainUntil: grant.evidence.retainUntil, redaction: 'none' },
          })
          if (decision.outcome !== 'allow') throw new FindingError(
            'finding export denied by assessment scope (' + decision.code + ')', 'FINDING_SCOPE_DENIED',
          )
        }
        const sessions = ctx.get('sessions')
        if (sessions === undefined || !await sessions.flush(agent.session)) {
          throw new FindingError('finding export could not checkpoint authorization', 'FINDING_SCOPE_DENIED')
        }
      }
      const sessionId = ArtifactSessionId(agent.session.id)
      const provenance = {
        executionHostId: resolved.reportExecutionHostId,
        producerId: REPORT_PRODUCER,
        sessionId,
        source: 'finding_export',
      }
      const mediaType = args.format === 'json'
        ? 'application/json'
        : args.format === 'markdown' ? 'text/markdown' : 'application/sarif+json'
      const artifact = await ctx.artifacts.publish({
        data,
        mediaType,
        kind: 'report',
        name: args.format === 'sarif' ? 'security-findings.sarif.json' : `security-findings.${args.format === 'markdown' ? 'md' : 'json'}`,
        provenance,
        authorization: provenance,
        retention: 'session',
        redaction: 'unknown',
      })
      return { format: args.format, findingCount: findings.length, artifact: artifactValue(artifact) }
    },
    presentCall: args => present('Export findings', 'other', args.format),
  }))
}

export { exportFindingsJson } from './export/json.ts'
export { exportFindingsMarkdown } from './export/markdown.ts'
export { exportFindingsSarif } from './export/sarif.ts'
