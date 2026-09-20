/** Owned bounded native command probes for SDK and helper readiness. */
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { Config } from './types.ts'
/** Execute a native probe and join its entire process range.
 * @param ctx - Injected subprocess owner.
 * @param config - Explicit output and lifecycle bounds.
 * @param executable - Existing exact binary or PATH selector.
 * @param args - Fixed probe arguments.
 * @param signal - Caller or Host task cancellation.
 * @returns Complete bounded UTF-8 stdout.
 */
export async function probe(
  ctx: Context, config: Required<Config>, executable: string, args: readonly string[], signal: AbortSignal,
): Promise<string> {
  const bound = deadline(signal, config.commandTimeoutMs, 'Mobile runtime probe timed out')
  let handle: SubprocessHandle | undefined
  try {
    const resolved = await ctx.subprocess.resolveExecutable(executable, {}, bound.signal)
    bound.signal.throwIfAborted()
    handle = ctx.subprocess.spawn({ argv: [resolved, ...args], cwd: config.storageDir, signal: bound.signal,
      graceMs: config.processGraceMs, stdio: { stdin: 'ignore', stdout: { maxBytes: config.maxOutputBytes }, stderr: { maxBytes: config.maxOutputBytes } } })
    const result = await handle.done
    bound.signal.throwIfAborted()
    const stdout = handle.collected.stdout?.readFrom(0)
    if (result.exitCode !== 0 || result.signal !== null || stdout?.lossy || handle.collected.stderr?.readFrom(0).lossy) throw new Error('Native component probe failed')
    return stdout?.text ?? ''
  } finally {
    try { handle?.terminate(); await handle?.done.catch(() => undefined); await handle?.waitForExit() } finally { bound[Symbol.dispose]() }
  }
}
