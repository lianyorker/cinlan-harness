---
description: "Optional experimental authorization review before native and PTC inner tool calls, using the current agent's model."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-auto-review

English | [中文](README.zh.md)

## Summary

Install this optional bundle to add Auto review to a session's permission picker. The current agent's model reviews each supported tool call before its body executes with Full access. Existing sessions and future-session defaults stay unchanged until a user selects Auto. Review is experimental, may allow unsafe actions or deny useful work, and spends additional tokens.

AutoReview is an external opt-in bundle. The reference release's optional bundle list contains AgentTeam, not AutoReview; neither that list nor this port makes AutoReview stock-enabled.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install and configure

Use a built or packed copy of this public experimental package at version 0.1.6-alpha.2 with a compatible dsh profile. Stop the profile before installing or removing its external layer, then restart it. From the repository root, the CLI installation form is:

```sh
dsh plugin --profile web add ./packages/experimental/auto-review
```

The package declares `dsh.bundle.patch` in its manifest. The profile manager appends [cordis.patch.yml](cordis.patch.yml), which inserts this plugin as the `auto-review` row. For a manually composed profile, the equivalent host row is:

```yaml
- id: auto-review
  name: '@deepseek-ai/dsh-experimental-auto-review'
```

The profile must already supply LLM, Session, tools, session projections, and permission presets, plus the sandbox-capable shell and approval services required by those presets. Its configured `danger-full-access` preset must resolve to `danger-full-access` sandbox and `never` approval; selecting or restoring Auto otherwise fails. A real run also requires credentials for the current provider and model. Mock validation requires no credentials.

Choose `Auto review (EXP)` in the composer or `/permission` picker and acknowledge its risk dialog. Typing the explicit command `/permission auto` switches directly. Auto is excluded from General settings and future-session defaults. To remove the external layer:

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-experimental-auto-review
```

### Review decisions

Low-risk project work is allowed. Medium-risk actions, including irreversible changes, external writes, and security changes, require explicit current human or direct-parent authorization of the action, target, and scope. Sensitive exfiltration is always denied. Malformed responses, missing logged call facts, provider failures, and conflicting authority deny execution; they never fall back to human approval or execute silently.

In-process children inherit the delegation-time Auto or Full access identity after their fork seed and policy overrides. Existing child permission restrictions and downstream tool guards remain effective. Other process backends keep their own authorization system.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle reuses the [permission service](../../interaction/permission-presets/README.md) and [tool pipeline](../../core/tools/README.md). It has no separate approval service, settings namespace, or developer-tool review role. The model request contains five sections: fixed policy, cwd, sourced project constraints, filtered sourced history, and the pending action. Assistant text, reasoning, tool results, and unsourced system messages cannot grant authority.

Native review reads the logged request schema. PTC review uses the frozen binding schema carried only through execution metadata. Denials persist structured error name/code and optional raw reason; the main model receives a fixed rejection message without that reason. No Session format change or committed fixture regeneration is required.

Disposal closes admission, aborts pending reviews, and waits for settlement before removing hooks. Following the reference behavior, live Auto sessions switch to Full access on removal; select a confined preset before removing the layer when that is the desired policy. A persisted Auto session cannot restore without an active reviewer. The [decision record](../../../.agents/notes/implemented/feature/2026-08-28-auto-review.md) owns the authority and lifecycle rationale.

No runtime invariant companion is published: this effect owns admission, review enrollment, cancellation, and cleanup, with no independent observation that can diverge; permission, tool, and Session services retain their own invariant relationships. Mock tests cover authority, cancellation, delegation, and disposal; a Loader composition exercises the real agent loop with a scripted model.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Tool authorization review

#### What the model sees

No tool or prompt is added to the main agent. A denied native or inner PTC call reports `Auto review rejected tool "<name>"; its body was not executed` without exposing the reviewer's raw diagnostic. Outer `run_code` is not reviewed.

#### Token effect

Each reviewed call makes a separate model request using retained Session context and the pending action. Reviewer output stays outside main-agent history; a denial adds the ordinary failed tool result.

#### KV Cache effect

The main-agent prompt and tool prefix are unchanged. Each reviewer request includes current retained history and the proposed call, so prefix reuse depends on the selected provider and shared request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Auto uses Full access and is not a deterministic security barrier. Direct JavaScript effects in outer `run_code` bypass inner-tool review.
- Permission catalog availability follows integration registration and disposal. Startup-only profiles still apply installed package changes on restart.
- Raw reasons remain durable structured metadata; ordinary tool error presentation is retained rather than a specialized denial card.
- A reviewer reads retained Session history synchronously. Compaction checkpoints preserve facts, not the authority of removed instructions.
- Source Loader and mock tests do not certify real-model decisions, registry publication, or installation into an external profile.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
