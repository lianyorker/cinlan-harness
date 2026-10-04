/** Exact OpenSSH argv: saved endpoint refinements append after plugin-owned options. */
import { describe, expect, it } from 'vitest'
import { sshArguments } from '../src/connection.ts'
import type { SshExecutionConfiguration } from '../src/types.ts'

const executable = 'ssh'

const defaults = ['-T', '-S', 'none',
  '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no',
  '-o', 'ClearAllForwardings=yes', '-o', 'RequestTTY=no', '-o', 'ConnectTimeout=30'] as const

function endpoint(overrides: Partial<SshExecutionConfiguration['endpoint']> = {}): SshExecutionConfiguration['endpoint'] {
  return { host: 'remote.example', port: 2202, username: 'worker',
    privateKeyFile: '/home/operator/.ssh/id_ed25519', hostKeySHA256: 'a'.repeat(64), ...overrides }
}

describe('OpenSSH argv composition', () => {
  it('keeps the exact legacy argv when no endpoint is saved', () => {
    expect(sshArguments(executable, 'inspection', 30_000)).toEqual([
      executable, ...defaults, '--', 'inspection', 'dsh --profile execution-host',
    ])
    expect(sshArguments(executable, 'inspection', 30_000, '/cfg/ssh_config')).toEqual([
      executable, '-F', '/cfg/ssh_config', ...defaults, '--', 'inspection', 'dsh --profile execution-host',
    ])
  })

  it('appends record-first refinements after the plugin-owned options in a fixed order', () => {
    const argv = sshArguments(executable, 'inspection', 30_000, undefined, endpoint({
      multiplex: true,
      proxyCommand: 'cloudflared access ssh --hostname %h',
      jumpHost: 'bastion.example.com',
      keepAliveIntervalSeconds: 60,
      connectTimeoutSeconds: 15,
    }))
    expect(argv).toEqual([
      executable, ...defaults,
      '-p', '2202', '-i', '/home/operator/.ssh/id_ed25519', '-o', 'User=worker',
      '-o', 'ProxyCommand=cloudflared access ssh --hostname %h',
      '-o', 'ProxyJump=bastion.example.com',
      '-o', 'ServerAliveInterval=60',
      '-o', 'ConnectTimeout=15',
      '--', 'inspection', 'dsh --profile execution-host',
    ])
    // OpenSSH resolves repeated options last-wins: the record's explicit
    // deadline must follow the plugin's own computed one.
    expect(argv.indexOf('ConnectTimeout=30')).toBeLessThan(argv.lastIndexOf('ConnectTimeout=15'))
    // This connection always dials with -S none, so a saved multiplex request
    // stays unrefinable here.
    expect(argv).not.toContain('ControlMaster=yes')
    expect(argv).not.toContain('ControlPersist=')
  })

  it('refines only the saved port, identity file and account when optional fields are absent', () => {
    expect(sshArguments(executable, 'target', 30_000, '/cfg/ssh_config', endpoint())).toEqual([
      executable, '-F', '/cfg/ssh_config', ...defaults,
      '-p', '2202', '-i', '/home/operator/.ssh/id_ed25519', '-o', 'User=worker',
      '--', 'target', 'dsh --profile execution-host',
    ])
    // An all-optional record refines nothing and keeps the OpenSSH configuration.
    expect(sshArguments(executable, 'target', 30_000, '/cfg/ssh_config', {})).toEqual([
      executable, '-F', '/cfg/ssh_config', ...defaults, '--', 'target', 'dsh --profile execution-host',
    ])
  })
})
