# Agent Note: Reviewed sidebar Git actions

Status: implemented

English | [中文](2026-09-17-reviewed-sidebar-git-actions.zh.md)

## Problem

Sidebar Git writes act on files and staged content that can change while a person reviews them. A browser working-directory hint, a stale Session, or an independently implemented transport handler can select a different repository or bypass a review check. Comparing against an upstream also needs a clear freshness policy: refreshing a remote changes the operation's network and credential requirements.

## Decision

The [sidebar Git service](../../../../packages/git/sidebar-git/README.md) owns manual Git execution. The typed [Remote controller](../../../../packages/api/sidebar-git-controller/src/index.ts) and the sidebar's [Git method decoder](../../../../packages/client/ui-better-sidebar/src/git.ts) delegate to that same service. The [Host composition](../../../../packages/client/ui-better-sidebar/src/index.ts) supplies the decoder through shared operations used by Connection Fetch and the optional Web aliases. Transport code decodes requests and maps failures; it does not own another Git runner. A missing executor produces an unavailable result.

The sidebar client declares the generated `remote.sidebarGit` namespace as a Cordis dependency. The Remote root alone does not establish namespace readiness; namespace disposal must also dispose consumers that capture its methods.

### Session and repository authority

Git action requests identify an attached Session. The executor obtains that actual Session from the Session store, retains one execution lease, and discovers the canonical repository root and Git directory through the same GitProcess and subprocess provider used by later operations. The lease supplies cwd and platform path syntax and remains retained until every command and output stream settles. A caller's cwd does not select the target. Mutations carry the observed repository root; queued work rechecks the attached Session, its cwd, and the repository before execution. Repository-relative paths are literal, including paths from Sessions opened in a subdirectory.

Mutations are serialized per immutable execution binding and canonical root. Destructive operations also carry their observed HEAD. These checks bind a request to the repository the caller inspected and prevent a detached or rebound Session from falling back to the server's process directory.

### Commit preparation and confirmation

Preparation requires staged changes on a local branch and refuses unresolved index conflicts. It records the Session id, cwd, canonical root, Git directory, branch, HEAD, and a fingerprint of the execution binding and staged entries. It computes the complete intended message and checks the final message limit after attribution and the trailing newline. The returned preview is the message presented for confirmation.

Optional attribution uses Git's trailer formatter and preserves existing trailers, including sign-offs. An existing canonical co-author trailer is retained without duplication. When insertion is needed, preparation refuses configured trailer commands and formatting that cannot produce the canonical trailer, so preview construction does not execute a user-defined trailer command. [Shared Git settings](../../../../packages/git/git-settings/README.md) own the preference; the UI Host does not register a second schema.

Confirmation resolves the Session and repository again and compares the recorded repository, branch, HEAD, and staged-entry fingerprint with a fresh snapshot. A mismatch refuses the commit and requires a fresh review. The executor passes the reviewed message through stdin with verbatim cleanup and commits the staged index without staging worktree edits.

User hooks and signing remain active. A hook can reject a commit or edit its message, so the successful result reads back and returns the message Git actually recorded. The review fixes the input supplied to Git; it does not promise to suppress configured hook behavior.

### Cached comparisons

The explicit comparison action selects locally available refs. With upstream comparison enabled, it prefers the current branch's cached upstream. Otherwise, or when that upstream is unavailable, it selects the cached default using origin/HEAD, local main, then local master. The result identifies the selected base and whether upstream fallback occurred. Both commits are resolved before the triple-dot diff, so the displayed comparison names the actual commit ids used.

An unborn or detached HEAD, an absent default branch, or a missing merge base produces an explicit unavailable result. The executor does not schedule a fetch, pull, or push. Cached refs can be stale; comparison does not imply a current view of a remote server.

### Bounds and process lifetime

[Managed execution](../../../../packages/git/sidebar-git/src/process.ts) resolves the executable and submits argv, cwd, stdin, and bounded stdout/stderr collection to the installed subprocess owner. Missing or lossy collection refuses a result. A separate byte check covers the complete serialized Git DTO, including repository and preview metadata, after assembly.

