# Typert remote calls

English | [中文](typert.zh.md)

Types shared by generated Remote artifacts, the Host Gateway, and consumer API assemblies. The [Typert Gateway Agent Note](../../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md) owns the architecture and transport decisions; this page records the literal public contracts from [`dsh-typert-protocol`](../../packages/typert/protocol/src/types.ts) and [`dsh-api-gateway`](../../packages/api/gateway/src/types.ts).

## Lookup and Context declarations

Business-object packages extend two empty maps through declaration merging. A lookup associates one Host object type with its wire identity; a Context declaration associates one scoped Context kind with its wire identity. Generated descriptors name these keys, while runtime providers supply the live resolution behavior.

```ts type-equiv
/** Merge-extensible Host object lookup declarations. */
interface TypertLookupMap {}
```

```ts type-equiv
/** Merge-extensible scoped Context declarations. */
interface TypertContextMap {}
```

The registry retains a lookup's wire declaration after its resolver unloads. SRC discovery therefore continues to classify the parameter as a lookup and fails unavailable instead of accepting the wire value as an ordinary business object.

```ts type-equiv
/** Stable wire declaration retained after a lookup provider unloads. */
interface TypertLookupDefinition {
  /** Merge-declared lookup key. */
  readonly key: string
  /** Source parameter name recognized by the SRC weak parser. */
  readonly parameter: string
  /** Wire field replacing the Host object parameter. */
  readonly wire: string
  /** Canonical Host type symbol used by strict generation. */
  readonly hostTypeSymbol: string
  /** Canonical wire type symbol used by strict generation. */
  readonly wireTypeSymbol: string
}
```

## Invocation descriptors

An `InvocationDescriptor` is local reflection, not a wire message. Host and consumer builds generate corresponding descriptors; the request sends only the endpoint and named `args`. Strict codecs carry generated schemas, while SRC codecs enforce JSON-safe values without structural type recovery. Cancellation is an out-of-band carrier signal injected after business parameters and never enters `args`.

```ts type-equiv
/** Codec attached to one invocation parameter or result. */
type TypertCodec =
  | {
    readonly mode: 'strict'
    readonly typeSymbol: string
    readonly schema: TypertSchema
  }
  | {
    readonly mode: 'src-json'
  }
```

```ts type-equiv
/** One ordered business parameter in a Remote invocation. */
interface InvocationParameterDescriptor {
  /** Source-level parameter name. */
  readonly name: string
  /** Required key in the wire `args` object. */
  readonly wire: string
  /** Whether the value is JSON or requires a registered Host lookup. */
  readonly source: 'json' | 'lookup'
  /** Lookup key when `source` is `lookup`. */
  readonly lookup?: string
  /** Boundary codec for the wire representation. */
  readonly codec: TypertCodec
  /** Missing wire fields decode to `undefined` only for an explicitly declared `T | undefined`. */
  readonly acceptsUndefined?: true
}
```

```ts type-equiv
/** Carrier-independent description of one exported method invocation. */
interface InvocationDescriptor {
  /** Globally stable generated identity. */
  readonly id: string
  /** Cordis service key owning the method. */
  readonly service: string
  /** Wire namespace, defaulting to the service key. */
  readonly namespace: string
  /** Public instance method name. */
  readonly method: string
  /** Service member invoked when the exported method name is an alias. */
  readonly implementation?: string
  /** Absent for unary calls; stream calls validate and deliver every yielded item. */
  readonly mode?: 'stream'
  /** Receiver selection mode. */
  readonly invocation:
    | { readonly kind: 'direct' }
    | {
      readonly kind: 'context'
      readonly context: string
      readonly wire: string
      readonly codec: TypertCodec
    }
  /** Optional consuming-Context projection for one direct lookup parameter. */
  readonly scope?: {
    /** Context kind whose Client adapter supplies the identity. */
    readonly context: string
    /** Lookup parameter wire field replaced by the Context identity. */
    readonly wire: string
  }
  /** Ordered business parameters. */
  readonly parameters: readonly InvocationParameterDescriptor[]
  /** Transport cancellation injected after business parameters instead of entering wire args. */
  readonly cancellation?: {
    /** Reserved final Host method parameter. */
    readonly parameter: 'signal'
  }
  /** Codec for the unary result or each yielded stream item. */
  readonly result: TypertCodec
  /** Source declaration used only for diagnostics. */
  readonly sourceLocation?: InvocationSourceLocation
}
```

## Typert registry

`ctx.typert` separates current-environment descriptors, explicitly selected Remote contributions, lookup providers, and scoped Context providers. A lookup provider owns the stable wire declaration and default resolver; Host composition can configure an effect-scoped synchronous or asynchronous resolver for the same key, and unloading that configuration restores the default policy. Registrations are Cordis-owned effects and return awaitable disposers.

```ts type-equiv
/** Minimal Typert runtime consumed through dependency inversion. */
interface TypertRegistryContract {
  readonly local: TypertLocalRegistry
  readonly remotes: TypertRemoteRegistry
  readonly lookups: TypertLookupRegistry
  readonly contexts: TypertContextRegistry
}
```

Generated consumer declarations merge direct namespaces into the map inherited by `TypertClientRemote`.

```ts type-equiv
/** Merge-extensible direct namespace surface generated for Client Remote services. */
interface TypertRemoteNamespaceMap {}
```

## Host Gateway

Connection decodes its carrier envelope before calling `ctx.typertGateway`. The request carries exact named wire fields and the carrier's cancellation signal separately; infrastructure and boundary failures ride `TypertGatewayError`, whose `gateway/*` codes are ordinary `RemoteError` codes, so the RPC adapter passes every structurally identified `RemoteError` through with its code and details intact and folds only unrecognized exceptions into `gateway/internal`.

```ts type-equiv
/** One Remote method request after a carrier has decoded its envelope. */
interface InvokeRemoteRequest {
  /** Remote namespace selected by the generated descriptor. */
  readonly namespace: string
  /** Exported Service method name. */
  readonly method: string
  /** Named wire values; fields must exactly match the descriptor. */
  readonly args: Readonly<Record<string, unknown>>
  /** Carrier or direct-caller cancellation injected only into cancellation-aware methods. */
  readonly signal?: AbortSignal
}
```

```ts type-equiv
/** Stable infrastructure and boundary failures emitted before or after business execution. */
type TypertGatewayErrorCode =
  | 'gateway/ambiguous-endpoint'
  | 'gateway/arguments-invalid'
  | 'gateway/binding-invalid'
  | 'gateway/context-failed'
  | 'gateway/context-not-found'
  | 'gateway/context-unavailable'
  | 'gateway/definition-unavailable'
  | 'gateway/input-invalid'
  | 'gateway/invocation-unavailable'
  | 'gateway/lookup-failed'
  | 'gateway/lookup-not-found'
  | 'gateway/lookup-unavailable'
  | 'gateway/method-unavailable'
  | 'gateway/provider-mismatch'
  | 'gateway/result-invalid'
  | 'gateway/service-unavailable'
  | 'gateway/signature-invalid'
```

