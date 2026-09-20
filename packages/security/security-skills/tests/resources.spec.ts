/** Real YAML composition and HTTP transactions for installed skill generations. */
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { buildSecuritySkillResource, type ResourceManifest } from '../../../../scripts/build-security-skill-resource.ts'
import * as SecuritySkills from '../src/index.ts'
import SecuritySkillResources from '../src/resources.ts'
import type { SecuritySkillOperationId, SecuritySkillResourceStatus } from '../src/types.ts'

async function dispose(fiber: Fiber): Promise<void> {
  await fiber.dispose()
  while (fiber.inertia !== undefined) await fiber.inertia
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-resources-'))
  let host: Context | undefined
  const siblings = new Set<Context>()
  let manifest: ResourceManifest
  let archive = new Uint8Array()
  let hold = false
  let archiveRequests = 0
  const pending = new Map<ServerResponse, Uint8Array>()
  const server = createServer((request, response) => {
    if (request.url === '/release.json') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(manifest))
    } else if (request.url === '/resource.zip') {
      archiveRequests++
      response.setHeader('content-length', archive.length)
      if (hold) {
        pending.set(response, archive.slice(8))
        response.once('close', () => pending.delete(response))
        response.write(archive.subarray(0, 8))
      } else response.end(archive)
    } else response.writeHead(404).end()
  })
  onTestFinished(async () => {
    try {
      for (const sibling of siblings) await dispose(sibling.fiber)
      if (host !== undefined) await dispose(host.fiber)
    } finally {
      for (const response of pending.keys()) response.destroy()
      if (server.listening) {
        const closed = new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error)
            else resolve()
          })
        })
        server.closeAllConnections()
        await closed
      }
      await rm(root, { recursive: true, force: true })
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture listener address')
  const origin = 'http://127.0.0.1:' + String(address.port)
  const source = join(root, 'source')
  const resources = join(root, 'resources')
  await mkdir(source)
  await writeFile(join(root, 'LICENSE'), 'Fixture license\n')
  await writeFile(join(root, 'NOTICE'), 'Fixture notice\n')
  await writeFile(join(root, 'provenance.json'), JSON.stringify({ license: { name: 'fixture' }, audit: { skillCount: 1 } }))
  async function release(body = 'FIRST_RESOURCE') {
    await writeFile(join(source, 'SKILL.md'), '---\nname: resource-fixture\ndescription: Resource lifecycle fixture\n---\n' + body + '\n')
    await writeFile(join(source, 'reference.md'), body + ' reference\n')
    const built = await buildSecuritySkillResource({
      sourceRoot: source, outputDirectory: join(root, 'release'),
      licensePath: join(root, 'LICENSE'), noticePath: join(root, 'NOTICE'),
      provenancePath: join(root, 'provenance.json'), archiveUrl: origin + '/resource.zip',
    })
    archive = new Uint8Array(await readFile(built.archivePath))
    manifest = built.manifest
    return manifest
  }
  const first = await release()
  const configFile = join(root, 'cordis.yml')
  await writeFile(configFile, [
    '- id: skills',
    '  name: cordis:resource-registry',
    '- id: manager',
    '  name: cordis:resource-manager',
    '  config:',
    '    root: ' + JSON.stringify(resources),
    '    releaseManifestUrl: ' + JSON.stringify(origin + '/release.json'),
    '- id: provider',
    '  name: cordis:resource-provider',
  ].join('\n') + '\n')
  async function startHost() {
    host = await boot('security-resource-test', configFile, [], (context) => {
      host = context
      Object.assign(context.loader.builtins, {
        'resource-registry': SkillRegistry,
        'resource-manager': SecuritySkillResources,
        'resource-provider': SecuritySkills,
      })
    })
    return host
  }
  await startHost()
  function ctx(): Context {
    if (host === undefined) throw new Error('Fixture Host has not started')
    return host
  }
  function manager() { return ctx().get('securitySkillResources')! }
  async function settled(context = ctx()): Promise<SecuritySkillResourceStatus> {
    return new Promise((resolve, reject) => {
      const finish = (snapshot: SecuritySkillResourceStatus) => {
        if (snapshot.operation !== undefined) return
        unlisten()
        resolve(snapshot)
      }
      const unlisten = context.on('security-skill-resources/changed', finish)
      void context.get('securitySkillResources')!.status().then(finish, (error: unknown) => {
        unlisten()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }
  return {
    ctx, manager, resources, first, release, settled,
    archiveRequests: () => archiveRequests,
    pendingRequests: () => pending.size,
    holdArchive() { hold = true },
    allowNewRequests() { hold = false },
    async secondHost() {
      return boot('security-resource-second-host', configFile, [], (context) => {
        siblings.add(context)
        Object.assign(context.loader.builtins, {
          'resource-registry': SkillRegistry,
          'resource-manager': SecuritySkillResources,
          'resource-provider': SecuritySkills,
        })
      })
    },
    releaseArchive() {
      hold = false
      for (const [response, bytes] of pending) response.end(bytes)
      pending.clear()
    },
    corruptArchive(kind: 'bytes' | 'hash') {
      archive = archive.slice()
      if (kind === 'bytes') archive = archive.subarray(0, archive.length - 1)
      else archive[archive.length - 1] = (archive[archive.length - 1] ?? 0) ^ 1
    },
    async restart() {
      await dispose(ctx().fiber)
      host = undefined
      await startHost()
    },
    async providerEnabled(enabled: boolean, context = ctx()) {
      const entry = context.loader.entries().find(entry => entry.options.id === 'provider')
      if (entry === undefined) throw new Error('Fixture provider entry missing')
      await entry.update({ disabled: !enabled })
      await context.loader.await()
    },
    async assertNoStaging() {
      expect((await readdir(resources)).filter(name => name.startsWith('staging-') || name.startsWith('active-'))).toEqual([])
    },
  }
}

describe('security skill resources through YAML Loader', () => {
  it('commits an installation and notifies later listeners when a change subscriber throws', async () => {
    const h = await harness()
    const broken = vi.fn(() => { throw new Error('fixture observer failure') })
    const observed: SecuritySkillResourceStatus[] = []
    h.ctx().on('security-skill-resources/changed', broken)
    h.ctx().on('security-skill-resources/changed', (snapshot) => { observed.push(snapshot) })
    await h.manager().install()
    const installed = await h.settled()
    expect(broken).toHaveBeenCalled()
    expect(installed.installed?.version).toBe(h.first.version)
    expect(installed.lastError).toBeUndefined()
    expect(observed.some(snapshot => snapshot.installed?.generation === installed.installed?.generation
      && snapshot.operation === undefined)).toBe(true)
    const active = JSON.parse(await readFile(join(h.resources, 'active.json'), 'utf8')) as { installed: unknown }
    expect(active.installed).toEqual(installed.installed)
    await vi.waitFor(async () => { expect((await h.ctx().skills.get('resource-fixture'))?.content).toBe('FIRST_RESOURCE') })
  })

  it('preserves another Host commit against a stale download and retains its borrowed generation through removal', async () => {
    const h = await harness()
    await h.providerEnabled(false)
    const second = await h.secondHost()
    await h.providerEnabled(false, second)
    const other = second.get('securitySkillResources')!
    h.holdArchive()
    await h.manager().install()
    await vi.waitFor(async () => { expect((await h.manager().status()).operation?.bytesReceived).toBe(8) })
    const winningRelease = await h.release('WINNING_RESOURCE')
    h.allowNewRequests()
    await other.install()
    const winner = await h.settled(second)
    expect(winner.installed?.version).toBe(winningRelease.version)
    expect(h.pendingRequests()).toBe(1)
    const committed = await readFile(join(h.resources, 'active.json'), 'utf8')
    h.releaseArchive()
    const stale = await h.settled()
    expect(stale.lastError).toBeTruthy()
    expect((await h.manager().status()).installed).toEqual(winner.installed)
    expect(await readFile(join(h.resources, 'active.json'), 'utf8')).toBe(committed)
    await h.assertNoStaging()

    const lease = await other.acquire()
    if (lease === undefined) throw new Error('Winning generation cannot be borrowed')
    const reference = join(lease.directory, 'reference.md')
    try {
      await h.manager().remove()
      expect((await h.settled()).installed).toBeUndefined()
      expect((await other.status()).installed).toBeUndefined()
      expect(await readFile(reference, 'utf8')).toBe('WINNING_RESOURCE reference\n')
      expect(await readdir(join(h.resources, 'generations'))).toContain(lease.installation.generation)
    } finally {
      await lease.release()
    }
    await vi.waitFor(async () => { expect(await readdir(join(h.resources, 'generations'))).not.toContain(lease.installation.generation) })
    await expect(readFile(reference)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a delayed empty-state installation after another Host installs and removes resources', async () => {
    const h = await harness()
    await h.providerEnabled(false)
    const second = await h.secondHost()
    await h.providerEnabled(false, second)
    const other = second.get('securitySkillResources')!
    h.holdArchive()
    await h.manager().install()
    await vi.waitFor(async () => { expect((await h.manager().status()).operation?.bytesReceived).toBe(8) })
    h.allowNewRequests()
    await other.install()
    expect((await h.settled(second)).installed).toBeDefined()
    await other.remove()
    expect((await h.settled(second)).installed).toBeUndefined()
    const tombstone = await readFile(join(h.resources, 'active.json'), 'utf8')
    expect(JSON.parse(tombstone)).toMatchObject({ revision: 2, installed: null })
    h.releaseArchive()
    const stale = await h.settled()
    expect(stale.lastError).toBeTruthy()
    expect(stale.installed).toBeUndefined()
    expect(await readFile(join(h.resources, 'active.json'), 'utf8')).toBe(tombstone)
    await h.assertNoStaging()
  })

  it('recovers catalog registration after one transient provider acquisition failure', async () => {
    const h = await harness()
    await h.manager().install()
    await h.settled()
    await vi.waitFor(async () => { expect(await h.ctx().skills.list()).toHaveLength(1) })
    const acquire = vi.spyOn(h.manager(), 'acquire').mockRejectedValueOnce(new Error('transient resource lock contention'))
    onTestFinished(() => { acquire.mockRestore() })
    const installed = await h.manager().status()
    const withdrawn = { ...installed }
    delete withdrawn.installed
    withdrawn.state = 'not-installed'
    await h.ctx().parallel('security-skill-resources/changed', withdrawn)
      .catch(() => { /* The injected acquisition failure is the first refresh outcome. */ })
    expect(await h.ctx().skills.list()).toEqual([])
    await h.ctx().parallel('security-skill-resources/changed', installed)
    expect((await h.ctx().skills.get('resource-fixture'))?.content).toBe('FIRST_RESOURCE')
    expect(acquire).toHaveBeenCalledTimes(2)
  })

  it('checks, installs, updates and reinstalls downloaded bytes, then restores committed state after restart', async () => {
    const h = await harness()
    expect(await h.manager().status()).toMatchObject({ state: 'not-installed', download: { available: true } })
    expect(await h.ctx().skills.list()).toEqual([])
    const transitions: SecuritySkillResourceStatus[] = []
    h.ctx().on('security-skill-resources/changed', (snapshot) => { transitions.push(snapshot) })
    const check = await h.manager().checkUpdate()
    expect(check.operation?.kind).toBe('check-update')
    expect(await h.settled()).toMatchObject({ state: 'not-installed', available: { version: h.first.version } })
    expect(h.archiveRequests()).toBe(0)

    const started = await h.manager().install()
    expect(started.operation?.kind).toBe('install')
    const installed = await h.settled()
    expect(installed).toMatchObject({ state: 'installed', installed: { version: h.first.version, source: { kind: 'download' }, skillCount: 1 } })
    expect(installed.lastError).toBeUndefined()
    await vi.waitFor(async () => { expect((await h.ctx().skills.get('resource-fixture'))?.content).toBe('FIRST_RESOURCE') })
    expect(transitions.some(snapshot => snapshot.operation?.id === started.operation?.id
      && snapshot.operation?.bytesReceived === h.first.archive.bytes)).toBe(true)
    expect(transitions.at(-1)?.installed).toEqual(installed.installed)
    expect(started.installed).toBeUndefined()

    await h.manager().update()
    expect((await h.settled()).installed).toEqual(installed.installed)
    expect(h.archiveRequests()).toBe(1)
    const next = await h.release('SECOND_RESOURCE')
    await h.manager().update()
    const updated = await h.settled()
    expect(updated.installed?.version).toBe(next.version)
    expect(updated.installed?.generation).not.toBe(installed.installed?.generation)
    await h.manager().reinstall()
    const reinstalled = await h.settled()
    expect(reinstalled.installed?.version).toBe(next.version)
    expect(reinstalled.installed?.generation).not.toBe(updated.installed?.generation)
    expect(h.archiveRequests()).toBe(3)
    const durable = JSON.parse(await readFile(join(h.resources, 'active.json'), 'utf8')) as { installed: unknown }
    expect(durable.installed).toEqual(reinstalled.installed)
    await h.restart()
    expect((await h.manager().status()).installed).toEqual(reinstalled.installed)
    expect((await h.ctx().skills.get('resource-fixture'))?.content).toBe('SECOND_RESOURCE')
    expect(h.archiveRequests()).toBe(3)
    await h.assertNoStaging()
  })

  it.each(['bytes', 'hash'] as const)('retains the prior generation and catalog after a failed archive %s check', async (kind) => {
    const h = await harness()
    await h.manager().install()
    const installed = await h.settled()
    const active = await readFile(join(h.resources, 'active.json'), 'utf8')
    await vi.waitFor(async () => { expect((await h.ctx().skills.get('resource-fixture'))?.content).toBe('FIRST_RESOURCE') })
    await h.release('REJECTED_RESOURCE')
    h.corruptArchive(kind)
    await h.manager().update()
    const failed = await h.settled()
    expect(failed.installed).toEqual(installed.installed)
    expect(failed.state).toBe('installed')
    expect(failed.lastError).toBeTruthy()
    expect(await readFile(join(h.resources, 'active.json'), 'utf8')).toBe(active)
    await vi.waitFor(async () => { expect((await h.ctx().skills.get('resource-fixture'))?.content).toBe('FIRST_RESOURCE') })
    await h.assertNoStaging()
  })

  it('invalidates listed skills on removal and keeps the empty state across restart', async () => {
    const h = await harness()
    await h.manager().install()
    const installed = await h.settled()
    await vi.waitFor(async () => { expect((await h.ctx().skills.list()).map(skill => skill.name)).toEqual(['resource-fixture']) })
    const generation = join(h.resources, 'generations', installed.installed!.generation)
    await h.manager().remove()
    expect(await h.settled()).toMatchObject({ state: 'not-installed' })
    await vi.waitFor(async () => { expect(await h.ctx().skills.list()).toEqual([]) })
    expect(await h.ctx().skills.get('resource-fixture')).toBeUndefined()
    await vi.waitFor(async () => { expect(await readdir(join(h.resources, 'generations'))).not.toContain(installed.installed!.generation) })
    await expect(readFile(join(generation, 'skills', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await h.restart()
    expect((await h.manager().status()).installed).toBeUndefined()
    expect(await h.ctx().skills.list()).toEqual([])
    await h.assertNoStaging()
  })

  it('retains loaded relative resources through provider HMR and removal until the owning scope is disposed', async () => {
    const h = await harness()
    await h.providerEnabled(false)
    const scope = createScope(h.ctx(), {})
    onTestFinished(() => scope.dispose())
    const provider = scope.ctx.plugin(SecuritySkills)
    await provider
    await h.manager().install()
    const installed = await h.settled()
    const view = { scope: scopeOf(scope.ctx) }
    await vi.waitFor(async () => { expect((await h.ctx().skills.list(view)).map(skill => skill.name)).toEqual(['resource-fixture']) })
    const loaded = await h.ctx().skills.get('resource-fixture', view)
    expect(loaded?.content).toBe('FIRST_RESOURCE')
    if (loaded?.resourceBase?.kind !== 'directory') throw new Error('Loaded skill has no directory base')
    const reference = join(loaded.resourceBase.path, 'reference.md')
    await dispose(provider)
    expect(await h.ctx().skills.list(view)).toEqual([])
    await scope.ctx.plugin(SecuritySkills)
    await h.release('SECOND_RESOURCE')
    await h.manager().update()
    const updated = await h.settled()
    expect(updated.installed?.generation).not.toBe(installed.installed?.generation)
    await vi.waitFor(async () => { expect((await h.ctx().skills.get('resource-fixture', view))?.content).toBe('SECOND_RESOURCE') })
    expect(await readFile(reference, 'utf8')).toBe('FIRST_RESOURCE reference\n')
    await h.manager().remove()
    await h.settled()
    await vi.waitFor(async () => { expect(await h.ctx().skills.list(view)).toEqual([]) })
    expect(await readFile(reference, 'utf8')).toBe('FIRST_RESOURCE reference\n')
    await scope.dispose()
    await vi.waitFor(async () => { expect(await readdir(join(h.resources, 'generations'))).toEqual([]) })
    await expect(readFile(reference)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('aborts a held download when its Host stops and restores only the prior committed generation', async () => {
    const h = await harness()
    await h.manager().install()
    const installed = await h.settled()
    const active = await readFile(join(h.resources, 'active.json'), 'utf8')
    await h.release('UNCOMMITTED_RESOURCE')
    h.holdArchive()
    const oldManager = h.manager()
    await oldManager.update()
    await vi.waitFor(async () => { expect((await oldManager.status()).operation?.bytesReceived).toBe(8) })
    await h.restart()
    await vi.waitFor(() => { expect(h.pendingRequests()).toBe(0) })
    expect((await h.manager().status()).installed).toEqual(installed.installed)
    expect(await readFile(join(h.resources, 'active.json'), 'utf8')).toBe(active)
    expect((await h.ctx().skills.get('resource-fixture'))?.content).toBe('FIRST_RESOURCE')
    await expect(oldManager.install()).rejects.toMatchObject({ code: 'disposed' })
    await h.assertNoStaging()
  })

  it('keeps downloads Host-owned after caller disposal and cancels only the matching operation', async () => {
    const h = await harness()
    await h.manager().install()
    const installed = await h.settled()
    await h.release('SECOND_RESOURCE')
    h.holdArchive()
    const caller = createScope(h.ctx(), {})
    onTestFinished(() => caller.dispose())
    const operation = await caller.ctx.get('securitySkillResources')!.update()
    await vi.waitFor(async () => { expect((await h.manager().status()).operation?.bytesReceived).toBe(8) })
    expect(h.pendingRequests()).toBe(1)
    await caller.dispose()
    expect((await h.manager().status()).operation?.id).toBe(operation.operation?.id)
    await expect(h.manager().remove()).rejects.toMatchObject({ code: 'busy' })
    await expect(h.manager().cancel('stale-operation' as SecuritySkillOperationId)).rejects.toMatchObject({ code: 'stale-operation' })
    const cancelled = await h.manager().cancel(operation.operation!.id)
    expect(cancelled.operation).toBeUndefined()
    expect(cancelled.installed).toEqual(installed.installed)
    expect(cancelled.lastError).toBeUndefined()
    await vi.waitFor(() => { expect(h.pendingRequests()).toBe(0) })
    await h.assertNoStaging()
    const replacement = await h.manager().update()
    await vi.waitFor(async () => { expect((await h.manager().status()).operation?.bytesReceived).toBe(8) })
    await expect(h.manager().cancel(operation.operation!.id)).rejects.toMatchObject({ code: 'stale-operation' })
    expect((await h.manager().status()).operation?.id).toBe(replacement.operation?.id)
    h.releaseArchive()
    expect((await h.settled()).installed?.version).not.toBe(installed.installed?.version)
  })
})
