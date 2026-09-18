/// <reference types="node" />
/** Real Loader, durable settings, and both native sidebar creation paths without Web services. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as sidebar from '../src/index.ts'
import { shellSpawnArgs } from '../src/pty-manager.ts'
import { SIDEBAR_PREFS_NS } from '../src/prefs-shared.ts'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SidebarTerminalFrame, SidebarTerminalSessionId, SidebarTerminalTabId, SidebarTerminalReleaseRequest } from '@deepseek-ai/dsh-sidebar-terminals/types'

// Native process creation is external; all preferences, routes, PTY ownership and persistence stay real.
const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('../src/pty-deps.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/pty-deps.ts')>(),
  loadNodePty: () => ({ spawn: native.spawn }),
  loadRequiredNodePty: () => ({ spawn: native.spawn }),
}))

type ProcessRecord = {
  file: string
  args: string[] | string
  cwd: string
  pid: number
  kill: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
}
const processes: ProcessRecord[] = []
const streams: { lifetime: AbortController; iterator: AsyncIterator<SidebarTerminalFrame> }[] = []
let root: string | undefined
let context: Context | undefined

beforeEach(() => {
  processes.length = 0
  native.spawn.mockImplementation((file: string, args: string[] | string, options: { cwd: string }) => {
    const exits = new Set<(event: { exitCode: number }) => void>()
    let alive = true
    const process = { file, args, cwd: options.cwd, pid: processes.length + 1, kill: vi.fn(() => {
      if (!alive) return
      alive = false
      for (const listener of [...exits]) listener({ exitCode: 0 })
    }), write: vi.fn() }
    processes.push(process)
    return { ...process, process: file, cols: 80, rows: 24, resize: vi.fn(), onData: () => ({ dispose() {} }),
      onExit: (listener: (event: { exitCode: number }) => void) => { exits.add(listener); return { dispose() { exits.delete(listener) } } },
    }
  })
})
afterEach(async () => {
  for (const { lifetime, iterator } of streams.splice(0)) {
    lifetime.abort()
    await iterator.return?.()
  }
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  native.spawn.mockReset()
})

async function load() {
  const firstBoot = root === undefined
  root ??= await mkdtemp(join(tmpdir(), 'dsh-terminal-settings-'))
  const cwd = join(root, 'session')
  await mkdir(cwd, { recursive: true })
  const settingsPath = join(root, 'settings.yaml')
  if (firstBoot) await writeFile(settingsPath, 'dsh-better-sidebar:\n  terminalShell: shell-a\n  terminalShellArgs: --first -i\n  agentTerminalTools: true\n')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: external-context', '  name: test-terminal-context',
    '- id: settings', "  name: '@deepseek-ai/dsh-settings-file'", '  config:', '    path: ' + JSON.stringify(settingsPath),
    '- id: prompt', "  name: '@deepseek-ai/dsh-system-prompt'",
    '- id: tools', "  name: '@deepseek-ai/dsh-tools'",
    '- id: sidebar', "  name: '@deepseek-ai/dsh-client-ui-better-sidebar'", '  config:', '    shell: deployment-shell', '    shellArgs: [--base]',
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const externalContext = { apply(scope: Context) {
    // Session metadata is an external input to this terminal composition.
    scope.provide('sessions', { get: () => ({ header: { cwd } }) } as never)
  } }
  const modules = new Map<string, unknown>([
    ['test-terminal-context', externalContext],
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt], ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-client-ui-better-sidebar', sidebar],
  ])
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('unexpected Loader module: ' + specifier)
    return modules.get(specifier)
  } } as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  await vi.waitFor(() => { expect(ctx.get('tools')?.get('terminal_create')).toBeDefined() })
  expect(ctx.get('webServer')).toBeUndefined()
  const settings = ctx.get('settings')!
  const updateShell = async (shell: string, args: string) => {
    const current = settings.describe().find(row => row.ns === SIDEBAR_PREFS_NS)!
    await settings.mutate(SIDEBAR_PREFS_NS as SettingsNamespace, [
      { op: 'set', path: ['terminalShell'], value: shell },
      { op: 'set', path: ['terminalShellArgs'], value: args },
    ], current.revision)
  }
  const connect = async (tab: string) => {
    const lifetime = new AbortController()
    const terminals = ctx.sidebarTerminals
    const iterator = terminals.open({
      target: { kind: 'ui', sessionId: 'owned-session' as SidebarTerminalSessionId, tabId: tab as SidebarTerminalTabId },
      cols: 80, rows: 24,
    }, lifetime.signal)[Symbol.asyncIterator]()
    streams.push({ lifetime, iterator })
    const ready = await iterator.next()
    if (ready.done || ready.value.type !== 'ready') throw new Error('Expected terminal readiness')
    const attachmentId = ready.value.attachmentId
    terminals.ack({ attachmentId, sequence: 0 })
    return async (mode: SidebarTerminalReleaseRequest['mode']) => {
      terminals.release({ attachmentId, mode })
      await expect(iterator.next()).resolves.toMatchObject({ done: true })
    }
  }
  return { ctx, cwd, settingsPath, updateShell, connect }
}

function execution(signal = new AbortController().signal): ToolRunContext {
  // Only the initiating session identity and cancellation signal cross into the terminal tool.
  return { signal, agent: { session: { id: 'owned-session' } } } as ToolRunContext
}

describe('terminal preferences through source Loader composition', () => {
  it('persists shell edits for later PTYs, preserves live reconnects, and creates a new process after close', async () => {
    const b = await load()
    const first = await b.connect('terminal:0')
    expect(processes).toHaveLength(1)
    expect(processes[0]).toMatchObject({ file: 'shell-a', args: shellSpawnArgs(['--first', '-i']), cwd: b.cwd })
    await b.updateShell('shell-b', '--second -l')
    expect(await readFile(b.settingsPath, 'utf8')).toContain('terminalShell: shell-b')
    expect(processes[0].kill).not.toHaveBeenCalled()
    await first('disconnect')
    const reconnected = await b.connect('terminal:0')
    expect(processes).toHaveLength(1)
    expect(processes[0].pid).toBe(1)
    await reconnected('close')
    expect(processes[0].kill).toHaveBeenCalledOnce()
    await b.connect('terminal:0')
    expect(processes).toHaveLength(2)
    expect(processes[1]).toMatchObject({ file: 'shell-b', args: shellSpawnArgs(['--second', '-l']), cwd: b.cwd, pid: 2 })
    const settings = b.ctx.get('settings')!
    const current = settings.describe().find(row => row.ns === SIDEBAR_PREFS_NS)!
    await settings.mutate(SIDEBAR_PREFS_NS as SettingsNamespace, [
      { op: 'unset', path: ['terminalShell'] }, { op: 'unset', path: ['terminalShellArgs'] },
    ], current.revision)
    await b.connect('terminal:1')
    expect(processes[2]).toMatchObject({ file: 'deployment-shell', args: shellSpawnArgs(['--base']), cwd: b.cwd })
    expect(await readFile(b.settingsPath, 'utf8')).not.toContain('terminalShell:')
    await b.ctx.fiber.dispose()
    expect(processes.map(process => process.kill.mock.calls.length)).toEqual([1, 1, 1])
    const restarted = await load()
    await restarted.connect('terminal:0')
    expect(processes).toHaveLength(4)
    expect(processes[3]).toMatchObject({ file: 'deployment-shell', cwd: restarted.cwd, pid: 4 })
  })

  it('applies the same durable startup preferences to agent terminals and refuses an aborted creation', async () => {
    const b = await load()
    const create = b.ctx.get('tools')!.get('terminal_create')!
    const aborted = new AbortController()
    aborted.abort()
    await expect(create.execute({ title: 'cancelled', command: '' }, execution(aborted.signal))).rejects.toThrow()
    expect(processes).toHaveLength(0)
    await create.execute({ title: 'first', command: 'echo first' }, execution())
    expect(processes[0]).toMatchObject({ file: 'shell-a', cwd: b.cwd })
    expect(processes[0].write).toHaveBeenCalledWith('echo first\r')
    await b.updateShell('shell-b', '--second')
    await create.execute({ title: 'second', command: '' }, execution())
    expect(processes[1]).toMatchObject({ file: 'shell-b', args: shellSpawnArgs(['--second']), cwd: b.cwd })
    expect(processes[0].kill).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
    expect(processes.map(process => process.kill.mock.calls.length)).toEqual([1, 1])
  })
})