```ts type-equiv
/** Host dispatcher consumed by Connection adapters. */
interface TypertGateway {
  /** Carrier adapter shared by WebSocket and in-process transports. */
  readonly wireStream: TypertGatewayWireStream
  /**
   * Register the application-selected forwarded-event source.
   * @param source - stream factory installed by the Remote assembly.
   * @param host - stable Host facts included in each Client generation's opening frame.
   * @returns disposer removing this exact source and cancelling its active streams.
   */
  registerRemoteEvents(
    source: TypertRemoteEventSource,
    host: RemoteEventHostInfo,
  ): () => Promise<void>
  /**
   * Invoke one live Remote method without assuming a carrier or response envelope.
   * @param request - decoded endpoint and named wire arguments.
   * @returns the business result without output decoding.
   * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
   */
  invoke(request: InvokeRemoteRequest): Promise<unknown>
  /**
   * Open one live stream Remote method without assuming a physical carrier.
   * @param request - decoded endpoint and named wire arguments.
   * @returns a cancellation-aware iterable over the business results.
   */
  stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>>
}
```

## Consumer Remote

`ctx.remote` exposes only namespaces contributed by imported `/remote` artifacts. `$mount()` installs generated descriptors and concrete methods as one fiber-owned operation. Each namespace is a traced `remote.<namespace>` Cordis child Service whose lifetime spans its mounted methods; no JavaScript Proxy or Host business Service type enters the consumer.

```ts type-equiv
/** Client Remote capability implemented by the Gateway and consumed by Remote assemblies. */
interface TypertClientRemote extends TypertRemoteNamespaceMap {
  /**
   * Mount one generated Host-for-Client contribution in the caller's fiber.
   * @param contribution - explicitly selected Remote package artifact.
   * @returns disposer after namespace services and concrete methods are ready.
   */
  $mount(contribution: TypertRemoteContribution): Promise<TypertDisposer>
  /**
   * Subscribe to one forwarded Host event. Notifications run in registration
   * order and isolate failures; scoped waterfalls return, delegate through
   * `next()`, or reject the Host dispatch.
   * @template Event - forwarded event name selected by the Host assembly.
   * @param event - forwarded Host event name, unchanged on the wire.
   * @param listener - receives the Client projection of the Cordis `Events` declaration.
   * @returns disposer owned by the calling fiber.
   */
  $on<Event extends TypertRemoteEvent>(event: Event, listener: TypertClientEventListener<Event>): () => void
}
```

## Native controller requests and results

The following JSON records are declared by the `packages/api` controller packages. The controllers own these wire projections; imported Automation, Browser, Git, MCP, Terminal, Voice, and Workspace capability types retain their declaring package owners.

### Automation

Source: [automation-controller/types](../../packages/api/automation-controller/src/types.ts). Runtime definitions and invocation records are documented by [Automation](automation.md).

| Type | Fields and semantics |
|---|---|
| `AutomationCancelRequest` | `runId` identifies an admitted invocation; cancellation does not delete its recurring definition. |
| `AutomationRunsRequest` | Definition `id`, nullable `cursor`, and `limit` select a bounded newest-first journal page. |
| `AutomationPreviewRequest` | `schedule` and absolute `afterUtc` select five strictly later UTC occurrences. |
| `AutomationFollowFrame` | `baseline` and `snapshot` frames each carry a complete committed `AutomationSnapshot` in `value`. |
| `AutomationCatalog` | Workspace, Agent preset, Provider, model, and permission choices plus configured defaults. Availability is advisory; an unlisted model does not prohibit explicit routing. |

### Browser

Source: [browser-controller/types](../../packages/api/browser-controller/src/types.ts). The [Browser Service Definition](../../packages/browser/browser/README.md) owns Provider requests, page identities, observations, and transfers.

| Type | Fields and semantics |
|---|---|
| `BrowserProfileValue`, `BrowserPagesValue` | Active `profileName`; the page list also carries `pages` and `maxFileBytes`, without exposing a profile filesystem path. |
| `BrowserPageRequest`, `BrowserOpenValue` | An existing or newly opened native `pageId`. |
| `BrowserElementSelectionValue` | A Provider-verified human selection with one-use identity on the requested page; cancellation aborts the picker. |
| `BrowserElementCaptureCommand` | `pageId` and `selectionId` consume that selection to capture its current visible bounds. |
| `BrowserElementCaptureValue` | The same page/selection ids, `verified: true`, a stored `image` reference, and its canonical base64 `data` for preview and explicit draft admission. |
| `BrowserHistoryValue`, `BrowserNetworkValue` | `entries` contain page visits or network metadata; the network projection excludes headers and bodies. |
| `BrowserObservationValue` | The current `observation` supplies fresh element identity for an explicit file-input selection. |
| `BrowserImportCookiesRequest`, `BrowserImportCookiesValue` | Explicit human import supplies expected `profileName` and cookie `json`; the receipt returns `imported` count and profile, never the input contents. |
| `BrowserFileUploadRequest`, `BrowserFileUploadValue` | Page, observation, element, filename, and bounded `base64` select a file input; the receipt reports accepted `bytes`. Page handlers may subsequently submit those bytes. |
| `BrowserDownloadsValue` | `items` and `truncated` describe captured transfers retained while the page stays open. |
| `BrowserDownloadRequest`, `BrowserDownloadValue` | Page-owned `downloadId` selects a bounded read; the result contains `name`, `base64`, and exact `bytes` for a human save. |

### Readiness and research

Sources: [device-capabilities-controller/types](../../packages/api/device-capabilities-controller/src/types.ts), [integration-preflight-controller/types](../../packages/api/integration-preflight-controller/src/types.ts), and [security-research-controller/types](../../packages/api/security-research-controller/src/types.ts).

| Type | Fields and semantics |
|---|---|
| `DeviceCapabilityRequest`, `DeviceCapabilitySnapshot` | `capability` selects `computer` or `mobile`; the result distinguishes `not-configured`, `available`, and `unavailable`, with a redacted nullable `reason`. It does not grant action permission. |
| `MobileSdkSnapshot` | Host `platform`, Android SDK detection, and optional iOS Simulator detection; SDK availability is separate from connected-device availability. |
| `MobileDeviceListSnapshot` | `devices` supplies selector identities, names, states, and per-device availability; `available` summarizes the list. |
| `IntegrationPreflightRequest`, `IntegrationPreflightSnapshot` | Select `github`, `gitlab`, or `gitee`; return Provider, connection `status`, nullable redacted `reason`, and optional account hint. Tokens and command diagnostics stay private. |
| `SecurityResearchSnapshot` | Overall `status`, preset visibility, root-scope validity and counts, component presence, and skill completeness. The status projection omits scope targets and credential values. |
| `SecurityResearchReportRequest`, `SecurityResearchReportValue` | A live `sessionId` and `json`/`markdown`/`sarif` format select a report. The result carries filename, media type, exact byte count, base64, and finding count; it contains Finding metadata and Artifact references, not Artifact contents. |

