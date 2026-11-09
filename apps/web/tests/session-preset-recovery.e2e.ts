/** Shipped presets recover persisted Sessions and replay patch requests without a live provider. */
import { expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { requireBuilt } from './support.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { fixtureUserPrompts, launchWebScaffold, readPersistedEvents } from './scaffold.ts'

// The scaffold boots built packages; invocation must share their HarnessError identity.
const { executeToolFixture } = requireBuilt('@deepseek-ai/dsh-tool-testkit') as typeof import('@deepseek-ai/dsh-tool-testkit')

it.each([false, true])('creates and resumes shipped preset Sessions with Agent Teams enabled=%s', async (teams) => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [
      ...teams ? [fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/cordis.patch.yml', import.meta.url))] : [],
      fileURLToPath(new URL('../../../packages/bundle/security-research/cordis.patch.yml', import.meta.url)),
    ],
    extraInstallAnchors: teams ? [fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/package.json', import.meta.url))] : [],
  })
  try {
    for (const preset of ['security-research', 'standard', 'ptc', 'cordis']) {
      const handle = await scaffold.ctx.agents.create({
        sessionId: SessionId('preset-recovery-' + preset),
        meta: { cwd: scaffold.workspaceCwd, agentPreset: preset },
        setup: async (ctx) => { await scaffold.ctx.agentPresets.mount(ctx, preset) },
      })
      const { agent } = handle
      expect(scaffold.ctx.agents.get(agent.id)).toBe(agent)
      const schemas = scaffold.ctx.tools.schemas(agent)
      expect(schemas.filter(tool => tool.name === 'list_agents')).toHaveLength(1)
      expect(schemas.filter(tool => tool.name === 'send_message')).toHaveLength(1)
      if (teams) expect(schemas.filter(tool => tool.name === 'team_merge_worktree')).toHaveLength(1)
      expect(schemas.filter(tool => tool.name === 'apply_patch')).toHaveLength(preset === 'security-research' ? 1 : 0)
      if (preset === 'security-research') {
        const path = join(scaffold.workspaceCwd, 'patch-recovery.txt')
        await writeFile(path, 'before\n')
        const input = `*** Begin Patch\n*** Update File: ${path}\n@@\n-before\n+after\n*** End Patch`
        const call = (name: string, args: object) => executeToolFixture(scaffold.ctx, {
          agent, name, arguments: args, signal: new AbortController().signal,
          callId: ToolCallId('patch-recovery-' + name),
        })
        expect(await call('apply_patch', { input })).toMatchObject({
          isError: true, error: { info: { code: 'FS_NOT_OBSERVED' } },
        })
        expect(await readFile(path, 'utf8')).toBe('before\n')
        expect((await call('read', { file_path: path })).isError).toBe(false)
        expect(await call('apply_patch', { input })).toMatchObject({
          isError: false, value: { phase: 'commit', cancelled: false },
        })
        expect(await readFile(path, 'utf8')).toBe('after\n')
      }
      agent.session.append('plan/mode', { active: true })
      await handle.dispose()
      expect(scaffold.ctx.agents.get(agent.id)).toBeUndefined()
      const resumed = await scaffold.ctx.agents.resume({
        resumeSessionId: agent.id,
        setup: async (ctx) => { await scaffold.ctx.agentPresets.mount(ctx, preset) },
      })
      try {
        expect(resumed.agent.id).toBe(agent.id)
        expect(scaffold.ctx.agentPresets.composedPreset(resumed.agent.ctx)).toBe(preset)
        expect(scaffold.ctx.sessionProjections.snapshot(resumed.agent.session).values.plan).toEqual({ active: true, pending: false })
        const restored = scaffold.ctx.tools.schemas(resumed.agent)
        expect(restored.filter(tool => tool.name === 'list_agents')).toHaveLength(1)
        expect(restored.filter(tool => tool.name === 'send_message')).toHaveLength(1)
        if (teams) expect(restored.filter(tool => tool.name === 'team_merge_worktree')).toHaveLength(1)
        expect(restored.filter(tool => tool.name === 'apply_patch')).toHaveLength(preset === 'security-research' ? 1 : 0)
        if (preset === 'security-research') {
          expect(await readFile(join(scaffold.workspaceCwd, 'patch-recovery.txt'), 'utf8')).toBe('after\n')
        }
      } finally {
        await resumed.dispose()
      }
    }
  } finally {
    await scaffold.close()
  }
}, 120_000)

it('replays the recorded multi-file patch through the packaged security preset', async () => {
  const directory = fileURLToPath(new URL('../../../snapshots/session/apply-patch-update/', import.meta.url))
  const fixture = join(directory, 'session.v4.jsonl')
  const scaffold = await launchWebScaffold({
    replayFixture: fixture,
    replayProviders: [{ id: 'deepseek-official', name: 'DeepSeek', models: [
      { id: 'deepseek-v4-pro', contextWindow: 1_000_000 },
    ] }],
    // The headless owner retains its Session and prompt expectations; this test checks the Web preset.
    compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('../../../packages/bundle/security-research/cordis.patch.yml', import.meta.url)),
  })
  try {
    await cp(join(directory, 'workspace'), scaffold.workspaceCwd, { recursive: true })
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('security-patch-replay'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'security-research' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      setup: async (ctx) => { await scaffold.ctx.agentPresets.mount(ctx, 'security-research') },
    })
    try {
      const [prompt] = fixtureUserPrompts(await readFile(fixture, 'utf8'))
      if (prompt === undefined) throw new Error('Recorded patch fixture has no user prompt')
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      const events = handle.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'turn/end').map(event => event.data.reason))
        .toEqual([{ kind: 'completed' }])
      expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name))
        .toMatchInlineSnapshot(`
          [
            "read",
            "read",
            "apply_patch",
          ]
        `)
      expect(events.filter(event => event.type === 'tool/result').map(event => event.data.message.isError))
        .toEqual([false, false, false])
      for (const name of ['a.ts', 'b.ts', 'c.ts']) {
        expect(await readFile(join(scaffold.workspaceCwd, 'src', name), 'utf8'))
          .toBe(await readFile(join(directory, 'workspace.expected', 'src', name), 'utf8'))
      }
      await scaffold.ctx.sessions.flush(handle.agent.session)
      expect(await readPersistedEvents(scaffold, handle.agent.id)).toEqual(handle.agent.session.snapshotEvents())
    } finally {
      await handle.dispose()
    }
  } catch (error) {
    try { await scaffold.close() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Patch replay and cleanup failed')
    }
    throw error
  }
  await scaffold.close()
}, 120_000)