The Remote controller forwards caller cancellation. Every command also observes its configured deadline and the executor's disposal signal. Settlement waits for both the command outcome and managed-range exit, including when the outcome rejects. Disposal aborts active work and waits for those operations to settle. Cancellation is not rollback of a Git write that already completed.

### Worktree checkpoints

[Worktree Task](../../../../packages/workspace/worktree-task-git/README.md) retains its own creation and checkpoint semantics. Branch prefixes apply during new task creation, with validation before capacity eviction or worktree mutation; recorded branch identities are preserved. Checkpoints retain their service identity, checkpoint message, and existing hook/signing flags. Sidebar attribution is not injected into that path or into the generic Git runner. The model-facing Git toolset remains read-only, and no turn-end commit behavior is introduced.

## Alternatives considered

**A raw-spawn compatibility owner for each carrier.** Separate Remote and Fetch runners duplicate repository admission, index checks, output accounting, and process lifetime rules. Delegation to one executor keeps those decisions at the operation that performs the write and makes missing capability explicit.

**Choosing a repository from browser cwd or process cwd.** Those paths do not establish the repository belonging to the requested attached Session. The Session's captured cwd and the observed canonical root provide the required provenance, including after queueing.

**Constructing the final message only when Commit is confirmed.** Late attribution or message reconstruction can change what the person reviewed. Preparation computes the complete message; confirmation reuses it while checking repository state.

**Fetching automatically for comparison or refreshing a checked-out base implicitly.** These add network access, credentials, and potentially changes visible to another checkout to a comparison or creation preference. Comparison consumes cached refs; local base refresh remains unavailable and retains its saved/resettable setting.

**Applying user-commit preferences to provider checkpoints.** Checkpoints capture provider-owned task state and use a separate identity and lifecycle. Reusing sidebar attribution or user hook/signing policy there changes the meaning of those snapshots.

## Consequences

One executor makes transport behavior and refusal conditions consistent, and explicit previews keep automatic attribution reviewable. The cost is additional Git reads, a separate confirmation step, and a fresh review when the captured state changes. Output limits can reject a large status, diff, or message instead of presenting incomplete data as complete.

The mutation queue coordinates this executor's work only. Repository checks and the subsequent Git write are not an atomic transaction with unrelated Git processes. Another process can change refs or the index after a check, and a hook can change the eventual outcome. A failed or cancelled operation therefore does not establish that the repository is unchanged; callers use fresh repository observations for subsequent actions.

## Related decisions

The active-note audit finds no earlier record owning this manual Git executor or its prepare/confirm protocol. [Agent initiator scope](2026-07-15-agent-initiator-scope.md) retains the rules for recovering a model tool's Agent and Session. [Workspace Isolation leases](../feature/2026-09-09-workspace-isolation-leases.md) and [Worktree/sidebar composition](../feature/2026-09-10-worktree-sidebar-security-integration.md) retain their distinct lifecycle and checkpoint rationale. [Native subprocess containment](2026-08-28-subprocess-native-containment.md) owns the platform-specific meaning and limits of managed-range exit. These are complementary decisions; no triplet is superseded or archived by this record.

## Testing

Executed [service tests](../../../../packages/git/sidebar-git/tests/service.spec.ts) and [controller tests](../../../../packages/api/sidebar-git-controller/tests/controller.spec.ts) boot real Loader compositions with attached Sessions and temporary repositories. They cover canonical targeting, stale review refusal, attribution, actual post-hook messages, complete response bounds, and service/controller removal on disposal. [Legacy-operation tests](../../../../packages/git/sidebar-git/tests/legacy.spec.ts) retain pagination and staged-data preservation checks. Git execution in these fixtures is confined to test-owned repositories.

Executed [process tests](../../../../packages/git/sidebar-git/tests/process.spec.ts) use independent command-outcome and range-exit barriers to cover cancellation, timeouts, disposal, and incomplete output. [HTTP adapter tests](../../../../packages/client/ui-better-sidebar/tests/git-spawn.spec.ts) and [Client adapter tests](../../../../packages/client/ui-better-sidebar/tests/git-api.client.spec.ts) check delegation and failure handling. This evidence covers source composition and owned fixtures. Assembled Web and Electron behavior requires the separate [application verification](../../../../docs/testing.md).