### Terminal and Voice

Sources: [terminal-controller/types](../../packages/api/terminal-controller/src/types.ts) and [voice-controller/types](../../packages/api/voice-controller/src/types.ts). Provider and backend values remain owned by [Terminal](terminal.md) and [Voice](voice.md).

| Type | Fields and semantics |
|---|---|
| `TerminalListRequest`, `TerminalListValue` | `sessionId` selects the owner; `terminals` contains detached ids, backend types, optional names/process ids, and running or exited status. |
| `TerminalSpawnValue` | The new terminal view plus `motd`. |
| `TerminalSendValue` | `viewport`, `waitReason`, `sessionStatus`, and `truncated` report readiness or timeout without treating either as process exit. |
| `TerminalReadValue` | Bounded `text`, `totalLines`, `lineBegin`, `lineEnd`, and `truncated` describe a scrollback window. |
| `TerminalSignalRequest`, `TerminalSignalValue` | Session and terminal ids plus an allowed signal select one process group; success returns `delivered: true` and `targetPgid`. |
| `TerminalKillRequest`, `TerminalKillValue` | Session and terminal ids select closure; the result reports `closed`. |
| `VoiceModelRequest`, `VoiceModelsRemoveValue` | `modelId` comes from the model list; successful removal returns an empty record. |
| `VoiceTranscribeRequest` in `api/voice-controller` | `modelId` plus canonical `pcm16kMonoBase64`: little-endian 16 kHz mono float32 PCM, bounded to 16 MiB decoded. This wire request differs from the [Voice Service request](voice.md), which carries decoded samples. |

### Workspace lifecycle projections

Sources: [workspace-isolation-controller/types](../../packages/api/workspace-isolation-controller/src/types.ts) and [worktree-task-controller/types](../../packages/api/worktree-task-controller/src/types.ts). [Workspace](workspace.md) owns provider lease and task identities, lifecycle, and filesystem operations.

| Type | Fields and semantics |
|---|---|
| `WorkspaceIsolationLeaseRequest` | Opaque `leaseId` addresses a provider-owned lease; callers cannot supply a checkout path. |
| `WorkspaceIsolationListValue`, `WorkspaceIsolationLeaseValue` | Detached `items` or `lease` expose owner Session, canonical source/checkout paths, branch/base/head, phase, review state, and timestamps. |
| `WorkspaceIsolationInspectionValue`, `WorkspaceIsolationComparisonValue` | `inspection` carries checkout state and current changes; bounded `comparison` adds ahead/behind, commits, changed files, patch, truncation, and tracked/untracked inclusion facts. |
| `WorkspaceIsolationIntegrationValue` | Retained hibernated `lease`, recorded `targetBranch`, and resulting `targetHead` after merge or cherry-pick. |
| `WorkspaceIsolationPatchValue` | Lease id, safe filename, complete bounded patch `content`, and explicit tracked/untracked inclusion facts. |
| `WorkspaceIsolationTeardownValue`, `WorkspaceIsolationPruneValue` | Teardown discriminates `removed` from retained `review` with reason `unmerged-branch`; pruning reports the number of orphaned worktrees removed. |
| `WorktreeTaskCreateRequest` | Name, Workspace id, source path, optional base ref, and optional linked issue create one task. |
| `WorktreeTaskRequest`, `WorktreeTaskCreateValue`, `WorktreeTaskValue` | An opaque `taskId` selects lifecycle work; creation and transitions return a detached `task` view. |
| `WorktreeTaskListValue` | Complete `items` of task views with workspace, branch/checkout, status, linked Sessions, and creation/update times. |
| `WorktreeTaskBindSessionRequest`, `WorktreeTaskBindSessionValue` | Task and Session ids bind ownership; the result returns the updated task plus effective `checkoutPath`. |
| `WorktreeTaskDeleteValue` | `deleted` carries the removed task id; `retained` also names the branch preserved by safe deletion. |

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomationcontroller--automationcontroller"></a>

### `ctx.automationController` — `AutomationController`

Generated Remote owner for the automation namespace.

```ts cordis-catalog
/** Read the committed runtime view.
 * @returns the full state, including explicit unavailability.
 */
@Remote('snapshot') snapshot(): AutomationSnapshot

/** Create a disabled plan.
 * @param draft - explicit draft inputs.
 * @returns the committed disabled definition.
 */
@Remote('create') create(draft: AutomationDraft): Promise<AutomationDefinition>

/** Save a complete revision-fenced replacement.
 * @param update - replacement fenced by the first-edit revision.
 * @returns the committed definition.
 */
@Remote('update') update(update: AutomationUpdate): Promise<AutomationDefinition>

/** Delete a plan while retaining its journal.
 * @param request - target and expected revision; active invocations refuse deletion.
 */
@Remote('delete') delete(request: AutomationDelete): Promise<void>

/** Admit one explicit manual invocation.
 * @param request - target revision and retained idempotency token.
 * @returns the admitted invocation.
 */
@Remote('run') run(request: AutomationRunRequest): Promise<AutomationRun>

/** Cancel an invocation without changing recurrence.
 * @param request - admitted invocation to cancel.
 */
@Remote('cancel') cancel(request: AutomationCancelRequest): Promise<void>

/** Read a bounded journal page.
 * @param request - bounded journal cursor.
 * @returns newest-first committed receipts.
 */
@Remote('runs') runs(request: AutomationRunsRequest): Promise<AutomationRunPage>

/** Preview a UTC schedule without saving it.
 * @param request - UTC schedule and exclusive lower bound.
 * @returns five future UTC timestamps.
 */
@Remote('previewSchedule') previewSchedule(request: AutomationPreviewRequest): Promise<number[]>

/** Read the current Host selector catalog.
 * @returns actual selector metadata; model membership is advisory.
 */
@Remote('catalog') catalog(): Promise<AutomationCatalog>

/** Follow full committed state for one carrier generation.
 * @param signal - carrier cancellation.
 * @returns full committed snapshots with bounded coalescing.
 */
@Remote({ mode: 'stream' }) follow(signal: AbortSignal): AsyncIterable<AutomationFollowFrame>
```

