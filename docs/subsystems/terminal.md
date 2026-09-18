# Persistent PTY Sessions

English | [中文](terminal.zh.md)

Types shared by PTY backends, `ctx.terminals`, and the model-facing consumer. The [persistent PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md) owns the rationale; this page records the cross-package vocabulary from [`packages/terminal/terminal/src/types.ts`](../../packages/terminal/terminal/src/types.ts).

## Identity and readiness

`TerminalSessionId` is a service-minted branded id. Optional names are owner-local display metadata; authorization compares the exact owning `Agent`, not a name or guessed id.

`TerminalWaitReason` says why one send returned. It is independent from `TerminalSessionStatus`: silence or timeout may return while the top-level shell remains alive, while `session_exit` means that shell exited rather than an arbitrary foreground child.

```ts type-equiv
/** Why one interactive send returned control to its caller. */
type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'
```

```ts type-equiv
/** Top-level PTY process status, independent of a send's wait reason. */
type TerminalSessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: NodeJS.Signals | null }
```

## Backend and live session

A backend owns how one registered type starts and detects readiness. `TerminalSessionService` publishes the returned session only after setup succeeds, then owns id authorization and cleanup. A backend that cannot clean partial startup resources rejects with `TerminalBackendCleanupError`, allowing disposal to retain the cleanup failure without replacing the caller's cancellation reason. A backend session owns terminal state and captured-resource quiescence.

```ts type-equiv
/** Replaceable provider for one PTY session type. */
interface TerminalBackend {
  /** Stable type selected by {@link TerminalSpawnRequest.type}. */
  readonly type: string
  /** Create an unpublished session or reject after cleaning partial resources; cleanup failure uses {@link TerminalBackendCleanupError}. */
  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>
}
```

```ts type-equiv
/** Backend-owned live session retained by {@link TerminalSessionService}. */
interface TerminalBackendSession {
  /** Initial bounded terminal output returned from `terminal_open`. */
  readonly motd: string
  /** Top-level process id when one exists. */
  readonly pid?: number
  /** Start one exclusive send operation. */
  startSend(request: TerminalSendRequest): TerminalSendOperation
  /** Read one bounded page from retained scrollback. */
  read(request: TerminalReadRequest): TerminalReadResult
  /** Signal the verified foreground process group. */
  signal(signal: TerminalSignal): Promise<TerminalSignalResult>
  /** Observe top-level process status. */
  status(): TerminalSessionStatus
  /** Idempotently close the captured owned process tree and await quiescence. */
  close(reason: string): Promise<void>
}
```

## Send and retained output

One live session accepts one active send. Its operation exposes a consuming output cursor for generic background jobs and one terminal result for a foreground caller. `TerminalReadResult` separately pages the bounded session scrollback.

```ts type-equiv
/** Live backend-owned send; exactly one may be active per PTY session. */
interface TerminalSendOperation {
  /** Resolves after readiness, timeout, cancellation, or top-level process exit. */
  done: Promise<TerminalSendResult>
  /** Consume output produced since the prior call. */
  readOutput(): TerminalSendRead
  /** Request `SIGINT`; returns false after the operation settled. */
  cancel(): boolean
}
```

```ts type-equiv
/** Settled result for one foreground or background send. */
interface TerminalSendResult {
  /** Bounded rendered terminal delta remaining at settlement. */
  viewport: string
  /** Why the wait returned; this does not imply arbitrary child-process exit. */
  waitReason: TerminalWaitReason
  /** Top-level session status observed at settlement. */
  sessionStatus: TerminalSessionStatus
  /** Whether output was dropped from the operation or retained scrollback. */
  truncated: boolean
}
```

## Ownership and durability

`TerminalSessionService` attaches one awaited cleanup to the exact owner scope, rejects foreign operations, and keeps sessions alive across backend or tool-plugin reload. PTY state and raw bytes remain process-local. Model input and bounded returned output are durable through the existing `tool/call`, `tool/result`, and task-result paths rather than duplicate PTY session events.

## Sidebar terminal attachments

`ctx.sidebarTerminals` connects UI tabs and agent terminals to a renderer through `SidebarTerminals`. Its browser-safe values are declared in [`sidebar-terminals/src/types.ts`](../../packages/terminal/sidebar-terminals/src/types.ts); the [service definition](../../packages/terminal/sidebar-terminals/src/index.ts) owns operations, and the [package reference](../../packages/terminal/sidebar-terminals/README.md) owns provider lifetime and floating-directory policy.

