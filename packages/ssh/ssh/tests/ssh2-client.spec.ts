/** Real encrypted SSH channels exercise the Windows-capable client, not a POSIX remote deployment. */
import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection, type Socket } from 'node:net'
import { createServer as createTlsServer, type TLSSocket } from 'node:tls'
import { Context } from '@deepseek-ai/cordis'
import { Server, utils, type Connection } from 'ssh2'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { SshConnection, type Config } from '../src/index.ts'
import { SSH_STREAM_TLS_OPTIONS } from '../src/stream-security.ts'

async function fixture(options: { holdStream?: boolean; hash?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh2-client-'))
  const keys = utils.generateKeyPairSync('ed25519')
  const hostKeys = utils.generateKeyPairSync('ed25519')
  const publicKey = utils.parseKey(keys.public)
  const hostKey = utils.parseKey(hostKeys.public)
  if (publicKey instanceof Error || hostKey instanceof Error) throw new Error('Invalid generated fixture key')
  const privateKeyFile = join(root, 'client-key')
  await writeFile(privateKeyFile, keys.private, { mode: 0o600 })
  const capability = 'b'.repeat(64)
  const tlsSockets = new Set<TLSSocket>()
  const proxies = new Set<Socket>()
  const clients = new Set<Connection>()
  const children = new Map<ChildProcessWithoutNullStreams, Promise<unknown>>()
  const commands: string[] = []
  const paths: string[] = []
  const streamEntered = Promise.withResolvers<undefined>()
  let releaseStream: (() => void) | undefined
  const secure = createTlsServer({ ...SSH_STREAM_TLS_OPTIONS,
    pskCallback: (_socket, identity) => identity === 'dsh-stream' ? Buffer.from(capability, 'hex') : null,
  }, (socket) => {
    tlsSockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => { tlsSockets.delete(socket) })
    socket.on('data', (bytes: Buffer) => { socket.write(bytes) })
  })
  secure.on('tlsClientError', () => { /* Wrong-capability cases intentionally reject authentication. */ })
  const server = new Server({ hostKeys: [hostKeys.private] }, (client) => {
    clients.add(client)
    client.on('error', () => { /* Host-key rejection and teardown close the fixture connection. */ })
    client.once('close', () => { clients.delete(client) })
    client.on('authentication', (auth) => {
      if (auth.method !== 'publickey' || auth.username !== 'fixture' || !auth.key.data.equals(publicKey.getPublicSSH())) {
        auth.reject(); return
      }
      if (auth.signature !== undefined
        && (auth.blob === undefined || !publicKey.verify(auth.blob, auth.signature, auth.hashAlgo))) {
        auth.reject(); return
      }
      auth.accept()
    })
    client.on('session', (accept) => {
      const session = accept()
      session.on('exec', (acceptExec, _reject, info) => {
        commands.push(info.command)
        const channel = acceptExec()
        const childEntry = fileURLToPath(new URL('./fixtures/ssh2-control.mjs', import.meta.url))
        const child = spawn(process.execPath, ['--import', 'tsx/esm', childEntry], {
          stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        })
        const closed = new Promise<void>((resolve) => { child.once('close', () => { children.delete(child); resolve() }) })
        children.set(child, closed)
        child.on('error', () => { channel.destroy() })
        child.stderr.resume()
        channel.pipe(child.stdin)
        child.stdout.pipe(channel)
        channel.once('close', () => { child.kill() })
      })
    })
    client.on('openssh.streamlocal', (accept, _reject, info) => {
      paths.push(info.socketPath)
      streamEntered.resolve(undefined)
      const connect = (): void => {
        const channel = accept()
        channel.on('error', () => {})
        const address = secure.address()
        if (address === null || typeof address === 'string') throw new Error('Missing TLS fixture address')
        const proxy = createConnection({ port: address.port, host: '127.0.0.1' })
        proxies.add(proxy)
        proxy.on('error', () => { channel.destroy() })
        proxy.once('close', () => { proxies.delete(proxy); channel.destroy() })
        channel.once('close', () => { proxy.destroy() })
        channel.pipe(proxy).pipe(channel)
      }
      if (options.holdStream) releaseStream = connect
      else connect()
    })
  })
  const ctx = new Context()
  let service: SshConnection | undefined = undefined
  onTestFinished(async () => {
    await service?.dispose()
    await ctx.fiber.dispose()
    for (const client of clients) client.end()
    for (const socket of tlsSockets) socket.destroy()
    for (const socket of proxies) socket.destroy()
    const active = [...children]
    for (const [child] of active) child.kill()
    await Promise.all(active.map(([, closed]) => closed))
    await Promise.all([
      new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
      new Promise<void>((resolve) => { secure.close(() => { resolve() }) }),
    ])
    await rm(root, { recursive: true, force: true })
  })
  secure.listen(0, '127.0.0.1')
  await once(secure, 'listening')
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing SSH fixture address')
  const config: Config = {
    endpoint: { host: '127.0.0.1', port: address.port, username: 'fixture', privateKeyFile,
      hostKeySHA256: options.hash ?? createHash('sha256').update(hostKey.getPublicSSH()).digest('hex') },
    node: '/fixture/node', helper: "/fixture/helper with ' quote.mjs", helperHash: 'a'.repeat(64), workspace: '/fixture/workspace',
    requestTimeoutMs: 3000, maxFrameBytes: 4096, maxPending: 8, leaseMs: 30_000,
  }
  service = new SshConnection(ctx, config)
  return { service, config, commands, paths, children, clients, streamEntered: streamEntered.promise,
    releaseStream: () => { releaseStream?.() }, endpoint: { path: '/tmp/ssh2-fixture/stream', capability } }
}

