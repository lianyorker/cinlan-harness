# Agent Note: Remote runtime installation and activation

Status: implemented

English | [中文](2026-09-20-remote-runtime-installation.zh.md)

## Problem

Remote execution needs a mutually compatible helper, PTC bootstrap, dependency tree, and native binaries. Copying only entry files leaves package resolution and native execution dependent on the remote account's ambient installation. Updating a shared directory can change the executable bytes beneath an existing Session's captured deployment.

An installation also outlives a browser observation. Binding its cancellation to a Settings stream makes a reload destructive, while treating a lost stream as successful cleanup hides unknown remote outcomes. A concurrent target edit can otherwise activate a verified runtime against stale trust or deployment coordinates.

## Decision

The [execution-runtime service](../../../../packages/execution-host/execution-runtime/README.md) owns installation independently of execution leases and Client observers. Each explicit install/update captures one target ID/revision and deployment request and returns a branded task ID immediately. Observation and cancellation require that ID. Closing an observer only detaches it; reloading a Client connected to the same Host recovers the bounded retained inventory. Explicit cancellation joins the task, and service disposal cancels and joins all owned work.

Task receipts are Host-memory observations, not durable jobs. Host process restart loses the inventory and does not resume installation. This keeps recovery claims within the authority the service actually retains: durable target activation records a selected deployment, but neither that record nor a browser receipt proves the state of an interrupted remote process.

### Pinned complete generations

A release manifest pins the version, source revision, protocol, target platform/architecture, entry paths, and every regular file's size, SHA-256, and executable flag. The artifact contains the full runtime dependency closure, including native system and PTY binaries. The release producer refuses tracked or untracked changes before recording the source revision; ignored target build outputs enter only after native verification and receive independent manifest hashes. The producer consumes installed, built inputs and fixes dependency versions; installation performs no remote package-manager resolution or registry access. A missing or incompatible release is an error rather than permission to use ambient packages.

Executable flags are target metadata. Windows controller file modes cannot identify POSIX executables reliably, so the producer explicitly identifies target executable files and validates native target bytes. Upload permissions and published file permissions follow that sealed metadata. Existing Node and a private account-owned installation root remain deployment prerequisites.

An explicit SSH endpoint pins the server key and identifies a Host private-key file. Each operation owns its connection, SFTP channel, supervisor, and random staging directory. Local verification, transfer-time rechecking, and remote verification cover the complete inventory. The remote supervisor evaluates the deployed PTC child through its control descriptor and verifies helper identity; native PTY and sandbox probes establish behavior separately from hashes. Installer probes run fixed verification code, not model-supplied code.

A verified staging tree publishes by directory rename into `generations/<manifest SHA-256>`. A generation is immutable through the installation service: the service neither overwrites nor collects published generations. This is an installation guarantee, not attestation against a malicious remote operating system or account owner.

### Activation and existing Sessions

Publication precedes a compare-and-swap of the saved target revision. The target persistence commit is the activation commit point. A stale revision leaves the current target untouched even if a complete unused generation remains. Cancellation while activation waits in the target mutation queue prevents selection. Once the durable write begins, cancellation does not undo a successful commit or rewrite its result as cancellation.

Managed activation retains predecessor execution configurations for existing captured bindings. Live leases retain their admitted deployment and keep using its helper/PTC paths and hashes. Cold Sessions may resolve explicitly retained activation revisions; ordinary target edits invalidate that retained authorization. Retaining all historical trust configurations would silently preserve credentials or trust that an operator intentionally replaced, so generation retention and authorization retention remain distinct.

Transport loss invalidates the observation; it does not prove remote cleanup. Cancellation joins the outcome that the operation can observe and closes only its owned resources. Automatic retry of an unconfirmed mutation is not a recovery protocol.

## Alternatives considered

- **Cancel when a management stream closes.** A Client reload or observer switch would cancel useful Host-owned work without explicit intent.
- **Treat task receipts as restart-durable jobs.** Reliable restart recovery requires persisted operation identity, remote outcome reconciliation, and a cleanup authority beyond an in-memory task map.
- **Install dependencies remotely or copy only helper entry files.** Registry state, optional native selection, and ambient module paths would decide the executed bytes after the release was selected.
- **Derive POSIX modes from controller files.** Windows mode bits do not preserve the target executable metadata needed by sandbox and PTY binaries.
- **Replace a shared current directory in place.** Existing leases could observe changed code, and target revision checks could not preserve their captured generation.
- **Delete predecessors after activation.** A different Host or cold Session can still retain a predecessor; local task completion does not establish global non-use.

## Consequences

Installation adds explicit release production and native validation costs. Missing production dependencies or target prebuilds prevent a usable release; the installer does not download binaries, upgrade Node, create accounts, or establish an installation root. Generations consume storage until a separate reference-aware collection design can account for other Hosts and retained Sessions.

The [POSIX SSH provider note](2026-09-11-posix-ssh-runtime.md) remains active for independent stream security, reservations, leases, and disconnect semantics. Automatic artifact provisioning belongs to this separate installation service; the provider family retains its execution responsibilities. The [immutable Session binding note](2026-09-20-immutable-session-execution-binding.md) remains active for durable selection, admission, and execution isolation. The [asynchronous sandbox and path note](2026-09-11-async-sandbox-execution-world-paths.md) remains active for preparation timing, cancellation, and provider-owned path identity. None is fully superseded or qualifies for consolidation or archival.

## Verification

The [provisioning tests](../../../../packages/execution-host/execution-runtime/tests/provisioning.spec.ts) cover encrypted SSH/SFTP transfer, manifest tampering, dependency completeness, staging ownership, and child control. The [task tests](../../../../packages/execution-host/execution-runtime/tests/tasks.spec.ts) exercise Loader-admitted ownership, observer detachment, same-Host inventory recovery, and target revision races. The [activation race tests](../../../../packages/execution-host/execution-runtime/tests/activation-races.spec.ts) exercise the real target mutation queue through direct cancellation signals and Loader-admitted runtime cancellation or fiber disposal, and preserve a successful commit after persistence has begun. Controlled transport peers and substituted helper behavior are bounded evidence; they do not establish native POSIX acceptance.

Required native evidence includes cold installation and update with complete target artifacts, deployed PTC evaluation, real PTY I/O, sandbox enforcement, and existing Session lease continuity. Windows producer evidence must verify target executable metadata independently of local mode bits. No real POSIX acceptance result is recorded here; artifact production and native validation require the integration owner's Linux/macOS environment and matching release dependencies and binaries.
