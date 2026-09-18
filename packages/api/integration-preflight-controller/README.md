---
description: "Check GitHub, GitLab, and Gitee authentication readiness on the Host without installing or activating integrations."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-integration-preflight-controller

English | [中文](README.zh.md)

## Summary

Check whether GitHub, GitLab, or Gitee authentication is available on the Host before using an integration. Results report readiness and an optional account hint without exposing credentials. Checks use existing setup and do not install software, sign in, or activate plugins.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this service in a Cordis composition with `typert` available. Host callers use `ctx.integrationPreflightController.check({ provider }, signal)`; Remote callers use `integrationPreflight.check`. The plugin defines no configurable fields.

| Provider | Host requirement | Authentication check |
|---|---|---|
| `github` | `gh` on the Host PATH | GitHub CLI authentication status |
| `gitlab` | `glab` on the Host PATH | GitLab CLI authentication status |
| `gitee` | `GITEE_TOKEN` in the Host environment | Gitee current-user API |

Missing setup, authentication failures, and probe failures return readiness snapshots with stable reason codes. Caller cancellation rejects the request. Successful checks may include an account hint; raw command output and credential values are not returned.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service exposes the `check` Remote method in the `integrationPreflight` namespace. GitHub and GitLab checks read CLI authentication status. Gitee checks read the configured token and request the current-user endpoint when a token is present. Each call returns one snapshot independently of plugin activation.

No invariant companion is published because this controller derives each readiness snapshot from the current CLI authentication result or Gitee token check and retains no separate readiness state or cache to reconcile.

See the [probe implementation](src/index.ts) and [request and result types](src/types.ts) for the public method and returned values.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Cordis primer](../../../docs/cordis-primer.md) explains service activation and composition.
- [Typert protocol](../../typert/protocol/README.md) owns Remote method transport.
- [Harness architecture](../../../docs/architecture.md) introduces plugin composition and extension points.

-----

<a id="model-experience"></a>
## Model Experience

None, as the controller reports integration readiness without contributing prompts, tools, or model-visible events.

#### KV Cache effect

None; readiness checks do not assemble or send model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Readiness describes the authentication observed during one check.

- A connected result does not verify repository-specific permissions or prove that an integration plugin is active.
- CLI probes use a fixed 10-second timeout and a 64-KiB output limit. Gitee HTTP probes rely on caller cancellation and have no controller-owned timeout.
- A successful CLI check can have a null account hint.
