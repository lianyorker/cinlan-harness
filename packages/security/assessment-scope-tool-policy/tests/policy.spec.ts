import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Policy from '../src/index.ts'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

function makeExecution(name: string, args: Record<string, unknown> = {}): ToolExecution {
  return { name, arguments: args, agent: { id: 'agent', session: { id: 'session' } } as never } as never
}

async function mount(outcome: 'allow' | 'deny' | 'approval-required' = 'allow', config: Policy.Config = {}) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const authorize = vi.fn(() => ({ outcome, code: outcome === 'allow' ? 'ASSESSMENT_ALLOWED' : 'ASSESSMENT_ACTION_OUT_OF_SCOPE' }))
  ctx.provide('assessmentScopeSessions', {
    require: () => ({ targets: [{ id: 'target', value: 'example.test', kind: 'hostname' }] }), authorize,
  } as never)
  ctx.provide('executionHost', { current: () => ({ hostId: 'host' }) } as never)
  await ctx.plugin(Policy, {
    ...(config.shellTools === undefined ? {} : { shellTools: [...config.shellTools] }),
    ...(config.networkTools === undefined ? {} : { networkTools: [...config.networkTools] }),
    ...(config.browserTools === undefined ? {} : { browserTools: [...config.browserTools] }),
    ...(config.workspaceCommands === undefined ? {} : { workspaceCommands: config.workspaceCommands.map(entry => ({ ...entry })) }),
  })
  return { ctx, authorize }
}

async function pre(ctx: Context, execution: ToolExecution): Promise<PreToolDecision> {
  return ctx.waterfall(ctx as never, 'tools/pre-execute', execution, () => Promise.resolve<PreToolDecision>({ kind: 'allow' }))
}

describe('assessment scope tool policy', () => {
  it('delegates exact workspace commands while retaining scope checks for other effects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-policy-'))
    const cwd = join(root, 'workspace')
    await mkdir(cwd)
    await mkdir(join(cwd, 'child'))
    try {
      const b = await mount('deny', { workspaceCommands: [{ tool: 'pwsh', command: 'pwd' }] })
      const execution = (args: Record<string, unknown>) => ({ ...makeExecution('pwsh', args),
        agent: { session: { id: 'session', header: { cwd } } } as never })
      await expect(pre(b.ctx, execution({ command: 'pwd' }))).resolves.toEqual({ kind: 'allow' })
      await expect(pre(b.ctx, execution({ command: 'pwd', workdir: '.' }))).resolves.toEqual({ kind: 'allow' })
      await expect(pre(b.ctx, execution({ command: 'pwd', workdir: 'child' }))).resolves.toEqual({ kind: 'allow' })
      expect(b.authorize).not.toHaveBeenCalled()
      for (const args of [
        { command: 'pwd; whoami' }, { command: 'pwd\nwhoami' },
        { command: 'pwd', workdir: root }, { command: 'pwd', workdir: '../' },
        { command: 'pwd', workdir: 'missing' }, { command: 'pwd', url: 'https://example.test/' },
        { command: 'pwd', sandbox_permissions: 'require_escalated' },
        { command: 'pwd', run_in_background: true }, { command: 'pwd', target_id: 'target' },
      ]) await expect(pre(b.ctx, execution(args))).resolves.toMatchObject({ kind: 'deny' })
      await expect(pre(b.ctx, makeExecution('web_fetch', { url: 'https://example.test/' }))).resolves.toMatchObject({ kind: 'deny' })
      await expect(pre(b.ctx, makeExecution('pwsh', { command: 'pwd' }))).resolves.toMatchObject({ kind: 'deny' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects invalid workspace command configuration at load', async () => {
    for (const workspaceCommands of [
      [{ tool: 'web_fetch', command: 'pwd' }],
      [{ tool: 'pwsh', command: '' }],
      [{ tool: 'pwsh', command: ' pwd' }],
      [{ tool: 'pwsh', command: 'pwd' }, { tool: 'pwsh', command: 'pwd' }],
    ]) await expect(mount('deny', { workspaceCommands })).rejects.toThrow(/invalid workspaceCommands/)
  })

  it('classifies shell, network, and Browser calls', async () => {
    const b = await mount()
    const cases = [
      ['bash', {}, 'active-validation'],
      ['web_fetch', { url: 'https://example.test/a' }, 'reconnaissance'],
      ['browser_open', { url: 'https://example.test/a' }, 'active-validation'],
    ] as const
    for (const [name, args, action] of cases) {
      await expect(pre(b.ctx, makeExecution(name, args))).resolves.toMatchObject({ kind: 'allow' })
      expect(b.authorize).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ action }))
    }
  })

  it('returns deny and approval-required decisions from the scope service', async () => {
    const denied = await mount('deny')
    await expect(pre(denied.ctx, makeExecution('web_fetch', { url: 'https://example.test/' }))).resolves.toMatchObject({ kind: 'deny' })
    const approval = await mount('approval-required')
    await expect(pre(approval.ctx, makeExecution('bash'))).resolves.toMatchObject({ kind: 'ask' })
  })

  it('delegates unrelated tools and rejects duplicate configuration', async () => {
    const b = await mount()
    await expect(pre(b.ctx, makeExecution('finding_query'))).resolves.toEqual({ kind: 'allow' })
    const ctx = new Context(); contexts.push(ctx); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
    ctx.provide('assessmentScopeSessions', {} as never); ctx.provide('executionHost', {} as never)
    await expect(ctx.plugin(Policy, { shellTools: ['bash', 'bash'] })).rejects.toThrow(/invalid shellTools/)
  })
})