| Identity type | Meaning |
|---|---|
| `SidebarTerminalSessionId` | The same `SessionId` brand used by the Session service. |
| `SidebarTerminalTabId` | Durable UI tab identity minted by the sidebar store. |
| `SidebarAgentTerminalId` | Agent terminal registry identity, independent of UI tabs. |
| `SidebarTerminalAttachmentId` | Server-issued identity of one attachment to one process generation. |
| `SidebarTerminalProcessId` | Server-issued native process identity that survives attachment reconnects. |
| `FloatingWorkspaceWindowId` | Validated UUID of one floating app window. |

`SidebarTerminalTarget` selects either a UI terminal with `kind: 'ui'`, `sessionId`, `tabId`, and optional `floating`, or an agent terminal with `kind: 'agent'` and `uuid`. `SidebarTerminalOpenRequest` captures that target and the initial `cols` and `rows` for one physical attachment.

`SidebarFloatingTerminalDirectory` captures `windowId` and `directory` when a floating UI tab is created. `FloatingWorkspaceTerminalContext` always carries `windowId`; only `status: 'ready'` carries a directory, while `loading` and `unavailable` do not. `ctx.floatingWorkspaceContext()` returns this context or `undefined`; the `ctx.floatingTerminalConsumer` marker identifies a consumer. Neither contribution creates a Host terminal.

`SidebarTerminalCapability` reports `status: 'available'` with `shellName`, or `status: 'unavailable'` with `reason: 'missing-dependencies'`. Reading capability starts no shell and does not prove that a configured shell can start.

### Output and control

`SidebarTerminalFrame` is a bounded stream value. Every variant carries `attachmentId`; only data frames carry a sequence for renderer acknowledgment.

| `type` | Additional fields | Meaning |
|---|---|---|
| `ready` | `processId`, `pid`, `cwd`, `shellName` | Opening metadata for the captured process. |
| `data` | `sequence`, `data` | Terminal text whose output credit remains held until rendered and acknowledged. |
| `exit` | `exitCode` | Exit of the attached process. |

| Request type | Fields | Semantics |
|---|---|---|
| `SidebarTerminalInputRequest` | `attachmentId`, `data` | Write to a live attachment; a detached generation cannot write. |
| `SidebarTerminalResizeRequest` | `attachmentId`, `cols`, `rows` | Update the existing attachment's display geometry. |
| `SidebarTerminalAckRequest` | `attachmentId`, `sequence` | Acknowledge the highest data-frame sequence consumed by the renderer. |
| `SidebarTerminalReleaseRequest` | `attachmentId`, `mode` | `disconnect` permits the configured reconnect grace period; `park` retains a hidden UI terminal; `close` terminates its UI process. |
| `SidebarTerminalUiTarget` | `sessionId`, `tabId` | Inspect an existing UI process without spawning it or extending its lifetime. |
| `SidebarTerminalCloseUiRequest` | `sessionId`, `tabId`, `processId` | Close the previously observed native process, including while disconnected; a replacement generation is rejected and a missing process is already closed. |

`SidebarAgentTerminalSnapshot` contains `uuid`, `title`, `command`, `exited`, and optional nullable `exitCode` and `exitSignal`. Watching a Session yields its current agent-terminal list and later updates. Closing an agent terminal uses its registry identity.

`SidebarTerminalError` carries a `SidebarTerminalErrorCode` for carriers to localize: `invalid-request`, `invalid-directory`, `unavailable`, `not-found`, `stale-attachment`, `output-overflow`, or `ack-timeout`. The attachment id cannot authorize operations on a replacement process; a stalled renderer can hold output credit until its attachment times out.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsidebarterminals--sidebarterminals-abstract-seam"></a>

### `ctx.sidebarTerminals` — `SidebarTerminals` (abstract seam)

Sidebar PTY ownership; the provider reuses the UI and agent terminal managers.

