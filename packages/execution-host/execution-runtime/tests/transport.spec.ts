/** Scripted SSH2 fakes drive transport error arms that real endpoints cannot reach deterministically. */
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { sha256, type RuntimeArtifact } from '../src/artifact.ts'
import { RuntimeConnectionError, runRemoteOperation } from '../src/transport.ts'
import type { RuntimeGeneration, RuntimeInspection, RuntimeLimits, RuntimeLocation, RuntimeManifest } from '../src/types.ts'

const fake = vi.hoisted(() => ({
  connect: undefined as undefined | ((client: EventEmitter) => void),
  sftp: undefined as undefined | ((callback: (error: Error | undefined, value?: unknown) => void) => void),
  exec: undefined as undefined | ((command: string, callback: (error: Error | undefined, value?: unknown) => void) => void),
  parseKey: undefined as undefined | ((key: unknown) => unknown),
  write: undefined as undefined | ((channel: unknown, data: string) => void),
  mkdir: undefined as undefined | (() => void),
  sftpWrite: undefined as undefined | (() => void),
  open: undefined as undefined | ((mode: number) => void),
  lastClient: undefined as EventEmitter | undefined,
}))

class FakeChannel extends EventEmitter {
  readonly stderr = { resume(): void {} }
  write(data: string): boolean { fake.write?.(this, data); return true }
  end(): this { this.emit('close', 0); return this }
}

class FakeSftp extends EventEmitter {
  mkdir(_path: string, _options: unknown, callback: (error?: Error) => void): void { fake.mkdir?.(); callback() }
  open(_path: string, _flags: string, options: { mode: number }, callback: (error: Error | undefined, handle?: Buffer) => void): void {
    fake.open?.(options.mode)
    callback(undefined, Buffer.alloc(4))
  }
  write(_handle: Buffer, _bytes: Buffer, _offset: number, _length: number, _position: number, callback: (error?: Error) => void): void {
    fake.sftpWrite?.()
    callback()
  }
  close(_handle: Buffer, callback: (error?: Error) => void): void { callback() }
  end(): this { return this }
}

vi.mock('ssh2', async () => {
  const { EventEmitter: FakeEmitter } = await import('node:events')
  class FakeClient extends FakeEmitter {
    connect(): void {
      fake.lastClient = this
      if (fake.connect) { fake.connect(this); return }
      queueMicrotask(() => { this.emit('ready') })
    }
    sftp(callback: (error: Error | undefined, value?: unknown) => void): void {
      if (fake.sftp) { fake.sftp(callback); return }
      callback(new Error('sftp unavailable'))
    }
    exec(command: string, callback: (error: Error | undefined, value?: unknown) => void): void {
      if (fake.exec) { fake.exec(command, callback); return }
      callback(new Error('exec unavailable'))
    }
    destroy(): this { this.emit('close'); return this }
  }
  return {
    default: { Client: FakeClient, utils: { parseKey: (key: unknown) => fake.parseKey?.(key) ?? ({}) } },
    Client: FakeClient,
  }
})

beforeEach(() => {
  for (const key of Object.keys(fake) as (keyof typeof fake)[]) fake[key] = undefined as never
})

const GENERATION = 'a'.repeat(64) as RuntimeGeneration
const LIMITS: RuntimeLimits = {
  operationTimeoutMs: 60_000, shutdownTimeoutMs: 5_000, maxManifestBytes: 64 * 1024,
  maxFileBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024, maxFiles: 64, maxResponseBytes: 64 * 1024,
}

async function fixture(): Promise<{ location: RuntimeLocation; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-transport-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const key = join(root, 'key')
  await writeFile(key, 'fake-private-key')
  return {
    root,
    location: {
      endpoint: { host: '127.0.0.1', port: 22, username: 'fixture', privateKeyFile: key, hostKeySHA256: 'b'.repeat(64) },
      node: '/usr/bin/node', installRoot: '/opt/runtime', workspace: '/opt/workspace',
    },
  }
}

function inspection(location: RuntimeLocation): RuntimeInspection {
  return {
    state: 'installed', platform: 'linux', arch: 'x64', node: location.node, nodeVersion: 'v24.9.0',
    installRoot: location.installRoot, generation: GENERATION, protocol: 1,
    helper: '/opt/runtime/helper.js', helperHash: 'c'.repeat(64),
    bootstrapPath: '/opt/runtime/process.js', bootstrapHash: 'd'.repeat(64),
  }
}

/** Wire an exec channel that runs a responder for every install/inspect action write. */
function scriptChannel(respond: (channel: FakeChannel, action: Record<string, unknown>) => void): void {
  fake.exec = (_command, callback) => {
    const channel = new FakeChannel()
    callback(undefined, channel)
    fake.write = (_ch, data) => {
      const action = JSON.parse(data.trim()) as Record<string, unknown>
      queueMicrotask(() => { respond(channel, action) })
    }
  }
}

function resultLine(location: RuntimeLocation): string {
  return JSON.stringify({ type: 'result', value: inspection(location) }) + '\n'
}