Types: [AutomationDefinition](automation.md) · [AutomationDelete](automation.md) · [AutomationDraft](automation.md) · [AutomationRun](automation.md) · [AutomationRunPage](automation.md) · [AutomationRunRequest](automation.md) · [AutomationSnapshot](automation.md) · [AutomationUpdate](automation.md)

Source: [`packages/api/automation-controller/src/index.ts`](../../packages/api/automation-controller/src/index.ts)

<a id="ctxbrowsercontroller--browsercontroller"></a>

### `ctx.browserController` — `BrowserController`

Authenticated human-facing Browser operations, separate from model tool permissions.

```ts cordis-catalog
/** Read the active profile without launching a browser.
 * @param signal - Caller cancellation.
 * @returns Active profile name.
 */
@Remote('profile') profile(signal: AbortSignal): BrowserProfileValue

/** Launch if needed and list native pages after an explicit UI action.
 * @param signal - Caller cancellation.
 * @returns Current page and profile identities.
 */
@Remote('pages') async pages(signal: AbortSignal): Promise<BrowserPagesValue>

/** Wait for a human to choose an element; cancellation removes the Provider overlay.
 * @param request - Existing native page selected by the caller.
 * @param signal - Caller cancellation, forwarded to the Provider.
 * @returns One-use selection with element identity and visible bounds.
 */
@Remote('selectElement') async selectElement(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserElementSelectionValue>

/** Capture and persist a verified crop without sending a Session message.
 * @param request - Page and one-use selection from selectElement.
 * @param signal - Caller cancellation; cancelled work returns no preview.
 * @returns Digest-verified stored bytes, encoded as base64, and their canonical metadata.
 */
@Remote('captureElement') async captureElement(request: BrowserElementCaptureCommand, signal: AbortSignal): Promise<BrowserElementCaptureValue>

/** Resolve an intent and open it with the active Provider settings.
 * @param request - Home, search, or absolute URL intent.
 * @param signal - Caller cancellation.
 * @returns New page identity.
 */
@Remote('open') async open(request: BrowserNavigationTarget, signal: AbortSignal): Promise<BrowserOpenValue>

/** Read page-local visits; nothing is loaded from another profile.
 * @param request - Open page identity.
 * @param signal - Caller cancellation.
 * @returns At most 100 visits; credentials, queries, and fragments are excluded.
 */
@Remote('history') async history(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserHistoryValue>

/** Read request metadata retained since the page opened.
 * @param request - Open page identity.
 * @param signal - Caller cancellation.
 * @returns At most 100 requests without headers, bodies, or URL query values.
 */
@Remote('network') async network(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserNetworkValue>

/** Observe a page so a human can select a file input.
 * @param request - Open page identity.
 * @param signal - Caller cancellation.
 * @returns Fresh observation and element ids.
 */
@Remote('snapshot') async snapshot(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserObservationValue>

/** Supply explicit file bytes to an observed input, without submitting its form.
 * @param request - Fresh observation ids, basename, and base64 from the chosen file.
 * @param signal - Caller cancellation.
 * @returns Accepted byte count, never file contents.
 */
@Remote('upload') async upload(request: BrowserFileUploadRequest, signal: AbortSignal): Promise<BrowserFileUploadValue>

/** Read page-owned download metadata.
 * @param request - Open page identity.
 * @param signal - Caller cancellation.
 * @returns Retained download ids and states.
 */
@Remote('downloads') async downloads(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserDownloadsValue>

/** Read one bounded completed download for a human save action.
 * @param request - Page and download ids obtained from downloads.
 * @param signal - Caller cancellation.
 * @returns Inert filename and exact file bytes encoded for Remote transport.
 */
@Remote('download') async download(request: BrowserDownloadRequest, signal: AbortSignal): Promise<BrowserDownloadValue>

/** Import an explicit cookie JSON array into the expected active profile.
 * @param request - Active profile name and user-selected file contents.
 * @param signal - Caller cancellation.
 * @returns Accepted count without cookie values; failures also omit values.
 */
@Remote('importCookies') async importCookies(request: BrowserImportCookiesRequest, signal: AbortSignal): Promise<BrowserImportCookiesValue>
```

Source: [`packages/api/browser-controller/src/index.ts`](../../packages/api/browser-controller/src/index.ts)

<a id="ctxdevicecapabilitiescontroller--devicecapabilitiescontroller"></a>

### `ctx.deviceCapabilitiesController` — `DeviceCapabilitiesController`

Probe the selected Provider without exposing desktop content or device identities.

```ts cordis-catalog
/**
 * Check Provider reachability independently from plugin activation.
 * @param request - Device family to check.
 * @param signal - Caller cancellation forwarded to the read-only Provider operation.
 * @returns Readiness and a redacted failure category, never installation or action authorization.
 */
@Remote('check') async check(request: DeviceCapabilityRequest, signal: AbortSignal): Promise<DeviceCapabilitySnapshot>

/**
 * Detect Android SDK and iOS Simulator availability without installing software.
 * @param signal - Caller cancellation.
 * @returns SDK detection results for the mobile emulator settings page.
 */
@Remote('checkSdk') async checkSdk(signal: AbortSignal): Promise<MobileSdkSnapshot>

/**
 * List mobile devices for the default-device selector; redacted to id/name/state/available.
 * @param signal - Caller cancellation forwarded to the Provider.
 * @returns Redacted device list and Provider availability.
 */
@Remote('listMobileDevices') async listMobileDevices(signal: AbortSignal): Promise<MobileDeviceListSnapshot>
```

Source: [`packages/api/device-capabilities-controller/src/index.ts`](../../packages/api/device-capabilities-controller/src/index.ts)

<a id="ctxexecutionhostcontroller--executionhostcontroller"></a>

### `ctx.executionHostController` — `ExecutionHostController`

Remote operations consumed by native execution-host settings.

