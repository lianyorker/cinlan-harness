# Security research

English | [中文](security-research.zh.md)

## Summary

Security research uses explicit assessment grants to authorize operations, durable findings to retain evidence and lifecycle state, and vulnerability knowledge bases to look up published advisories. This reference covers the types declared in `packages/security`; grant decisions describe whether an effect is permitted, while effect adapters perform the operation. Finding revisions and trusted Consumer attribution keep subsequent records tied to their evidence and origin.

## Table of Contents

- [Assessment grants](#assessment-grants)
- [Session assessment state](#session-assessment-state)
- [Durable findings](#durable-findings)
- [Vulnerability knowledge base](#vulnerability-knowledge-base)
- [Skill resources](#skill-resources)
- [Dev Note](#dev-note)

<a id="assessment-grants"></a>

## Assessment grants

The [assessment declarations](../../packages/security/assessment-scope/src/types.ts) define immutable grants and normalized operation requests. `AssessmentScopePolicy` in the [Service Definition](../../packages/security/assessment-scope/src/index.ts) owns root restoration, child narrowing, time classification, and authorization decisions. Fields are readonly unless stated otherwise; `?` marks optional fields in the tables.

| Type | Fields and meaning |
|---|---|
| `AssessmentEngagementId`, `AssessmentGrantId`, `AssessmentTargetId`, `AssessmentDecisionId`, `AssessmentAuthorizationRef` | Branded strings for the engagement, immutable grant, declared target, pre-effect decision, and non-secret written-authorization reference. |
| `AssessmentAction` | `reconnaissance`, `active-validation`, `credential-use`, `persistence-change`, `exploit-execution`, `destructive-operation`, `report-download`, `data-export`, `external-reporting`. |
| `AssessmentTargetKind`, `AssessmentTarget` | Kind: `hostname`, `ip-address`, `url-prefix`, `artifact-scope`, `service`. Target: `id: AssessmentTargetId`, `kind: AssessmentTargetKind`, `value: string`; effect adapters own target-value normalization. |
| `AssessmentEgressProtocol`, `AssessmentEgressPurpose` | Protocol: `http`, `https`, `tcp`, `udp`. Purpose: `model-provider`, `web-search`, `target-access`, `artifact-export`, `external-reporting`. |
| `AssessmentEgressGrant` | `protocol`, `host: string`, `port: number`, `purpose`, `targetId: AssessmentTargetId` identify an exact target-scoped destination. |
| `AssessmentCredentialPurpose`, `AssessmentCredentialGrant` | Purpose: `model-provider`, `web-search`, `target-authentication`, `artifact-store`, `external-reporting`. Grant: `ref: CredentialRef`, `purpose`, `targetId`; it carries a credential reference, never its secret value. |
| `AssessmentEvidenceRedaction`, `AssessmentExternalReportingPolicy` | Redaction: `none`, `secrets`, `sensitive`. External reporting: `deny`, `approval-required`, `allow`. |
| `AssessmentEvidencePolicy` | `retainUntil: number` in epoch milliseconds, `minimumRedaction: AssessmentEvidenceRedaction`, `externalReporting: AssessmentExternalReportingPolicy`. |
| `AssessmentGrant` | `version: 1`, `engagementId`, `grantId`, `parentGrantId?`, `authorizationRef`, `notBefore`, `expiresAt`, `executionHostIds`, `targets`, `excludedTargetIds`, `actions`, `approvalRequiredActions`, `egress`, `credentials`, `evidence: AssessmentEvidencePolicy`. Host ids, targets, exclusions, actions, egress grants, and credential grants are readonly arrays. |
| `AssessmentChildGrantRequest` | Required new `grantId`; optional `notBefore`, `expiresAt`, `executionHostIds`, `targetIds`, `excludedTargetIds`, `actions`, `approvalRequiredActions`, `egress`, `credentials`, and `evidence: Partial<AssessmentEvidencePolicy>`. Restrictions inherit or narrow the parent authority. |
| `AssessmentOperationEgress`, `AssessmentOperationCredential`, `AssessmentOperationEvidence` | Egress: `protocol`, `host`, `port`, `purpose`. Credential: `ref`, `purpose`. Evidence: `retainUntil`, `redaction`; the containing operation supplies the target id. |
| `AssessmentOperation` | `decisionId`, `grantId`, `at: number`, `action: AssessmentAction`, `targetId`, `executionHostId`, `egress?`, `credential?`, `evidence?`; `at` is an explicit epoch millisecond. |
| `AssessmentDecisionOutcome`, `AssessmentDecision` | Outcome: `allow`, `deny`, `approval-required`. Decision: `decisionId`, `grantId`, `outcome`, `code: AssessmentDecisionCode`, `operation: AssessmentOperation`, `matchedTarget?: AssessmentTarget`. |
| `AssessmentDecisionCode` | Closed codes distinguish allowed/approval-required results from grant mismatch, invalid time, host/target/action scope, required or out-of-scope egress/credentials/evidence, excessive retention, insufficient redaction, and denied external reporting. |
| `AssessmentGrantStatus` | `not-yet-valid` before `notBefore`; `active` when `notBefore <= at < expiresAt`; `expired` at or after `expiresAt`. |
| `AssessmentScopeError` | An `Error` with readonly open-string `code`, declared in the Service Definition for invalid grants, operations, or Provider relationships. |

A child grant cannot expand any parent limit. Authorization requires egress for `data-export` and `external-reporting`, evidence handling for those actions and `report-download`, and a credential reference for `credential-use`. A returned `approval-required` decision still requires the caller's approval workflow; the policy does not perform the effect.

The [static Provider declarations](../../packages/security/assessment-scope-static/src/index.ts) accept operator configuration before ids are branded. `AssessmentTargetConfig` has `id: string`, `kind: AssessmentTargetKind`, and `value: string`; `AssessmentEgressConfig` has `protocol`, `host`, `port`, `purpose`, and string `targetId`; `AssessmentCredentialConfig` has string `ref`, `purpose`, and string `targetId`. `AssessmentRootGrantConfig` carries every root `AssessmentGrant` field except `version` and `parentGrantId`, using string ids and those config records for `targets`, `egress`, and `credentials`.

<a id="session-assessment-state"></a>

## Session assessment state

The [Session runtime](../../packages/security/assessment-scope-session/src/index.ts) declares `AssessmentScopeSessions` and inserts the audit identity, bound grant id, and decision time before appending an operation decision. The [assessment event and projection types](../../packages/security/assessment-scope/src/types.ts) retain the binding and latest decision without changing the grant's authority.

| Type | Fields and meaning |
|---|---|
| `AssessmentSessionOperation` | `AssessmentOperation` without `decisionId`, `grantId`, or `at`: required `action`, `targetId`, `executionHostId`, and optional `egress`, `credential`, `evidence`. |
| `AssessmentScopeBoundSource`, `AssessmentScopeBoundEvent` | Source: `profile` or `delegation`. Event: `version: 1`, `source`, `grant: AssessmentGrant`; payload of required log-only `assessment/scope-bound`. |
| `AssessmentOperationDecidedEvent` | `version: 1`, `decision: AssessmentDecision`; payload of required log-only `assessment/operation-decided`, recorded before the proposed effect. |
| `AssessmentDecisionProjection` | `decisionId`, `outcome`, `code`, `action`, `targetId`, `at` summarize the latest decision. |
| `AssessmentScopeProjection` | `engagementId`, `grantId`, `parentGrantId?`, `notBefore`, `expiresAt`, readonly arrays `executionHostIds`, `targetIds`, `actions`, and `lastDecision?: AssessmentDecisionProjection`. The `assessmentScope` projection is `null` before binding. |
| `AssessmentScopeSessionError` | An `Error` with readonly string `code` and optional constructor `options.cause` for binding, restoration, or lifecycle failures. |

<a id="durable-findings"></a>

## Durable findings

The [finding declarations](../../packages/security/finding/src/types.ts) separate stable identity, evidence, mutable lifecycle state, and trusted origin. `FindingService` in the [Service Definition](../../packages/security/finding/src/index.ts) accepts an exact live Agent, records or transitions one finding, and queries complete snapshots from that Agent's Session log. Mutations resolve only after durable flush.

### Identity and evidence

| Type | Fields and meaning |
|---|---|
| `FindingId`, `FindingFingerprint`, `FindingRuleId`, `FindingTargetId`, `FindingCursor` | Branded strings for stable finding identity, canonical-identity SHA-256 digest, detector/rule, target, and opaque pagination cursor. |
| `FindingRef` | `id: FindingId`, `revision: number`; the positive revision is the compare-and-set token and increases on every durable mutation. |
| `FindingState`, `FindingInitialState`, `FindingTransitionState` | States: `observation`, `hypothesis`, `reproduced-vulnerability`, `remediation`, `unresolved`. Initial states are the first three; transition targets exclude `observation`. |
| `FindingSeverity`, `FindingConfidence` | Severity: `informational`, `low`, `medium`, `high`, `critical`. Confidence: `low`, `medium`, `high`. |
| `FindingTarget` | `id: FindingTargetId`, `kind` (`host`, `service`, `url`, `repository`, `package`, `file`, `component`, `other`), `displayName: string`. |
| `FindingCodeLocation` | `kind: 'code'`, `targetId`, `uri`, optional numeric `startLine`, `startColumn`, `endLine`, `endColumn`. |
| `FindingDependencyLocation`, `FindingLocation` | Dependency: `kind: 'dependency'`, `targetId`, `ecosystem`, `packageName`, `version?`, `manifestUri?`. `FindingLocation` is the code-or-dependency union. |
| `FindingIdentity` | `ruleId`, readonly `targetIds`, readonly `locations`; these canonical facts determine the fingerprint. |
| `FindingCvss` | `version` is `3.1` or `4.0`, with `vector: string` and `score: number`. |
| `FindingReachability` | `kind: 'unknown'`; `kind: 'unreachable'` with `reason`; or `kind: 'reachable'` with `entrypoint` and `pathEvidence?: ArtifactRef`. |
| `FindingEvidenceRole`, `FindingEvidence` | Role: `observation`, `reproduction`, `remediation-validation`, `supporting`. Evidence: `role`, immutable `artifact: ArtifactRef`, `note?: string`. |
| `FindingProvenance` | `pluginId`, `pluginVersion`, `toolName` are trusted same-process Consumer attribution, never accepted from model arguments. |

### Records, transitions, and queries

The [finding fold](../../packages/security/finding/src/fold.ts) permits `observation` to become `hypothesis`, `reproduced-vulnerability`, or `unresolved`; `hypothesis` to become `reproduced-vulnerability` or `unresolved`; and `reproduced-vulnerability` to become `remediation` or `unresolved`. `remediation` and `unresolved` are terminal. Reproduced and remediated findings require reproduction evidence; remediation also requires fix guidance and remediation-validation evidence.

| Type | Fields and meaning |
|---|---|
| `FindingRecordRequest` | Required `ruleId`, `title`, `summary`, `state: FindingInitialState`, `severity`, `confidence`, readonly `targets`, readonly `locations`, `reachability`; optional `cweIds`, `cveIds`, `cvss`, `assumptions`, `evidence`. |
| `FindingSnapshot` | `FindingRef` plus record fields with `state: FindingState`; `cweIds`, `cveIds`, `assumptions`, and `evidence` arrays are required. Adds `fingerprint`, `identity`, readonly `provenance`, `fixGuidance?`, `occurrences`, `createdAt`, `updatedAt`; `cvss` remains optional. |
| `FindingTransitionRequest` | `to: FindingTransitionState`, `evidence?: readonly FindingEvidence[]`, `fixGuidance?: string`; supplied guidance is valid only when entering remediation. |
| `FindingOperationOptions` | `signal?: AbortSignal`; mutations accept cancellation before commit, and queries accept cancellation while waiting behind a mutation. |
| `FindingQueryRequest` | Optional readonly filters `ids`, `states`, `severities`, `ruleIds`, `targetIds`, plus `cursor?: FindingCursor` and `limit?: number`. |
| `FindingQueryPage` | `items: readonly FindingSnapshot[]`, `nextCursor?: FindingCursor`; snapshots are ordered by `FindingId` within the owning Session. |
| `FindingSummary` | `FindingRef` plus `ruleId`, `title`, `state`, `severity`, `confidence`, readonly `targetIds`, `evidenceCount`, `occurrences`, `updatedAt`. |
| `FindingProjection` | `total`, `byState: Readonly<Record<FindingState, number>>`, `items: readonly FindingSummary[]`; value of the `findings` Session projection. |
| `FindingOperation`, `FindingChange` | Operation: `record` or `transition`. Change: `kind: 'finding/change'`, `version: 1`, `operation`, `previous: FindingRef` or `null`, `finding: FindingSnapshot`; required-on-read `finding/change` events carry complete post-mutation state. |
| `FindingErrorCode` | Closed `FINDING_*` codes cover live-Agent ownership, scope denial, invalid records/transitions/logs/cursors, missing or stale findings, fingerprint collision, artifact verification/mismatch, count/result limits, and uncertain persistence. |

The [error declarations](../../packages/security/finding/src/runtime.ts) define `FindingErrorOptions`, extending `ErrorOptions` with `committedRef?: FindingRef`, and `FindingError`, extending `HarnessError` with `code: FindingErrorCode` and `committedRef: FindingRef` or `undefined`. A [Session Provider](../../packages/security/finding-session/src/index.ts) flush failure after append reports `FINDING_PERSISTENCE_UNCERTAIN` with that exact revision: the event is in memory, but durable persistence is uncertain.

The [fold declarations](../../packages/security/finding/src/fold.ts) also expose `FindingFoldState` with `findings: Map<FindingId, FindingSnapshot>`, `ResolvedFindingRecord` with all record fields plus derived `id`, `fingerprint`, `identity` and required `cweIds`, `cveIds`, `assumptions`, `evidence` arrays, and `ResolvedFindingTransition` with `to`, required `evidence`, and optional `fixGuidance`. These values support canonical mutation construction and strict replay.

<a id="vulnerability-knowledge-base"></a>

## Vulnerability knowledge base

The [knowledge-base declarations](../../packages/security/vuln-kb-service/src/types.ts) describe advisory records independently of finding state. [Identifier declarations](../../packages/security/vuln-kb-service/src/brand.ts) brand input and Provider ids; the [Service Definition](../../packages/security/vuln-kb-service/src/index.ts) declares `VulnKbRuntime` and `VulnKbProvider`. Advisory entry fields are mutable unless an array is explicitly readonly.

| Type | Fields and meaning |
|---|---|
| `CveId`, `VulnKbProviderId` | Branded strings identifying a CVE and the Provider selected for a query; constructors brand values already validated by their caller. |
| `VulnSeverity`, `VulnReference` | Severity: `critical`, `high`, `medium`, `low`, `unknown`. Reference: `source: string`, `url: string`. |
| `VulnAffectedRange` | `ecosystem`, `package`, `rangeType` (`semver`, `ecosystem`, `git`, `cpe`, `versions`); optional `introduced`, `introducedInclusive`, `fixed`, `lastAffected`, `limit`, readonly `versions`. `fixed` is the first unaffected version; `lastAffected` is inclusive. |
| `VulnEntry` | `id: string` (CVE or OSV id), `source`, `summary`, `description`, `severity`, `cvssVector?`, `published?`, `modified?`, `affected: readonly VulnAffectedRange[]`, `references: readonly VulnReference[]`, `hasFix: boolean`. Dates use ISO 8601 strings. |
| `VulnQueryRequest` | Optional `cveId: CveId`, `ecosystem`, `package`, `version`, `maxResults`; Provider query validation owns supported combinations. |
| `VulnQueryResult` | `entries: readonly VulnEntry[]`, `total: number`, `truncated: boolean`; total matches may exceed the returned entries. |
| `VulnKbProvider` | Readonly `id: VulnKbProviderId`; `query(request, signal?)` resolves `VulnQueryResult`; `read(cveId, signal?)` resolves `VulnEntry`; optional `dispose()` returns void or a Promise. Signals are `AbortSignal`. |
| `VulnKbErrorCode`, `VulnKbError` | Codes: `not_found`, `invalid_query`, `query_failed`, `unavailable`. The Error carries readonly `code`, name `VulnKbError`, a message, and optional `ErrorOptions`. |

<a id="skill-resources"></a>

## Skill resources

The [resource declarations](../../packages/security/security-skills/src/types.ts) describe installation state separately from assessment authority. The [resource manager](../../packages/security/security-skills/README.md) owns download, validation, atomic activation, and retained generations; the official Skill registry discovers only the active generation. Installing resources does not authorize assessment actions or execute their scripts.

| Type | Fields and meaning |
|---|---|
| `SecuritySkillGenerationId`, `SecuritySkillOperationId` | Branded generation and operation identities; neither is a filesystem path supplied by the caller. |
| `SecuritySkillResourceSource` | `kind: bundled` / `download` and optional sanitized `url` distinguish packaged resources from network delivery. |
| `SecuritySkillResourceInstallation` | `version`, `generation`, `source`, epoch-millisecond `installedAt`, and `skillCount` identify the committed installation. |
| `SecuritySkillResourceOperation` | `id`, `kind`, `phase`, `bytesReceived`, and optional `totalBytes` describe the current Host-owned operation. |
| `SecuritySkillResourceStatus` | Fixed `resourceId: security-skills`; `state: not-installed` / `installed` / `error`; optional `installed`, `available`, `operation`, and safe `lastError`; `download` reports source availability. |
| `SecuritySkillGenerationLease` | `directory` and `installation` identify retained content. Awaiting `release()` settles that consumer's retention. |

A started operation belongs to the Host. Closing an observation stream does not cancel it; cancellation names the exact current operation. Failed downloads retain the committed installation. Removing a generation withdraws discovery while leases preserve paths already returned to an Agent realm. The resource manager persists the active generation and a monotonically increasing revision outside Session logs. Removing resources commits an empty installation with a new revision, so a delayed writer cannot reactivate an earlier empty state. Generation preparation and activation share the writer lock. Loaded skill content follows the existing logged Skill-loading mechanism.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxassessmentscope--assessmentscopepolicy-abstract-seam"></a>

### `ctx.assessmentScope` — `AssessmentScopePolicy` (abstract seam)

Provider-neutral assessment policy. Providers supply one root grant while this definition owns child narrowing, restore checks, and decisions.

```ts cordis-catalog
/**
 * Restore a durable grant only when it remains inside the provider's current root authority.
 * @param value - Durable grant snapshot.
 * @returns Canonical immutable grant accepted by the current provider.
 */
restore(value: AssessmentGrant): AssessmentGrant

/**
 * Derive one equal-or-narrower child grant.
 * @param parent - Parent grant.
 * @param request - Child id and optional restrictions.
 * @returns Canonical immutable child grant.
 */
deriveChild(parent: AssessmentGrant, request: AssessmentChildGrantRequest): AssessmentGrant

/**
 * Classify one grant at an explicit time.
 * @param grant - Grant to classify.
 * @param at - Epoch millisecond supplied by the caller.
 * @returns Time-window status.
 */
status(grant: AssessmentGrant, at: number): AssessmentGrantStatus

/**
 * Decide one operation without performing its effect.
 * @param grant - Session-bound grant.
 * @param operation - Complete normalized operation.
 * @returns Deterministic frozen policy decision.
 */
authorize(grant: AssessmentGrant, operation: AssessmentOperation): AssessmentDecision
```

Source: [`packages/security/assessment-scope/src/index.ts`](../../packages/security/assessment-scope/src/index.ts)

<a id="ctxassessmentscopesessions--assessmentscopesessions"></a>

### `ctx.assessmentScopeSessions` — `AssessmentScopeSessions`

Process-local binding runtime derived exclusively from required Session events.

```ts cordis-catalog
/**
 * Read the current immutable binding for one Session.
 * @param session - Live or reconstructed Session.
 * @returns Bound grant, or `undefined` when binding is absent or failed.
 */
get(session: Session): AssessmentGrant | undefined

/**
 * Require the current immutable binding for one Session.
 * @param session - Session whose authority is required.
 * @returns Revalidated bound grant.
 * @throws {@link AssessmentScopeSessionError} when binding is absent, failed, or outside the provider root.
 */
require(session: Session): AssessmentGrant

/**
 * Decide and durably log one operation before its caller may perform an effect.
 * @param session - Session whose binding supplies the grant id.
 * @param operation - Complete operation except the Session-owned audit identity, grant id, and decision time.
 * @returns The exact frozen decision snapshot that entered the Session log.
 */
authorize(session: Session, operation: AssessmentSessionOperation): AssessmentDecision
```

Types: [Session](session.md)

Source: [`packages/security/assessment-scope-session/src/index.ts`](../../packages/security/assessment-scope-session/src/index.ts)

<a id="ctxfindings--findingservice-abstract-seam"></a>

### `ctx.findings` — `FindingService` (abstract seam)

Provider-neutral same-session finding authority. Providers validate evidence, append complete `finding/change` snapshots, and make mutations durable before resolving. Reads rebuild from the owning Session log.

```ts cordis-catalog
/**
 * Record a new finding or deterministic duplicate occurrence.
 * @param agent - Exact live Agent whose Session owns the finding.
 * @param request - Typed finding facts; id and fingerprint are derived.
 * @param source - Trusted same-process Consumer attribution.
 * @param options - Optional pre-commit cancellation.
 * @returns The durably flushed current snapshot.
 */
abstract record( agent: Agent, request: FindingRecordRequest, source: FindingProvenance, options?: FindingOperationOptions, ): Promise<FindingSnapshot>

/**
 * Apply one compare-and-set lifecycle transition.
 * @param agent - Exact live Agent whose Session owns the finding.
 * @param ref - Expected current finding revision.
 * @param request - Target state and evidence added by this transition.
 * @param source - Trusted same-process Consumer attribution.
 * @param options - Optional pre-commit cancellation.
 * @returns The durably flushed current snapshot.
 */
abstract transition( agent: Agent, ref: FindingRef, request: FindingTransitionRequest, source: FindingProvenance, options?: FindingOperationOptions, ): Promise<FindingSnapshot>

/**
 * Query one deterministic page from the authoritative Session log.
 * @param agent - Exact live Agent whose Session owns the findings.
 * @param request - Optional filters, cursor, and page limit.
 * @param options - Optional cancellation while waiting behind a mutation.
 * @returns Complete snapshots ordered by FindingId.
 */
abstract query( agent: Agent, request: FindingQueryRequest, options?: FindingOperationOptions, ): Promise<FindingQueryPage>
```

Types: [Agent](core.md)

Source: [`packages/security/finding/src/index.ts`](../../packages/security/finding/src/index.ts)

<a id="ctxsecurityskillresources--securityskillresources"></a>

### `ctx.securitySkillResources` — `SecuritySkillResources`

Shared Host service; Agent providers only borrow committed generations.

```ts cordis-catalog
/** Inspect committed state and current Host operation.
 * @returns A detached snapshot, including an explicit unavailable download reason.
 */
async status(): Promise<SecuritySkillResourceStatus>

/** Check only the configured release manifest.
 * @returns Snapshot of the newly started Host operation.
 */
async checkUpdate(): Promise<SecuritySkillResourceStatus>

/** Download and install into an empty resource state.
 * @returns Snapshot of the newly started Host operation.
 */
async install(): Promise<SecuritySkillResourceStatus>

/** Fetch and validate the release again while preserving the active generation.
 * @returns Snapshot of the newly started Host operation.
 */
async reinstall(): Promise<SecuritySkillResourceStatus>

/** Install a different published version after validating its entire inventory.
 * @returns Snapshot of the newly started Host operation.
 */
async update(): Promise<SecuritySkillResourceStatus>

/** Copy the audited package seed; this operation performs no download.
 * @returns Snapshot of the newly started Host operation, marked bundled.
 */
async installBundled(): Promise<SecuritySkillResourceStatus>

/** Atomically unpublish resources; leased generations remain readable.
 * @returns Snapshot of the newly started Host operation.
 */
async remove(): Promise<SecuritySkillResourceStatus>

/** Cancel only the specified Host operation and await its cleanup.
 * @param expectedOperationId - Optional identity protecting against a stale cancel action.
 * @returns State after settlement. Cancellation before publication preserves the prior generation;
 * an atomic replacement already in progress may commit and is never rolled back.
 */
async cancel(expectedOperationId?: SecuritySkillOperationId): Promise<SecuritySkillResourceStatus>

/** Borrow the current generation until the owning realm releases it.
 * @returns A lease or undefined when no generation is installed.
 */
async acquire(): Promise<SecuritySkillGenerationLease | undefined>
```

Source: [`packages/security/security-skills/src/resources.ts`](../../packages/security/security-skills/src/resources.ts)

<a id="ctxvulnkb--vulnkbruntime"></a>

### `ctx.vulnKb` — `VulnKbRuntime`

Registry and dispatch facade for vulnerability KB providers. Load one implementation per context as `ctx.vulnKb`, then register providers via VulnKbRuntime.registerProvider.

```ts cordis-catalog
/**
 * Register one vulnerability KB provider for the calling plugin lifetime.
 * @param provider - provider implementation with a stable id.
 * @returns a disposer that unregisters this exact contribution.
 */
registerProvider(provider: VulnKbProvider): () => Promise<void>

/**
 * Query vulnerabilities by CVE id, package, or version.
 * @param request - Typed query filters: CVE id or ecosystem/package/version.
 * @param signal - Optional pre-completion cancellation.
 * @returns Matching vulnerability entries.
 */
query(request: VulnQueryRequest, signal?: AbortSignal): Promise<VulnQueryResult>

/**
 * Read a single vulnerability entry by CVE id.
 * @param cveId - Opaque CVE identifier.
 * @param signal - Optional pre-completion cancellation.
 * @returns The vulnerability entry with full details.
 */
read(cveId: CveId, signal?: AbortSignal): Promise<VulnEntry>
```

Source: [`packages/security/vuln-kb-service/src/index.ts`](../../packages/security/vuln-kb-service/src/index.ts)

<a id="security-skill-resources-events"></a>

### `security-skill-resources/*` events

<a id="security-skill-resourceschanged--parallel"></a>

#### `security-skill-resources/changed` — parallel

Detached resource state after an operation transition or installation commit.

```ts cordis-catalog
/**
 * Detached resource state after an operation transition or installation commit.
 * @mode parallel
 * @param snapshot - Complete published resource and Host operation state, detached from manager storage.
   */
'security-skill-resources/changed'(snapshot: SecuritySkillResourceStatus): void | Promise<void>
```

Source: [`packages/security/security-skills/src/resources.ts`](../../packages/security/security-skills/src/resources.ts)
<!-- END GENERATED cordis-surface -->

<a id="dev-note"></a>

## Dev Note

None.
