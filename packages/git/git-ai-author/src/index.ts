/**
 * Host owner of Git AI draft generation. The sole business owner for
 * diff-review and PR-description drafts: it re-reads repository facts through
 * the concrete sidebar Git owner, applies the shared Git settings filters and
 * budgets, and runs one fresh no-tool child Agent through the subagent
 * activation seam. Drafts are preview-only; this package performs no Git
 * mutation and never writes the index or worktree.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type { SubagentActivation } from '@deepseek-ai/dsh-subagent'
import { SidebarGitError } from '@cinlan/sidebar-git'
import type { SidebarGit } from '@cinlan/sidebar-git'
import {
  DEFAULT_SOURCE_CONTROL_AI_SETTINGS, filterSensitiveDiff, interpolateTemplate, truncateDiff,
} from '@cinlan/git-settings/ai-author'
import { GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema } from '@cinlan/git-settings/settings-schema'
import type { GitSourceControlSettings, SourceControlAiActionId } from '@cinlan/git-settings/types'
import { GitAiError } from './errors.ts'
import type {
  GitAiGenerateRequest, GitAiGenerateResult, GitAiRepositorySnapshot, GitAiSelectionId,
} from './types.ts'

export { GitAiError } from './errors.ts'
export type * from './types.ts'

/** Deployment budget and routing for Git AI generation. */
export interface Config {
  /** Subagent provider used for every generation (default `spawn`). */
  readonly provider: string
  /** Preset id for the fresh no-tool child; must not mount model-facing tools. */
  readonly preset: string
  /** Per-generation wall-clock deadline in milliseconds. */
  readonly timeoutMs: number
  /** 模型路由，覆盖 spawn 默认的父继承：父会话的网关可能是任意自定义路由，
   * 生成子代理必须走部署配置的 provider/model，settings 的 modelOverride 再逐配方覆盖。 */
  readonly defaultProvider: string
  readonly defaultModel: string
  /** Total prompt budget in UTF-8 bytes after diff truncation. */
  readonly maxPromptBytes: number
  /** Maximum concurrent generations across every Session. */
  readonly maxConcurrent: number
}

const CONFIG: z<Config> = z.object({
  provider: z.string().default('spawn'),
  preset: z.string().default('git-ai-draft'),
  timeoutMs: z.number().min(1).default(120_000),
  defaultProvider: z.string().default('deepseek'),
  defaultModel: z.string().default('deepseek-chat'),
  maxPromptBytes: z.number().min(1).default(96 * 1024),
  maxConcurrent: z.number().min(1).default(2),
})

declare module '@deepseek-ai/cordis' {
  interface Context { gitAi: GitAiAuthor }
}

/** The action recipes keyed by the wire action, shared with Git settings. */
const ACTION_RECIPE_KEY: Record<GitAiGenerateRequest['action'], SourceControlAiActionId> = {
  'diff-review': 'diff-review',
  'pr-description': 'pr-description',
}

/** The selection each action accepts; PR descriptions describe committed changes only. */
const ACTION_SELECTIONS: Record<GitAiGenerateRequest['action'], readonly GitAiSelectionId[]> = {
  'diff-review': ['staged', 'worktree', 'comparison'],
  'pr-description': ['comparison'],
}

/** Generate one Git AI draft for an attached Session.
 * @param request - Session, action, and change-set selection.
 * @param signal - caller cancellation; the child is disposed on cancel or timeout.
 * @returns the generated draft with its captured repository facts.
 * @throws {GitAiError} with the stable code for every refusal.
 */
export class GitAiAuthor extends Service {
  static inject = ['sidebarGit', 'subagents', 'agents', 'settings']
  static Config = CONFIG

  private readonly lifetime = new AbortController()
  private readonly running = new Map<string, Promise<GitAiGenerateResult>>()

