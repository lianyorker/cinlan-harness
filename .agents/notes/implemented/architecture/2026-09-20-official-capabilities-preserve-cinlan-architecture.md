# Agent Note: Official capabilities preserve Cinlan architecture

Status: implemented

English | [中文](2026-09-20-official-capabilities-preserve-cinlan-architecture.zh.md)

## Problem

The official 0.1.6-alpha.2 feature set spans runtime services, model capabilities, file delivery, and application UI. Matching package versions or substituting a neighboring local feature leaves observable gaps. Replacing whole application compositions also changes Cinlan's Settings, sidebar consumers, and Desktop package ownership without resolving those gaps independently.

## Decision

Integrate capabilities through their current owners and record source support separately from runtime and packaged acceptance. The [feature parity report](../../../../reports/migration/official-0.1.6-alpha.2-feature-parity.md) owns the release checklist, executed evidence, platform restrictions, and remaining verification. A package version identifies the integration target; it does not establish that a provider is configured or that an installer contains the current source.

The [product ownership decision](2026-09-19-selective-upstream-integration-preserves-product-ownership.md) retains Settings persistence, sidebar consumers, model protocol selection, and local delegation defaults. The [feature navigation decision](2026-09-19-feature-settings-navigation.md) retains independent function destinations and native save/reset owners. Linear.app remains future design context; this integration does not adopt its visual design.

### Sidebar and Desktop ownership

Office preview registers through the existing file-viewer API and authorized [Office converter](../../../../packages/document/office-to-pdf/README.md). Plans, changes, and declared deliverables use the existing better-sidebar APIs. The terminal shell chooser extends the existing Session-owned PTY service: each tab captures its launch choice without changing Settings, and reconnecting reuses a surviving process. Host restart cannot restore an exited process or its running command. These integrations preserve the extension API and avoid competing owners for the same panel or process. Embedded child tabs use the ordinary Conversation renderer and retain a Session reference without changing the main selection; closing the tab releases its reference. File previews separate the visible layout Session from the source Session that owns cwd and read authorization, so an immediate cross-session preview cannot inherit the wrong reader.

The [Session controller](../../../../packages/api/session-controller/README.md) edits and removes durable queued input from an authorized cold continuable child without activating an Agent. [AgentLoop](../../../../packages/core/agent-loop/README.md) retains the standard inbox projection for its service lifetime alongside the existing per-Agent references, so stored queues remain readable with zero live Agents. Cold mutation uses the existing exclusive persistence writer and the current child identity from its own log suffix. Standard interrupted-turn recovery records precede the existing inbox splice; a successful flush precedes publication of the existing inbox projection frame at a sequence above the cold reader's observed state. This keeps queue edits durable and visible without starting model work, introducing another event type, or bypassing the child ownership check. The existing Remote response, realtime carrier, and Session format remain unchanged.

Desktop keeps its private npm project, staged package transactions, recovery, private pnpm store, and [framed-pipe transport](2026-08-25-electron-desktop-packaging-and-updates.md). Its explicit Host adapter permits configuration-row changes through the profile manager while package and composition mutations remain shell-owned. Without that adapter, the manager refuses Desktop changes. The [Host bootstrap](../../../../apps/desktop-host/src/index.ts) installs the common proxy policy before plugins and releases it during teardown; this does not configure every transport. OTLP, model-authored workers, and Electron update traffic have separate limits recorded in the parity report. Packaging identifies the independently published `@deepseek-ai/libreoffice-kit` as a registry dependency for the offline seed. Required local dsh and vendored packages still reject preparation when their tarball is absent; shared npm scope alone does not establish local ownership.

The [Connection type entry](../../../../packages/client/connection/README.md#use-this-package) exports shared RPC and Fetch interfaces without either Host or Client Context service declaration. Sidebar transport helpers import those interfaces through `/types`, so the Client compiler does not acquire Host services merely to describe a route. Host and Client plugin entries retain their own services; the existing HTTP and Desktop framed-pipe carriers keep the same runtime behavior.

### MCP and durable delivery

[MCP resources](../../../../packages/mcp/mcp-resources/README.md) adds shared caller-scoped list, template-list, and read tools while retaining the local v1 MCP client and its managed supervisor. Resource listings return one page with an opaque continuation cursor. Requests use the initialized connection generation and combine caller, generation, and lifecycle cancellation. Connection failure does not remove the configured provider's shared tools. Pure presenters retain server attribution; canonical programmatic results retain binary payloads while model text describes them. External prompt text uses whole-section `interpolate: false` so literal braces cannot become prompt-variable lookups.

The [existing MCP decision](../feature/2026-07-07-mcp-client-plugin.md) still owns stable tool names, transport isolation, canonical output, and image admission. Replacing its supervisor merely to match the official SDK version would discard managed ownership, credential redaction, repeated-cursor protection, and unconfirmed-close reservations. The resource service extends that lifecycle instead.

The [present tool](../../../../packages/deliverables/tool-present/src/index.ts) records declared existing files only after successful tool settlement. Its `deliverables/presented` event is required on read: a reader that does not know this event refuses the log. File preview, default-app open, and reveal resolve recorded Session/event/file coordinates through authorization. A delivered reference opens the current source file; it is not an immutable copy. New event support does not rewrite committed JSONL generations, following the [released-session rule](2026-08-31-released-session-format-migrations.md).

Feedback categories remain optional metadata owned by the feedback domain. Submission appends the record; draft edits and dismissal append nothing. Category changes participate in compare-and-swap without rewriting history or loosening historical admission. Existing native v3 metadata support carries these records, and model messages retain their prior meaning. The [persistence tests](../../../../packages/session/session-log-deepseek/tests/feedback-composition.spec.ts) cover real JSONL reopening; browser, SDK, and Win32 behavior require their own validation.

### Optional providers

[Browser Use](2026-09-12-browser-use-provider-registration.md) and [Cua Driver](2026-09-20-cinlan-cua-driver-compatibility.md) remain explicit provider choices with external browser, driver, model, or OS prerequisites. Auto review requires an installed integration and an explicit Session permission choice. Provider registration and mock tests do not establish real desktop control. [SSH](2026-09-11-posix-ssh-runtime.md) requires a custom Linux/macOS composition with matching remote helpers; saved target metadata does not redirect filesystem, command, or PTC execution. Windows endpoints remain unsupported.

## Alternatives considered

**Treat version alignment or partial equivalents as full parity.** A plugin catalog entry does not activate an Office viewer, a child-status panel does not display its conversation beside the parent, and saved SSH aliases do not mount remote execution providers. The report records those behaviors separately.

**Replace Cinlan's Settings, sidebar, or Desktop with the official composition.** This changes independently owned product behavior and package transactions. Additive consumers retain those owners while exposing the requested capabilities.

**Enable every experimental provider by default.** External credentials, browser attachment, desktop permissions, and competing provider lifetimes require deliberate configuration. A source port cannot establish those prerequisites for the user.

## Consequences

The integration carries adapters and focused regression obligations in exchange for retaining Cinlan's product APIs and durable data rules. Required evidence covers scoped resource teardown and cancellation, native terminal reuse, authorized Office conversion, declared-file authorization, profile mutation ownership, and unchanged Settings persistence. Assembled UI, real external providers, and Windows installer acceptance remain separate evidence levels in the report. The Settings, Desktop, MCP, Browser, Cua, SSH, and archived-session notes retain independent rationale; none is fully superseded or archived by this decision.
