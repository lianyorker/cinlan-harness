/** Concrete Git owner for explicit sidebar actions over HTTP and desktop Remote. */
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subprocess'
import { GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema } from '@deepseek-ai/dsh-git-settings/settings-schema'
import type { GitSourceControlSettings } from '@deepseek-ai/dsh-git-settings/types'
import { GitProcess } from './process.ts'
import type { GitProcessOptions } from './process.ts'
import { parseLogLines, parsePorcelainZ } from './parse.ts'
import { SidebarGitError } from './errors.ts'
import type {
  GitBranchesResult, GitCheckoutRequest, GitCommitPreview, GitCommitRequest, GitCommitResult,
  GitCompareResult, GitDiffRequest, GitDiffResult, GitDiscardRequest, GitLogEntry, GitLogRequest,
  GitMutationRequest, GitMutationResult, GitPathMutationRequest, GitPrepareCommitRequest,
  GitRepositoryState, GitRevisionMutationRequest, GitRevisionRequest, GitSessionRequest, GitShowRequest,
  GitShowResult, GitStatusResult,
} from './types.ts'

export { SidebarGitError } from './errors.ts'
export type * from './types.ts'

/** Process, message, and history bounds for this concrete Git implementation. */
export interface Config extends GitProcessOptions {
  maxMessageBytes: number
  defaultLogEntries: number
  maxLogEntries: number
}

interface RepositoryContext {
  session: Session
  sessionId: SessionId
  sessionCwd: string
  root: string
  gitDirectory: string
}

const ATTRIBUTION = 'Co-authored-by: Cinlan IDE <noreply@cinlan.online>'
const stripLineEnding = (text: string): string => text.replace(/\r?\n$/, '')

/** Normalize a literal path without allowing it to escape the selected repository. */
function repositoryPath(root: string, path: string): string {
  if (path.length === 0 || path.includes('\0')) throw new SidebarGitError('invalid-request', 'A file path must be non-empty')
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const child = relative(root, absolute)
  if (isAbsolute(child) || child === '..' || child.startsWith('..' + sep)) {
    throw new SidebarGitError('invalid-request', 'The file path is outside the selected repository')
  }
  return child.length === 0 ? '.' : child.split(sep).join('/')
}

