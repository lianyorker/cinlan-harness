/** Operation-owned authenticated SSH2/SFTP transport for the fixed remote installer program. */
import { readFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import ssh2, { type ClientChannel, type SFTPWrapper } from 'ssh2'
const { Client, utils } = ssh2
import { z } from 'zod'
import { sha256, type RuntimeArtifact } from './artifact.ts'
import type { RuntimeGeneration, RuntimeInspection, RuntimeLimits, RuntimeLocation } from './types.ts'

/** Internal marker for SSH authentication, connection, channel, or SFTP transport failures. */
export class RuntimeConnectionError extends Error {
  /**
   * Preserve the local cause while exposing only a stable category upstream.
   * @param cause - Raw transport error retained inside the Host process.
   */
  constructor(cause: unknown) {
    super('SSH runtime transport failed', { cause })
    this.name = 'RuntimeConnectionError'
  }
}

const connectionFailure = (cause: unknown): RuntimeConnectionError =>
  cause instanceof RuntimeConnectionError ? cause : new RuntimeConnectionError(cause)

const inspectionSchema = z.object({
  state: z.enum(['missing', 'installed']), platform: z.string(), arch: z.string(), node: z.string(), nodeVersion: z.string(),
  installRoot: z.string(), generation: z.string().regex(/^[0-9a-f]{64}$/u).transform(value => value as RuntimeGeneration),
  directory: z.string().optional(), version: z.string().optional(), sourceCommit: z.string().optional(), protocol: z.number().optional(),
  helper: z.string().optional(), helperHash: z.string().optional(),
  bootstrapPath: z.string().optional(), bootstrapHash: z.string().optional(),
}).strict()
const responseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage'), directory: z.string(), platform: z.string(), arch: z.string(), node: z.string(), nodeVersion: z.string(),
    installRoot: z.string(), generation: z.string() }).strict(),
  z.object({ type: z.literal('result'), value: inspectionSchema }).strict(),
  z.object({ type: z.literal('error'), message: z.string() }).strict(),
])

function quoted(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'" }

async function upload(sftp: SFTPWrapper, stage: string, artifact: RuntimeArtifact, signal: AbortSignal): Promise<void> {
  let unavailable = false
  sftp.once('close', () => { unavailable = true })
  const invoke = <T>(operation: (callback: (error: Error | undefined | null, value: T) => void) => void): Promise<T> =>
    new Promise((resolve, reject) => {
      if (unavailable) { reject(new RuntimeConnectionError(new Error('SFTP channel is closed'))); return }
      const closed = (): void => { reject(new RuntimeConnectionError(new Error('SFTP channel closed during transfer'))) }
      sftp.once('close', closed)
      operation((error, value) => {
        sftp.off('close', closed)
        if (error) reject(connectionFailure(error)); else resolve(value)
      })
    })
  const directories = new Set([stage])
  for (const file of [...artifact.manifest.files, { path: 'runtime-manifest.json', sha256: artifact.generation, size: artifact.bytes.length, executable: false }]) {
    signal.throwIfAborted()
    const destination = posix.join(stage, file.path)
    const parents: string[] = []
    for (let parent = posix.dirname(destination); !directories.has(parent); parent = posix.dirname(parent)) parents.unshift(parent)
    for (const directory of parents) {
      await invoke<void>((callback) => { sftp.mkdir(directory, { mode: 0o700 }, (error) => { callback(error, undefined) }) })
      directories.add(directory)
    }
    const bytes = file.path === 'runtime-manifest.json' ? artifact.bytes : await readFile(join(artifact.root, file.path))
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error('Runtime artifact changed during transfer: ' + file.path)
    const handle = await invoke<Buffer>((callback) => {
      sftp.open(destination, 'wx', { mode: file.executable ? 0o700 : 0o600 }, callback)
    })
    try {
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        signal.throwIfAborted()
        await invoke<void>((callback) => {
          sftp.write(handle, bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset,
            (error) => { callback(error, undefined) })
        })
      }
    } finally {
      if (!signal.aborted) await invoke<void>((callback) => { sftp.close(handle, (error) => { callback(error, undefined) }) })
    }
  }
}

/**
 * Inspect or stage one release through its own pinned connection and supervised Node process.
 * @param location - Explicit endpoint and remote paths.
 * @param generation - Exact manifest digest being inspected or installed.
 * @param limits - Deployment operation budgets.
 * @param artifact - Complete verified local tree for install; absent for inspection.
 * @param signal - Task-owned cancellation, never a UI observation's lifetime.
 * @returns Validated remote observation after the supervisor and SSH channel close.
 */
