import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import IntegrationPreflightController, { parseCliAccount, parseGitHubBudget, withoutTerminalFormatting } from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { for (const ctx of roots.splice(0)) await ctx.fiber.dispose() })

function bench() {
  const ctx = new Context()
  roots.push(ctx)
  return { ctx, controller: new IntegrationPreflightController(ctx), signal: new AbortController().signal }
}

describe('Integration preflight readiness', () => {
  it('reports not-configured when GITEE_TOKEN is not set', async () => {
    const { controller, signal } = bench()
    vi.stubEnv('GITEE_TOKEN', '')
    const result = await controller.check({ provider: 'gitee' }, signal)
    expect(result).toEqual({ provider: 'gitee', status: 'not-configured', reason: 'token-not-set', account: null })
    vi.unstubAllEnvs()
  })

  it('honours cancellation before the probe starts', async () => {
    const { controller } = bench()
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    await expect(controller.check({ provider: 'github' }, abort.signal)).rejects.toThrow('cancelled')
  })

  it('returns a snapshot with the requested provider', async () => {
    const { controller, signal } = bench()
    vi.stubEnv('GITEE_TOKEN', 'fake-token-for-test')
    const result = await controller.check({ provider: 'gitee' }, signal)
    expect(result.provider).toBe('gitee')
    expect(result.status).toBeDefined()
    vi.unstubAllEnvs()
  })
})

describe('Integration API budget', () => {
  it('reports Gitee as unsupported instead of inventing a quota', async () => {
    const { controller, signal } = bench()
    const result = await controller.budget({ provider: 'gitee' }, signal)
    expect(result).toEqual({
      provider: 'gitee',
      state: 'unsupported',
      reason: 'budget-unsupported',
      remaining: null,
      limit: null,
      resetsAt: null,
    })
  })

  it('names the missing CLI rather than reporting an empty budget', async () => {
    const { controller, signal } = bench()
    // No `gh` on this machine's PATH is the normal probe outcome, not an error.
    vi.stubEnv('PATH', '')
    const result = await controller.budget({ provider: 'github' }, signal)
    expect(result.state).toBe('unavailable')
    expect(result.reason).toBe('cli-not-found')
    expect(result.remaining).toBeNull()
    vi.unstubAllEnvs()
  })

  it('reads the core bucket whether or not the CLI applied its filter', async () => {
    // Both spellings a real `gh api rate_limit` can produce; the probe must not
    // report "no data" when the quota is sitting in a nested bucket.
    const flat = { limit: 5000, remaining: 4999, reset: 1791994139, used: 1 }
    const whole = { resources: { core: flat } }
    const expected = { remaining: 4999, limit: 5000, resetsAt: new Date(1791994139 * 1000).toISOString() }
    expect(parseGitHubBudget(JSON.stringify(flat))).toEqual(expected)
    expect(parseGitHubBudget(JSON.stringify(whole))).toEqual(expected)
    expect(parseGitHubBudget('not json')).toBeUndefined()
  })

  it('reads the login name from either gh auth status wording', () => {
    expect(parseCliAccount('  ✓ Logged in to github.com account octocat (keyring)')).toBe('octocat')
    expect(parseCliAccount('  ✓ Logged in to github.com as octocat\n')).toBe('octocat')
    expect(parseCliAccount('github.com\n  X Not logged in')).toBeNull()
  })

  it('reports the quota when the CLI colourises its output', () => {
    // A terminal-capable host makes gh decorate stdout even when piped; the probe
    // strips the decoration and parses, rather than reporting "no data".
    const decorated = '\u001b[1;38m{\u001b[m\n\u001b[1;34m"limit"\u001b[m\u001b[1;38m:\u001b[m 5000,\n'
      + '\u001b[1;34m"remaining"\u001b[m\u001b[1;38m:\u001b[m 1234,\n\u001b[1;34m"reset"\u001b[m\u001b[1;38m:\u001b[m 1791994139\n\u001b[1;38m}\u001b[m\n'
    expect(withoutTerminalFormatting(decorated)).toBe('{\n"limit": 5000,\n"remaining": 1234,\n"reset": 1791994139\n}\n')
    expect(parseGitHubBudget(withoutTerminalFormatting(decorated)))
      .toEqual({ remaining: 1234, limit: 5000, resetsAt: new Date(1791994139 * 1000).toISOString() })
  })

  it('honours cancellation before the budget probe starts', async () => {
    const { controller } = bench()
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    await expect(controller.budget({ provider: 'github' }, abort.signal)).rejects.toThrow('cancelled')
  })
})
