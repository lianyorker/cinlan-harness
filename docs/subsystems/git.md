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

Execute repository-bound user actions in the Session's retained execution world.

```ts cordis-catalog
/** Execute status in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async status(request: GitSessionRequest, signal?: AbortSignal): Promise<GitStatusResult>

/** Execute diff in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async diff(request: GitDiffRequest, signal?: AbortSignal): Promise<GitDiffResult>

/** Execute stage in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async stage(request: GitPathMutationRequest, signal?: AbortSignal): Promise<GitMutationResult>

/** Execute unstage in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async unstage(request: GitPathMutationRequest, signal?: AbortSignal): Promise<GitMutationResult>

/** Execute branches in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async branches(request: GitSessionRequest, signal?: AbortSignal): Promise<GitBranchesResult>

/** Execute checkout in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async checkout(request: GitCheckoutRequest, signal?: AbortSignal): Promise<GitMutationResult>

/** Execute prepareCommit in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async prepareCommit(request: GitPrepareCommitRequest, signal?: AbortSignal): Promise<GitCommitPreview>

/** Execute commit in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async commit(request: GitCommitRequest, signal?: AbortSignal): Promise<GitCommitResult>

/** Execute compare in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async compare(request: GitSessionRequest, signal?: AbortSignal): Promise<GitCompareResult>

/** Execute log in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async log(request: GitLogRequest, signal?: AbortSignal): Promise<GitLogEntry[]>

/** Execute show in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async show(request: GitShowRequest, signal?: AbortSignal): Promise<GitShowResult>

/** Execute commitDiff in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async commitDiff(request: GitRevisionRequest, signal?: AbortSignal): Promise<GitDiffResult>

/** Execute discard in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async discard(request: GitDiscardRequest, signal?: AbortSignal): Promise<GitMutationResult>

/** Execute revert in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async revert(request: GitRevisionMutationRequest, signal?: AbortSignal): Promise<GitMutationResult>

/** Execute cherryPick in the Session's captured world.
 * @param request - Session-owned Git request.
 * @param signal - caller cancellation.
 * @returns the operation result after managed subprocess settlement.
 */
async cherryPick(request: GitRevisionMutationRequest, signal?: AbortSignal): Promise<GitMutationResult>
```

Source: [`packages/git/sidebar-git/src/index.ts`](../../packages/git/sidebar-git/src/index.ts)
<!-- END GENERATED cordis-surface -->
