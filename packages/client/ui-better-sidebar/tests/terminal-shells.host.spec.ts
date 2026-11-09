/** Local filesystem discovery never launches a subprocess. */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverTerminalShells } from '../src/terminal-shells.ts'

let root: string | undefined
function installed(name: string): string {
  root ??= mkdtempSync(join(tmpdir(), 'sidebar-shells-'))
  const path = join(root, name + (process.platform === 'win32' ? '.exe' : ''))
  writeFileSync(path, 'shell fixture')
  chmodSync(path, 0o755)
  return realpathSync(path)
}
afterEach(() => {
  vi.unstubAllEnvs()
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('local terminal shell discovery', () => {
  it('keeps the configured default first, deduplicates installed candidates, and supplies shell-specific arguments', () => {
    const preferred = installed('preferred')
    const pwsh = installed('pwsh')
    const bash = installed('bash')
    const cmd = installed('cmd')
    mkdirSync(join(root!, 'directory'))
    vi.stubEnv('PATH', root!)
    expect(discoverTerminalShells({ shell: preferred, shellArgs: ['--custom'] },
      ['missing', 'directory', 'preferred', 'pwsh', 'bash', 'cmd', pwsh])).toEqual([
      { path: preferred, name: 'preferred', args: ['--custom'] },
      { path: pwsh, name: 'pwsh', args: ['-NoLogo'] },
      { path: bash, name: 'bash', args: ['-l'] },
      { path: cmd, name: 'cmd', args: [] },
    ])
  })

  it('offers installed alternatives when the configured default is unavailable', () => {
    const bash = installed('bash')
    vi.stubEnv('PATH', root!)
    expect(discoverTerminalShells({ shell: 'missing', shellArgs: [] }, [bash])).toEqual([
      { path: bash, name: 'bash', args: ['-l'] },
    ])
  })

  it.skipIf(process.platform === 'win32')('excludes files without execute permission', () => {
    const bash = installed('bash')
    chmodSync(bash, 0o644)
    expect(discoverTerminalShells({ shell: bash, shellArgs: [] }, [bash])).toEqual([])
  })
})
