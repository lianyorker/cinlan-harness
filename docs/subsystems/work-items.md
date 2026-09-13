# Work Items

English | [中文](work-items.zh.md)

## Composition

The [Work Items family](../../packages/work-items/README.md) separates normalized reads and durable writes from fixed-origin GitHub/Linear providers. Its [optional bundle](../../packages/bundle/cinlan-work-items/README.md) adds model tools and the Web Remote/UI to a base-backed Web profile.

## Reads and local associations

WorkItem contains an opaque provider-prefixed id, source, title, state, HTTPS URL, labels, assignees, and optional body/timestamps. WorkItemPage retains the provider cursor and truncation flag. Selection requires an explicit source or exactly one usable provider; unavailable or ambiguous configurations fail explicitly.

The [controller](../../packages/api/work-items-controller/README.md) persists explicit WorkItem/Workspace/Session tuples. Deleted Workspaces and archived or foreign Sessions cannot receive new links. Existing links are hidden when their target is unavailable; deleting and recreating a Workspace does not reuse its old identity. Unlink can remove stale local records without contacting the provider.

## Write states

The registry owns immutable WorkItemMutation previews identified by WorkItemWriteId. Provider writes are disabled by default. Enabled writes require separate prepareWrite and confirmWrite calls; confirmation rechecks scope and target revision. Receipts are retained through sequential Host restarts.

| Status | Meaning |
|---|---|
| prepared | Validated preview awaiting confirmation |
| running | Durable dispatch marker; recovery treats this as uncertain |
| succeeded | Confirmed provider receipt |
| failed | Rejected or not dispatched |
| unknown | Possible external effect; never automatically resent |
| canceled | Unexecuted preview canceled |
| expired | Preview lifetime elapsed before confirmation |

## Limits

The [service](../../packages/work-items/work-items/README.md) owns bounds, errors, and durable-write semantics. The [Settings UI](../../packages/client/ui-work-items/README.md) shows existing issues and explicit local links; it does not create Sessions or worktrees. Credentials stay on the Host.