describe('explicit SSH client over encrypted network channels', () => {
  it('verifies identity, runs the control child, and authenticates an independent TLS stream', async () => {
    const state = await fixture()
    await state.service.ready
    expect(await state.service.request('echo', { value: 'control' }, z.object({ value: z.string() }))).toEqual({ value: 'control' })
    expect(state.commands).toEqual(["'/fixture/node' '--disable-sigusr1' '/fixture/helper with '\\'' quote.mjs'"])
    const lifetime = new AbortController()
    const socket = await state.service.connectStream(state.endpoint, lifetime.signal)
    const bytes = new Promise<Buffer>((resolve) => { socket.once('data', resolve) })
    socket.resume()
    socket.write('authenticated data')
    expect((await bytes).toString()).toBe('authenticated data')
    expect(state.paths).toEqual([state.endpoint.path])
    const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
    lifetime.abort(new Error('stream consumer cancelled'))
    await closed
    expect(await state.service.request('echo', 'after stream close', z.string())).toBe('after stream close')
    await state.service.dispose()
    expect(socket.destroyed).toBe(true)
    await vi.waitFor(() => { expect(state.children.size).toBe(0); expect(state.clients.size).toBe(0) })
  })

  it('refuses a mismatched host key before starting the helper', async () => {
    const state = await fixture({ hash: '0'.repeat(64) })
    await expect(state.service.ready).rejects.toThrow(/verification|host/i)
    expect(state.commands).toEqual([])
    await state.service.dispose()
  })

  it('rejects the wrong stream capability while leaving the authenticated control usable', async () => {
    const state = await fixture()
    await state.service.ready
    await expect(state.service.connectStream({ ...state.endpoint, capability: 'c'.repeat(64) })).rejects.toThrow()
    expect(await state.service.request('echo', 'still connected', z.string())).toBe('still connected')
  })

  it('waits for a cancelled opening to return and closes the late channel', async () => {
    const state = await fixture({ holdStream: true })
    await state.service.ready
    const abort = new AbortController()
    const opening = state.service.connectStream(state.endpoint, abort.signal)
    const rejected = expect(opening).rejects.toThrow(/cancel/i)
    await state.streamEntered
    abort.abort(new Error('cancel stream'))
    let settled = false
    void opening.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    state.releaseStream()
    await rejected
    expect(await state.service.request('echo', 'after cancel', z.string())).toBe('after cancel')
  })

  it('joins disposal while the server holds a channel-open response', async () => {
    const state = await fixture({ holdStream: true })
    await state.service.ready
    const opening = state.service.connectStream(state.endpoint)
    const rejected = expect(opening).rejects.toThrow(/closed|lost/i)
    await state.streamEntered
    await state.service.dispose()
    await rejected
    await vi.waitFor(() => { expect(state.children.size).toBe(0) })
  })
})
