---
description: "Local Workspace Isolation lease administration through official Remotes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace-isolation

English | [中文](README.zh.md)

## Summary

This plugin adds a local-only Workspace Isolation page to Web Settings. It lists authoritative active and hibernated leases and exposes checkout inspection, bounded change review, merge, cherry-pick, `.patch` export, activate, hibernate, safe teardown, refresh, and orphan pruning through the generated `workspaceIsolation` Remote namespace.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the plugin with Settings, Locale, and the official Remote assembly. The section is registered only when `ctx.remote.$host.isLoopback` is true, because its paths and Git worktree lifecycle describe the Host machine.

Merge, cherry-pick, teardown, and orphan pruning require explicit acknowledgement. Commands send only provider-issued lease ids; no browser callback accepts a repository path, target branch, deletion path, or force flag. A safe teardown refusal leaves the hibernated lease visible with a review marker. Superseded reads and component teardown abort in-flight browser requests, and stale responses cannot replace a newer list.

Native rows use the parent Settings content width. Localized field search covers lease records, review operations, orphan pruning, and provider-policy guidance without indexing paths, ids, branch names, or current values. A policy target opens its disclosure. Descriptors and the page share one slot-registration lifetime. Failed inspection offers a retry; pruning stays disabled until the Host provides a lease list.

<a id="model-experience"></a>
## Model Experience

None, as this package contributes browser UI only and registers no prompt, tool, Session event, or model-request input.

#### KV Cache effect

None; lease administration does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Lease creation remains owned by Session and task execution paths rather than Settings.
- Checkout roots and active limits are provider configuration. Isolation mode, execution host, shared-cache policy, and idle timeout have no writable preference consumer exposed by this page.
- State refresh is explicit; the page does not subscribe to provider lifecycle events.
- Active untracked files are reported but omitted from patch preview and export.

<a id="dev-note"></a>
### Dev Note

The component receives only typed locale and lifecycle callbacks. Cordis services remain in the registration module, and the Host controller owns Remote error classification.

No runtime invariant companion is published because the page keeps only component-local interaction state and reloads authoritative provider projections after successful mutations.
