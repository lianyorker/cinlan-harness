/** Editable connection records: argv refinements, persistence and the real probe. */
import { describe, expect, it } from 'vitest'
import { sshArguments } from '../src/connection.ts'
import { createHarness } from './harness.ts'
import type { SavedTarget, SshConnection } from '../src/types.ts'

const PLUGIN_ARGUMENTS = [
  '-T', '-S', 'none', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no',
  '-o', 'ClearAllForwardings=yes', '-o', 'RequestTTY=no', '-o', 'ConnectTimeout=30',
]

function revision(target: SavedTarget) {
  return { id: target.id, revision: target.revision }
}

describe('saved connection refinements', () => {
  it('appends the record refinements after the plugin defaults, in a fixed order', () => {
    const connection: SshConnection = {
      port: 2222, username: 'deploy', privateKeyFile: '/keys/id_ed25519',
      proxyCommand: 'cloudflared access ssh --hostname %h', jumpHost: 'bastion.example.com',
      keepAliveIntervalSeconds: 60, connectTimeoutSeconds: 15,
    }
    expect(sshArguments('ssh', 'alias', 30_000, '/cfg', connection)).toEqual([
      'ssh', '-F', '/cfg', ...PLUGIN_ARGUMENTS, '-p', '2222', '-i', '/keys/id_ed25519', '-o', 'User=deploy',
      '-o', 'ProxyCommand=cloudflared access ssh --hostname %h', '-o', 'ProxyJump=bastion.example.com',
      '-o', 'ServerAliveInterval=60', '-o', 'ConnectTimeout=15',
      '--', 'alias', 'dsh --profile execution-host',
    ])
  })

  it('persists the refinements, exposes them in management views and clears them when an update omits them', async () => {
    const h = await createHarness()
    const { targets } = await h.registry()
    const connection: SshConnection = { port: 2222, username: 'deploy', multiplex: true }
    const saved = (await targets.create({ label: 'Connection', sshAlias: 'inspection', connection })).target
    expect(saved.connection).toEqual(connection)
    expect(targets.list().targets[0]!.connection).toEqual(connection)
    const cleared = (await targets.update({ ...revision(saved), label: saved.label, sshAlias: saved.sshAlias })).target
    expect(cleared.connection).toBeUndefined()
    expect(targets.list().targets[0]!.connection).toBeUndefined()
  })

  it('dials the port described by the record rather than the one in the OpenSSH configuration', async () => {
    const h = await createHarness()
    await h.worker('dialed')
    const denied = await h.worker('denied-port', { denyAuthentication: true })
    const { targets } = await h.registry()
    const connection: SshConnection = { port: denied.port, username: 'worker', privateKeyFile: h.recordKeyFile }
    const saved = (await targets.create({ label: 'Dialed', sshAlias: 'dialed', connection })).target
    // The alias still resolves through ssh_config to the other fixture, so only
    // record-first refinements can reach this listening, authenticating-refusing server.
    await expect(targets.test(revision(saved))).rejects.toMatchObject({ code: 'authentication-required' })
    expect(denied.authentication.length).toBeGreaterThan(0)
    expect(targets.list().targets[0]!.state).toEqual({ phase: 'disconnected' })
  })

  it('probes and authenticates through the connection identity file', async () => {
    const h = await createHarness()
    const worker = await h.worker('probed')
    const { targets } = await h.registry()
    const connection: SshConnection = { port: worker.port, username: 'worker',
      privateKeyFile: h.recordKeyFile, keepAliveIntervalSeconds: 60 }
    const saved = (await targets.create({ label: 'Probed', sshAlias: 'probed', connection })).target
    const probed = await targets.test(revision(saved))
    expect(probed.rootCount).toBe(1)
    expect(worker.authentication).toContain('publickey:worker:true:true')
    expect(probed.target.state).toEqual({ phase: 'disconnected' })
  })

  it('imports the configured OpenSSH Host entries without rewriting that file', async () => {
    const h = await createHarness()
    await h.worker('imported')
    const { targets } = await h.registry()
    const imported = await targets.listImportableHosts()
    expect(imported.source).toBe(h.configPath)
    expect(imported.exists).toBe(true)
    expect(imported.entries).toEqual([{ alias: 'imported', host: '127.0.0.1', username: 'worker',
      port: expect.any(Number), identityFile: expect.stringContaining('client_key') }])
  })
})
