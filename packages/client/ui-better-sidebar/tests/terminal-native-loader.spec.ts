/** Native shells behind the same source Loader, settings, and Remote controller used by Desktop. */
import { mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { load as loadYaml } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import SidebarTerminalController from '@deepseek-ai/dsh-api-sidebar-terminal-controller'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SidebarTerminalFrame, SidebarTerminalOpenRequest, SidebarTerminalReleaseRequest, SidebarTerminalSessionId, SidebarTerminalTabId } from '@deepseek-ai/dsh-sidebar-terminals/types'
import * as sidebar from '../src/index.ts'
import { SIDEBAR_PREFS_NS } from '../src/prefs-shared.ts'

const uiTarget = { sessionId: 'native-session' as SidebarTerminalSessionId, tabId: 'terminal:0' as SidebarTerminalTabId }
const target = { kind: 'ui' as const, ...uiTarget }

async function load() {
  const root = await mkdtemp(join(tmpdir(), 'dsh native terminal '))
  const ctx = new Context()
  const streams: {
    lifetime: AbortController
    iterator: AsyncIterator<SidebarTerminalFrame>
    drained?: Promise<void>
    failure?: unknown
  }[] = []
  const links: string[] = []
  onTestFinished(async () => {
    try {
      for (const stream of streams) stream.lifetime.abort()
      await ctx.fiber.dispose()
      await Promise.all(streams.map(async (stream) => {
        await stream.drained
        await stream.iterator.return?.()
        if (stream.failure !== undefined) throw stream.failure
      }))
    } finally {
      for (const link of links) await unlink(link)
      await rm(root, { recursive: true, force: true })
    }
  })
  const shellExecutable = process.platform === 'win32'
    ? join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : '/bin/sh'
  const settingsPath = join(root, 'settings.yaml')
  await writeFile(settingsPath, 'dsh-better-sidebar:\n  terminalShell: ""\n  terminalShellArgs: ""\n')
  const rows = [
    { name: 'test-native-session' },
    { name: '@deepseek-ai/dsh-settings-file', config: { path: settingsPath } },
    { name: '@deepseek-ai/dsh-system-prompt' },
    { name: '@deepseek-ai/dsh-tools' },
    { name: '@deepseek-ai/dsh-client-ui-better-sidebar', config: {
      shell: shellExecutable, shellArgs: process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['-s'],
    } },
    { name: '@deepseek-ai/dsh-credentials-local', config: { path: join(root, 'credentials.yaml'), watch: false } },
    { name: '@deepseek-ai/dsh-client-connection' },
    { name: '@deepseek-ai/dsh-typert-registry' },
    { name: '@deepseek-ai/dsh-api-gateway' },
    { name: '@deepseek-ai/dsh-api-sidebar-terminal-controller' },
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const sessions = { apply(scope: Context) {
    // Session identity is an external input; native processes and all terminal services stay real.
    scope.provide('sessions', { get: (id: string) => id === target.sessionId ? { header: { cwd: root } } : undefined } as never)
  } }
  const modules = new Map<string, unknown>([
    ['test-native-session', sessions], ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt], ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-client-ui-better-sidebar', sidebar],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials], ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry], ['@deepseek-ai/dsh-api-gateway', Gateway],
    ['@deepseek-ai/dsh-api-sidebar-terminal-controller', SidebarTerminalController],
  ])
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected Loader module: ' + specifier)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect(ctx.get('webServer')).toBeUndefined()
  const shared = ctx.connection.createSharedFetchHandler('/api')
  let rpcId = 0
  const call = async (method: string, request?: unknown) => {
    const response = await shared.fetch(new Request('dsh-app://app/api/sidebarTerminals/' + method, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: String(++rpcId), method: 'sidebarTerminals/' + method,
        payload: { args: request === undefined ? {} : { request } } }),
    }))
    expect(response.status).toBe(200)
    const envelope = await response.json() as { result: { ok: boolean; value?: unknown } }
    expect(envelope.result).toMatchObject({ ok: true })
    return envelope.result.value
  }
  return {
    ctx, root, settingsPath, call,
    async explicitShell() {
      const directory = join(root, 'shell with spaces')
      await symlink(dirname(shellExecutable), directory, process.platform === 'win32' ? 'junction' : 'dir')
      links.push(directory)
      return join(directory, basename(shellExecutable))
    },
    async updateShell(shell: string, args = '') {
      const settings = ctx.settings
      const current = settings.describe().find(row => row.ns === SIDEBAR_PREFS_NS)!
      await settings.mutate(SIDEBAR_PREFS_NS as SettingsNamespace, [
        { op: 'set', path: ['terminalShell'], value: shell },
        { op: 'set', path: ['terminalShellArgs'], value: args },
      ], current.revision)
    },
    async attach() {
      const lifetime = new AbortController()
      const request: SidebarTerminalOpenRequest = { target, cols: 120, rows: 24 }
      const source = await ctx.typertGateway.wireStream.open('sidebarTerminals/open', { args: { request } }, lifetime.signal)
      const iterator = (source as AsyncIterable<SidebarTerminalFrame>)[Symbol.asyncIterator]()
      const stream: typeof streams[number] = { lifetime, iterator }
      streams.push(stream)
      const first = await iterator.next()
      if (first.done || first.value.type !== 'ready') throw new Error('Expected native terminal readiness')
      const ready = first.value
      const output: string[] = []
      const observers = new Set<() => void>()
      let finished = false
      await call('ack', { attachmentId: ready.attachmentId, sequence: 0 })
      stream.drained = (async () => {
        try {
          while (true) {
            const frame = await iterator.next()
            if (frame.done) return
            if (frame.value.type === 'data') {
              output.push(frame.value.data)
              for (const observer of observers) observer()
              await call('ack', { attachmentId: ready.attachmentId, sequence: frame.value.sequence })
            }
          }
        } catch (error) {
          if (!lifetime.signal.aborted) stream.failure = error
        } finally {
          finished = true
          for (const observer of observers) observer()
        }
      })()
      return {
        ready,
        async waitForText(text: string) {
          await new Promise<void>((resolve, reject) => {
            const observe = (): void => {
              if (stream.failure !== undefined || finished) {
                observers.delete(observe)
                reject(stream.failure ?? new Error('Terminal exited before expected output: ' + text))
              } else if (output.join('').includes(text)) {
                observers.delete(observe)
                resolve()
              }
            }
            observers.add(observe)
            observe()
          })
        },
        input: (data: string) => call('input', { attachmentId: ready.attachmentId, data }),
        async release(mode: SidebarTerminalReleaseRequest['mode']) {
          await call('release', { attachmentId: ready.attachmentId, mode })
          await stream.drained
          if (stream.failure !== undefined) throw stream.failure
        },
      }
    },
  }
}

