---
description: "Work Items reads and explicit local associations through official Remotes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-work-items

English | [中文](README.zh.md)

## Summary

This plugin adds GitHub, GitLab, and Linear issue pages, details, and local Workspace/Session association controls to Cinlan Settings. External writes require an opt-in provider and separate preview confirmation.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The optional `work-items` profile mounts this package. Open Settings → Work Items and select a source and state; pagination reads provider data through the Host, while search filters the current provider page. Workspace scope filters local association projections, not the external provider’s project or team. [Host providers](../../work-items/README.md) own scope and credential configuration; the browser receives no credentials.

Provider visibility is a Host preference in `work-items.githubVisible`, `gitlabVisible`, and `linearVisible`; these fields control the source choices in this page. Restore inherited value removes the override, and unavailable or read-only settings disable writes. GitHub and GitLab CLI status comes from Integration Preflight and does not prove REST credential availability. Linear availability is checked through an actual query. Failed refresh preserves selected details and write drafts.

Select a Workspace and an issue to link the issue to that Workspace or one of its existing Sessions. Unlink removes only the local association, not the issue, Session, or Git branch. Branch and lease state appear only when the Host verifies a managed worktree for the Session; issue names never imply associations.

Expand Change external issues, fill create/comment/state/assignment fields, preview them, then separately confirm the exact server-stored payload. Editing the form does not alter an existing preview; prepare another one instead. History restores pending, canceled, expired, successful, failed, and unknown receipts; terminal receipts offer no execution button. State and assignee inputs retain separate drafts when search switches their target. GitLab usernames resolve to numeric user ids before an issue write; an empty assignment list explicitly clears assignees.

<a id="implementation"></a>
## Implementation

The component calls generated workItems Remotes through injected callbacks and reads live Workspace projections through the framework useWorkspaces hook. Deleted Workspaces and archived Sessions cannot receive new associations. Changing source, filters, page, or detail cancels superseded requests. Only successful durable receipts update displayed links; a failed write preserves the prior display and permits retry.

The page uses the parent Settings content width and responsive native rows. Localized public descriptors cover visibility, query, association, and write controls, with stable field anchors and no current values, credentials, issue content, or paths in search. Search reveals collapsed write controls before locating their fields. Descriptors register and dispose with the section slot.

No runtime invariant companion is published because the Host controller owns durable associations and the renderer owns slot lifetime; this package retains only page-local interaction state.

<a id="model-experience"></a>
## Model Experience

None, as issue browsing and local association writes register no prompt, tool, or model request mutation.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- External deletion and automatic retry of uncertain outcomes are not provided; verify unknown results at the provider.
- This UI does not create Sessions or worktrees; it links existing objects. External issues and association details refresh on request rather than through push subscriptions.
- Default-source, automatically-show-linked, and external-write-policy preferences are not exposed here. Provider deployment configuration controls scope and write availability.

<a id="dev-note"></a>
### Dev Note

The [controller](../../api/work-items-controller/README.md) defines Remote and persistence semantics. The UI does not use the preview ApiProxy or maintain a second Workspace data model.
