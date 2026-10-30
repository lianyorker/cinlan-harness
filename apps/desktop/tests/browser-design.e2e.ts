/** Built-artifact Browser guest checks; build Host and Browser Client types first. */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const hasDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

it.skipIf(!hasDisplay)('reads real guest elements and retains the guest across responsive viewports', { retry: 0 }, async () => {
  const guestModule = join(repository, 'apps/desktop/lib/types/browser-guests.js')
  const nativeModule = join(repository, 'packages/client/ui-sidebar-browser/lib/types/client/view/native-design.js')
  for (const artifact of [guestModule, nativeModule]) {
    if (!existsSync(artifact)) throw new Error(`Missing built artifact: ${artifact}`)
  }
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('Electron executable is unavailable')
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-design-'))
  try {
    const fixture = fileURLToPath(new URL('./fixtures/browser-design-smoke.mjs', import.meta.url))
    const result = await execa(electron, [fixture, guestModule, nativeModule, root], {
      env: { ELECTRON_RUN_AS_NODE: undefined, DSH_CLIENT_VERSION: '1.2.3' },
      timeout: 45_000, forceKillAfterDelay: 5_000, reject: false,
    })
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.signal, result.stderr).toBeUndefined()
    expect(result.exitCode, result.stderr).toBe(0)
    const line = result.stdout.split('\n').find(value => value.startsWith('BROWSER_DESIGN_RESULT '))
    if (line === undefined) throw new Error(`Missing Electron result: ${result.stdout}\n${result.stderr}`)
    expect(JSON.parse(line.slice('BROWSER_DESIGN_RESULT '.length))).toEqual({
      sizes: [[1440, 850], [768, 1024], [390, 844]], element: true, html: true, sameGuest: true, marker: true,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
