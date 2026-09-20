/** Opt-in real official resource installation through Loader and Harness subprocess ownership. */
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import MobileRuntime from '../src/index.ts'
import { MobileResourceStore } from '../src/store.ts'
import { catalog } from '../src/catalog.ts'
import type { MobileResourceId } from '../src/types.ts'

it.runIf(process.env.DSH_MOBILE_RESOURCE_SMOKE === '1')('installs verifies and removes both fixed official resources through a real Loader', async () => {
  const path = await mkdtemp(join(tmpdir(), 'dsh-mobile-resource-real-'))
  const ctx = new Context()
  const signal = new AbortController().signal
  const storageDir = join(path, 'runtime')
  try {
    const configPath = join(path, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([{ id: 'subprocess', name: 'cordis:subprocess' }, { id: 'mobile-runtime', name: 'cordis:mobile-runtime',
      config: { storageDir, installTimeoutMs: 60000, downloadProxyUrl: process.env.DSH_MOBILE_DOWNLOAD_PROXY ?? '' } }]))
    ctx.baseUrl = pathToFileURL(path).href + '/'
    await ctx.plugin(Loader)
    const loader = ctx.loader
    loader.builtins.include = Include
    loader.builtins.subprocess = LocalSubprocess
    loader.builtins['mobile-runtime'] = MobileRuntime
    await loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } }); await loader.await()
    const runtime = ctx.mobileRuntime
    const store = new MobileResourceStore(storageDir, 3000)
    for (const id of ['platform-tools', 'scrcpy'] as const satisfies readonly MobileResourceId[]) {
      const before = await store.inspect(catalog[id], signal)
      console.log('Starting official resource install', id)
      const receipt = runtime.start({ resourceId: id, operation: 'install', expectedRevision: before.revision, acceptLicense: true }, signal)
      let observed = await runtime.status(signal)
      while (observed.task?.state === 'running') { await delay(300); observed = await runtime.status(signal) }
      expect(observed.task).toMatchObject({ id: receipt.id, state: 'succeeded' })
      const installed = await store.inspect(catalog[id], signal)
      expect(installed).toMatchObject({ integrity: 'verified', installedVersion: catalog[id].version })
      console.log(JSON.stringify({ resource: id, version: installed.installedVersion, sha256: catalog[id].sha256,
        installed: true, deviceCount: observed.devices.length }))
      const lease = await store.acquire(catalog[id], signal)
      await expect(store.remove(catalog[id], installed.revision, signal)).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_LEASED' })
      await lease.release()
      runtime.start({ resourceId: id, operation: 'remove', expectedRevision: installed.revision, acceptLicense: false }, signal)
      observed = await runtime.status(signal)
      while (observed.task?.state === 'running') { await delay(100); observed = await runtime.status(signal) }
      expect(observed.task?.state).toBe('succeeded')
      expect((await store.inspect(catalog[id], signal)).integrity).toBe('missing')
    }
  } finally { await (ctx.fiber).dispose(); await rm(path, { recursive: true, force: true }) }
}, 180000)