```ts cordis-catalog
/** Read native availability without spawning a shell.
 * @returns Current availability.
 */
abstract capability(): SidebarTerminalCapability

/** Attach to a process and observe its output.
 * @param request - immutable target and initial geometry.
 * @param signal - attachment lifetime.
 * @returns bounded terminal frames until exit or release.
 */
abstract open(request: SidebarTerminalOpenRequest, signal: AbortSignal): AsyncIterable<SidebarTerminalFrame>

/** Write input to the attached process.
 * @param request - input for a live attachment.
 */
abstract input(request: SidebarTerminalInputRequest): void

/** Resize the attached process display.
 * @param request - updated display geometry.
 */
abstract resize(request: SidebarTerminalResizeRequest): void

/** Acknowledge output after the renderer consumes it.
 * @param request - highest data sequence rendered by xterm.
 */
abstract ack(request: SidebarTerminalAckRequest): void

/** Release a view of its captured process.
 * @param request - disposition for this attachment's process generation.
 */
abstract release(request: SidebarTerminalReleaseRequest): void

/** Observe an existing UI process without spawning or extending its lifetime.
 * @param request - existing UI tab.
 * @returns its native process identity, or null; never spawns or extends its lifetime.
 */
abstract inspectUi(request: SidebarTerminalUiTarget): SidebarTerminalProcessId | null

/** Request termination of an observed UI process and reject replacement generations.
 * @param request - exact observed native generation; missing processes are already closed, replacements are rejected.
 */
abstract closeUi(request: SidebarTerminalCloseUiRequest): void

/** Observe the agent terminals owned by a Session.
 * @param sessionId - owning Session.
 * @param signal - consumer lifetime.
 * @returns current agent terminal list and later updates.
 */
abstract watch(sessionId: SidebarTerminalSessionId, signal: AbortSignal): AsyncIterable<readonly SidebarAgentTerminalSnapshot[]>

/** Request termination of an agent terminal.
 * @param uuid - agent-owned terminal explicitly closed by its user.
 */
abstract closeAgent(uuid: SidebarAgentTerminalId): void
```

Source: [`packages/terminal/sidebar-terminals/src/index.ts`](../../packages/terminal/sidebar-terminals/src/index.ts)

<a id="ctxterminals--terminalsessionservice"></a>

### `ctx.terminals` — `TerminalSessionService`

In-process registry for replaceable PTY backends and exact-Agent sessions.

```ts cordis-catalog
/**
 * Register one backend type for this effect scope.
 * @param backend - provider with a non-empty unique type.
 * @returns disposer that removes exactly this contribution.
 */
registerBackend(backend: TerminalBackend): () => void

/**
 * List registered backend types in registration order.
 * @returns fresh backend type names.
 */
listBackends(): string[]

/**
 * Create and publish one owner-scoped session after backend setup succeeds.
 * @param owner - exact registered Agent that owns access and cleanup.
 * @param request - backend type plus optional owner-local name and cwd.
 * @param signal - cancellation of unpublished setup.
 * @returns published identity, metadata, status, and MOTD.
 */
async spawn(owner: Agent, request: TerminalSpawnRequest, signal?: AbortSignal): Promise<TerminalSpawnResult>

/**
 * Test whether an exact owner has a published session or unpublished spawn.
 * @param owner - exact live owner to inspect.
 * @returns true across the entire spawn-to-close interval, with no publication gap.
 */
hasOwnerActivity(owner: Agent): boolean

/**
 * Start one exclusive interactive send.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - explicit text, submit behavior, and cancellation.
 * @returns live operation handle for foreground await or task registration.
 */
startSend(owner: Agent, id: TerminalSessionId, request: TerminalSendRequest): TerminalSendOperation

/**
 * Read one bounded scrollback page from an owned session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - optional newest-relative offset and line count.
 * @returns bounded retained text and pagination metadata.
 */
read(owner: Agent, id: TerminalSessionId, request: TerminalReadRequest = {}): TerminalReadResult

/**
 * Deliver an allowed signal through an owned backend session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param signal - allowed POSIX signal name.
 * @returns delivered foreground process-group identity.
 */
signal(owner: Agent, id: TerminalSessionId, signal: TerminalSignal): Promise<TerminalSignalResult>

/**
 * Close one owned session and remove it only after quiescent backend cleanup.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param reason - diagnostic cleanup reason.
 * @returns true for a newly closed session, false when the same close is already in flight.
 */
async kill(owner: Agent, id: TerminalSessionId, reason: string = 'model request'): Promise<boolean>

/**
 * List fresh snapshots for exactly one owner.
 * @param owner - exact owner whose sessions are visible.
 * @returns owner-visible snapshots in publication order.
 */
list(owner: Agent): TerminalSessionSnapshot[]
```

Types: [Agent](core.md)

Source: [`packages/terminal/terminal/src/index.ts`](../../packages/terminal/terminal/src/index.ts)
<!-- END GENERATED cordis-surface -->
