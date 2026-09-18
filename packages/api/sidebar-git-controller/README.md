---
description: "Typed sidebar Git Remote calls, Session-bound authority, cancellation, and stable operation failures."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-sidebar-git-controller

English | [中文](README.zh.md)

## Summary

Use the same explicit Git actions from Web and desktop clients through the `sidebarGit` Remote namespace. Read changes, history, and comparisons, then submit repository-bound actions or a reviewed commit intent. The controller forwards cancellation and preserves actionable operation failures. It obtains all repository authority from the [sidebar Git service](../../git/sidebar-git/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the controller with Typert and the [sidebar Git service](../../git/sidebar-git/README.md). It has no configuration fields. The generated `./remote` export supplies the client calls; `./types` supplies browser-safe request, result, and error declarations.

Each request identifies an attached Session. Mutations carry the repository displayed to the user; commit carries the exact preview returned by preparation. The controller forwards these facts without accepting a client working-directory fallback or running its own Git subprocesses. The service owns path validation, comparison selection, commit preflight, hooks, signing, and process bounds.

Failures use stable `sidebar-git/*` codes and include the operation name. An absent service returns `sidebar-git/unavailable`; cancellation returns `sidebar-git/cancelled`. Service refusals retain their corresponding code and message. Unexpected failures become `sidebar-git/git-error`. Clients must refresh stale repository facts or prepare a fresh commit preview before retrying a refused intent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[The controller](src/index.ts) publishes typed methods through Typert, resolves the current `sidebarGit` service for each call, and forwards the same request and cancellation signal. It owns error translation into [Remote error codes](src/types.ts), without adding repository state or another mutation policy. HTTP callers use the same concrete service through their own carrier.

No invariant companion is published because the controller only performs typed forwarding and error translation. It owns no persisted cache or independent Git projection to reconcile.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Sidebar Git service](../../git/sidebar-git/README.md) — operations, process limits, and commit review.
- [Git settings](../../git/git-settings/README.md) — preference ownership.
- [API Gateway](../../../docs/api-gateway.md) — generated Remote transport.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

<a id="model-experience"></a>
## Model Experience

None, as the controller forwards explicit UI requests without adding model-facing mutation tools, turn-end behavior, or model input.

#### KV Cache effect

None; the controller does not assemble model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

The controller inherits the service's operation limits:

- An attached Session with an authoritative working directory is required; client directories cannot supply missing authority.
- The existing DiffTab untracked-content HTTP route is separate from these Git Remote methods.
- There is no local base refresh or network Git operation. Comparisons use locally cached refs.
- Mutation admission does not form an atomic transaction with external Git processes; the service serializes only its own mutations and refuses stale facts at admission.
