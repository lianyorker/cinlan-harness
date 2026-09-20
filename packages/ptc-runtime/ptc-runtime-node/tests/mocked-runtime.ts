/** In-memory process-world fixtures; no executable lookup, sandbox probe, or child spawn reaches the OS. */
import { Context, Service } from '@deepseek-ai/cordis'
import { onTestFinished } from 'vitest'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxMode, SandboxPolicy as FilePolicy } from '@deepseek-ai/dsh-sandbox'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import NodeRuntime from '../src/index.ts'
import type { Config } from '../src/index.ts'

class FileSystem extends Service {
  constructor(ctx: Context) { super(ctx, 'fs') }
  processPathFromHostPath(path: string): string | undefined { return path }
}

class Subprocess extends Service {
  constructor(ctx: Context) { super(ctx, 'subprocess') }
  async resolveExecutable(): Promise<string> { throw new Error('unmocked executable lookup') }
  spawn(): SubprocessHandle { throw new Error('unmocked process spawn') }
}

class Sandbox extends Service {
  constructor(ctx: Context) { super(ctx, 'sandbox') }
  async confine(_argv: readonly string[], policy: FilePolicy): Promise<ConfinedArgv> {
    throw new SandboxUnavailableError(policy.mode)
  }
}

export async function mountMockRuntime(ctx: Context, config: Config = {}, policy: { mode?: SandboxMode; workspaceRoot?: string } = {}) {
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(FileSystem)
  await ctx.plugin(Subprocess)
  await ctx.plugin(Sandbox)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', ...policy })
  await ctx.plugin(NodeRuntime, config)
  return ctx.ptcRuntime as NodeRuntime
}
