# 安全研究

[English](security-research.md) | 中文

## 摘要

安全研究通过显式评估授权判定操作权限，通过持久化发现记录保留证据和生命周期状态，并通过漏洞知识库查询已发布的公告。本参考页覆盖 `packages/security` 声明的类型；授权判定描述是否允许副作用，效果适配器负责执行操作。发现记录的修订号与可信 Consumer 归因使后续记录始终关联其证据和来源。

## 目录

- [评估授权](#assessment-grants)
- [Session 评估状态](#session-assessment-state)
- [持久化发现记录](#durable-findings)
- [漏洞知识库](#vulnerability-knowledge-base)
- [开发备注](#dev-note)

<a id="assessment-grants"></a>

## 评估授权

[评估类型声明](../../packages/security/assessment-scope/src/types.ts)定义不可变授权与归一化操作请求。[Service Definition](../../packages/security/assessment-scope/src/index.ts) 中的 `AssessmentScopePolicy` 负责根授权恢复、子授权收窄、时间分类和权限判定。除非另行说明，字段均为只读；表中的 `?` 表示可选字段。

| 类型 | 字段与含义 |
|---|---|
| `AssessmentEngagementId`, `AssessmentGrantId`, `AssessmentTargetId`, `AssessmentDecisionId`, `AssessmentAuthorizationRef` | 品牌化字符串，分别表示评估项目、不可变授权、已声明目标、副作用执行前的判定，以及非秘密的书面授权引用。 |
| `AssessmentAction` | `reconnaissance`、`active-validation`、`credential-use`、`persistence-change`、`exploit-execution`、`destructive-operation`、`report-download`、`data-export`、`external-reporting`。 |
| `AssessmentTargetKind`, `AssessmentTarget` | Kind：`hostname`、`ip-address`、`url-prefix`、`artifact-scope`、`service`。Target：`id: AssessmentTargetId`、`kind: AssessmentTargetKind`、`value: string`；效果适配器负责目标值的归一化。 |
| `AssessmentEgressProtocol`, `AssessmentEgressPurpose` | Protocol：`http`、`https`、`tcp`、`udp`。Purpose：`model-provider`、`web-search`、`target-access`、`artifact-export`、`external-reporting`。 |
| `AssessmentEgressGrant` | `protocol`、`host: string`、`port: number`、`purpose`、`targetId: AssessmentTargetId` 标识一个限定于目标的精确出站目的地。 |
| `AssessmentCredentialPurpose`, `AssessmentCredentialGrant` | Purpose：`model-provider`、`web-search`、`target-authentication`、`artifact-store`、`external-reporting`。Grant：`ref: CredentialRef`、`purpose`、`targetId`；只携带凭据引用，不携带秘密值。 |
| `AssessmentEvidenceRedaction`, `AssessmentExternalReportingPolicy` | Redaction：`none`、`secrets`、`sensitive`。External reporting：`deny`、`approval-required`、`allow`。 |
| `AssessmentEvidencePolicy` | `retainUntil: number` 为 Unix 纪元毫秒时间，另有 `minimumRedaction: AssessmentEvidenceRedaction`、`externalReporting: AssessmentExternalReportingPolicy`。 |
| `AssessmentGrant` | `version: 1`、`engagementId`、`grantId`、`parentGrantId?`、`authorizationRef`、`notBefore`、`expiresAt`、`executionHostIds`、`targets`、`excludedTargetIds`、`actions`、`approvalRequiredActions`、`egress`、`credentials`、`evidence: AssessmentEvidencePolicy`。Host id、目标、排除项、操作类别、出站授权与凭据授权均为只读数组。 |
| `AssessmentChildGrantRequest` | 必填的新 `grantId`；可选的 `notBefore`、`expiresAt`、`executionHostIds`、`targetIds`、`excludedTargetIds`、`actions`、`approvalRequiredActions`、`egress`、`credentials`、`evidence: Partial<AssessmentEvidencePolicy>`。限制继承或收窄父级权限。 |
| `AssessmentOperationEgress`, `AssessmentOperationCredential`, `AssessmentOperationEvidence` | Egress：`protocol`、`host`、`port`、`purpose`。Credential：`ref`、`purpose`。Evidence：`retainUntil`、`redaction`；所属操作提供目标 id。 |
| `AssessmentOperation` | `decisionId`、`grantId`、`at: number`、`action: AssessmentAction`、`targetId`、`executionHostId`、`egress?`、`credential?`、`evidence?`；`at` 是显式提供的 Unix 纪元毫秒时间。 |
| `AssessmentDecisionOutcome`, `AssessmentDecision` | Outcome：`allow`、`deny`、`approval-required`。Decision：`decisionId`、`grantId`、`outcome`、`code: AssessmentDecisionCode`、`operation: AssessmentOperation`、`matchedTarget?: AssessmentTarget`。 |
| `AssessmentDecisionCode` | 封闭错误码区分允许／需批准结果，以及授权不匹配、时间无效、Host／目标／操作类别超出范围、出站／凭据／证据缺失或超出范围、保留期限过长、脱敏不足、外部报告被拒绝等情况。 |
| `AssessmentGrantStatus` | 早于 `notBefore` 为 `not-yet-valid`；`notBefore <= at < expiresAt` 为 `active`；达到或超过 `expiresAt` 为 `expired`。 |
| `AssessmentScopeError` | 带有只读开放字符串 `code` 的 `Error`，由 Service Definition 声明，用于无效授权、操作或 Provider 关系。 |

子授权不能扩大父级的任何限制。`data-export` 和 `external-reporting` 必须提供出站信息；这两类操作以及 `report-download` 必须提供证据处理信息；`credential-use` 必须提供凭据引用。返回 `approval-required` 判定后，调用方仍需执行批准流程；策略本身不执行副作用。

[静态 Provider 声明](../../packages/security/assessment-scope-static/src/index.ts)在 id 品牌化前接受操作员配置。`AssessmentTargetConfig` 包含 `id: string`、`kind: AssessmentTargetKind`、`value: string`；`AssessmentEgressConfig` 包含 `protocol`、`host`、`port`、`purpose` 和字符串 `targetId`；`AssessmentCredentialConfig` 包含字符串 `ref`、`purpose` 和字符串 `targetId`。`AssessmentRootGrantConfig` 携带根 `AssessmentGrant` 除 `version`、`parentGrantId` 外的全部字段，使用字符串 id，并在 `targets`、`egress`、`credentials` 中使用上述配置记录。

<a id="session-assessment-state"></a>

## Session 评估状态

[Session 运行时](../../packages/security/assessment-scope-session/src/index.ts)声明 `AssessmentScopeSessions`，在追加操作判定前填入审计标识、已绑定授权 id 和判定时间。[评估事件与投影类型](../../packages/security/assessment-scope/src/types.ts)保留绑定与最新判定，不改变授权权限。

| 类型 | 字段与含义 |
|---|---|
| `AssessmentSessionOperation` | 从 `AssessmentOperation` 排除 `decisionId`、`grantId`、`at`：必填 `action`、`targetId`、`executionHostId`，可选 `egress`、`credential`、`evidence`。 |
| `AssessmentScopeBoundSource`, `AssessmentScopeBoundEvent` | Source：`profile` 或 `delegation`。Event：`version: 1`、`source`、`grant: AssessmentGrant`；它是必读、仅日志事件 `assessment/scope-bound` 的载荷。 |
| `AssessmentOperationDecidedEvent` | `version: 1`、`decision: AssessmentDecision`；它是必读、仅日志事件 `assessment/operation-decided` 的载荷，在拟执行的副作用前记录。 |
| `AssessmentDecisionProjection` | `decisionId`、`outcome`、`code`、`action`、`targetId`、`at` 概括最新判定。 |
| `AssessmentScopeProjection` | `engagementId`、`grantId`、`parentGrantId?`、`notBefore`、`expiresAt`，只读数组 `executionHostIds`、`targetIds`、`actions`，以及 `lastDecision?: AssessmentDecisionProjection`。绑定前 `assessmentScope` 投影为 `null`。 |
| `AssessmentScopeSessionError` | 带有只读字符串 `code`，且构造参数可包含 `options.cause` 的 `Error`，用于绑定、恢复或生命周期失败。 |

<a id="durable-findings"></a>

## 持久化发现记录

[发现记录类型声明](../../packages/security/finding/src/types.ts)区分稳定身份、证据、可变生命周期状态与可信来源。[Service Definition](../../packages/security/finding/src/index.ts) 中的 `FindingService` 接受精确的存活 Agent（智能体），记录发现或转换其状态，并从该 Agent 的 Session 日志查询完整快照。修改仅在持久化 flush 完成后返回。

### 身份与证据

| 类型 | 字段与含义 |
|---|---|
| `FindingId`, `FindingFingerprint`, `FindingRuleId`, `FindingTargetId`, `FindingCursor` | 品牌化字符串，分别表示稳定的发现身份、规范身份的 SHA-256 摘要、检测器／规则、目标与不透明分页游标。 |
| `FindingRef` | `id: FindingId`、`revision: number`；正整数修订号是比较并交换 token，每次持久化修改都会递增。 |
| `FindingState`, `FindingInitialState`, `FindingTransitionState` | 状态为 `observation`、`hypothesis`、`reproduced-vulnerability`、`remediation`、`unresolved`。初始状态为前三种；转换目标不含 `observation`。 |
| `FindingSeverity`, `FindingConfidence` | Severity：`informational`、`low`、`medium`、`high`、`critical`。Confidence：`low`、`medium`、`high`。 |
| `FindingTarget` | `id: FindingTargetId`、`kind`（`host`、`service`、`url`、`repository`、`package`、`file`、`component`、`other`）、`displayName: string`。 |
| `FindingCodeLocation` | `kind: 'code'`、`targetId`、`uri`，以及可选数值 `startLine`、`startColumn`、`endLine`、`endColumn`。 |
| `FindingDependencyLocation`, `FindingLocation` | Dependency：`kind: 'dependency'`、`targetId`、`ecosystem`、`packageName`、`version?`、`manifestUri?`。`FindingLocation` 是代码位置与依赖位置的联合类型。 |
| `FindingIdentity` | `ruleId`、只读的 `targetIds`、只读的 `locations`；这些规范事实决定 fingerprint。 |
| `FindingCvss` | `version` 为 `3.1` 或 `4.0`，另有 `vector: string`、`score: number`。 |
| `FindingReachability` | `kind: 'unknown'`；`kind: 'unreachable'` 加 `reason`；或 `kind: 'reachable'` 加 `entrypoint` 和 `pathEvidence?: ArtifactRef`。 |
| `FindingEvidenceRole`, `FindingEvidence` | Role：`observation`、`reproduction`、`remediation-validation`、`supporting`。Evidence：`role`、不可变的 `artifact: ArtifactRef`、`note?: string`。 |
| `FindingProvenance` | `pluginId`、`pluginVersion`、`toolName` 是同一进程内可信 Consumer 提供的归因，绝不接受模型参数提供这些值。 |

### 记录、转换与查询

[发现记录归并逻辑](../../packages/security/finding/src/fold.ts)允许 `observation` 转为 `hypothesis`、`reproduced-vulnerability` 或 `unresolved`，允许 `hypothesis` 转为 `reproduced-vulnerability` 或 `unresolved`，允许 `reproduced-vulnerability` 转为 `remediation` 或 `unresolved`。`remediation` 与 `unresolved` 是终态。已复现和已修复的发现均需要复现证据；修复状态还需要修复指导与修复验证证据。

| 类型 | 字段与含义 |
|---|---|
| `FindingRecordRequest` | 必填 `ruleId`、`title`、`summary`、`state: FindingInitialState`、`severity`、`confidence`、只读的 `targets`、只读的 `locations`、`reachability`；可选 `cweIds`、`cveIds`、`cvss`、`assumptions`、`evidence`。 |
| `FindingSnapshot` | `FindingRef` 加记录字段，`state` 为 `FindingState`；`cweIds`、`cveIds`、`assumptions`、`evidence` 数组均必填。增加 `fingerprint`、`identity`、只读的 `provenance`、`fixGuidance?`、`occurrences`、`createdAt`、`updatedAt`；`cvss` 仍为可选。 |
| `FindingTransitionRequest` | `to: FindingTransitionState`、`evidence?: readonly FindingEvidence[]`、`fixGuidance?: string`；提供的指导仅在进入修复状态时有效。 |
| `FindingOperationOptions` | `signal?: AbortSignal`；修改在提交前接受取消，查询在等待先前修改期间接受取消。 |
| `FindingQueryRequest` | 可选的只读筛选数组 `ids`、`states`、`severities`、`ruleIds`、`targetIds`，以及 `cursor?: FindingCursor`、`limit?: number`。 |
| `FindingQueryPage` | `items: readonly FindingSnapshot[]`、`nextCursor?: FindingCursor`；快照在所属 Session 内按 `FindingId` 排序。 |
| `FindingSummary` | `FindingRef` 加 `ruleId`、`title`、`state`、`severity`、`confidence`、只读的 `targetIds`、`evidenceCount`、`occurrences`、`updatedAt`。 |
| `FindingProjection` | `total`、`byState: Readonly<Record<FindingState, number>>`、`items: readonly FindingSummary[]`；它是 `findings` Session 投影的值。 |
| `FindingOperation`, `FindingChange` | Operation：`record` 或 `transition`。Change：`kind: 'finding/change'`、`version: 1`、`operation`、`previous: FindingRef` 或 `null`、`finding: FindingSnapshot`；必读的 `finding/change` 事件携带修改后的完整状态。 |
| `FindingErrorCode` | 封闭的 `FINDING_*` 错误码涵盖存活 Agent 所有权、范围拒绝、无效记录／转换／日志／游标、缺失或过期修订的发现、fingerprint 冲突、产物验证／不匹配、数量／结果限制和持久化不确定性。 |

[错误声明](../../packages/security/finding/src/runtime.ts)定义 `FindingErrorOptions`，扩展 `ErrorOptions` 并包含 `committedRef?: FindingRef`；并定义 `FindingError`，扩展 `HarnessError` 并包含 `code: FindingErrorCode` 以及 `committedRef: FindingRef` 或 `undefined`。[Session Provider](../../packages/security/finding-session/src/index.ts) 在追加事件后若 flush 失败，会报告 `FINDING_PERSISTENCE_UNCERTAIN` 并携带该精确修订：事件已在内存中，但持久化状态不确定。

[归并声明](../../packages/security/finding/src/fold.ts)还公开 `FindingFoldState`，包含 `findings: Map<FindingId, FindingSnapshot>`；`ResolvedFindingRecord`，包含全部记录字段、派生的 `id`、`fingerprint`、`identity`，以及必填数组 `cweIds`、`cveIds`、`assumptions`、`evidence`；以及 `ResolvedFindingTransition`，包含 `to`、必填的 `evidence` 和可选的 `fixGuidance`。这些值用于构造规范修改和严格重放。

<a id="vulnerability-knowledge-base"></a>

## 漏洞知识库

[知识库类型声明](../../packages/security/vuln-kb-service/src/types.ts)独立于发现状态描述公告记录。[标识符声明](../../packages/security/vuln-kb-service/src/brand.ts)为输入和 Provider id 品牌化；[Service Definition](../../packages/security/vuln-kb-service/src/index.ts) 声明 `VulnKbRuntime` 和 `VulnKbProvider`。公告条目字段可变，但显式声明为只读的数组除外。

| 类型 | 字段与含义 |
|---|---|
| `CveId`, `VulnKbProviderId` | 品牌化字符串，分别标识 CVE 与查询所选的 Provider；构造函数为调用方已经验证的值品牌化。 |
| `VulnSeverity`, `VulnReference` | Severity：`critical`、`high`、`medium`、`low`、`unknown`。Reference：`source: string`、`url: string`。 |
| `VulnAffectedRange` | `ecosystem`、`package`、`rangeType`（`semver`、`ecosystem`、`git`、`cpe`、`versions`）；可选 `introduced`、`introducedInclusive`、`fixed`、`lastAffected`、`limit`、只读的 `versions`。`fixed` 是首个不受影响的版本；`lastAffected` 包含该版本自身。 |
| `VulnEntry` | `id: string`（CVE 或 OSV id）、`source`、`summary`、`description`、`severity`、`cvssVector?`、`published?`、`modified?`、`affected: readonly VulnAffectedRange[]`、`references: readonly VulnReference[]`、`hasFix: boolean`。日期使用 ISO 8601 字符串。 |
| `VulnQueryRequest` | 可选的 `cveId: CveId`、`ecosystem`、`package`、`version`、`maxResults`；Provider 查询验证负责判定支持的组合。 |
| `VulnQueryResult` | `entries: readonly VulnEntry[]`、`total: number`、`truncated: boolean`；匹配总数可能超过返回的条目数。 |
| `VulnKbProvider` | 只读的 `id: VulnKbProviderId`；`query(request, signal?)` 返回 `VulnQueryResult`；`read(cveId, signal?)` 返回 `VulnEntry`；可选的 `dispose()` 返回 void 或 Promise。signal 类型为 `AbortSignal`。 |
| `VulnKbErrorCode`, `VulnKbError` | 错误码：`not_found`、`invalid_query`、`query_failed`、`unavailable`。该 Error 携带只读的 `code`、名称 `VulnKbError`、消息和可选的 `ErrorOptions`。 |

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Session](session.zh.md)

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

Types: [Agent](core.zh.md)

Source: [`packages/security/finding/src/index.ts`](../../packages/security/finding/src/index.ts)

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
<!-- END GENERATED cordis-surface -->

<a id="dev-note"></a>

## 开发备注

无。
