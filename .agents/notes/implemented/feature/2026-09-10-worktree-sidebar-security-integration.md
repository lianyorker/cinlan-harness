# Agent Note: Web composition for Worktree, Sidebar, and Security migrations

Status: implemented

English | [中文](2026-09-10-worktree-sidebar-security-integration.zh.md)

## Problem

The migration introduced Worktree Task, Workspace Isolation, a replacement sidebar, and Security Research packages beside older terminal and right-sidebar stacks. Mounting every implementation in the default Web bundle would duplicate right-panel ownership and terminal services, while leaving all rows inactive would hide which packages were safe to ship.

## Decision

Worktree Task uses the Git-backed provider at `ctx.worktreeTask` and a typed Host Remote controller. Its Web Settings page accepts only provider-issued opaque task ids and lifecycle methods; it never accepts checkout paths or shell commands. The Worktree Task and Workspace Isolation rows remain inactive in the default Web composition until that product path is selected as a whole.

The default Web bundle mounts `ui-better-sidebar` as its only right-side shell. That plugin owns its PTY routes, terminal presentation, file surface, and optional agent-terminal tools; the superseded `ui-sidebar-right`, `ui-right-sidebar`, `dsh-terminal`, `dsh-terminal-bash`, and terminal-controller rows remain unmounted. Its tool Consumer compiles definitions through the injected `ctx.tools.define` method and registers the result, preserving the Tools Service Definition's schema validation without an unclassified Host runtime import.

The `security-research` profile composes local Execution Host identity, local persistent Artifact storage, assessment scope, Session finding persistence, vulnerability providers and tools, Security Skills, and workflow prompt guidance. Its default assessment grant has no execution hosts, targets, actions, egress rules, or credentials. Operators must supply a separate explicit authorization patch. The optional bundle contributes its read-only Agent preset through `AgentPresets.registerSystemRoot`. The ordinary Web roster remains unchanged without the bundle. Settings registers Security Research only after `agentPresets/list` reports its id, never from generic Skill modules or the Settings package's own name.

## Consequences

The migration packages remain independently installable, but the default Web process activates one right-sidebar and terminal implementation. Generated Typert declarations and the model tool catalog remain release artifacts. Packages without an independently observable owned relation omit an invariant companion and document that choice in their README.

The scope service starts with an empty grant; only Consumers that consult it enforce that grant. The profile does not confine arbitrary shell commands. Artifact bytes are persisted locally, and the sidebar Browser page accepts validated HTTP(S) addresses without cross-origin DOM access. Worktree checkpoint commits use a stable service identity and represent provider-owned snapshots rather than user-authored commits.

## Alternatives considered

**Mounting every migrated and predecessor sidebar row.** Rejected because the compositions claim the same right-panel and terminal responsibilities. The default bundle selects one complete implementation instead of resolving conflicts by Loader order.

**Accepting browser checkout paths or arbitrary commands.** Rejected because Host providers can enforce ownership and containment only when callers submit provider-issued opaque ids and typed operations.

**Shipping a non-empty assessment grant.** Rejected because a profile cannot infer target authorization. The shipped grant denies all assessment actions until an operator supplies explicit hosts, targets, actions, egress, and evidence policy.

**Publishing empty invariant companions.** Rejected because a companion must check an independently observable owned relation; service presence and fixed registration metadata do not satisfy that requirement.

System root contributions follow the registering Cordis fiber. Shipped and explicitly configured roots retain precedence; implicit user roots follow contributions. Withdrawing a contribution removes discovery, not files or existing standing compositions.

The [native browser and evidence decision](2026-09-13-native-browser-and-security-evidence.md) owns local Artifact persistence and the native Browser composition.

## Related decisions

The [docking note](2026-09-04-right-sidebar-docking-infrastructure.md), [tab-types note](../architecture/2026-09-05-sidebar-tab-types-and-navigation.md), and [file-tree note](2026-09-05-sidebar-text-preview-and-file-tree.md) retain the rationale for the predecessor docking stack. This note supersedes only their claim that those packages own the default Web composition. Workspace Isolation lease semantics remain in [the isolation note](2026-09-09-workspace-isolation-leases.md); Worktree Task is a separate task-oriented provider and does not extend Workspace records.

## Testing

Focused Worktree Task, sidebar, Tools runtime, and security settings suites cover their package behavior. Package dependency, Client package, Client UI localization, TypeScript path, package invariant, package README, tool-catalog, and Cordis profile checks cover composition metadata. The GUI and Web replay gates remain required before release.
