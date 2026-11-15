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

async function mount(
  outcome: 'allow' | 'deny' | 'approval-required' = 'allow',
  config: Policy.Config = {},
  grantTargets: Array<Record<string, unknown>> = [{ id: 'target', value: 'example.test', kind: 'hostname' }],
) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const authorize = vi.fn(() => ({ outcome, code: outcome === 'allow' ? 'ASSESSMENT_ALLOWED' : 'ASSESSMENT_ACTION_OUT_OF_SCOPE' }))
  ctx.provide('assessmentScopeSessions', {
    require: () => ({ targets: grantTargets }), authorize,
  } as never)
  ctx.provide('executionHost', { current: () => ({ hostId: 'host' }) } as never)
  await ctx.plugin(Policy, {
    ...(config.shellTools === undefined ? {} : { shellTools: [...config.shellTools] }),
    ...(config.networkTools === undefined ? {} : { networkTools: [...config.networkTools] }),
    ...(config.browserTools === undefined ? {} : { browserTools: [...config.browserTools] }),
    ...(config.credentialTools === undefined ? {} : { credentialTools: [...config.credentialTools] }),
    ...(config.exploitTools === undefined ? {} : { exploitTools: [...config.exploitTools] }),
    ...(config.persistenceTools === undefined ? {} : { persistenceTools: [...config.persistenceTools] }),
    ...(config.cloudTools === undefined ? {} : { cloudTools: [...config.cloudTools] }),
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

  it('maps credential tools onto credential-use with the presented credential reference', async () => {
    const b = await mount('allow', { credentialTools: ['kerberoast'] })
    const execution = makeExecution('kerberoast', { target_id: 'example.test', credential_ref: 'ASSESS_AD_PASS' })
    await expect(pre(b.ctx, execution)).resolves.toMatchObject({ kind: 'allow' })
    expect(b.authorize).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      action: 'credential-use',
      credential: { ref: 'ASSESS_AD_PASS', purpose: 'target-authentication' },
    }))
  })

  it('denies credential tool calls without a well-formed credential_ref', async () => {
    const b = await mount('allow', { credentialTools: ['kerberoast'] })
    for (const args of [{ target_id: 'example.test' }, { target_id: 'example.test', credential_ref: '' }, { target_id: 'example.test', credential_ref: 'bad ref!' }]) {
      await expect(pre(b.ctx, makeExecution('kerberoast', args))).resolves.toMatchObject({ kind: 'deny' })
    }
    expect(b.authorize).not.toHaveBeenCalled()
  })

  it('asks for approval when the scope service requires it for credential use', async () => {
    const b = await mount('approval-required', { credentialTools: ['nxc_spray'] })
    const execution = makeExecution('nxc_spray', { target_id: 'example.test', credential_ref: 'ASSESS_AD_PASS' })
    await expect(pre(b.ctx, execution)).resolves.toMatchObject({ kind: 'ask' })
  })

  it('maps exploit and persistence tools onto their actions without credential arguments', async () => {
    const b = await mount('allow', { exploitTools: ['responder_capture'], persistenceTools: ['rbcd'] })
    await expect(pre(b.ctx, makeExecution('responder_capture', { target_id: 'example.test', interface: 'eth0' })))
      .resolves.toMatchObject({ kind: 'allow' })
    expect(b.authorize).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      action: 'exploit-execution',
    }))
    await expect(pre(b.ctx, makeExecution('rbcd', { target_id: 'example.test', delegate_from: 'EVIL$' })))
      .resolves.toMatchObject({ kind: 'allow' })
    expect(b.authorize).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      action: 'persistence-change',
    }))
  })

  it('rejects invalid exploitTools and persistenceTools configuration at load', async () => {
    await expect(mount('deny', { exploitTools: [''] })).rejects.toThrow(/invalid exploitTools/)
    await expect(mount('deny', { persistenceTools: [' rbcd'] })).rejects.toThrow(/invalid persistenceTools/)
    await expect(mount('deny', { persistenceTools: ['rbcd', 'rbcd'] })).rejects.toThrow(/invalid persistenceTools/)
  })

  it('rejects invalid credentialTools configuration at load', async () => {
    for (const credentialTools of [[''], [' keroboast'], ['dup', 'dup']]) {
      await expect(mount('deny', { credentialTools })).rejects.toThrow(/invalid credentialTools/)
    }
  })

  it('maps cloud tools onto reconnaissance against a cloud target', async () => {
    const targets = [{ id: 'target', value: '123456789012', kind: 'cloud', cloud: { provider: 'aws' } }]
    const b = await mount('allow', { cloudTools: ['s3_enum'] }, targets)
    await expect(pre(b.ctx, makeExecution('s3_enum', { target_id: '123456789012', region: 'us-east-1' })))
      .resolves.toMatchObject({ kind: 'allow' })
    expect(b.authorize).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      action: 'reconnaissance',
    }))
  })

  it('carries a presented credential reference from cloud reconnaissance calls into the operation', async () => {
    const targets = [{ id: 'target', value: '123456789012', kind: 'cloud', cloud: { provider: 'aws' } }]
    const b = await mount('allow', { cloudTools: ['iam_enum'] }, targets)
    await expect(pre(b.ctx, makeExecution('iam_enum', { target_id: '123456789012', credential_ref: 'ASSESS_AWS_KEYS' })))
      .resolves.toMatchObject({ kind: 'allow' })
    expect(b.authorize).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      action: 'reconnaissance',
      credential: { ref: 'ASSESS_AWS_KEYS', purpose: 'target-authentication' },
    }))
    for (const args of [{ target_id: '123456789012', credential_ref: 'bad ref!' }]) {
      await expect(pre(b.ctx, makeExecution('iam_enum', args))).resolves.toMatchObject({ kind: 'deny' })
    }
    expect(b.authorize).toHaveBeenCalledTimes(1)
  })

  it('denies cloud tools whose explicit scope arguments fall outside the declared allowlists', async () => {
    const targets = [{
      id: 'target', value: '123456789012', kind: 'cloud',
      cloud: { provider: 'aws', regions: ['us-east-1', 'us-west-2'] },
    }]
    const b = await mount('allow', { cloudTools: ['s3_enum'] }, targets)
    await expect(pre(b.ctx, makeExecution('s3_enum', { target_id: '123456789012', region: 'eu-central-1' })))
      .resolves.toMatchObject({ kind: 'deny' })
    expect(b.authorize).not.toHaveBeenCalled()
    await expect(pre(b.ctx, makeExecution('s3_enum', { target_id: '123456789012', region: 'US-EAST-1' })))
      .resolves.toMatchObject({ kind: 'allow' })
    await expect(pre(b.ctx, makeExecution('s3_enum', { target_id: '123456789012' })))
      .resolves.toMatchObject({ kind: 'allow' })
  })

  it('checks subscription and project allowlists for azure and gcp cloud targets', async () => {
    const azure = await mount('allow', { cloudTools: ['storage_enum'] }, [{
      id: 'target', value: 'sub-acc', kind: 'cloud',
      cloud: { provider: 'azure', subscriptions: ['sub-a'] },
    }])
    await expect(pre(azure.ctx, makeExecution('storage_enum', { target_id: 'sub-acc', subscription: 'sub-b' })))
      .resolves.toMatchObject({ kind: 'deny' })
    const gcp = await mount('allow', { cloudTools: ['gcs_enum'] }, [{
      id: 'target', value: 'proj-acc', kind: 'cloud',
      cloud: { provider: 'gcp', projects: ['proj-a'] },
    }])
    await expect(pre(gcp.ctx, makeExecution('gcs_enum', { target_id: 'proj-acc', project: 'proj-b' })))
      .resolves.toMatchObject({ kind: 'deny' })
    await expect(pre(gcp.ctx, makeExecution('gcs_enum', { target_id: 'proj-acc', project: 'proj-a' })))
      .resolves.toMatchObject({ kind: 'allow' })
  })

  it('admits cloud scope arguments when the target declares no allowlist for that dimension', async () => {
    const b = await mount('allow', { cloudTools: ['s3_enum'] }, [{
      id: 'target', value: '123456789012', kind: 'cloud', cloud: { provider: 'aws' },
    }])
    await expect(pre(b.ctx, makeExecution('s3_enum', { target_id: '123456789012', region: 'ap-southeast-1' })))
      .resolves.toMatchObject({ kind: 'allow' })
  })

  it('rejects invalid cloudTools configuration at load', async () => {
    for (const cloudTools of [[''], [' s3_enum'], ['dup', 'dup']]) {
      await expect(mount('deny', { cloudTools })).rejects.toThrow(/invalid cloudTools/)
    }
  })
})
