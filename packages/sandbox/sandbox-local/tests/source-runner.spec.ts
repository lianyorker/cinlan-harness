import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { expect, it } from 'vitest'

it('loads the full source runner independently of cwd and ambient tsconfig', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-acl-source-cwd-'))
  const ctx = new Context()
  try {
    writeFileSync(join(cwd, 'tsconfig.json'), '{ invalid workspace configuration')
    await ctx.plugin(LocalSandboxProvider)
    const sandbox = ctx.sandbox as LocalSandboxProvider
    sandbox.internals = {
      chain: ['windows-acl', 'bwrap'],
      probeWindowsAcl: () => true,
      windowsAclRunnerEntry: join(cwd, 'absent-runner.js'),
    }
    const { argv } = await sandbox.confine(['true'], { mode: 'read-only', workspaceRoot: cwd })
    expect(argv.slice(0, 2)).toEqual([process.execPath, '--import'])
    expect(argv[2]).toMatch(/^data:text\/javascript,/)
    expect(argv[3]).toMatch(/runner\.ts$/)
    for (const ambientConfig of [undefined, join(cwd, 'absent-ambient-tsconfig.json')]) {
      const result = spawnSync(argv[0]!, argv.slice(1, 4), {
        cwd,
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, NODE_OPTIONS: undefined, TSX_TSCONFIG_PATH: ambientConfig },
      })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status, result.stderr).toBe(127)
      expect(result.stderr).toBe('windows-acl-run: missing --workspace\n')
    }
  } finally {
    await ctx.fiber.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
}, 10_000)