```ts cordis-catalog
/**
 * Read saved targets and current connection observations.
 * @param signal Carrier cancellation before the read.
 * @returns the complete management snapshot.
 */
@Remote list(signal: AbortSignal): Promise<ListTargetsValue>

/**
 * Subscribe before the initial snapshot and coalesce subsequent observations.
 * @param signal Carrier cancellation; controller disposal also ends the stream.
 * @returns complete snapshots without an unbounded update backlog.
 */
@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<ListTargetsValue>

/**
 * Persist an OpenSSH alias without connecting.
 * @param request Label and alias; never credentials or flags.
 * @param signal Carrier cancellation before admission.
 * @returns the durable disconnected target.
 */
@Remote create(request: CreateTargetRequest, signal: AbortSignal): Promise<TargetValue>

/**
 * Replace saved metadata at its exact revision after disconnecting.
 * @param request Current revision and replacement fields.
 * @param signal Carrier cancellation before admission.
 * @returns the committed target.
 */
@Remote update(request: UpdateTargetRequest, signal: AbortSignal): Promise<TargetValue>

/**
 * Remove a target after owned remote work settles.
 * @param request Exact saved revision.
 * @param signal Carrier cancellation before admission.
 * @returns durable deletion acknowledgement.
 */
@Remote removeTarget(request: TargetRevisionRequest, signal: AbortSignal): Promise<Record<string, never>>

/**
 * Authenticate and inspect an exported root before publishing readiness.
 * @param request Target and exact saved revision.
 * @param signal Carrier cancellation propagated through worker settlement.
 * @returns the ready worker identity and connection generation.
 */
@Remote connect(request: TargetRevisionRequest, signal: AbortSignal): Promise<TargetValue>

/**
 * Close a target after cancellation acknowledgement for admitted work.
 * @param request Saved target identity.
 * @param signal Carrier cancellation before admission.
 * @returns the disconnected target.
 */
@Remote disconnect(request: TargetRequest, signal: AbortSignal): Promise<TargetValue>

/**
 * Read a bounded directory listing inside an exported root.
 * @param request Target, generation, root and relative path.
 * @param signal Carrier cancellation propagated through worker settlement.
 * @returns the directory result with target provenance.
 */
@Remote inspectDirectory(request: InspectDirectoryRequest, signal: AbortSignal): Promise<InspectionValue>
```

Source: [`packages/api/execution-host-controller/src/index.ts`](../../packages/api/execution-host-controller/src/index.ts)

<a id="ctxintegrationpreflightcontroller--integrationpreflightcontroller"></a>

### `ctx.integrationPreflightController` — `IntegrationPreflightController`

Probe GitHub, GitLab, and Gitee integration readiness without exposing tokens or credentials.

```ts cordis-catalog
/**
 * Check one integration provider's readiness independently from plugin activation.
 * @param request - Integration provider to check.
 * @param signal - Caller cancellation forwarded to the read-only probe.
 * @returns Readiness snapshot with redacted status and account hint.
 */
@Remote('check') async check(request: IntegrationPreflightRequest, signal: AbortSignal): Promise<IntegrationPreflightSnapshot>
```

Source: [`packages/api/integration-preflight-controller/src/index.ts`](../../packages/api/integration-preflight-controller/src/index.ts)

<a id="ctxmcpcontroller--mcpcontroller"></a>

### `ctx.mcpController` — `McpController`

Current-profile MCP management without composition rewrites or tool execution.

```ts cordis-catalog
/**
 * Read the complete profile view without starting network work.
 * @returns Current desired configuration and redacted live observations.
 */
@Remote snapshot(): McpManagementSnapshot

/**
 * Observe complete replacement snapshots, coalescing updates while the consumer is paused.
 * @param signal - Stream cancellation; controller disposal also closes the stream.
 * @returns Initial state followed by current complete snapshots; no unbounded event backlog.
 */
@Remote({ mode: 'stream' }) async *watch(signal: AbortSignal): AsyncIterable<McpManagementSnapshot>

/**
 * Save desired configuration independently from connection readiness.
 * @param request - Full desired configuration and editor revision.
 * @returns Durable record identity and current status.
 */
@Remote async save(request: McpSaveRequest): Promise<McpSaveResult>

/**
 * Stop the owned connection before deleting its configuration.
 * @param request - Owned record and expected revision.
 * @returns Durable removal after its child stops.
 */
@Remote async removeServer(request: McpRemoveRequest): Promise<McpManagementSnapshot>

/**
 * Persist enablement and apply it to the owned connection.
 * @param request - Desired switch and expected revision.
 * @returns Committed desired state and current observed readiness.
 */
@Remote async setEnabled(request: McpSetEnabledRequest): Promise<McpManagementSnapshot>

/**
 * Replace an enabled connection after confirmed cleanup.
 * @param request - Enabled manager-owned record.
 * @returns New observed attempt after the previous child quiesces.
 */
@Remote async reconnect(request: McpServerRequest): Promise<McpManagementSnapshot>

/**
 * Refresh tools on an initialized owned connection; starts no server and invokes no tool.
 * @param request - Managed record address.
 * @param signal - Cancellation of the tools/list request.
 * @returns The complete profile view after discovery.
 */
@Remote async probe(request: McpServerRequest, signal: AbortSignal): Promise<McpManagementSnapshot>
```

Types: [McpManagementSnapshot](mcp.md) · [McpRemoveRequest](mcp.md) · [McpSaveRequest](mcp.md) · [McpSaveResult](mcp.md) · [McpServerRequest](mcp.md) · [McpSetEnabledRequest](mcp.md)

Source: [`packages/api/mcp-controller/src/index.ts`](../../packages/api/mcp-controller/src/index.ts)

<a id="ctxsecurityresearchcontroller--securityresearchcontroller"></a>

### `ctx.securityResearchController` — `SecurityResearchController`

Host owner of Security Research status and explicit local report downloads.

```ts cordis-catalog
/**
 * Describe the current Harness-native security composition without exposing
 * target values, credentials, authorization references, or provider paths.
 * @param signal - Caller cancellation.
 * @returns A redacted point-in-time status for the Settings page.
 */
@Remote('describe') async describe(signal: AbortSignal): Promise<SecurityResearchSnapshot>

/**
 * Export a complete same-Session report after every contained target passes report-download authorization.
 * @param request - Live Session and report format; free-text Finding metadata is exported verbatim.
 * @param signal - Caller cancellation, checked again after every asynchronous operation.
 * @returns Bounded deterministic bytes after the authorization decisions reach Session storage.
 */
@Remote('exportReport') async exportReport(request: SecurityResearchReportRequest, signal: AbortSignal): Promise<SecurityResearchReportValue>
```

Source: [`packages/api/security-research-controller/src/index.ts`](../../packages/api/security-research-controller/src/index.ts)

<a id="ctxsidebargitcontroller--sidebargitcontroller"></a>

### `ctx.sidebarGitController` — `SidebarGitController`

Carry typed Git requests without adding authority or another process implementation.