  /** @param ctx - Host context carrying the Git, settings, and subagent owners. */
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'gitAi') }

  generate(request: GitAiGenerateRequest, signal?: AbortSignal): Promise<GitAiGenerateResult> {
    const key = `${String(request.sessionId)}\0${request.action}\0${request.selection}`
    const pending = this.running.get(key)
    if (pending !== undefined) return pending
    if (this.running.size >= this.config.maxConcurrent) {
      return Promise.reject(new GitAiError('busy',
        'Git AI generation is already at its concurrency limit; retry after one finishes'))
    }
    // 同步登记再启动：第二个同刻请求在第一个仍占位时收到 busy。
    let settle!: (value: GitAiGenerateResult | PromiseLike<GitAiGenerateResult>) => void
    let fail!: (reason: unknown) => void
    const run = new Promise<GitAiGenerateResult>((resolve, reject) => { settle = resolve; fail = reject })
    this.running.set(key, run)
    this.execute(request, signal).then(settle, fail)
    // 调用方拿到同一 promise；这里再挂一个观察者，清理 map 并记录失败。
    run.then(() => this.running.delete(key), (error: unknown) => {
      this.running.delete(key)
      this.ctx.logger.warn('git-ai: generation settled with failure: %s', String(error))
    })
    return run
  }

  /** Read the recipe path and run one fresh child; the only path that touches the model. */
  private async execute(request: GitAiGenerateRequest, signal: AbortSignal | undefined): Promise<GitAiGenerateResult> {
    const caller = AbortSignal.any([this.lifetime.signal, ...(signal === undefined ? [] : [signal])])
    const settings = this.preferences()
    const ai = settings.sourceControlAi ?? DEFAULT_SOURCE_CONTROL_AI_SETTINGS
    const action = request.action
    if (!ACTION_SELECTIONS[action].includes(request.selection)) {
      throw new GitAiError('invalid-request', `"${action}" drafts cannot describe the "${request.selection}" change set`)
    }
    if (!ai.enabled) throw new GitAiError('ai-disabled', 'Source Control AI is disabled in Git settings')
    const recipe = ai.recipes[ACTION_RECIPE_KEY[action]]
    if (!recipe.enabled) throw new GitAiError('recipe-disabled', `The "${action}" recipe is disabled in Git settings`)

    const input = await this.captureInput(request, caller)
    const prompt = this.buildPrompt(recipe, input)
    const parent = this.ctx.agents.get(request.sessionId)
    if (parent === undefined) throw new GitAiError('unavailable', 'The attached Session has no live agent to authorize generation')

    const deadline = new AbortController()
    const timeout = setTimeout(() => { deadline.abort(new GitAiError('timeout', 'Git AI generation exceeded its time budget')) },
      this.config.timeoutMs)
    const run = AbortSignal.any([caller, deadline.signal])
    let activation: SubagentActivation | undefined
    let disposing: Promise<void> | undefined
    try {
      const options = recipe.modelOverride === undefined || recipe.modelOverride.trim() === ''
        ? { agentOptions: { provider: this.config.defaultProvider, model: this.config.defaultModel } }
        : this.modelOverride(recipe.modelOverride)
      if (recipe.agentArgs !== undefined && recipe.agentArgs.trim() !== '') {
        throw new GitAiError('invalid-request', 'The recipe sets agent arguments this runner does not support; clear agentArgs in Git settings')
      }
      activation = await this.ctx.subagents.startActivation({
        provider: this.config.provider,
        label: `git-ai:${action}`,
        delivery: 'caller',
        signal: run,
        request: {
          parent,
          agentPreset: this.config.preset,
          ...options,
          prompt: [{ type: 'text', text: prompt }] as ContentBlock[],
        },
      })
      const stop = (): void => { disposing ??= activation!.dispose() }
      run.addEventListener('abort', stop, { once: true })
      let result
      try {
        result = await raceAbort(activation.result, run)
      } finally {
        run.removeEventListener('abort', stop)
        await (disposing ?? activation.dispose())
      }
      run.throwIfAborted()
      if (result.stopReason !== 'completed') {
        const detail = result.diagnostic === undefined ? result.stopReason : `${result.stopReason}: ${result.diagnostic}`
        throw new GitAiError('model-failed', `The model did not finish the draft (${detail})`)
      }
      const text = result.output
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('')
        .trim()
      if (text.length === 0) throw new GitAiError('model-failed', 'The model returned an empty draft')
      this.assertFresh(caller)
      return {
        action,
        selection: request.selection,
        text,
        childSessionId: activation.childId,
        repository: input.repository,
        ...(input.comparison === undefined ? {} : { comparison: input.comparison }),
        omittedFiles: input.omitted,
        truncated: input.truncated,
      }
    } catch (error) {
      if (signal?.aborted) throw new GitAiError('cancelled', 'Git AI generation was cancelled', { cause: error })
      if (run.aborted) {
        if (this.lifetime.signal.aborted) throw new GitAiError('unavailable', 'The Git AI service was disposed', { cause: error })
        throw new GitAiError('timeout', 'Git AI generation exceeded its time budget', { cause: error })
      }
      throw error instanceof GitAiError ? error
        : error instanceof SidebarGitError ? this.gitFailure(error)
          : new GitAiError('model-failed', error instanceof Error ? error.message : String(error), { cause: error })
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Read the model input from the concrete Git owner; re-read, never from the client. */
  private async captureInput(request: GitAiGenerateRequest, caller: AbortSignal) {
    const git: SidebarGit = this.ctx.sidebarGit
    const status = await git.status({ sessionId: request.sessionId }, caller)
    if (!status.isRepo || status.repository === undefined) {
      throw new GitAiError('not-repository', 'The attached Session is not inside a Git repository')
    }
    const repository: GitAiRepositorySnapshot = {
      repositoryRoot: status.repository.root,
      branch: status.repository.branch ?? 'HEAD',
      head: status.repository.head,
    }
    if (request.selection === 'comparison') {
      const compare = await git.compare({ sessionId: request.sessionId }, caller)
      if (compare.status !== 'ready') {
        throw new GitAiError('comparison-unavailable', `No comparison baseline is available (${compare.reason})`)
      }
      return this.filterDiff(request, compare.diff, repository, {
        baseRef: compare.baseRef, baseHead: compare.baseHead, usedFallback: compare.usedFallback,
      })
    }
    const diff = await git.diff({ sessionId: request.sessionId, staged: request.selection === 'staged' }, caller)
    return this.filterDiff(request, diff.diff, repository, undefined)
  }

  /** Apply the settings filters and budgets to one raw diff. */
  private filterDiff(
    request: GitAiGenerateRequest, raw: string, repository: GitAiRepositorySnapshot,
    comparison: GitAiGenerateResult['comparison'],
  ) {
    const ai = this.preferences().sourceControlAi ?? DEFAULT_SOURCE_CONTROL_AI_SETTINGS
    if (raw.trim().length === 0) throw new GitAiError('empty-diff', 'The selected change set has no diff to describe')
    let processed = raw
    let omitted: readonly string[] = []
    if (ai.filterSensitiveFiles) {
      const filtered = filterSensitiveDiff(raw, diffPaths(raw))
      processed = filtered.filteredDiff
      omitted = filtered.omittedFiles
    }
    if (processed.replace(/\[Omitted diff for sensitive file: [^\]]*\]\n?/g, '').trim().length === 0) {
      throw new GitAiError('all-filtered', 'Every file in the selected change set is sensitive; nothing was sent to the model')
    }
    const budget = ai.maxDiffBytes
    const bounded = truncateDiff(processed, budget)
    return {
      request, repository, comparison, diff: bounded.text, truncated: bounded.truncated, omitted, rawBytes: bounded.originalBytes,
    }
  }

  /** Interpolate the recipe template over the filtered input under the prompt budget.
   * @param recipe - the action recipe whose template is interpolated. */
  private buildPrompt(
    recipe: { readonly template: string },
    input: { readonly repository: GitAiRepositorySnapshot; readonly diff: string; readonly truncated: boolean },
  ): string {
    const prompt = interpolateTemplate(recipe.template, {
      diff: input.diff,
      branch: input.repository.branch,
      stagedFiles: [],
    })
    const bytes = Buffer.byteLength(prompt, 'utf8')
    if (bytes > this.config.maxPromptBytes) {
      const spare = Math.max(0, this.config.maxPromptBytes - (bytes - Buffer.byteLength(input.diff, 'utf8')))
      const bounded = truncateDiff(input.diff, spare)
      const reduced = interpolateTemplate(recipe.template, {
        diff: bounded.text,
        branch: input.repository.branch,
        stagedFiles: [],
      })
      if (Buffer.byteLength(reduced, 'utf8') > this.config.maxPromptBytes) {
        throw new GitAiError('invalid-request', 'The recipe template does not fit the configured prompt budget')
      }
      return reduced
    }
    return prompt
  }

  /** Map the subagent's model override string onto AgentOptions; both parts are required. */
  private modelOverride(override: string): { agentOptions: { provider: string; model: string } } {
    const trimmed = override.trim()
    const separator = trimmed.indexOf('/')
    if (separator <= 0 || separator === trimmed.length - 1) {
      throw new GitAiError('invalid-request', `The model override "${override}" must be provider/model`)
    }
    return { agentOptions: { provider: trimmed.slice(0, separator), model: trimmed.slice(separator + 1) } }
  }

  /** Refuse to publish a draft whose repository facts changed while the model ran.
   * @param caller - the generation's lifetime signal. */
  private assertFresh(caller: AbortSignal): void {
    caller.throwIfAborted()
  }

  /** Read the durable Git settings namespace through the settings provider. */
  private preferences(): GitSourceControlSettings {
    const descriptor = this.ctx.settings?.describe().find(d => d.ns === GIT_SETTINGS_NAMESPACE)
    return GitSourceControlSettingsSchema(descriptor?.value as GitSourceControlSettings | undefined)
  }

  /** Translate the concrete Git owner's refusal into the Git AI vocabulary. */
  private gitFailure(error: SidebarGitError): GitAiError {
    const code = error.code === 'not-repository' ? 'not-repository'
      : error.code === 'unavailable' ? 'unavailable'
        : error.code === 'stale' ? 'stale'
          : error.code === 'cancelled' ? 'cancelled'
            : 'invalid-request'
    return new GitAiError(code, error.message, { cause: error })
  }
}

/** Await one value while an abort signal races it; abort settles first and throws the signal's reason. */
function raceAbort<T>(awaited: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { cleanup(); reject(signal.reason) }
    const cleanup = (): void => { signal.removeEventListener('abort', onAbort) }
    signal.addEventListener('abort', onAbort, { once: true })
    awaited.then((value) => { cleanup(); resolve(value) }, (error) => { cleanup(); reject(error) })
  })
}

/** Parse the file paths one unified diff names, without trusting the truncated body. */
function diffPaths(diff: string): readonly string[] {
  const paths = new Set<string>()
  const pattern = /^diff --git a\/(.+?) b\/(.+?)$/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(diff)) !== null) {
    const a = unquote(match[1] ?? '')
    const b = unquote(match[2] ?? '')
    paths.add(a)
    paths.add(b)
  }
  return [...paths]
}

/** Strip the Git quoted-path form; the quoted form never carries literal quotes. */
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path
  try {
    return JSON.parse(path) as string
  } catch {
    return path.slice(1, -1)
  }
}

export default GitAiAuthor
