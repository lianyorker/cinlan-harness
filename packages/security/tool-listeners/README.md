---
description: "Model-facing Responder and ntlmrelayx listener tools for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-listeners

English | [中文](README.zh.md)

## Summary
This package registers the `responder_capture` and `ntlm_relay` tools on `ctx.tools`, running each external listener as a background job through `ctx.jobs`: the call returns a job id at once, captured output streams into the job ring (`job_output`, `job_kill`), and the listen window or a kill terminates the session. Local binds are the listener surface; the relay target is the only outbound destination. `assessment-scope-tool-policy` enforces the `exploit-execution` mapping upstream with `target_id` matched against a grant target and approval prompts preserved where configured.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-jobs` with a registry such as `@deepseek-ai/dsh-jobs-local`, `@deepseek-ai/dsh-tool-jobs` (the `job_output`/`job_kill` tools), and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `exploitTools` including both tool names. The `Responder` and `ntlmrelayx` executables must be resolvable on the execution host's PATH or via the config commands; both need raw-socket privileges (root/administrator). Set `config.maxListenMs` to the deployment's acceptable session ceiling.

<a id="model-experience"></a>
## Model Experience

### responder_capture and ntlm_relay tool schemas

#### What the model sees

The model receives the generated [`responder_capture` schema](../../../docs/tool-catalog.md#cinlantool-listeners) (and the sibling `ntlm_relay` schema): `target_id` (required grant target), a required listener-specific argument (`interface` for Responder, the relay target scheme for ntlm_relay), and an optional `listen_window_ms` bounded by `maxListenMs`. Calls return `{ jobId, listenWindowMs }` at once.

#### Token effect

The tools add two descriptions and JSON schemas to the model tool context; captured output is bounded by the job registry's ring and read through `job_output`, not by the call result.

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires locally installed, privileged Responder and ntlmrelayx binaries; each tool reports a clear error when its executable is missing.
- Listener sessions are exploit execution: the deployment should list `exploit-execution` in the grant's `approvalRequiredActions` so every poisoning or relay call requires approval.
- Captured hashes (Responder) and relayed authentication events (ntlmrelayx) stream raw into the job ring; hash values are kept `full` for offline cracking under the grant evidence policy, consistent with `secrets_dump`.
- Responder poisoning affects the whole broadcast segment of the chosen interface; scope the grant target to the assessed network.
- ntlmrelayx relay targets beyond the single granted destination, SOCKS-mode chains, and multi-protocol relay graphs are deferred.

<a id="dev-note"></a>
### Dev Note

Keep the tool names, the `listen_window_ms` parameter name, the fixed `-smb2support` relay flag, and the `exploitTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
