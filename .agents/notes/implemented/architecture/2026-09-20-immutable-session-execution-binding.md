# Agent Note: Immutable Session execution bindings

Status: implemented

English | [中文](2026-09-20-immutable-session-execution-binding.zh.md)

## Problem

A saved SSH target and a successful directory inspection do not identify the providers used by an Agent. A path-only Workspace can also confuse identical paths on different machines, while a mutable global selector can move later operations of an existing Session to a different host. Independent filesystem, terminal and Git consumers make that ambiguity observable even when the Agent's shell is remote.

The [portable execution consumer decision](2026-07-28-portable-execution-world-consumers.md) establishes paired filesystem and process providers. The [execution-world path decision](2026-09-11-async-sandbox-execution-world-paths.md) establishes asynchronous preparation and provider-owned path resolution. Both remain active: this decision adds durable selection and admission ownership without replacing those provider rules.

## Decision

A Workspace owns a local binding or an immutable SSH deployment snapshot plus its canonical directory. Identity includes the execution location and directory. Every Session admitted by an execution-aware composition records the captured selection in a required execution event; absence in an older known execution-managed Session means local. Profiles that do not select execution hosts retain their existing local Session lifecycle. The event is independent of Session origin, which continues to describe lineage. Session persistence remains owned by the controlling Host, and committed JSONL generations are not rewritten to add selection metadata.

Agent admission acquires the captured deployment before mounting its consumers. The target registry reserves authorization before setup and excludes ordinary target edits and removal until the synchronous publication commit or scope rollback releases it. A racing mutation returns a retryable conflict instead of invalidating the target after the durable event flush. A pending admission rejects Session-id execution lookup even when its new log is already readable from storage; only the exact published Agent can expose the prepared lease. Cold lookups pin the admission generation and Agent/provider identities across every await. A changed generation restarts lookup or serves the exact published lease, so an empty observation captured before remote publication cannot select local execution afterward. Remote providers and consumers share explicit Cordis isolation labels; a remote lookup cannot resolve the local provider when its isolated service is absent. Dynamic API consumers use a lease and strict context service lookup. Connection and subprocess ownership can be shared by matching snapshots, while Agent filesystem policy, shell defaults, PTC, Git and terminal registries are private to that Agent's execution scope.

A retained lease identifies one incarnation, carries connection loss, and joins provider teardown after the final holder releases. Live Session operations retain their admitted context rather than resolving the saved target again. A cold Session resolves the durable snapshot and its recorded permission state. Disconnect rejects new work and invalidates receipts; it never switches to a local provider. Node, helper and PTC bootstrap paths belong to the verified remote deployment, not to the controller executable or source tree.

Managed runtime activation preserves explicitly retained predecessor configurations so Sessions captured before an upgrade can resume. Ordinary target edits clear that history; changed trust or credentials do not implicitly authorize previous snapshots. This distinction retains installed generations without treating every historical target revision as valid. Installation ownership remains separate from execution leases.

Workspace creation from a client submits only the selected directory and target id/revision. The Host captures the immutable deployment and performs admission; client-supplied deployment fields cannot bypass target validation. The UI displays the captured endpoint and revision so an existing Workspace continues to identify the deployment it owns.

## Alternatives considered

A second Agent RPC service would duplicate Session authority, permission handling and replay. Reusing the official providers keeps the existing Agent loop and durable owner. A UI-only target selector lacks the publication transaction and allows FS, PTY and Git to disagree. Persisting only a target id allows later edits to retarget an existing Session. Retaining all target history would preserve obsolete trust and credential references after ordinary edits.

## Consequences

Workspace schema migration is explicit and monotonic; compatible predecessor records default to local without altering old Session logs. Remote Session admission requires an execution-aware preset, and remote preset replacement is refused while that consumer ownership cannot be preserved. Controller-specific project instruction paths, filesystem skill discovery, worktree isolation and task providers fail closed until they implement the remote execution semantics they consume.

Verification uses production Loader assembly, real target storage and Agent admission with a controlled external SSH peer. It distinguishes local and remote roots, exercises paired providers, target revision races, cancellation, disconnect and disposal, and compares durable selection with the admitted Agent world. Separate real-endpoint evidence remains required for deployed helper, native PTY and PTC execution. A passing Windows transport fixture does not establish Windows remote endpoint support.
