# Git

English | [中文](git.zh.md)

## Summary

This reference lists the Cordis API declared by the `packages/git` group. The [Git Service Definition](../../packages/git/git/README.md) owns canonical repository identity and bounded status, diff, and log observations. [Sidebar Git](../../packages/git/sidebar-git/README.md) owns Session-bound review and mutation requests, displayed repository/HEAD checks, commit preparation, and cached-ref comparisons. Identically named types such as `GitDiffRequest`, `GitLogRequest`, and `GitLogEntry` keep each package's documented fields.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgit--gitruntime-abstract-seam"></a>

### `ctx.git` — `GitRuntime` (abstract seam)

Read-only Git Service Definition. Mutation, publication, and worktree isolation are separate Consumers and providers and are not part of this seam.

```ts cordis-catalog
/**
 * Resolve the canonical repository containing a directory.
 * @param request - directory and optional cancellation signal.
 * @returns canonical repository identity and current head when one exists.
 */
abstract resolveRepository(request: GitResolveRequest): Promise<GitRepository>

/**
 * Return structured working-tree status.
 * @param repository - canonical repository returned by this capability.
 * @param signal - optional cancellation signal.
 * @returns bounded branch and working-tree counts.
 */
abstract status(repository: GitRepository, signal?: AbortSignal): Promise<GitStatus>

/**
 * Return a bounded diff observation.
 * @param request - repository, caller byte bound, and cancellation signal.
 * @returns diff text plus truncation state.
 */
abstract diff(request: GitDiffRequest): Promise<GitDiff>

/**
 * Return recent commits within the provider and caller bounds.
 * @param request - repository, entry limit, and cancellation signal.
 * @returns structured commit entries in Git log order.
 */
abstract log(request: GitLogRequest): Promise<readonly GitLogEntry[]>
```

Source: [`packages/git/git/src/index.ts`](../../packages/git/git/src/index.ts)

<a id="ctxsidebargit--sidebargit"></a>

### `ctx.sidebarGit` — `SidebarGit`

Execute repository-bound user actions; core model-facing Git tools remain independent.

```ts cordis-catalog
/**
 * Resolve a directory for the existing sidebar filesystem-root display.
 * @param cwd - directory already selected by the calling Host filesystem route.
 * @param signal - caller cancellation.
 * @returns canonical repository root, or undefined outside a repository.
 */
async discover(cwd: string, signal?: AbortSignal): Promise<string | undefined>

/**
 * Read working-tree entries, exact repository facts, and effective group order.
 * @param request - attached Session identity.
 * @param signal - caller cancellation.
 * @returns current Git panel data; a non-repository has no mutation target.
 */
async status(request: GitSessionRequest, signal?: AbortSignal): Promise<GitStatusResult>

/**
 * Read a worktree or staged diff for literal paths.
 * @param request - Session, optional path, and staged selection.
 * @param signal - caller cancellation.
 * @returns complete unified diff text.
 */
async diff(request: GitDiffRequest, signal?: AbortSignal): Promise<GitDiffResult>

/**
 * Stage selected files, or all files for an explicit all-files request.
 * @param request - displayed repository and optional literal path.
 * @param signal - caller cancellation.
 * @returns successful completion.
 */
async stage(request: GitPathMutationRequest, signal?: AbortSignal): Promise<GitMutationResult>

/**
 * Unstage selected files without changing worktree contents.
 * @param request - displayed repository and optional literal path.
 * @param signal - caller cancellation.
 * @returns successful completion.
 */
async unstage(request: GitPathMutationRequest, signal?: AbortSignal): Promise<GitMutationResult>

/**
 * List existing local branches.
 * @param request - attached Session identity.
 * @param signal - caller cancellation.
 * @returns names and the checked-out branch, or HEAD when detached.
 */
async branches(request: GitSessionRequest, signal?: AbortSignal): Promise<GitBranchesResult>

/**
 * Switch only to an existing local branch selected by the user.
 * @param request - displayed repository and branch.
 * @param signal - caller cancellation.
 * @returns successful completion.
 */
async checkout(request: GitCheckoutRequest, signal?: AbortSignal): Promise<GitMutationResult>

/**
 * Prepare the exact attributed message and repository facts for confirmation.
 * @param request - repository displayed by the UI and the user's message.
 * @param signal - caller cancellation.
 * @returns complete commit intent; preparation changes neither index nor refs.
 */
async prepareCommit(request: GitPrepareCommitRequest, signal?: AbortSignal): Promise<GitCommitPreview>

/**
 * Commit exactly a reviewed intent after rechecking Session, repository, HEAD, and index.
 * @param request - unchanged preview confirmed by the user.
 * @param signal - caller cancellation.
 * @returns the new commit and the message recorded by Git, including user-hook edits.
 */
async commit(request: GitCommitRequest, signal?: AbortSignal): Promise<GitCommitResult>

/**
 * Compare committed changes against the selected locally cached base.
 * @param request - attached Session identity.
 * @param signal - caller cancellation.
 * @returns a pinned comparison, or the specific missing prerequisite.
 */
async compare(request: GitSessionRequest, signal?: AbortSignal): Promise<GitCompareResult>

/**
 * Read one bounded history page.
 * @param request - Session, page size, and offset.
 * @param signal - caller cancellation.
 * @returns existing sidebar history rows.
 */
async log(request: GitLogRequest, signal?: AbortSignal): Promise<GitLogEntry[]>

/**
 * Read a file from a pinned revision.
 * @param request - Session, revision, and literal repository path.
 * @param signal - caller cancellation.
 * @returns file contents, or null when no such file exists at that revision.
 */
async show(request: GitShowRequest, signal?: AbortSignal): Promise<GitShowResult>

/**
 * Read the patch for an existing history commit.
 * @param request - Session and selected commit.
 * @param signal - caller cancellation.
 * @returns the patch against the first parent for merge commits.
 */
async commitDiff(request: GitRevisionRequest, signal?: AbortSignal): Promise<GitDiffResult>

/**
 * Discard one tracked worktree path after its explicit confirmation.
 * @param request - displayed repository, HEAD, and literal path.
 * @param signal - caller cancellation.
 * @returns successful completion; the index remains unchanged.
 */
async discard(request: GitDiscardRequest, signal?: AbortSignal): Promise<GitMutationResult>

/**
 * Revert a selected commit after explicit confirmation.
 * @param request - displayed repository, HEAD, and selected history commit.
 * @param signal - caller cancellation.
 * @returns successful completion.
 */
async revert(request: GitRevisionMutationRequest, signal?: AbortSignal): Promise<GitMutationResult>

/**
 * Cherry-pick a selected commit after explicit confirmation.
 * @param request - displayed repository, HEAD, and selected history commit.
 * @param signal - caller cancellation.
 * @returns successful completion.
 */
async cherryPick(request: GitRevisionMutationRequest, signal?: AbortSignal): Promise<GitMutationResult>
```

Source: [`packages/git/sidebar-git/src/index.ts`](../../packages/git/sidebar-git/src/index.ts)
<!-- END GENERATED cordis-surface -->
