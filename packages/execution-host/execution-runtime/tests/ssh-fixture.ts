/** Encrypted SSH2/SFTP fixture executes the actual installer supervisor under task-owned Node children. */
import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, open, rm, writeFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ssh2, { type Connection } from 'ssh2'
import { onTestFinished } from 'vitest'
import type { RuntimeLocation } from '../src/types.ts'
const { Server, utils } = ssh2

/**
 * Create isolated encrypted SSH and SFTP endpoints with no user configuration or installed helper.
 * @param options - Deterministic transport barriers and payload adaptation on Windows.
 * @returns Explicit endpoint plus observable child/file lifecycle barriers.
 */
export async function sshFixture(options: { holdExec?: boolean; holdWrite?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-ssh-'))
  const installRoot = join(root, 'runtime'); const workspace = join(root, 'workspace')
  await mkdir(installRoot, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 })
  // ssh2 1.17 rejects some leading-zero Ed25519 public keys; P-256 avoids that key serialization defect.
  const keys = utils.generateKeyPairSync('ecdsa', { bits: 256 }); const hosts = utils.generateKeyPairSync('ecdsa', { bits: 256 })
  const publicKey = utils.parseKey(keys.public); const host = utils.parseKey(hosts.public)
  if (publicKey instanceof Error || host instanceof Error) throw new Error('Invalid fixture keys')
  const privateKeyFile = join(root, 'key'); await writeFile(privateKeyFile, keys.private, { mode: 0o600 })
  const clients = new Set<Connection>(); const children = new Map<ChildProcessWithoutNullStreams, Promise<void>>()
  const handles = new Set<FileHandle>(); const commands: string[] = []
  const execEntered = Promise.withResolvers<undefined>(); const writeEntered = Promise.withResolvers<undefined>()
  let releaseExec: (() => void) | undefined; let releaseWrite: (() => void) | undefined
  const mapped = (path: string): string => {
    const value = path.replaceAll('\\', '/')
    const normalized = value.startsWith('/fixture/') ? join(root, value.slice('/fixture/'.length)) : resolve(path)
    if (normalized !== root && !normalized.startsWith(root + sep)) throw new Error('Fixture path escapes task root')
    return normalized
  }
  const server = new Server({ hostKeys: [hosts.private] }, (client) => {
    clients.add(client); client.on('error', () => { /* Rejected host keys and cancellation close test connections. */ })
    client.once('close', () => { clients.delete(client) })
    client.on('authentication', (auth) => {
      if (auth.method !== 'publickey' || auth.username !== 'fixture' || !auth.key.data.equals(publicKey.getPublicSSH())
          || (auth.signature !== undefined
            && (auth.blob === undefined || !publicKey.verify(auth.blob, auth.signature, auth.hashAlgo)))) auth.reject()
      else auth.accept()
    })
    client.on('session', (accept) => {
      const session = accept()
      session.on('sftp', (acceptSftp) => {
        const sftp = acceptSftp()
        const ids = new Map<string, FileHandle>(); let nextId = 0
        const fail = (id: number): void => { sftp.status(id, 4) }
        sftp.on('MKDIR', (id, path) => { void mkdir(mapped(path), { mode: 0o700 }).then(() => { sftp.status(id, 0) }, () => { fail(id) }) })
        sftp.on('OPEN', (id, path) => { void open(mapped(path), 'wx', 0o600).then((handle) => {
          handles.add(handle); const token = Buffer.from(String(++nextId)); ids.set(token.toString(), handle); sftp.handle(id, token)
        }, () => { fail(id) }) })
        sftp.on('WRITE', (id, handle, offset, data) => {
          const file = ids.get(handle.toString()); if (file === undefined) { fail(id); return }
          const write = (): void => { void file.write(data, 0, data.length, offset).then(() => { sftp.status(id, 0) }, () => { fail(id) }) }
          writeEntered.resolve(undefined)
          if (options.holdWrite) releaseWrite = write; else write()
        })
        sftp.on('CLOSE', (id, token) => {
          const handle = ids.get(token.toString()); if (handle === undefined) { fail(id); return }
          ids.delete(token.toString()); handles.delete(handle)
          void handle.close().then(() => { sftp.status(id, 0) }, () => { fail(id) })
        })
      })
      session.on('exec', (acceptExec, _reject, info) => {
        commands.push(info.command); execEntered.resolve(undefined)
        const launch = (): void => {
          const channel = acceptExec()
          // Windows loopback maps only deployment paths. The complete real supervisor body executes unchanged.
          const sourceEntry = fileURLToPath(new URL('../assets/remote-operation.mjs', import.meta.url))
          const child = spawn(process.execPath, [sourceEntry], { stdio: ['pipe', 'pipe', 'pipe'] })
          const closed = new Promise<void>((done) => { child.once('close', (code) => {
            children.delete(child); channel.exit(code ?? 1); channel.end(); done()
          }) })
          children.set(child, closed)
          child.on('error', () => { channel.destroy() }); child.stderr.pipe(channel.stderr)
          let input = ''
          channel.on('data', (bytes: Buffer) => {
            input += bytes.toString('utf8'); let end: number
            while ((end = input.indexOf('\n')) >= 0) {
              const value = JSON.parse(input.slice(0, end)) as Record<string, unknown>; input = input.slice(end + 1)
              if (typeof value.installRoot === 'string') value.installRoot = mapped(value.installRoot)
              if (typeof value.workspace === 'string') value.workspace = mapped(value.workspace)
              child.stdin.write(JSON.stringify(value) + '\n')
            }
          })
          channel.on('end', () => { child.stdin.end() })
          channel.once('close', () => { child.stdin.end() })
          let output = ''
          child.stdout.on('data', (bytes: Buffer) => {
            output += bytes.toString('utf8'); let end: number
            while ((end = output.indexOf('\n')) >= 0) {
              const line = output.slice(0, end); output = output.slice(end + 1)
              // Translate native fixture paths back to the configured remote POSIX namespace.
              const value: unknown = JSON.parse(line)
              const converted = JSON.stringify(value, (_key, item: unknown) => typeof item === 'string' && item.startsWith(root)
                ? '/fixture' + item.slice(root.length).replaceAll('\\', '/') : item)
              channel.write(converted + '\n')
            }
          })
        }
        if (options.holdExec) releaseExec = launch; else launch()
      })
    })
  })
  onTestFinished(async () => {
    for (const client of clients) client.end()
    const active = [...children]; for (const [child] of active) child.kill()
    await Promise.all(active.map(([, closed]) => closed))
    for (const handle of handles) await handle.close()
    await new Promise<void>((done) => { server.close(() => { done() }) })
    await rm(root, { recursive: true, force: true })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Fixture did not listen')
  const location: RuntimeLocation = { endpoint: { host: '127.0.0.1', port: address.port, username: 'fixture', privateKeyFile,
    hostKeySHA256: createHash('sha256').update(host.getPublicSSH()).digest('hex') }, node: '/fixture/node', installRoot: '/fixture/runtime', workspace: '/fixture/workspace' }
  return { root, installRoot, workspace, location, children, clients, commands,
    execEntered: execEntered.promise, writeEntered: writeEntered.promise,
    releaseExec: () => { releaseExec?.() }, releaseWrite: () => { releaseWrite?.() } }
}