export async function runRemoteOperation(location: RuntimeLocation, generation: RuntimeGeneration, limits: RuntimeLimits,
  artifact: RuntimeArtifact | undefined, signal: AbortSignal): Promise<RuntimeInspection> {
  signal.throwIfAborted()
  const client = new Client()
  const connection = { started: false }
  let channel: ClientChannel | undefined
  let stopTimer: NodeJS.Timeout | undefined
  let failure: Error | undefined
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(limits.operationTimeoutMs)])
  const closed = new Promise<void>((resolve) => { client.once('close', () => { resolve() }) })
  const abort = (): void => {
    channel?.end()
    stopTimer ??= setTimeout(() => { client.destroy() }, limits.shutdownTimeoutMs)
    if (channel === undefined) client.destroy()
  }
  client.on('error', (error) => { failure ??= connectionFailure(error) })
  lifetime.addEventListener('abort', abort, { once: true })
  let key: Buffer | undefined
  try {
    key = await readFile(location.endpoint.privateKeyFile)
    lifetime.throwIfAborted()
    if (utils.parseKey(key) instanceof Error) throw new Error('Configured SSH private key is invalid')
    const privateKey = key
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error): void => {
        client.off('ready', ready); client.off('error', failed); client.off('close', disconnected)
        if (error) reject(connectionFailure(error)); else resolve()
      }
      const ready = (): void => { done() }
      const failed = (error: Error): void => { done(error) }
      const disconnected = (): void => { done(new Error('SSH connection closed before authentication')) }
      client.once('ready', ready); client.once('error', failed); client.once('close', disconnected)
      try {
        client.connect({ ...location.endpoint, privateKey, hostHash: 'sha256',
          hostVerifier: (hash: string) => hash === location.endpoint.hostKeySHA256,
          authHandler: ['publickey'], agentForward: false, readyTimeout: limits.operationTimeoutMs })
        connection.started = true
      } catch (error) { done(error instanceof Error ? error : new Error(String(error))) }
    })
    key.fill(0)
    lifetime.throwIfAborted()
    const source = await readFile(new URL('../assets/remote-operation.mjs', import.meta.url), 'utf8')
    const command = ['env', '-i', 'PATH=/usr/bin:/bin', location.node, '--disable-sigusr1', '--input-type=module', '--eval', source].map(quoted).join(' ')
    const open = <T>(operation: (callback: (error: Error | undefined, value: T) => void) => void): Promise<T> =>
      new Promise((resolve, reject) => {
        const disconnected = (): void => {
          const reason = lifetime.reason instanceof Error ? lifetime.reason : new Error(String(lifetime.reason))
          reject(lifetime.aborted ? reason : new RuntimeConnectionError(new Error('SSH connection closed during channel acquisition')))
        }
        client.once('close', disconnected)
        operation((error, value) => {
          client.off('close', disconnected)
          if (error) reject(connectionFailure(error)); else resolve(value)
        })
      })
    const sftp = artifact === undefined ? undefined : await open<SFTPWrapper>((callback) => { client.sftp(callback) })
    lifetime.throwIfAborted()
    channel = await open<ClientChannel>((callback) => { client.exec(command, callback) })
    channel.on('error', (error: Error) => { failure ??= connectionFailure(error) })
    lifetime.throwIfAborted()
    const control = channel
    return await new Promise<RuntimeInspection>((resolve, reject) => {
      let buffer = ''
      const decoder = new StringDecoder('utf8')
      let responseBytes = 0
      let result: RuntimeInspection | undefined
      let operation: Promise<void> | undefined
      let receivedStage = false
      let error: Error | undefined
      const fail = (cause: unknown): void => { error ??= cause instanceof Error ? cause : new Error(String(cause)); control.end() }
      control.stderr.resume()
      control.on('error', (error: Error) => { fail(connectionFailure(error)) })
      control.on('data', (bytes: Buffer) => {
        responseBytes += bytes.length
        if (responseBytes > limits.maxResponseBytes) { fail(new Error('Remote installer response exceeds limit')); return }
        buffer += decoder.write(bytes)
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          try {
            const response = responseSchema.parse(JSON.parse(line))
            if (response.type === 'error') { fail(new Error(response.message)); continue }
            if (response.type === 'result') {
              if (result !== undefined || response.value.generation !== generation || response.value.installRoot !== location.installRoot) throw new Error('Remote runtime identity differs from request')
              result = response.value
            } else {
              if (receivedStage || artifact === undefined || sftp === undefined || response.generation !== generation
                  || response.installRoot !== location.installRoot
                  || !response.directory.startsWith(posix.join(location.installRoot, '.staging') + '/operation-')
                  || response.directory.slice(posix.join(location.installRoot, '.staging').length + 1).includes('/')) throw new Error('Invalid remote staging ownership')
              receivedStage = true
              operation = upload(sftp, response.directory, artifact, lifetime).then(() => {
                lifetime.throwIfAborted(); control.write(JSON.stringify({ action: 'publish' }) + '\n')
              }).catch(fail)
            }
          } catch (cause) { fail(cause) }
        }
      })
      control.once('close', (code: number | undefined) => {
        sftp?.end()
        void (async () => {
          await operation
          if (lifetime.aborted) throw lifetime.reason
          if (error) throw error
          if (result === undefined || code !== 0 || failure) throw failure ?? new Error('Remote installation outcome is unconfirmed')
          return result
        })().then(resolve, reject)
      })
      if (lifetime.aborted) abort()
      else control.write(JSON.stringify({ action: artifact === undefined ? 'inspect' : 'install', generation,
        installRoot: location.installRoot, workspace: location.workspace, limits }) + '\n')
    })
  } finally {
    key?.fill(0)
    lifetime.removeEventListener('abort', abort)
    if (stopTimer) clearTimeout(stopTimer)
    client.destroy()
    if (connection.started) await closed
  }
}
