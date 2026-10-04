/** OpenSSH Host parsing and the read-only import path used by the management UI. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSshConfigHosts, readImportableHosts } from '../src/import.ts'
import type { Config } from '../src/config.ts'

const CONFIG = `# A comment
Host dev-box
  HostName 10.0.0.5
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519

Host *.internal
  User ignored

Host alpha beta=gamma
  HostName alpha.example
  ProxyCommand cloudflared access ssh --hostname %h
  ProxyJump bastion.example.com

Host duplicated
  HostName first.example
  HostName second.example

Host matched
  User before
Match host matched
  User after

Host bracketed
  HostName [2001:db8::1]
`

describe('OpenSSH Host import', () => {
  it('reads concrete Host entries with their first-obtained destination values', () => {
    expect(parseSshConfigHosts(CONFIG)).toEqual([
      { alias: 'dev-box', host: '10.0.0.5', username: 'deploy', port: 2222, identityFile: '~/.ssh/id_ed25519' },
      { alias: 'alpha', host: 'alpha.example', proxyCommand: 'cloudflared access ssh --hostname %h',
        jumpHost: 'bastion.example.com' },
      { alias: 'beta', host: 'alpha.example', proxyCommand: 'cloudflared access ssh --hostname %h',
        jumpHost: 'bastion.example.com' },
      // A pattern list splits on whitespace and on the keyword '=' form alike.
      { alias: 'gamma', host: 'alpha.example', proxyCommand: 'cloudflared access ssh --hostname %h',
        jumpHost: 'bastion.example.com' },
      { alias: 'duplicated', host: 'first.example' },
      // Match ends the unconditional block, so its own keywords never contribute.
      { alias: 'matched', username: 'before' },
      { alias: 'bracketed', host: '[2001:db8::1]' },
    ])
  })

  it('ignores wildcard, negated and out-of-range entries instead of importing a wrong destination', () => {
    expect(parseSshConfigHosts('Host !excluded\n  HostName hidden.example\nHost port-broken\n  Port 99999\n'))
      .toEqual([{ alias: 'port-broken' }])
  })

  it('reports a missing configuration file as an empty import rather than a failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-import-'))
    try {
      const source = join(root, 'absent')
      const config = { sshConfigFile: source } as Config
      expect(await readImportableHosts(config)).toEqual({ source, exists: false, entries: [] })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('reads the configured path and reports it with the entries, without writing anything back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-import-'))
    try {
      const source = join(root, 'ssh_config')
      await writeFile(source, CONFIG)
      const config = { sshConfigFile: source } as Config
      const imported = await readImportableHosts(config)
      expect(imported.source).toBe(source)
      expect(imported.exists).toBe(true)
      expect(imported.entries[0]).toEqual({
        alias: 'dev-box', host: '10.0.0.5', username: 'deploy', port: 2222, identityFile: '~/.ssh/id_ed25519',
      })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('fails with a stable code when the configured path exists but cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-import-'))
    try {
      const source = join(root, 'directory')
      await mkdir(source)
      await expect(readImportableHosts({ sshConfigFile: source } as Config))
        .rejects.toMatchObject({ code: 'configuration-unreadable' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