```ts cordis-catalog
/**
 * Read the current Git panel state.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('status') async status(request: GitSessionRequest, signal: AbortSignal): Promise<GitStatusResult>

/**
 * Read a worktree or staged patch.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('diff') async diff(request: GitDiffRequest, signal: AbortSignal): Promise<GitDiffResult>

/**
 * Stage explicitly selected paths.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('stage') async stage(request: GitPathMutationRequest, signal: AbortSignal): Promise<GitMutationResult>

/**
 * Unstage explicitly selected paths.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('unstage') async unstage(request: GitPathMutationRequest, signal: AbortSignal): Promise<GitMutationResult>

/**
 * List existing local branches.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('branches') async branches(request: GitSessionRequest, signal: AbortSignal): Promise<GitBranchesResult>

/**
 * Check out an existing local branch.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('checkout') async checkout(request: GitCheckoutRequest, signal: AbortSignal): Promise<GitMutationResult>

/**
 * Prepare an exact commit intent for user review.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('prepareCommit') async prepareCommit(request: GitPrepareCommitRequest, signal: AbortSignal): Promise<GitCommitPreview>

/**
 * Commit the unchanged intent confirmed by the user.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('commit') async commit(request: GitCommitRequest, signal: AbortSignal): Promise<GitCommitResult>

/**
 * Compare committed changes against locally available refs.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('compare') async compare(request: GitSessionRequest, signal: AbortSignal): Promise<GitCompareResult>

/**
 * Read a bounded page of commit history.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('log') async log(request: GitLogRequest, signal: AbortSignal): Promise<GitLogEntry[]>

/**
 * Read one file from a selected commit.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('show') async show(request: GitShowRequest, signal: AbortSignal): Promise<GitShowResult>

/**
 * Read the patch of a selected commit.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('commitDiff') async commitDiff(request: GitRevisionRequest, signal: AbortSignal): Promise<GitDiffResult>

/**
 * Discard one tracked path after explicit confirmation.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('discard') async discard(request: GitDiscardRequest, signal: AbortSignal): Promise<GitMutationResult>

/**
 * Revert an explicitly selected commit.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('revert') async revert(request: GitRevisionMutationRequest, signal: AbortSignal): Promise<GitMutationResult>

/**
 * Cherry-pick an explicitly selected commit.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('cherryPick') async cherryPick(request: GitRevisionMutationRequest, signal: AbortSignal): Promise<GitMutationResult>
```

Source: [`packages/api/sidebar-git-controller/src/index.ts`](../../packages/api/sidebar-git-controller/src/index.ts)

<a id="ctxsidebarterminalcontroller--sidebarterminalcontroller"></a>

### `ctx.sidebarTerminalController` — `SidebarTerminalController`

Validated Remote calls over the sole sidebar terminal provider; owns no PTYs.

```ts cordis-catalog
/** Query native terminal availability.
 * @returns Availability without opening a terminal.
 */
@Remote capability(): SidebarTerminalCapability

/** Discover installed local shells for a new UI tab.
 * @returns Verified executable paths and display names; does not create a process.
 */
@Remote shells(): readonly SidebarTerminalShell[]

/**
 * Attach to a terminal and forward acknowledged output without buffering it.
 * @param request - Immutable target and integer geometry from 1 through 1024.
 * @param signal - Attachment lifetime; disposal also cancels and closes the provider iterator.
 * @returns Provider frames; operational failures use sidebarTerminals error codes.
 */
@Remote({ mode: 'stream' }) open(request: SidebarTerminalOpenRequest, signal: AbortSignal): AsyncIterable<SidebarTerminalFrame>

/** Forward input to the attached native process.
 * @param request - Live attachment and at most 64 KiB of UTF-8 input.
 */
@Remote input(request: SidebarTerminalInputRequest): void

/** Resize the attached native process.
 * @param request - Live attachment and integer geometry from 1 through 1024.
 */
@Remote resize(request: SidebarTerminalResizeRequest): void

/** Acknowledge output consumed by the renderer.
 * @param request - Live attachment and highest rendered nonnegative safe sequence.
 */
@Remote ack(request: SidebarTerminalAckRequest): void

/** Release the attachment with its requested disposition.
 * @param request - Attachment to disconnect, park, or close.
 */
@Remote release(request: SidebarTerminalReleaseRequest): void

/** Observe an existing UI process without spawning or extending lifetime.
 * @param request - Existing UI tab.
 * @returns Its native generation or null.
 */
@Remote inspectUi(request: SidebarTerminalUiTarget): SidebarTerminalProcessId | null

/** Close only the observed UI process generation.
 * @param request - Exact previously observed process; replacements cannot be closed by a stale request.
 */
@Remote closeUi(request: SidebarTerminalCloseUiRequest): void

/**
 * Observe the agent terminals owned by one Session.
 * @param sessionId - Nonempty opaque Session identity.
 * @param signal - Consumer lifetime; disposal also cancels and closes the provider iterator.
 * @returns Complete current lists and subsequent provider snapshots.
 */
@Remote({ mode: 'stream' }) watch(sessionId: SidebarTerminalSessionId, signal: AbortSignal): AsyncIterable<readonly SidebarAgentTerminalSnapshot[]>

/** Close the identified agent terminal.
 * @param uuid - Lowercase UUID of an agent terminal explicitly closed by the user.
 */
@Remote closeAgent(uuid: SidebarAgentTerminalId): void
```

