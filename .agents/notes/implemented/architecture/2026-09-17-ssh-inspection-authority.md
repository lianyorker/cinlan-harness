# Agent Note: SSH inspection does not establish remote Session authority

Status: implemented

English | [中文](2026-09-17-ssh-inspection-authority.zh.md)

## Problem

A reachable SSH endpoint does not establish where a Session executes or which remote paths it may use. Saving an alias, completing authentication, and receiving a worker greeting prove different facts. A disconnected transport also cannot prove that an operation stopped. Treating these observations as one connected flag can mislabel local execution or allow a delayed response to act on a replacement connection.

## Decision

The [target owner](../../../../packages/execution-host/execution-host-targets/README.md) keeps revisioned alias records separate from live connection instances. Saved target ids remain stable while each accepted worker incarnation and connection generation identifies one live peer. Root references and directory results retain that identity. Admission and response processing reject retired generations.

OpenSSH owns authentication and host trust through an existing configured alias. Connections use batch mode, strict known-host checking, and no agent forwarding. The fixed remote command invokes the supported `dsh --profile execution-host` profile, which the remote user installs and configures beforehand. The [standalone bundle](../../../../packages/bundle/execution-host-app/README.md) supplies the worker and its explicit local providers without a Web server, Agent composition, or model credentials.

The [worker](../../../../packages/execution-host/execution-host-worker/README.md) starts through public AppReady participation after Loader commit and shuts down through AppExit. Its versioned stdio messages advertise bounded directory inspection only. Exported roots are explicit and default to an empty list. The connector requires a negotiated incarnation and successful inspection of actual exported roots before reporting readiness; a greeting or empty root list does not satisfy that requirement.

Cancellation waits for the original worker operation to settle and acknowledges its outcome. A deadline or broken transport that prevents acknowledgement reports outcome-unconfirmed. Teardown retains cleanup ownership, prevents replacement admission after unload, and retires stale workers. Completed cancellation ids have bounded retention, so an expired id cannot establish a past outcome.

The [controller](../../../../packages/api/execution-host-controller/README.md) and [native page](../../../../packages/client/ui-settings-hosts/README.md) expose records, explicit connection actions, and root-bound inspection through the existing authenticated Remote carrier. Default-host, switch-confirmation, and isolation rows store no preferences because there is no remote Workspace or Session execution authority to consume them. The existing execution-host provenance service continues to identify the current process; selecting a target does not replace that identity. The [portable execution-world decision](2026-07-28-portable-execution-world-consumers.md) continues to require filesystem and subprocess providers from one execution world; target inspection does not install or replace those providers.

## Alternatives considered

**Treat the selected host as the current execution host.** A UI selection cannot relocate an Agent, reconstruct its environment, or authorize its files. Keeping provenance and target selection separate prevents local work from being labelled remote.

**Bootstrap a worker or open an additional HTTP listener automatically.** Installing software and defining remote exports require a separate explicit deployment choice. A configured profile and authenticated SSH stdio keep those choices visible.

**Report cancellation success when the transport closes.** Connection loss provides no settlement evidence. An explicit uncertain outcome preserves what the Host actually knows.

## Consequences

SSH target management does not supply remote Agent dispatch, remote Session defaults, OS daemon installation, or general remote command execution. The worker emits bounded results, but its filesystem provider enumerates the whole directory before output truncation. Containment checks are not atomic against hostile concurrent path replacement, so configured roots require trusted filesystem topology. Package READMEs own the precise limits and configuration.

Verification uses native OpenSSH against isolated servers with private keys, known-host files, and actual worker Loader compositions. Distinct target sentinels, authentication refusal, root inspection, generation guards, cancellation settlement, transport-loss uncertainty, and unload are exercised without contacting user servers. Controller compositions cover authenticated Web, shared Fetch, and WebSocket carriers. The supported CLI profile and assembled browser/Desktop remain separate artifact checks.
