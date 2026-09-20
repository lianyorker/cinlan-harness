/** Isolated HTTP releases and Loader-composed real resource management. */
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, expect, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SecuritySkills from '@deepseek-ai/dsh-security-skills'
import SecuritySkillResources from '@deepseek-ai/dsh-security-skills/resources'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { buildSecuritySkillResource, type ResourceManifest } from '../../../../scripts/build-security-skill-resource.ts'
import SecurityResearchController from '../src/index.ts'
import type { SecuritySkillResourceStatus } from '../src/types.ts'

/**
 * Compose the actual manager, registry, provider and Remote services around a controlled ZIP server.
 * @param configured - Whether this deployment supplies a release manifest URL.
 * @returns The real Host plus externally controlled response barriers and release bytes.
 */
export async function resourceHarness(configured = true) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-resource-bff-'))
  let ctx: Context | undefined
  let manifest: ResourceManifest | undefined
  let zip = new Uint8Array()
  let hold = false
  const pending = new Map<ServerResponse, Uint8Array>()
  let archiveRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/release.json') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(manifest))
      return
    }
    if (request.url === '/resource.zip') {
      archiveRequests++
      response.setHeader('content-length', zip.length)
      response.setHeader('content-type', 'application/zip')
      if (hold) {
        response.write(zip.subarray(0, 8))
        pending.set(response, zip.slice(8))
        response.once('close', () => { pending.delete(response) })
      } else response.end(zip)
      return
    }
    response.writeHead(404).end()
  })
  onTestFinished(async () => {
    try {
      if (ctx !== undefined) {
        await ctx.fiber.dispose()
        while (ctx.fiber.inertia !== undefined) await ctx.fiber.inertia
      }
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
  if (address === null || typeof address === 'string') throw new Error('Fixture HTTP server has no TCP address')
  const origin = `http://127.0.0.1:${address.port}`
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(root, 'LICENSE'), 'Fixture license\n')
  await writeFile(join(root, 'NOTICE'), 'Fixture notice\n')
  await writeFile(join(root, 'provenance.json'), JSON.stringify({ license: { name: 'fixture' }, audit: { skillCount: 1 } }))
  async function release(body = 'FIRST_RESOURCE'): Promise<ResourceManifest> {
    await writeFile(join(source, 'SKILL.md'), '---\nname: resource-fixture\ndescription: Controlled integration resource\n---\n' + body + '\n')
    const built = await buildSecuritySkillResource({
      sourceRoot: source, outputDirectory: join(root, 'release'), licensePath: join(root, 'LICENSE'),
      noticePath: join(root, 'NOTICE'), provenancePath: join(root, 'provenance.json'), archiveUrl: origin + '/resource.zip',
    })
    zip = new Uint8Array(await readFile(built.archivePath))
    manifest = built.manifest
    return manifest
  }
  await release()
  const configFile = join(root, 'cordis.yml')
  const resources = join(root, 'resources')
  const rows = [
    { id: 'skills', name: 'cordis:resource-registry' },
    { id: 'manager', name: 'cordis:resource-manager', config: { root: resources,
      ...(configured ? { releaseManifestUrl: origin + '/release.json' } : {}) } },
    { id: 'provider', name: 'cordis:resource-provider' },
    { id: 'typert', name: 'cordis:resource-typert' },
    { id: 'gateway', name: 'cordis:resource-gateway' },
    { id: 'controller', name: 'cordis:resource-controller' },
  ]
  await writeFile(configFile, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  ctx = await boot('resource-remote-fixture', configFile, [], (context) => {
    ctx = context
    Object.assign(context.loader.builtins, {
      'resource-registry': SkillRegistry, 'resource-manager': SecuritySkillResources, 'resource-provider': SecuritySkills,
      'resource-typert': TypertRegistry, 'resource-gateway': TypertGateway, 'resource-controller': SecurityResearchController,
    })
  })
  const host = ctx
  const call = (method: string, request?: unknown, signal?: AbortSignal) => host.typertGateway.invoke({
    namespace: 'securityResearch', method, args: request === undefined ? {} : { request },
    ...(signal === undefined ? {} : { signal }),
  }) as Promise<SecuritySkillResourceStatus>
  return {
    ctx: host, root, resources, call, release,
    holdArchive(): void { hold = true },
    releaseArchive(): void {
      hold = false
      for (const [response, bytes] of pending) response.end(bytes)
      pending.clear()
    },
    corruptArchive(): void { zip = zip.slice(); zip[zip.length - 1] = (zip[zip.length - 1] ?? 0) ^ 1 },
    archiveRequests: () => archiveRequests,
    pendingRequests: () => pending.size,
    async settled(timeout = 1000): Promise<SecuritySkillResourceStatus> {
      let status: SecuritySkillResourceStatus | undefined
      await vi.waitFor(async () => { status = await call('describeResources'); expect(status.operation).toBeUndefined() }, { timeout })
      return status!
    },
    async assertNoStaging(): Promise<void> {
      expect((await readdir(resources)).filter(name => name.startsWith('staging-') || name.startsWith('active-'))).toEqual([])
    },
    async enabled(id: string, enabled: boolean): Promise<void> {
      const entry = host.loader.entries().find(row => row.options.id === id)
      if (entry === undefined) throw new Error('Missing fixture entry: ' + id)
      await entry.update({ disabled: !enabled })
      await host.loader.await()
    },
  }
}