Types: [SidebarAgentTerminalId](terminal.md) · [SidebarAgentTerminalSnapshot](terminal.md) · [SidebarTerminalAckRequest](terminal.md) · [SidebarTerminalCapability](terminal.md) · [SidebarTerminalCloseUiRequest](terminal.md) · [SidebarTerminalFrame](terminal.md) · [SidebarTerminalInputRequest](terminal.md) · [SidebarTerminalOpenRequest](terminal.md) · [SidebarTerminalProcessId](terminal.md) · [SidebarTerminalReleaseRequest](terminal.md) · [SidebarTerminalResizeRequest](terminal.md) · [SidebarTerminalSessionId](terminal.md) · [SidebarTerminalShell](../../packages/terminal/sidebar-terminals/README.md#ownership-and-lifetime) · [SidebarTerminalUiTarget](terminal.md)

Source: [`packages/api/sidebar-terminal-controller/src/index.ts`](../../packages/api/sidebar-terminal-controller/src/index.ts)

<a id="ctxterminalcontroller--terminalcontroller"></a>

### `ctx.terminalController` — `TerminalController`

Host service backing the generated `ctx.remote.terminals` namespace.

```ts cordis-catalog
/**
 * List all terminals owned by one session's agent.
 * @param request - session identity.
 * @param signal - cancellation.
 * @returns terminal snapshots in publication order.
 */
@Remote async list(request: TerminalListRequest, signal: AbortSignal): Promise<TerminalListValue>

/**
 * Spawn a new terminal session owned by the agent.
 * @param request - session identity and terminal spawn parameters.
 * @param signal - cancellation of unpublished setup.
 * @returns published terminal identity and initial output.
 */
@Remote async spawn(request: TerminalSpawnRequest, signal: AbortSignal): Promise<TerminalSpawnValue>

/**
 * Send input to a terminal and await readiness.
 * @param request - terminal identity and input text.
 * @param signal - cancellation of the send operation.
 * @returns settled output and wait reason.
 */
@Remote async send(request: TerminalSendRequest, signal: AbortSignal): Promise<TerminalSendValue>

/**
 * Read terminal scrollback.
 * @param request - terminal identity and optional page parameters.
 * @param signal - cancellation.
 * @returns bounded scrollback page.
 */
@Remote async read(request: TerminalReadRequest, signal: AbortSignal): Promise<TerminalReadValue>

/**
 * Signal a terminal's foreground process group.
 * @param request - terminal identity and signal name.
 * @param signal - cancellation.
 * @returns delivered process group identity.
 */
@Remote async signal(request: TerminalSignalRequest, signal: AbortSignal): Promise<TerminalSignalValue>

/**
 * Close a terminal and await quiescent cleanup.
 * @param request - terminal identity.
 * @param signal - cancellation.
 * @returns whether the terminal was newly closed.
 */
@Remote async kill(request: TerminalKillRequest, signal: AbortSignal): Promise<TerminalKillValue>
```

Types: [TerminalReadRequest](terminal.md) · [TerminalSendRequest](terminal.md) · [TerminalSpawnRequest](terminal.md)

Source: [`packages/api/terminal-controller/src/index.ts`](../../packages/api/terminal-controller/src/index.ts)

<a id="ctxtypert--typertregistry"></a>

### `ctx.typert` — `TypertRegistry`

Registry of generated schemas, package reflection, invocations, and Remote dependency providers.

```ts cordis-catalog
/**
 * Register one generated contribution atomically for the calling fiber.
 * Duplicate package-face identities, schemas, invocation ids, or endpoints
 * reject the whole batch.
 * @param contribution - generated schemas, reflection, and Host invocations.
 * @returns the exact effect disposer that removes this contribution.
 */
register(contribution: TypertContribution): TypertDisposer

/**
 * Look up one schema by `<package>#<name>`.
 * @param key - global schema key.
 * @returns the live schema record, or `undefined` when absent.
 */
get(key: string): TypertSchemaRecord | undefined

/**
 * Resolve one required schema.
 * @param key - global schema key.
 * @returns the live schema record.
 * @throws when the key is malformed, the package face is absent, or the schema is not contributed.
 */
resolve(key: string): TypertSchemaRecord

/**
 * Enumerate live schemas in registration order.
 * @param filter - optional package and face restriction.
 * @returns matching schema records.
 */
list(filter: TypertSchemaFilter = {}): TypertSchemaRecord[]

/**
 * Look up generated reflection for one package face.
 * @param packageName - exact npm package name.
 * @param face - face to query; defaults to the host runtime.
 * @returns the live package record, or `undefined` when absent.
 */
getPackage(packageName: string, face: TypertFace = 'host'): TypertPackageRecord | undefined

/**
 * Enumerate generated package reflection in registration order.
 * @param filter - optional package and face restriction.
 * @returns matching package records.
 */
listPackages(filter: TypertPackageFilter = {}): TypertPackageRecord[]

/**
 * Project a live Zod schema to JSON Schema without caching the result.
 * @param key - global schema key.
 * @param params - Zod projection parameters.
 * @returns a fresh JSON Schema document.
 */
toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema
```

Types: [TypertContribution](invariants.md) · [TypertFace](invariants.md) · [TypertPackageFilter](invariants.md) · [TypertPackageRecord](invariants.md) · [TypertSchemaFilter](invariants.md) · [TypertSchemaRecord](invariants.md)

Source: [`packages/typert/registry/src/service.ts`](../../packages/typert/registry/src/service.ts)

<a id="ctxtypertgateway--typertgatewayservice"></a>

### `ctx.typertGateway` — `TypertGatewayService`

Resolve strict generated definitions or conservative SRC markers against current Cordis Services and Typert providers.

```ts cordis-catalog
/**
 * Register the sole application-selected forwarded-event source.
 * @param source - stream factory installed by the Remote assembly.
 * @param host - stable Host facts included in each Client generation's opening frame.
 * @returns disposer removing this source and cancelling its active streams.
 */
registerRemoteEvents( source: TypertRemoteEventSource, host: RemoteEventHostInfo, ): () => Promise<void>

/**
 * Invoke one live Remote method through strict generated reflection or SRC markers.
 * @param request - decoded endpoint and exact named wire arguments.
 * @returns the business result without output decoding.
 * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
 */
async invoke(request: InvokeRemoteRequest): Promise<unknown>

/**
 * Open one live stream Remote method without assuming a physical carrier.
 * @param request - decoded endpoint and named wire arguments.
 * @returns a cancellation-aware iterable over the business results.
 */
async stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>>
```

Source: [`packages/api/gateway/src/index.ts`](../../packages/api/gateway/src/index.ts)

<a id="ctxusagecontroller--usagecontroller"></a>

### `ctx.usageController` — `UsageController`

Read-only usage consumer with no Session activation or preference mutation.

```ts cordis-catalog
/**
 * Query known own-Turn accounting through the authenticated browser carrier.
 * @param request - interval and optional exact provider/model filters.
 * @param signal - transport cancellation propagated through all Host reads.
 * @returns the query service result unchanged, including unknown/partial accounting.
 * @throws a sanitized RemoteError on query failure, or the caller signal reason on cancellation.
 */
@Remote async query(request: UsageQueryRequest, signal: AbortSignal): Promise<UsageQueryResult>
```

Types: [UsageQueryRequest](session-query.md) · [UsageQueryResult](session-query.md)

Source: [`packages/api/usage-controller/src/index.ts`](../../packages/api/usage-controller/src/index.ts)

<a id="ctxvoicecontroller--voicecontroller"></a>

### `ctx.voiceController` — `VoiceController`

Transport adapter over the provider-neutral voice operations.

```ts cordis-catalog
/**
 * Read native engine availability without downloading models.
 * @param signal - Transport cancellation.
 * @returns Availability and provider repair guidance.
 */
@Remote engineStatus(signal: AbortSignal): Promise<VoiceEngineStatus>

/**
 * Read the model roster and current cache state.
 * @param signal - Transport cancellation.
 * @returns Display metadata and installation status.
 */
@Remote modelsList(signal: AbortSignal): Promise<VoiceModelsListValue>

/**
 * Download or await a model installation.
 * @param request - Exact model selector from modelsList.
 * @param signal - Cancels the shared model installation and awaits its cleanup.
 * @returns Ready cache directory.
 */
@Remote modelsDownload(request: VoiceModelRequest, signal: AbortSignal): Promise<VoiceModelsDownloadValue>

/**
 * Cancel model work and remove the downloaded files.
 * @param request - Exact model selector from modelsList.
 * @param signal - Caller cancellation before deletion starts.
 * @returns Empty receipt after removal and resource cleanup.
 */
@Remote modelsRemove(request: VoiceModelRequest, signal: AbortSignal): Promise<VoiceModelsRemoveValue>

/**
 * Transcribe bounded canonical base64 PCM with an installed model.
 * @param request - Model selector and little-endian 16kHz mono float32 PCM.
 * @param signal - Transport cancellation; native work settles before resources release.
 * @returns Transcript after recognizer disposal.
 */
@Remote transcribe(request: VoiceTranscribeRequest, signal: AbortSignal): Promise<VoiceTranscribeResult>
```

Types: [VoiceEngineStatus](voice.md) · [VoiceModelsDownloadValue](voice.md) · [VoiceModelsListValue](voice.md) · [VoiceTranscribeRequest](voice.md) · [VoiceTranscribeResult](voice.md)

Source: [`packages/api/voice-controller/src/index.ts`](../../packages/api/voice-controller/src/index.ts)

<a id="ctxworkspaceisolationcontroller--workspaceisolationcontroller"></a>

### `ctx.workspaceIsolationController` — `WorkspaceIsolationController`

Host API exposing lease ids and detached state, never deletion paths.

```ts cordis-catalog
/**
 * List every provider-owned lease without activating a checkout.
 * @param signal - Caller cancellation checked before reading provider state.
 * @returns detached active and hibernated lease projections.
 */
@Remote('list') list(signal: AbortSignal): WorkspaceIsolationListValue

/**
 * Materialize one hibernated lease.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached active lease state.
 */
@Remote('activate') async activate( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationLeaseValue>

/**
 * Checkpoint and reclaim one inactive checkout while retaining its branch.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation checked before provider admission.
 * @returns detached hibernated lease state.
 */
@Remote('hibernate') async hibernate( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationLeaseValue>

/**
 * Inspect checkout ownership and working-tree state without mutation.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached lightweight inspection.
 */
@Remote('inspect') async inspect( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationInspectionValue>

/**
 * Compare one lease with its current base branch.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached bounded comparison.
 */
@Remote('compare') async compare( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationComparisonValue>

/**
 * Merge a managed branch into its clean recorded base checkout.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached integration receipt.
 */
@Remote('merge') async merge( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationIntegrationValue>

/**
 * Cherry-pick a managed branch's linear commits into its clean recorded base checkout.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached integration receipt.
 */
@Remote('cherryPick') async cherryPick( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationIntegrationValue>

/**
 * Export a complete bounded patch without accepting a browser-supplied path.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns patch content and omission metadata.
 */
@Remote('exportPatch') async exportPatch( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationPatchValue>

/**
 * Reclaim one checkout and delete its branch only after safe integration.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation checked before provider admission.
 * @returns removal acknowledgement or a retained branch requiring review.
 */
@Remote('teardown') async teardown( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationTeardownValue>

/**
 * Remove provider-detected orphaned worktrees in its bounded scan scope.
 * @param signal - Caller cancellation checked before provider admission.
 * @returns number of orphaned worktrees removed.
 */
@Remote('prune') async prune(signal: AbortSignal): Promise<WorkspaceIsolationPruneValue>
```

Source: [`packages/api/workspace-isolation-controller/src/index.ts`](../../packages/api/workspace-isolation-controller/src/index.ts)

<a id="ctxworktreetaskcontroller--worktreetaskcontroller"></a>

### `ctx.worktreeTaskController` — `WorktreeTaskController`

Host API exposing Worktree Task lifecycle operations.

```ts cordis-catalog
/**
 * Create a new Worktree Task with its own branch and worktree checkout.
 * @param request - Task name, workspace, source path, and optional base ref.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached created task projection.
 */
@Remote('create') async create(request: WorktreeTaskCreateRequest, signal: AbortSignal): Promise<WorktreeTaskCreateValue>

/**
 * List every task without activating a checkout.
 * @param signal - Caller cancellation checked before reading provider state.
 * @returns detached task projections.
 */
@Remote('list') list(signal: AbortSignal): WorktreeTaskListValue

/**
 * Get one task by id without filesystem work.
 * @param request - Task identity.
 * @param signal - Caller cancellation checked before reading provider state.
 * @returns detached task projection; an unknown id rejects with not-found.
 */
@Remote('get') get(request: WorktreeTaskRequest, signal: AbortSignal): WorktreeTaskValue

/**
 * Read provider defaults without running hooks or materializing tasks.
 * @param signal - Caller cancellation checked before the read.
 * @returns detached defaults, revision, and managed root.
 */
@Remote('settings') settings(signal: AbortSignal): WorktreeTaskSettings

/**
 * Save defaults for future tasks without changing existing tasks or running hooks.
 * @param request - Complete defaults and the revision observed by the caller.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns persisted defaults with their new revision; a stale revision rejects.
 */
@Remote('updateSettings') async updateSettings(request: UpdateWorktreeTaskSettingsRequest, signal: AbortSignal): Promise<WorktreeTaskSettings>

/**
 * Read tracked changes against the captured base without activating a dormant task.
 * @param request - Provider-issued task identity.
 * @param signal - Caller cancellation forwarded to queued and active provider reads.
 * @returns complete bounded review, captured hooks, and untracked names without contents.
 */
@Remote('review') async review(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskReview>

/**
 * Bind a session to an existing task.
 * @param request - Task id and session id.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns updated task and checkout path.
 */
@Remote('bindSession') async bindSession(request: WorktreeTaskBindSessionRequest, signal: AbortSignal): Promise<WorktreeTaskBindSessionValue>

/**
 * Reactivate a hibernated task's checkout.
 * @param request - Task identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached active task projection.
 */
@Remote('activate') async activate(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskValue>

/**
 * Checkpoint and reclaim one inactive task's checkout.
 * @param request - Task identity.
 * @param signal - Cancellation forwarded to queued work and provider subprocesses.
 * @returns detached hibernated task projection.
 */
@Remote('hibernate') async hibernate(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskValue>

/**
 * Run captured cleanup and archive a task, retaining its branch and records for review.
 * A succeeded receipt prevents repeat execution; an unsettled receipt rejects another attempt.
 * @param request - Task identity; repeating a settled failure explicitly retries cleanup.
 * @param signal - Cancellation forwarded to queued work and provider subprocesses.
 * @returns detached archived task projection, including any cleanup receipt.
 */
@Remote('archive') async archive(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskValue>

/**
 * Archive through captured cleanup, then remove an integrated task branch when safe.
 * An unmerged branch remains archived and reviewable; successful cleanup is not repeated.
 * @param request - Task identity; repeating a settled failure explicitly retries cleanup.
 * @param signal - Cancellation forwarded to queued work and provider subprocesses.
 * @returns deletion or retained-branch result, including any cleanup receipt.
 */
@Remote('delete') async delete(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskDeleteValue>
```

Types: [UpdateWorktreeTaskSettingsRequest](workspace.md) · [WorktreeTaskReview](workspace.md) · [WorktreeTaskSettings](workspace.md)

Source: [`packages/api/worktree-task-controller/src/index.ts`](../../packages/api/worktree-task-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
