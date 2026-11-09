/** Packaged filesystem rows boot through Include and retain observed-file mutation guards. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { expect, it, onTestFinished } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { boot, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import Tools from '@deepseek-ai/dsh-tools'

const presetUrl = new URL('../presets/security-research/agent.cordis.yml', import.meta.url)

it.each(['standard', 'ptc', 'cordis'])('preserves the upstream %s filesystem default', (preset) => {
  const rows = composeEntries([loadOverlayPatches('patch defaults', fileURLToPath(new URL(
    `../../web-app/presets/${preset}.patch.yml`, import.meta.url)))])
  const declaration = rows.find(row => row.id === `preset-${preset}`)
  const config = declaration?.config as { plugins: EntryOptions[] }
  expect(config.plugins.find(row => row.id === 'tool-fs')).toMatchObject({ config: { applyPatch: false } })
})

it('boots the packaged patch tool, rejects unread edits, and applies a patch after reading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cinlan-patch-composition-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const preset = load(await readFile(presetUrl, 'utf8'), { schema: entryListSchema }) as EntryOptions[]
  const base = composeEntries([loadOverlayPatches('patch composition', fileURLToPath(new URL('../../base/cordis.patch.yml', import.meta.url)))])
  const ids = ['tools', 'system-prompt', 'tool-executor-native', 'fs-sandbox', 'fs-observation-policy']
  const rows = base.filter(row => ids.includes(row.id))
  expect(rows.map(row => row.id).sort()).toEqual([...ids].sort())
  const tool = preset.find(row => row.id === 'tool-fs')
  expect(tool).toMatchObject({ config: { applyPatch: true } })
  if (!tool) throw new Error('Packaged filesystem row is missing')
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-tools', Tools], ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tool-executor-native', NativeExecutor], ['@deepseek-ai/dsh-fs-sandbox', SandboxedFileSystem],
    ['@deepseek-ai/dsh-fs-observation-policy', FsPolicy], ['@deepseek-ai/dsh-tool-fs', ToolFs],
    ['sandbox-policy', SandboxPolicy], ['projections', SessionProjections], ['sessions', Sessions],
  ])
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'sessions', name: 'cordis:sessions' },
    { id: 'projections', name: 'cordis:projections' },
    { id: 'sandbox-policy', name: 'cordis:sandbox-policy', config: { mode: 'workspace-write', workspaceRoot: root } },
    ...rows.map(row => ({ ...row, name: 'cordis:' + row.name })),
    { ...tool, name: 'cordis:' + tool.name },
  ]))
  const ctx = await boot('patch composition', configPath, undefined, (ctx) => {
    // The session collaborator pins only directory lookup; filesystem, policy, tools and Loader are real.
    provideWorkingDirectoryFixture(ctx, root)
    for (const [name, module] of modules) ctx.loader.builtins[name] = module
  })
  onTestFinished(() => ctx.fiber.dispose())
  expect(ctx.tools.get('apply_patch')).toBeDefined()
  const guidance = (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:apply_patch')
  expect(guidance?.text).toMatchInlineSnapshot('"Prefer apply_patch over separate edit calls for changes across files or separated regions. Read a file before updating, deleting, or moving it (the default fs-observation-policy requires it), unless you just created or edited it in this session. The whole patch is checked first (syntax, hunk matching, missing files) and a rejected patch changes nothing; once applying starts, operations run in order, stop at the first failure, and are not rolled back, so re-read affected files before retrying when needed."')
  const path = join(root, 'fixture.txt')
  await writeFile(path, 'old\n')
  const agent = { session: ctx.sessions.create(SessionId('patch-composition')) } as never
  let calls = 0
  const call = (name: string, args: object) => executeToolFixture(ctx, {
    name, arguments: args, agent, signal: new AbortController().signal, callId: ToolCallId(`composition-${++calls}`),
  })
  const input = `*** Begin Patch\n*** Update File: ${path}\n@@\n-old\n+new\n*** End Patch`
  expect(await call('apply_patch', { input })).toMatchObject({ isError: true, error: { info: { code: 'FS_NOT_OBSERVED' } } })
  expect(await readFile(path, 'utf8')).toBe('old\n')
  expect((await call('read', { file_path: path })).isError).toBe(false)
  const result = await call('apply_patch', { input })
  expect(result).toMatchObject({ isError: false, value: { phase: 'commit', cancelled: false } })
  expect(await readFile(path, 'utf8')).toBe('new\n')
  await ctx.fiber.dispose()
  expect(ctx.get('tools')).toBeUndefined()
})
