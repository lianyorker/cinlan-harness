/** Opt-in real ADB binary discovery; never selects, observes, or mutates a connected device. */
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import FileSettings from '@deepseek-ai/dsh-settings-file'
import MobileDevice from '@deepseek-ai/dsh-mobile-device'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import * as NativeAdb from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'
import { AdbRunner } from '../src/runner.ts'

it.runIf(!!process.env.DSH_NATIVE_ADB_SMOKE)('reads real adb version and inventory through Harness with no device interactions', async () => {
  const command = process.env.DSH_NATIVE_ADB_SMOKE ?? ''
  const path = await mkdtemp(join(tmpdir(), 'dsh-real-adb-'))
  const ctx = new Context()
  try {
    const settingsPath = join(path, 'settings.json')
    await writeFile(settingsPath, JSON.stringify({ 'mobile-device': { enabled: true, androidSdkPath: command } }))
    const configPath = join(path, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([
      { name: 'subprocess' }, { name: 'settings', config: { path: settingsPath, watch: false } },
      { name: 'mobile', config: { provider: 'adb' } }, { name: 'native', config: { providerId: 'adb', cwd: path } },
    ]))
    const modules = new Map<string, unknown>([['subprocess', LocalSubprocess], ['settings', FileSettings], ['mobile', MobileDevice], ['native', NativeAdb]])
    ctx.baseUrl = pathToFileURL(path).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    // This test map supplies imports only, not the production module registry caches.
    ctx.loader.internal = { version: 'v2', async import(name: string) { return modules.get(name) } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const runner = new AdbRunner(ctx, resolveConfig({ command, cwd: path }), () => '')
    try {
      const version = (await runner.run(['version'], undefined, 16_384)).toString('utf8').trim()
      expect(version).toMatch(/Android Debug Bridge version/)
      const devices = await ctx.mobileDevice.listDevices()
      expect(devices.every(device => device.backend === 'android')).toBe(true)
      console.log(JSON.stringify({
        version, deviceCount: devices.length, availableDevices: devices.filter(device => device.isAvailable).length,
        iosAvailable: false, deviceInteractionAttempted: false,
      }))
    } finally { await runner.dispose() }
  } finally {
    await ctx.fiber.dispose()
    await rm(path, { recursive: true, force: true })
  }
}, 45_000)
