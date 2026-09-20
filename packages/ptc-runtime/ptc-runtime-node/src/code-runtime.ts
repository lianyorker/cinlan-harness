/** Optional CodeRuntime provider for compositions that execute through the PTC runtime. */
import { Context } from '@deepseek-ai/cordis'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunFailure, CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import type { PtcRunFailure, PtcRunResult } from '@deepseek-ai/dsh-ptc-runtime'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Preserve the CodeRuntime failure union while retaining PTC diagnostics. */
function codeFailure(error: PtcRunFailure): CodeRunFailure {
  const kind = error.kind
  switch (kind) {
    case 'protocol':
    case 'sandbox-unavailable':
      return { kind: 'worker-exit', message: error.message }
    case 'exception':
    case 'timeout':
    case 'abort':
    case 'worker-exit':
    case 'invalid-output':
    case 'output-limit':
      return { kind, message: error.message }
    default: return assertNever(kind)
  }
}

/**
 * Opt-in adapter for existing CodeRuntime consumers. The initiating Session selects cwd and policy;
 * agentless calls use deployment policy. PTC retains process ownership, deadlines, and output limits.
 * CodeRuntime has no sandbox metadata or per-call execution options; direct PTC callers retain both.
 */
export class PtcCodeRuntime extends CodeRuntime {
  static inject = ['ptcRuntime', 'sandboxPolicy']
  private readonly controller = new AbortController()
  private readonly live = new Set<Promise<PtcRunResult>>()

  constructor(ctx: Context) {
    super(ctx)
    ctx.effect(() => async () => {
      this.controller.abort('code runtime adapter disposed')
      await Promise.allSettled([...this.live])
    }, 'PTC CodeRuntime adapter cleanup')
  }

  get language(): string { return this.ctx.ptcRuntime.language }
  get isolation(): string { return this.ctx.ptcRuntime.isolation }

  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    if (this.controller.signal.aborted) throw new Error('ptc-runtime-node: CodeRuntime adapter run after disposal')
    const session = this.ctx.get('agents')?.currentInitiator()?.session
    const sandboxPolicy = this.ctx.sandboxPolicy.resolve(session === undefined ? {} : { session })
    const runtime = this.ctx.ptcRuntime
    const spec = runtime.resolve({
      ...request,
      cwd: sandboxPolicy.workspaceRoot,
      sandboxPolicy,
      signal: request.signal === undefined ? this.controller.signal : AbortSignal.any([request.signal, this.controller.signal]),
    })
    const pending = runtime.run(spec)
    this.live.add(pending)
    try {
      const result = await pending
      return {
        logs: result.logs,
        ...result.value === undefined ? {} : { value: result.value },
        ...result.error === undefined ? {} : { error: codeFailure(result.error) },
      }
    } finally { this.live.delete(pending) }
  }
}

export default PtcCodeRuntime
