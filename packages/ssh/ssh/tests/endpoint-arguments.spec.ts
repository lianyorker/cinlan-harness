/** SSH endpoint argument construction over the mocked transport. */
import { EventEmitter } from 'node:events'
import { Duplex, PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SshRpcPeer } from '../src/protocol.ts'
import { SshConnection } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const transport = vi.hoisted(() => ({ spawn: vi.fn(), exec: vi.fn(), connect: vi.fn(), tls: vi.fn(), directory: vi.fn(), remove: vi.fn() }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: transport.spawn, execFile: transport.exec }))
vi.mock('node:net', async original => ({ ...await original<typeof import('node:net')>(), createConnection: transport.connect }))
vi.mock('node:tls', async original => ({ ...await original<typeof import('node:tls')>(), connect: transport.tls }))
vi.mock('node:fs/promises', () => ({ mkdtemp: transport.directory, rm: transport.remove }))

class Stream extends Duplex {
  finishDestroy: ((error: Error | null) => void) | undefined
  holdDestroy = false
  override _read(): void {}
  override _write(_bytes: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback() }
  override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    if (this.holdDestroy) this.finishDestroy = callback
    else callback(error)
  }
  releaseDestroy(): void {
    const callback = this.finishDestroy
    this.finishDestroy = undefined
    callback?.(null)
  }
  disableRenegotiation(): void {}
}

class Child extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly signals: string[] = []
  closed = false
  kill(signal = 'SIGTERM'): boolean {
    this.signals.push(signal)
    if (!this.closed) {
      this.closed = true
      queueMicrotask(() => { this.emit('close', 0, null) })
    }
    return true
  }
}

const config: Config = {
  host: 'test-alias', node: '/remote/node', helper: '/remote/helper.js', helperHash: 'a'.repeat(64), workspace: '/remote/workspace',
  requestTimeoutMs: 1000, maxFrameBytes: 4096, maxPending: 8, leaseMs: 30_000,
}

/** Start one connection over the mocked transport and expose the spawn argv. */
function setup(overrides: Partial<Config> = {}) {
  const ctx = new Context()
  const child = new Child()
  const raw = new Stream()
  const secure = new Stream()
  const helper = new SshRpcPeer(child.stdin, child.stdout, 4096, 8, async () => {
    throw new Error('helper requests are not exercised by this spec')
  })
  transport.directory.mockResolvedValue('/virtual/ssh-endpoint')
  transport.remove.mockResolvedValue(undefined)
  transport.spawn.mockReturnValue(child)
  transport.exec.mockImplementation((_file: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => {
    const command = new Child()
    queueMicrotask(() => { callback(null); command.kill() })
    return command
  })
  transport.connect.mockImplementation(() => {
    queueMicrotask(() => { raw.emit('connect') })
    return raw
  })
  transport.tls.mockImplementation(() => {
    raw.on('error', (error) => { secure.destroy(error) })
    raw.once('close', () => { secure.destroy() })
    secure.once('close', () => { raw.destroy() })
    queueMicrotask(() => { secure.emit('secureConnect') })
    return secure
  })
  // oxlint-disable-next-line eslint/prefer-const -- Failed construction still runs the fixture cleanup.
  let service: SshConnection | undefined
  onTestFinished(async () => {
    raw.releaseDestroy()
    secure.releaseDestroy()
    try { await service?.dispose().catch(() => {}) }
    finally {
      raw.destroy(); secure.destroy(); helper.close(); child.stderr.destroy(); child.kill()
      await ctx.fiber.dispose()
      vi.restoreAllMocks()
      for (const mock of Object.values(transport)) mock.mockReset()
    }
  })
  service = new SshConnection(ctx, { ...config, ...overrides })
  return { argv: (): string[] => (transport.spawn.mock.calls.at(-1) as [string, string[]])[1] }
}

describe.skipIf(process.platform === 'win32')('SSH endpoint arguments', () => {
  it('spawns the alias destination with no endpoint options by default', () => {
    const h = setup()
    const argv = h.argv()
    expect(argv).not.toContain('-p')
    expect(argv).not.toContain('-i')
    expect(argv.some(value => value.startsWith('ProxyCommand='))).toBe(false)
    expect(argv.at(-1)).toBe('test-alias')
  })

  it('adds exactly one option per configured endpoint field', () => {
    const h = setup({
      host: 'remote.example.com', port: 2222, username: 'deploy', identityFile: '/keys/id_ed25519',
      proxyCommand: 'cloudflared access ssh --hostname %h', jumpHost: 'bastion.example.com',
      keepAliveIntervalSeconds: 30, connectTimeoutSeconds: 60,
    })
    const argv = h.argv()
    expect(argv).toContain('ProxyCommand=cloudflared access ssh --hostname %h')
    expect(argv).toContain('ProxyJump=bastion.example.com')
    expect(argv).toContain('ServerAliveInterval=30')
    expect(argv).toContain('ConnectTimeout=60')
    expect(argv[argv.indexOf('-p') + 1]).toBe('2222')
    expect(argv[argv.indexOf('-i') + 1]).toBe('/keys/id_ed25519')
    // The configured keep-alive is appended after the plugin's own default, and
    // OpenSSH resolves the last occurrence.
    expect(argv.lastIndexOf('ServerAliveInterval=30')).toBeGreaterThan(argv.indexOf('ServerAliveInterval=10'))
    expect(argv.at(-1)).toBe('deploy@remote.example.com')
  })

  it('omits the control socket when multiplexing is disabled', () => {
    const h = setup({ multiplex: false, port: 22 })
    const argv = h.argv()
    expect(argv).not.toContain('-M')
    expect(argv).not.toContain('-S')
    expect(argv).not.toContain('ControlPersist=no')
    expect(argv.at(-1)).toBe('test-alias')
  })
})
