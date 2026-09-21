/** Two remote peers exercise actual Loader, binding, filesystem, subprocess and consumer owners. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { WorkspaceFiles } from '@deepseek-ai/dsh-api-workspace-files'
import { createTrustedConnectionAccess } from '@deepseek-ai/dsh-client-connection'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import ExecutionBindings from '@deepseek-ai/dsh-execution-binding'
import ExecutionHostLocal from '@deepseek-ai/dsh-execution-host-local'
import Targets from '@deepseek-ai/dsh-execution-host-targets'
import LocalFs from '@deepseek-ai/dsh-fs-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import Settings from '@deepseek-ai/dsh-settings-file'
import SidebarGit from '@deepseek-ai/dsh-sidebar-git'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Sidebar from '../src/index.ts'
import { remoteFileWorld } from './remote-file-peer.ts'

vi.mock('@deepseek-ai/dsh-ssh', async () => {
  const { FilePeer } = await import('./remote-file-peer.ts')
  return { default: FilePeer, SshConnection: FilePeer }
})

class FileEndpoint extends WorkspaceFiles { static override inject = ['executionBindings'] }

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sidebar-worlds-'))
  const localRoot = join(root, 'local')
  const ctx = new Context()
  const unregister: (() => void)[] = []
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally {
      for (const dispose of unregister) dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
  await mkdir(localRoot)
  await writeFile(join(localRoot, 'shared.txt'), 'local')
  const modules = new Map<string, unknown>([
    ['storage', Storage], ['storage-json', StorageJson], ['storage-domain', StorageDomain],
    ['fs-local', LocalFs], ['subprocess-local', LocalSubprocess], ['execution-host-local', ExecutionHostLocal],
    ['execution-host-targets', Targets], ['session', SessionStore], ['session-projection', SessionProjections],
    ['session-query-sqlite', SessionQuery], ['system-prompt', SystemPrompt], ['tools', ToolRuntime],
    ['execution-binding', ExecutionBindings],
  ])
  const rows = [
    { name: 'storage' }, { name: 'storage-json', config: { root: join(root, 'storage') } },
    { name: 'storage-domain', config: { backend: 'json' } },
    { name: 'fs-local', config: { cwd: localRoot } }, { name: 'subprocess-local' },
    { name: 'execution-host-local' }, { name: 'execution-host-targets' }, { name: 'session' },
    { name: 'session-projection' }, { name: 'session-query-sqlite', config: { path: ':memory:', openAt: 'never' } },
    { name: 'system-prompt', config: { personaPrefix: 'Sidebar execution fixture.' } }, { name: 'tools' },
    { name: 'execution-binding', config: { sandboxMode: 'workspace-write' } },
  ]
  const file = join(root, 'cordis.yml')
  await writeFile(file, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected Sidebar execution fixture import: ' + specifier)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  return {
    ctx, root, localRoot,
    async remote(label: string) {
      const fixture = remoteFileWorld(label)
      unregister.push(fixture.unregister)
      const { target } = await ctx.executionHostTargets.create({
        label, sshAlias: 'inspection', execution: {
          endpoint: { host: fixture.world.host, port: 22, username: 'fixture',
            privateKeyFile: join(root, 'unused-key'), hostKeySHA256: 'a'.repeat(64) },
          node: '/usr/bin/node', helper: '/opt/helper.mjs', helperHash: 'b'.repeat(64), workspace: '/project',
          bootstrapPath: '/opt/bootstrap.mjs', bootstrapHash: 'c'.repeat(64),
        },
      })
      const binding = ctx.executionHostTargets.snapshotExecution({ id: target.id, revision: target.revision })
      return { world: fixture.world, target, binding }
    },
  }
}

async function fixture() {
  const h = await createHarness()
  const entries = [
    { name: 'consumer-credentials', module: Credentials, config: { path: join(h.root, 'credentials.yml'), watch: false } },
    { name: 'consumer-connection', module: Connection },
    { name: 'consumer-settings', module: Settings, config: { path: join(h.root, 'settings.yml'), watch: false } },
    { name: 'consumer-git', module: SidebarGit },
    { name: 'consumer-files', module: FileEndpoint },
    { name: 'consumer-sidebar', module: Sidebar, config: { agentTerminalTools: false } },
  ]
  const resolver = h.ctx.loader.internal!
  const original = resolver.import.bind(resolver) as unknown as (name: string) => Promise<unknown>
  resolver.import = async (name: string): Promise<unknown> => {
    const module: unknown = entries.find(entry => entry.name === name)?.module ?? await original(name)
    return module
  }
  for (const { module: _module, ...entry } of entries) await h.ctx.loader.create(entry)
  await h.ctx.loader.await()
  const left = await h.remote('left')
  const right = await h.remote('right')
  const session = (name: string, binding: typeof left.binding) => {
    const value = h.ctx.sessions.prepare(SessionId(name), { meta: { cwd: '/project' } })
    value.append('execution/bound', { binding })
    h.ctx.effect(() => h.ctx.sessions.enter(value))
    return value
  }
  const a = session('left-files', left.binding)
  const b = session('right-files', right.binding)
  const fetch = h.ctx.connection.createSharedFetchHandler('/api', createTrustedConnectionAccess())
  const call = async (method: string, payload: unknown) => {
    const response = await fetch.fetch(new Request('http://localhost/api/sidebar.api?method=' + method, { method: 'POST', body: JSON.stringify(payload) }))
    return { response, body: await response.json() as { ok: boolean; value?: Record<string, unknown>; error?: unknown } }
  }
  return { ...h, left, right, a, b, fetch, call }
}

describe('file and Git execution worlds through Loader', () => {
  it('keeps identical POSIX file names in their owning Session across reads edits search previews and byte windows', async () => {
    const h = await fixture()
    for (const [session, label] of [[h.a, 'left'], [h.b, 'right']] as const) {
      const scope = { sessionId: session.id, path: '/project/shared.txt' }
      expect((await h.call('fs.read', scope)).body).toMatchObject({ ok: true, value: { content: label } })
      expect((await h.call('fs.tree', { sessionId: session.id })).body).toMatchObject({ ok: true, value: { path: '/project', entries: [{ name: 'shared.txt' }] } })
      expect((await h.call('fs.search', { sessionId: session.id, query: 'shared' })).body).toMatchObject({ ok: true, value: { matches: ['shared.txt'] } })
      const media = await h.fetch.fetch(new Request('http://localhost/api/sidebar.file?' + new URLSearchParams(scope).toString()))
      expect(media.status).toBe(200)
      expect(await media.text()).toBe(label)
      const agent = { session } as Agent
      const bytes = await h.ctx.workspaceFiles.readBytes(agent, 'shared.txt', { offset: 0, length: 2 }, new AbortController().signal)
      expect(Buffer.from(bytes.data, 'base64').toString()).toBe(label.slice(0, 2))
      expect((await h.ctx.workspaceFiles.read(agent, 'shared.txt', {}, new AbortController().signal)).text).toBe(label)
    }
    expect((await h.call('fs.write', { sessionId: h.a.id, path: '/project/shared.txt', content: 'edited left' })).body.ok).toBe(true)
    expect(h.left.world.files.get('/project/shared.txt')).toBe('edited left')
    expect(h.right.world.files.get('/project/shared.txt')).toBe('right')
    expect(await readFile(join(h.localRoot, 'shared.txt'), 'utf8')).toBe('local')
    expect(h.left.world.disposed).toBe(h.left.world.connections.length)
    expect(h.right.world.disposed).toBe(h.right.world.connections.length)
  })

  it('runs repository discovery status and mutations in the selected subprocess world', async () => {
    const h = await fixture()
    for (const [session, label] of [[h.a, 'left'], [h.b, 'right']] as const) {
      const status = await h.ctx.sidebarGit.status({ sessionId: session.id })
      expect(status.repository?.root).toBe('/project')
      expect(status.entries.map(entry => entry.path)).toContain(label + '.txt')
    }
    const beforeReconnect = await h.ctx.sidebarGit.status({ sessionId: h.a.id })
    const afterReconnect = await h.ctx.sidebarGit.status({ sessionId: h.a.id })
    expect(afterReconnect.repository?.indexFingerprint).toBe(beforeReconnect.repository?.indexFingerprint)
    await h.ctx.sidebarGit.stage({ sessionId: h.a.id, repositoryRoot: '/project', path: 'shared.txt' })
    expect(h.left.world.commands.some(argv => argv.includes('add'))).toBe(true)
    expect(h.right.world.commands.some(argv => argv.includes('add'))).toBe(false)
    expect(h.left.world.requests.filter(request => request.method === 'process.prepare').every(request =>
      (request.params as { cwd: string }).cwd === '/project')).toBe(true)
    expect(h.left.world.disposed).toBe(h.left.world.connections.length)
  })

  it('filters same-path observations by Session and releases suspended change generations on cancellation', async () => {
    const h = await fixture()
    const controller = new AbortController()
    const iterator = h.ctx.workspaceFiles.changes({ session: h.a } as Agent, controller.signal)[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: { kind: 'ready' } })
    const lease = await h.ctx.executionBindings.forSession(h.a.id)
    try {
      const fs = lease.ctx.get('fs')!
      const target = await fs.resolve('/project/shared.txt')
      const pending = iterator.next()
      h.ctx.emit('fs/observed', target, { kind: 'present', version: 'wrong' as never }, { agent: { session: h.b } })
      h.ctx.emit('fs/observed', target, { kind: 'present', version: 'right' as never }, { agent: { session: h.a } })
      expect(await pending).toEqual({ done: false, value: { kind: 'change', change: { absolutePath: '/project/shared.txt', version: 'right' } } })
    } finally { await lease.release(); controller.abort() }
    await iterator.return?.()
    expect(h.left.world.disposed).toBe(h.left.world.connections.length)
  })

  it('confines remote reads and writes to the Session directory without touching an outside target', async () => {
    const h = await fixture()
    h.right.world.files.set('/outside/secret.txt', 'remote secret')

    const read = await h.call('fs.read', { sessionId: h.b.id, path: '/outside/secret.txt' })
    const write = await h.call('fs.write', { sessionId: h.b.id, path: '/outside/secret.txt', content: 'replaced' })

    expect(read.response.status).toBe(403)
    expect(read.body).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(write.response.status).toBe(403)
    expect(write.body).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(h.right.world.files.get('/outside/secret.txt')).toBe('remote secret')
    expect(await readFile(join(h.localRoot, 'shared.txt'), 'utf8')).toBe('local')
    expect(h.right.world.disposed).toBe(h.right.world.connections.length)
  })

  it('rejects lost leases and unsupported remote native opening or upload without Host fallback', async () => {
    const h = await fixture()
    const retained = await h.ctx.executionBindings.forSession(h.a.id)
    try {
      h.left.world.connections.at(-1)!.drop()
      expect((await h.call('fs.read', { sessionId: h.a.id, path: '/project/shared.txt' })).body.ok).toBe(false)
      await expect(h.ctx.sidebarGit.status({ sessionId: h.a.id })).rejects.toThrow('connection lost')
      expect(h.left.world.connections).toHaveLength(1)
      expect((await h.call('open.external', { sessionId: h.b.id, action: 'reveal', path: '/project/shared.txt' })).response.status).toBe(501)
      const upload = await h.fetch.fetch(new Request('http://localhost/api/sidebar.upload?' + new URLSearchParams({ sessionId: h.b.id, dir: '/project', relativePath: 'shared.txt' }).toString(), { method: 'POST', body: 'no replacement' }))
      expect(upload.status).toBe(501)
      expect(h.right.world.files.get('/project/shared.txt')).toBe('right')
      expect(await readFile(join(h.localRoot, 'shared.txt'), 'utf8')).toBe('local')
    } finally { await retained.release() }
  })
})