/** Keep user-selected revisions out of Git's option parser. */
function requireRevision(ref: string): void {
  if (ref.length === 0 || ref.startsWith('-') || ref.includes('\0')) {
    throw new SidebarGitError('invalid-request', 'A non-option Git revision is required')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { sidebarGit: SidebarGit }
}

/** Execute repository-bound user actions; core model-facing Git tools remain independent. */
export class SidebarGit extends Service {
  static inject = ['subprocess', 'sessions', 'settings']
  static Config: s<Config> = s.object({
    executable: s.string().default('git'),
    timeoutMs: s.number().min(1).default(30_000),
    graceMs: s.number().min(1).default(1_000),
    maxOutputBytes: s.number().min(1).default(8 * 1024 * 1024),
    maxMessageBytes: s.number().min(1).default(64 * 1024),
    defaultLogEntries: s.number().min(1).default(30),
    maxLogEntries: s.number().min(1).default(500),
  })

  private readonly process: GitProcess
  private readonly mutations = new Map<string, Promise<void>>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'sidebarGit')
    if (config.executable.trim().length === 0) throw new Error('sidebar Git executable must be non-empty')
    for (const value of [config.timeoutMs, config.graceMs, config.maxOutputBytes, config.maxMessageBytes,
      config.defaultLogEntries, config.maxLogEntries]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('sidebar Git limits must be positive safe integers')
    }
    if (config.defaultLogEntries > config.maxLogEntries) throw new Error('default Git history page exceeds its maximum')
    this.process = new GitProcess(ctx.subprocess, config)
    ctx.effect(() => () => this.process.dispose())
  }

  /**
   * Resolve a directory for the existing sidebar filesystem-root display.
   * @param cwd - directory already selected by the calling Host filesystem route.
   * @param signal - caller cancellation.
   * @returns canonical repository root, or undefined outside a repository.
   */
  async discover(cwd: string, signal?: AbortSignal): Promise<string | undefined> {
    const result = await this.process.capture(cwd, ['rev-parse', '--show-toplevel'], signal)
    if (result.exitCode === 128) return undefined
    if (result.exitCode !== 0) throw new SidebarGitError('git-error', result.stderr.trim() || 'Cannot inspect Git repository')
    return stripLineEnding(result.stdout)
  }

  /**
   * Read working-tree entries, exact repository facts, and effective group order.
   * @param request - attached Session identity.
   * @param signal - caller cancellation.
   * @returns current Git panel data; a non-repository has no mutation target.
   */
  async status(request: GitSessionRequest, signal?: AbortSignal): Promise<GitStatusResult> {
    const { session, cwd } = this.attached(request.sessionId)
    const groupOrder = this.preferences().sourceControlGroupOrder
    const root = await this.discover(cwd, signal)
    this.assertSession(session, cwd)
    if (root === undefined) return this.bounded({ isRepo: false, entries: [], groupOrder })
    const context = await this.repository(request, signal)
    const [repository, raw] = await Promise.all([
      this.snapshot(context, signal),
      this.process.run(context.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal),
    ])
    this.assertSession(context.session, context.sessionCwd)
    return this.bounded({ isRepo: true, branch: repository.branch ?? 'HEAD', entries: parsePorcelainZ(raw), repository, groupOrder })
  }

  /**
   * Read a worktree or staged diff for literal paths.
   * @param request - Session, optional path, and staged selection.
   * @param signal - caller cancellation.
   * @returns complete unified diff text.
   */
  async diff(request: GitDiffRequest, signal?: AbortSignal): Promise<GitDiffResult> {
    const context = await this.repository(request, signal)
    const args = ['diff', '--no-ext-diff', '--no-color', '-U3', ...(request.staged ? ['--cached'] : [])]
    if (request.path !== undefined) args.push('--', repositoryPath(context.root, request.path))
    return this.bounded({ diff: await this.process.run(context.root, args, signal) })
  }

  /**
   * Stage selected files, or all files for an explicit all-files request.
   * @param request - displayed repository and optional literal path.
   * @param signal - caller cancellation.
   * @returns successful completion.
   */
  async stage(request: GitPathMutationRequest, signal?: AbortSignal): Promise<GitMutationResult> {
    return this.mutate(request, signal, async (context) => {
      await this.process.run(context.root, ['add', '-A', ...this.pathArgs(context, request.path)], signal)
      return { ok: true }
    })
  }

  /**
   * Unstage selected files without changing worktree contents.
   * @param request - displayed repository and optional literal path.
   * @param signal - caller cancellation.
   * @returns successful completion.
   */
  async unstage(request: GitPathMutationRequest, signal?: AbortSignal): Promise<GitMutationResult> {
    return this.mutate(request, signal, async (context) => {
      let paths = this.pathArgs(context, request.path)
      if (request.path !== undefined) {
        const path = repositoryPath(context.root, request.path)
        const raw = await this.process.run(context.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal)
        const entry = parsePorcelainZ(raw).find(row => row.path === path)
        if (entry?.xy[0] === 'R' && entry.previousPath !== undefined) paths = ['--', entry.previousPath, path]
      }
      if (await this.resolveCommit(context.root, 'HEAD', signal) === undefined) {
        await this.process.run(context.root, ['rm', '--cached', '-f', '-r', '--quiet', '--ignore-unmatch', ...(paths.length === 0 ? ['--', '.'] : paths)], signal)
      } else {
        await this.process.run(context.root, ['reset', '-q', ...paths], signal)
      }
      return { ok: true }
    })
  }

  /**
   * List existing local branches.
   * @param request - attached Session identity.
   * @param signal - caller cancellation.
   * @returns names and the checked-out branch, or HEAD when detached.
   */
  async branches(request: GitSessionRequest, signal?: AbortSignal): Promise<GitBranchesResult> {
    const context = await this.repository(request, signal)
    const raw = await this.process.run(context.root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], signal)
    const current = (await this.snapshot(context, signal)).branch ?? 'HEAD'
    const names = raw.split('\n').map(stripLineEnding).filter(name => name.length > 0)
    return this.bounded({ current, names: names.includes(current) ? names : [current, ...names] })
  }

  /**
   * Switch only to an existing local branch selected by the user.
   * @param request - displayed repository and branch.
   * @param signal - caller cancellation.
   * @returns successful completion.
   */
  async checkout(request: GitCheckoutRequest, signal?: AbortSignal): Promise<GitMutationResult> {
    return this.mutate(request, signal, async (context) => {
      requireRevision(request.branch)
      const names = await this.process.run(context.root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], signal)
      if (!names.split('\n').includes(request.branch)) throw new SidebarGitError('invalid-request', 'The selected local branch no longer exists')
      await this.process.run(context.root, ['checkout', '--no-guess', request.branch, '--'], signal)
      return { ok: true }
    })
  }

  /**
   * Prepare the exact attributed message and repository facts for confirmation.
   * @param request - repository displayed by the UI and the user's message.
   * @param signal - caller cancellation.
   * @returns complete commit intent; preparation changes neither index nor refs.
   */
  async prepareCommit(request: GitPrepareCommitRequest, signal?: AbortSignal): Promise<GitCommitPreview> {
    return this.mutate(request, signal, async (context) => {
      this.requireMessage(request.message)
      const state = await this.snapshot(context, signal)
      if (state.branch === null) throw new SidebarGitError('invalid-request', 'Check out a local branch before committing')
      const changes = await this.process.run(context.root, ['diff', '--cached', '--name-only', '-z'], signal)
      if (changes.length === 0) throw new SidebarGitError('invalid-request', 'Stage changes before preparing a commit')
      const unresolved = await this.process.run(context.root, ['ls-files', '--unmerged', '-z'], signal)
      if (unresolved.length !== 0) throw new SidebarGitError('conflict', 'Resolve index conflicts before committing')
      let message = request.message
      const attributed = this.preferences().enableGitHubAttribution
      if (attributed) {
        const trailers = await this.process.run(context.root, ['interpret-trailers', '--parse'], signal, message)
        if (!trailers.split('\n').some(line => line.trim().toLowerCase() === ATTRIBUTION.toLowerCase())) {
          const commands = await this.process.capture(context.root, ['config', '--get-regexp', '^trailer\\..*\\.(cmd|command)$'], signal)
          if (commands.exitCode === 0) {
            throw new SidebarGitError('unavailable', 'Automatic attribution preview is unavailable with configured trailer commands')
          }
          if (commands.exitCode !== 1) throw new SidebarGitError('git-error', commands.stderr.trim() || 'Cannot inspect Git trailer configuration')
          message = await this.process.run(context.root, [
            '-c', 'trailer.co-authored-by.key=Co-authored-by', 'interpret-trailers', '--where=end',
            '--if-exists=addIfDifferent', '--if-missing=add', '--trailer', ATTRIBUTION,
          ], signal, message)
          if (!message.split('\n').some(line => line.trim().toLowerCase() === ATTRIBUTION.toLowerCase())) {
            throw new SidebarGitError('unavailable', 'Disable automatic attribution to use this Git trailer formatting')
          }
        }
      }
      if (!message.endsWith('\n')) message += '\n'
      this.requireMessage(message)
      const current = await this.snapshot(context, signal)
      this.requireSameState(state, current)
      return this.bounded({ ...state, sessionId: request.sessionId, message, attributed })
    })
  }

  /**
   * Commit exactly a reviewed intent after rechecking Session, repository, HEAD, and index.
   * @param request - unchanged preview confirmed by the user.
   * @param signal - caller cancellation.
   * @returns the new commit and the message recorded by Git, including user-hook edits.
   */
  async commit(request: GitCommitRequest, signal?: AbortSignal): Promise<GitCommitResult> {
    const preview = request.preview
    this.requireMessage(preview.message)
    return this.mutate({ sessionId: preview.sessionId, repositoryRoot: preview.root }, signal, async (context) => {
      const current = await this.snapshot(context, signal)
      this.requireSameState(preview, current)
      if (current.branch === null) throw new SidebarGitError('stale', 'The reviewed branch is no longer checked out')
      await this.process.run(context.root, ['commit', '--cleanup=verbatim', '-F', '-'], signal, preview.message)
      const head = await this.resolveCommit(context.root, 'HEAD', signal)
      if (head === undefined) throw new SidebarGitError('git-error', 'Git did not produce a commit')
      const message = await this.process.run(context.root, ['log', '-1', '--format=format:%B', head], signal)
      return this.bounded({ repositoryRoot: context.root, head, message })
    })
  }

  /**
   * Compare committed changes against the selected locally cached base.
   * @param request - attached Session identity.
   * @param signal - caller cancellation.
   * @returns a pinned comparison, or the specific missing prerequisite.
   */
  async compare(request: GitSessionRequest, signal?: AbortSignal): Promise<GitCompareResult> {
    const context = await this.repository(request, signal)
    const state = await this.snapshot(context, signal)
    if (state.head === null) return this.bounded({ status: 'unavailable', reason: 'unborn' })
    if (state.branch === null) return this.bounded({ status: 'unavailable', reason: 'detached' })
    const preferUpstream = this.preferences().compareAgainstUpstream
    let baseRef: string | undefined
    if (preferUpstream) {
      const upstream = await this.process.capture(context.root, ['rev-parse', '--symbolic-full-name', '@{upstream}'], signal)
      if (upstream.exitCode === 0) baseRef = stripLineEnding(upstream.stdout)
    }
    const usedFallback = preferUpstream && baseRef === undefined
    if (baseRef === undefined) {
      const remoteDefault = await this.process.capture(context.root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], signal)
      const candidates = [...(remoteDefault.exitCode === 0 ? [stripLineEnding(remoteDefault.stdout)] : []), 'refs/heads/main', 'refs/heads/master']
      for (const candidate of candidates) {
        if (await this.resolveCommit(context.root, candidate, signal) !== undefined) { baseRef = candidate; break }
      }
    }
    if (baseRef === undefined) return this.bounded({ status: 'unavailable', reason: 'no-default-branch' })
    const baseHead = await this.resolveCommit(context.root, baseRef, signal)
    if (baseHead === undefined) return this.bounded({ status: 'unavailable', reason: 'no-default-branch' })
    const mergeBase = await this.process.capture(context.root, ['merge-base', baseHead, state.head], signal)
    if (mergeBase.exitCode !== 0) return this.bounded({ status: 'unavailable', reason: 'no-merge-base' })
    const diff = await this.process.run(context.root, ['diff', '--no-ext-diff', '--no-color', '-U3', baseHead + '...' + state.head], signal)
    this.assertSession(context.session, context.sessionCwd)
    return this.bounded({ status: 'ready', repositoryRoot: context.root, baseRef, baseHead, head: state.head, usedFallback, diff })
  }

  /**
   * Read one bounded history page.
   * @param request - Session, page size, and offset.
   * @param signal - caller cancellation.
   * @returns existing sidebar history rows.
   */
  async log(request: GitLogRequest, signal?: AbortSignal): Promise<GitLogEntry[]> {
    const count = request.count ?? this.config.defaultLogEntries
    const skip = request.skip ?? 0
    if (!Number.isSafeInteger(count) || count < 1 || count > this.config.maxLogEntries || !Number.isSafeInteger(skip) || skip < 0) {
      throw new SidebarGitError('invalid-request', 'Invalid Git history page')
    }
    const context = await this.repository(request, signal)
    const raw = await this.process.run(context.root, ['log', '-n', String(count), '--skip', String(skip), '--decorate=short',
      '--pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D'], signal)
    return this.bounded(parseLogLines(raw))
  }

  /**
   * Read a file from a pinned revision.
   * @param request - Session, revision, and literal repository path.
   * @param signal - caller cancellation.
   * @returns file contents, or null when no such file exists at that revision.
   */
  async show(request: GitShowRequest, signal?: AbortSignal): Promise<GitShowResult> {
    const context = await this.repository(request, signal)
    const ref = await this.resolveCommit(context.root, request.ref, signal)
    if (ref === undefined) return { content: null }
    const path = repositoryPath(context.root, request.path)
    const result = await this.process.capture(context.root, ['show', ref + ':' + path], signal)
    return this.bounded({ content: result.exitCode === 0 ? result.stdout : null })
  }

  /**
   * Read the patch for an existing history commit.
   * @param request - Session and selected commit.
   * @param signal - caller cancellation.
   * @returns the patch against the first parent for merge commits.
   */
  async commitDiff(request: GitRevisionRequest, signal?: AbortSignal): Promise<GitDiffResult> {
    const context = await this.repository(request, signal)
    const hash = await this.resolveCommit(context.root, request.hash, signal)
    if (hash === undefined) throw new SidebarGitError('invalid-request', 'The selected commit does not exist')
    return this.bounded({ diff: await this.process.run(context.root,
      ['show', '--no-ext-diff', '--no-color', '--format=', '-m', '--first-parent', hash], signal) })
  }

  /**
   * Discard one tracked worktree path after its explicit confirmation.
   * @param request - displayed repository, HEAD, and literal path.
   * @param signal - caller cancellation.
   * @returns successful completion; the index remains unchanged.
   */
  async discard(request: GitDiscardRequest, signal?: AbortSignal): Promise<GitMutationResult> {
    return this.mutate(request, signal, async (context) => {
      if (request.path === undefined) throw new SidebarGitError('invalid-request', 'Discard requires one file path')
      await this.requireHead(context, request.head, signal)
      await this.process.run(context.root, ['checkout', '--', repositoryPath(context.root, request.path)], signal)
      return { ok: true }
    })
  }

  /**
   * Revert a selected commit after explicit confirmation.
   * @param request - displayed repository, HEAD, and selected history commit.
   * @param signal - caller cancellation.
   * @returns successful completion.
   */
  async revert(request: GitRevisionMutationRequest, signal?: AbortSignal): Promise<GitMutationResult> {
    return this.historyMutation('revert', request, signal)
  }

  /**
   * Cherry-pick a selected commit after explicit confirmation.
   * @param request - displayed repository, HEAD, and selected history commit.
   * @param signal - caller cancellation.
   * @returns successful completion.
   */
  async cherryPick(request: GitRevisionMutationRequest, signal?: AbortSignal): Promise<GitMutationResult> {
    return this.historyMutation('cherry-pick', request, signal)
  }

  private preferences() {
    const resolved = this.ctx.settings.get(GIT_SETTINGS_NAMESPACE) as GitSourceControlSettings | undefined
    return GitSourceControlSettingsSchema(resolved)
  }

  private attached(sessionId: SessionId): { session: Session; cwd: string } {
    this.process.assertActive()
    const session = this.ctx.sessions.get(sessionId)
    const cwd = session?.header.cwd
    if (session === undefined || cwd === undefined || cwd.length === 0) {
      throw new SidebarGitError('unavailable', 'Attach the Session with its authoritative working directory before using Git')
    }
    return { session, cwd }
  }

  private assertSession(session: Session, cwd: string): void {
    this.process.assertActive()
    if (this.ctx.sessions.get(session.id) !== session || session.header.cwd !== cwd) {
      throw new SidebarGitError('stale', 'The Session working directory changed; refresh Git before continuing')
    }
  }

  private async repository(request: GitSessionRequest, signal?: AbortSignal): Promise<RepositoryContext> {
    const { session, cwd: sessionCwd } = this.attached(request.sessionId)
    const root = await this.discover(sessionCwd, signal)
    if (root === undefined) throw new SidebarGitError('not-repository', 'The attached Session is not inside a Git repository')
    const gitDirectory = stripLineEnding(await this.process.run(root, ['rev-parse', '--absolute-git-dir'], signal))
    this.assertSession(session, sessionCwd)
    return { session, sessionId: request.sessionId, sessionCwd, root, gitDirectory }
  }

  private async snapshot(context: RepositoryContext, signal?: AbortSignal): Promise<GitRepositoryState> {
    const [head, branch, index] = await Promise.all([
      this.resolveCommit(context.root, 'HEAD', signal),
      this.process.capture(context.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal),
      this.process.run(context.root, ['ls-files', '--stage', '-z'], signal),
    ])
    this.assertSession(context.session, context.sessionCwd)
    return { root: context.root, gitDirectory: context.gitDirectory, sessionCwd: context.sessionCwd,
      head: head ?? null, branch: branch.exitCode === 0 ? stripLineEnding(branch.stdout) : null,
      indexFingerprint: createHash('sha256').update(index).digest('hex') }
  }

  private async resolveCommit(root: string, ref: string, signal?: AbortSignal): Promise<string | undefined> {
    requireRevision(ref)
    const result = await this.process.capture(root, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'], signal)
    return result.exitCode === 0 ? stripLineEnding(result.stdout) : undefined
  }

  private pathArgs(context: RepositoryContext, path: string | undefined): string[] {
    return path === undefined ? [] : ['--', repositoryPath(context.root, path)]
  }

  private requireMessage(message: string): void {
    if (message.trim().length === 0 || message.includes('\0') || Buffer.byteLength(message) > this.config.maxMessageBytes) {
      throw new SidebarGitError('invalid-request', 'Commit message is empty or exceeds the configured byte limit')
    }
  }

  private requireSameState(expected: GitRepositoryState, actual: GitRepositoryState): void {
    if (expected.root !== actual.root || expected.gitDirectory !== actual.gitDirectory || expected.sessionCwd !== actual.sessionCwd
      || expected.head !== actual.head || expected.branch !== actual.branch || expected.indexFingerprint !== actual.indexFingerprint) {
      throw new SidebarGitError('stale', 'The repository, branch, HEAD, or staged files changed; review the commit again')
    }
  }

  private async requireHead(context: RepositoryContext, expected: string | null, signal?: AbortSignal): Promise<void> {
    if ((await this.resolveCommit(context.root, 'HEAD', signal) ?? null) !== expected) {
      throw new SidebarGitError('stale', 'The repository HEAD changed; refresh Git before continuing')
    }
  }

  private async historyMutation(
    operation: 'revert' | 'cherry-pick', request: GitRevisionMutationRequest, signal?: AbortSignal,
  ): Promise<GitMutationResult> {
    return this.mutate(request, signal, async (context) => {
      const hash = await this.resolveCommit(context.root, request.hash, signal)
      if (hash === undefined) throw new SidebarGitError('invalid-request', 'The selected history commit does not exist')
      await this.requireHead(context, request.head, signal)
      await this.process.run(context.root, [operation, '--no-edit', hash], signal)
      return { ok: true }
    })
  }

  private async mutate<T>(
    request: GitMutationRequest, signal: AbortSignal | undefined, operation: (context: RepositoryContext) => Promise<T>,
  ): Promise<T> {
    const captured = await this.repository(request, signal)
    if (captured.root !== request.repositoryRoot) throw new SidebarGitError('stale', 'The displayed repository changed; refresh Git')
    const previous = this.mutations.get(captured.root) ?? Promise.resolve()
    const result = previous.then(async () => {
      signal?.throwIfAborted()
      this.assertSession(captured.session, captured.sessionCwd)
      const current = await this.repository(request, signal)
      if (current.root !== captured.root || current.gitDirectory !== captured.gitDirectory) {
        throw new SidebarGitError('stale', 'The Session repository changed while waiting for another Git action')
      }
      return this.bounded(await operation(current))
    })
    const tail = result.then(() => {}, () => {})
    this.mutations.set(captured.root, tail)
    void tail.then(() => { if (this.mutations.get(captured.root) === tail) this.mutations.delete(captured.root) })
    return result
  }

  private bounded<T>(value: T): T {
    if (Buffer.byteLength(JSON.stringify(value)) > this.config.maxOutputBytes) {
      throw new SidebarGitError('output-limit', 'Git response exceeded the configured byte limit')
    }
    return value
  }
}

export default SidebarGit