function stageLine(location: RuntimeLocation, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'stage', directory: location.installRoot + '/.staging/operation-1', platform: 'linux', arch: 'x64',
    node: location.node, nodeVersion: 'v24.9.0', installRoot: location.installRoot, generation: GENERATION,
    ...overrides,
  }) + '\n'
}

function manifestBase(overrides: Partial<RuntimeManifest>): RuntimeManifest {
  return { schemaVersion: 1, version: '1.0.0', sourceCommit: 'a'.repeat(40), protocol: 1,
    platform: 'linux', arch: 'x64', helper: 'helper.js', bootstrap: 'process.js', files: [], ...overrides }
}

async function artifactFor(root: string, options: { executable?: boolean; sha?: string } = {}): Promise<RuntimeArtifact> {
  const content = Buffer.from('helper-bytes')
  await writeFile(join(root, 'helper.js'), content)
  const manifest = manifestBase({
    files: [{ path: 'helper.js', size: content.length, sha256: options.sha ?? sha256(content), executable: options.executable ?? false }],
  })
  const bytes = Buffer.from(JSON.stringify(manifest) + '\n')
  return { root, manifest, bytes, generation: sha256(bytes) as RuntimeGeneration }
}

it('completes an inspection round-trip through a scripted channel', async () => {
  const { location } = await fixture()
  scriptChannel((channel, action) => {
    expect(action.action).toBe('inspect')
    channel.emit('data', Buffer.from(resultLine(location)))
    channel.emit('close', 0)
  })
  const result = await runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal)
  expect(result.state).toBe('installed')
})

it('stages, uploads executable files with mode 0700, and publishes', async () => {
  const { location, root } = await fixture()
  const artifact = await artifactFor(root, { executable: true })
  const sftp = new FakeSftp()
  const modes: number[] = []
  fake.open = (mode) => { modes.push(mode) }
  fake.sftp = (callback) => { callback(undefined, sftp) }
  scriptChannel((channel, action) => {
    if (action.action === 'install') { channel.emit('data', Buffer.from(stageLine(location))); return }
    if (action.action === 'publish') { channel.emit('data', Buffer.from(resultLine(location))); channel.emit('close', 0) }
  })
  const result = await runRemoteOperation(location, GENERATION, LIMITS, artifact, new AbortController().signal)
  expect(result.state).toBe('installed')
  expect(modes).toContain(0o700)
})

it('rejects a private key the SSH parser refuses', async () => {
  const { location } = await fixture()
  fake.parseKey = () => new Error('bad key')
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toThrow(/private key is invalid/)
})

it('fails when the connection closes before authentication', async () => {
  const { location } = await fixture()
  fake.connect = (client) => { queueMicrotask(() => { client.emit('close') }) }
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toBeInstanceOf(RuntimeConnectionError)
})

it('wraps synchronous connect throws, including non-Error causes', async () => {
  const { location } = await fixture()
  fake.connect = () => { throw new Error('connect boom') }
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toBeInstanceOf(RuntimeConnectionError)
  fake.connect = () => { throw 'string failure' as never }
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toBeInstanceOf(RuntimeConnectionError)
})

it('passes RuntimeConnectionError failures through unwrapped', async () => {
  const { location } = await fixture()
  const transport = new RuntimeConnectionError(new Error('transport died'))
  fake.connect = (client) => {
    queueMicrotask(() => { client.emit('error', transport); client.emit('close') })
  }
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toBe(transport)
})

it('rejects a mid-acquisition close with the transport category', async () => {
  const { location } = await fixture()
  fake.exec = () => {
    const client = fake.lastClient
    queueMicrotask(() => { client?.emit('close') })
  }
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toBeInstanceOf(RuntimeConnectionError)
})

it('rejects a mid-acquisition close with the cancellation reason when aborted', async () => {
  const { location } = await fixture()
  const controller = new AbortController()
  fake.exec = () => {
    queueMicrotask(() => { controller.abort(new Error('task cancelled')) })
  }
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, controller.signal))
    .rejects.toThrow(/task cancelled/)
})