type Harness = Awaited<ReturnType<typeof load>>
type Attachment = Awaited<ReturnType<Harness['attach']>>

async function observeShell(h: Harness, attachment: Attachment, name: string): Promise<number> {
  const path = join(h.root, name)
  const quoted = "'" + path.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''") + "'"
  const command = process.platform === 'win32'
    ? '[IO.File]::WriteAllText(' + quoted + ', [string]$PID + [char]10 + (Get-Location).Path); Write-Output (\'dsh-native-\' + \'' + name + '\')\r'
    : 'printf \'%s\\n%s\' "$$" "$PWD" > ' + quoted + '; printf \'%s%s\\n\' \'dsh-native-\' \'' + name + '\'\r'
  await attachment.input(command)
  await attachment.waitForText('dsh-native-' + name)
  const [pid, cwd] = (await readFile(path, 'utf8')).split('\n')
  expect(await realpath(cwd!)).toBe(await realpath(h.root))
  expect(Number(pid)).toBeGreaterThan(0)
  return Number(pid)
}

describe('native sidebar terminals through Remote', () => {
  it('opens empty preferences, shares and parks a native process, and awaits exit on shutdown', async () => {
    const h = await load()
    expect(await h.call('capability')).toMatchObject({ status: 'available' })
    const first = await h.attach()
    const pid = await observeShell(h, first, 'first.txt')
    const second = await h.attach()
    expect(second.ready.processId).toBe(first.ready.processId)
    expect(second.ready.attachmentId).not.toBe(first.ready.attachmentId)
    await first.release('disconnect')
    expect(await observeShell(h, second, 'second.txt')).toBe(pid)
    await second.release('park')
    await h.updateShell('   ')
    const reconnected = await h.attach()
    expect(reconnected.ready.processId).toBe(first.ready.processId)
    expect(await observeShell(h, reconnected, 'reconnected.txt')).toBe(pid)
    await reconnected.release('park')
    await h.ctx.fiber.dispose()
    expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
  })

  it('recovers the same tab after an invalid executable and accepts an absolute path with spaces', async () => {
    const h = await load()
    await h.updateShell(join(h.root, 'missing shell executable'))
    await expect(h.attach()).rejects.toMatchObject({ code: 'sidebarTerminals/operation-failed' })
    expect(await h.call('inspectUi', uiTarget)).toBeNull()
    const executable = await h.explicitShell()
    await h.updateShell(executable, process.platform === 'win32' ? '-NoLogo -NoProfile' : '')
    const valid = await h.attach()
    const pid = await observeShell(h, valid, 'recovered.txt')
    expect(loadYaml(await readFile(h.settingsPath, 'utf8'))).toMatchObject({
      [SIDEBAR_PREFS_NS]: { terminalShell: executable },
    })
    await valid.release('close')
    expect(await h.call('inspectUi', uiTarget)).toBeNull()
    await h.updateShell('')
    const defaulted = await h.attach()
    expect(defaulted.ready.processId).not.toBe(valid.ready.processId)
    const defaultPid = await observeShell(h, defaulted, 'defaulted.txt')
    await defaulted.release('park')
    await h.ctx.fiber.dispose()
    expect(() => process.kill(defaultPid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
    expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
  })
})
