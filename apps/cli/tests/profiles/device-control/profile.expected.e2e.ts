/** Shipped device-control profile assembly through the supported dsh source launcher. */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'
import { expect, it } from 'vitest'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../../../../..', import.meta.url))

type Row = { id: string; name: string; config?: Record<string, unknown> }

it('initializes device-control with both capability families and ask-by-default policies', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-device-profile-'))
  try {
    const result = await run(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'device-control', '--dump-config'], {
      cwd: root,
      env: { ...process.env, DSH_HOME: home },
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    })
    const rows = load(result.stdout, { schema: entryListSchema }) as Row[]
    const selected = rows.filter(row =>
      /^(computer-use|mobile-device|tool-computer-use|tool-mobile-device|device-capabilities-controller)/.test(row.id))
    expect(selected.map(row => row.id)).toEqual([
      'device-capabilities-controller',
      'computer-use', 'computer-use-permission-policy', 'computer-use-cua-driver-native',
      'mobile-device', 'mobile-device-adb', 'mobile-device-permission-policy', 'tool-mobile-device',
    ])
    expect(selected.find(row => row.id === 'computer-use-permission-policy')?.config).toEqual({
      native: 'ask',
    })
    expect(selected.find(row => row.id === 'mobile-device-permission-policy')?.config).toEqual({
      observe: 'ask', touch: 'ask', textInput: 'ask', deviceNavigation: 'ask',
    })
    const manifest = JSON.parse(await readFile(join(home, 'profiles/device-control/package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    expect(manifest.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-cinlan-computer-use', '@deepseek-ai/dsh-cinlan-mobile-device',
    ])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