it('fails staged lines sent during an inspection or with foreign ownership', async () => {
  const { location, root } = await fixture()
  scriptChannel((channel) => {
    channel.emit('data', Buffer.from(stageLine(location)))
    channel.emit('close', 0)
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toThrow(/staging ownership/)

  fake.sftp = (callback) => { callback(undefined, new FakeSftp()) }
  for (const directory of ['/etc/passwd', location.installRoot + '/.staging/operation-1/nested']) {
    scriptChannel((channel, action) => {
      if (action.action !== 'install') return
      channel.emit('data', Buffer.from(stageLine(location, { directory })))
      channel.emit('close', 0)
    })
    await expect(runRemoteOperation(location, GENERATION, LIMITS, await artifactFor(root), new AbortController().signal))
      .rejects.toThrow(/staging ownership/)
  }

  scriptChannel((channel, action) => {
    if (action.action !== 'install') return
    channel.emit('data', Buffer.from(stageLine(location, { generation: 'e'.repeat(64) })))
    channel.emit('close', 0)
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, await artifactFor(root), new AbortController().signal))
    .rejects.toThrow(/staging ownership/)
})

it('fails when local artifact bytes changed mid-transfer', async () => {
  const { location, root } = await fixture()
  const artifact = await artifactFor(root, { sha: '0'.repeat(64) })
  fake.sftp = (callback) => { callback(undefined, new FakeSftp()) }
  scriptChannel((channel, action) => {
    if (action.action !== 'install') return
    channel.emit('data', Buffer.from(stageLine(location)))
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, artifact, new AbortController().signal))
    .rejects.toThrow(/changed during transfer/)
})

it('rejects the next SFTP call once the channel closed mid-upload', async () => {
  const { location, root } = await fixture()
  const content = Buffer.from('helper-bytes')
  await mkdir(join(root, 'bin'))
  await writeFile(join(root, 'bin', 'helper.js'), content)
  const manifest = manifestBase({
    helper: 'bin/helper.js',
    files: [{ path: 'bin/helper.js', size: content.length, sha256: sha256(content), executable: false }],
  })
  const bytes = Buffer.from(JSON.stringify(manifest) + '\n')
  const artifact: RuntimeArtifact = { root, manifest, bytes, generation: sha256(bytes) as RuntimeGeneration }
  const sftp = new FakeSftp()
  fake.mkdir = () => { queueMicrotask(() => { sftp.emit('close') }) }
  fake.sftp = (callback) => { callback(undefined, sftp) }
  scriptChannel((channel, action) => {
    if (action.action !== 'install') return
    channel.emit('data', Buffer.from(stageLine(location)))
    channel.emit('close', 0)
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, artifact, new AbortController().signal))
    .rejects.toBeInstanceOf(RuntimeConnectionError)
})

it('rejects a pending SFTP call when the channel closes mid-write', async () => {
  const { location, root } = await fixture()
  const artifact = await artifactFor(root)
  const sftp = new FakeSftp()
  fake.sftpWrite = () => { sftp.emit('close') }
  fake.sftp = (callback) => { callback(undefined, sftp) }
  scriptChannel((channel, action) => {
    if (action.action !== 'install') return
    channel.emit('data', Buffer.from(stageLine(location)))
    channel.emit('close', 0)
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, artifact, new AbortController().signal))
    .rejects.toBeInstanceOf(RuntimeConnectionError)
})

it('stringifies non-Error abort reasons surfacing during upload', async () => {
  const { location, root } = await fixture()
  const artifact = await artifactFor(root)
  const controller = new AbortController()
  fake.sftpWrite = () => { controller.abort('stop-without-error') }
  fake.sftp = (callback) => { callback(undefined, new FakeSftp()) }
  scriptChannel((channel, action) => {
    if (action.action !== 'install') return
    channel.emit('data', Buffer.from(stageLine(location)))
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, artifact, controller.signal))
    .rejects.toThrow(/stop-without-error/)
})

it('rejects unconfirmed outcomes and nonzero exit codes', async () => {
  const { location } = await fixture()
  scriptChannel((channel) => { channel.emit('close', 0) })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toThrow(/unconfirmed/)

  scriptChannel((channel) => {
    channel.emit('data', Buffer.from(resultLine(location)))
    channel.emit('close', 1)
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toThrow(/unconfirmed/)
})

it('surfaces channel errors and rejects the settled outcome', async () => {
  const { location } = await fixture()
  scriptChannel((channel) => {
    channel.emit('error', new Error('channel died'))
    channel.emit('close', 1)
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toThrow(/channel died|SSH runtime transport failed/)
})

it('fails when the remote response exceeds the byte budget', async () => {
  const { location } = await fixture()
  scriptChannel((channel) => {
    channel.emit('data', Buffer.from('x'.repeat(200) + '\n'))
    channel.emit('close', 0)
  })
  await expect(runRemoteOperation(location, GENERATION, { ...LIMITS, maxResponseBytes: 16 }, undefined, new AbortController().signal))
    .rejects.toThrow(/exceeds limit/)
})

it('fails when the remote identity differs from the request', async () => {
  const { location } = await fixture()
  scriptChannel((channel) => {
    const wrong = { ...inspection(location), generation: 'e'.repeat(64) }
    channel.emit('data', Buffer.from(JSON.stringify({ type: 'result', value: wrong }) + '\n'))
    channel.emit('close', 0)
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toThrow(/identity differs/)
})

it('rejects malformed protocol lines and remote error envelopes', async () => {
  const { location } = await fixture()
  scriptChannel((channel) => {
    channel.emit('data', Buffer.from('not-json\n'))
    channel.emit('close', 0)
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toThrow()

  scriptChannel((channel) => {
    channel.emit('data', Buffer.from(JSON.stringify({ type: 'error', message: 'remote exploded' }) + '\n'))
    channel.emit('close', 0)
  })
  await expect(runRemoteOperation(location, GENERATION, LIMITS, undefined, new AbortController().signal))
    .rejects.toThrow(/remote exploded/)
})
