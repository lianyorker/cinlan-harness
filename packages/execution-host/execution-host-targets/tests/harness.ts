/** Real OpenSSH client, isolated ssh2 server and production Loader rows for target tests. */
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { Server, utils, type Connection } from 'ssh2'
import { onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import ExecutionHostLocal from '@deepseek-ai/dsh-execution-host-local'
import LocalFs from '@deepseek-ai/dsh-fs-local'
import * as Worker from '@deepseek-ai/dsh-execution-host-worker'
import Targets from '../src/index.ts'
import type { Config } from '../src/config.ts'

const slash = (path: string): string => path.replaceAll('\\', '/')

function createAppReady(): { service: AppReady; commit(): void } {
  const listeners = new Set<() => void>()
  return {
    service: { onReady(listener) { listeners.add(listener); return () => { listeners.delete(listener) } } },
    commit() { for (const listener of listeners) listener(); listeners.clear() },
  }
}

async function load(ctx: Context, root: string, rows: readonly object[], modules: ReadonlyMap<string, unknown>): Promise<void> {
  await mkdir(root, { recursive: true })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const file = join(root, 'cordis.yml')
  await writeFile(file, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected execution-host fixture import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
}

/**
 * Allocate independent SSH keys, trust files, directories and cleanup ownership.
 * @returns source-Loader registry and real SSH worker factory.
 */
export async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-execution-targets-'))
  const cleanups: (() => Promise<void>)[] = []
  onTestFinished(async () => {
    try { for (const cleanup of cleanups.reverse()) await cleanup() }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  // ssh2 1.17 drops valid leading-zero Ed25519 public bytes; P-256 fixtures avoid that key generator defect.
  const clientKey = utils.generateKeyPairSync('ecdsa', { bits: 256 })
  const parsed = utils.parseKey(clientKey.private)
  if (parsed instanceof Error) throw parsed
  const privateFile = join(root, 'client_key')
  await writeFile(privateFile, clientKey.private, { mode: 0o600 })
  await chmod(privateFile, 0o600)
  if (process.platform === 'win32') {
    const acl = spawnSync('icacls.exe', [privateFile, '/inheritance:r', '/grant:r', userInfo().username + ':(F)'], {
      stdio: 'ignore', windowsHide: true, timeout: 5000,
    })
    if (acl.status !== 0) throw new Error('could not restrict temporary OpenSSH private-key permissions', { cause: acl.error })
  }
  const configPath = join(root, 'ssh_config')
  const knownHosts = join(root, 'known_hosts')
  let configuration = ''
  let trust = ''
  let registryIndex = 0

  return {
    root,
    configPath,
    /** Mount one real persisted target registry, optionally reusing the private storage directory. */
    async registry(overrides: Partial<Config> = {}) {
      const ctx = new Context()
      cleanups.push(() => ctx.fiber.dispose())
      const rows = [
        { name: '@deepseek-ai/dsh-storage' },
        { name: '@deepseek-ai/dsh-storage-json', config: { root: join(root, 'storage') } },
        { name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
        { name: '@deepseek-ai/dsh-execution-host-local' },
        { name: '@deepseek-ai/dsh-subprocess-local' },
        { name: '@deepseek-ai/dsh-execution-host-targets', config: { sshConfigFile: configPath, ...overrides } },
      ]
      await load(ctx, join(root, 'registry-' + String(++registryIndex)), rows, new Map<string, unknown>([
        ['@deepseek-ai/dsh-storage', Storage], ['@deepseek-ai/dsh-storage-json', StorageJson],
        ['@deepseek-ai/dsh-storage-domain', StorageDomain], ['@deepseek-ai/dsh-execution-host-local', ExecutionHostLocal],
        ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess], ['@deepseek-ai/dsh-execution-host-targets', Targets],
      ]))
      const entry = [...ctx.loader.entries()].find(value => value.options.name === '@deepseek-ai/dsh-execution-host-targets')
      const fiber = entry?.fiber
      if (fiber === undefined) throw new Error('target registry Loader entry did not activate')
      return { ctx, targets: ctx.executionHostTargets, fiber }
    },
    /** Start a real authenticated SSH server; only the supported fixed worker command is accepted. */
    async worker(
      alias: string, options: { roots?: boolean; wrongHostKey?: boolean; denyAuthentication?: boolean; process?: boolean } = {},
    ) {
      const serverKey = utils.generateKeyPairSync('ecdsa', { bits: 256 })
      const wrongKey = utils.generateKeyPairSync('ecdsa', { bits: 256 })
      const directory = join(root, alias, 'export')
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, alias + '.txt'), alias)
      const workspace = fileURLToPath(new URL('../../../..', import.meta.url))
      const processHome = join(root, alias, 'process-home')
      if (options.process) {
        const profile = join(processHome, 'profiles', 'execution-host')
        const modules = join(profile, 'node_modules', '@deepseek-ai')
        await mkdir(modules, { recursive: true })
        await symlink(join(workspace, 'packages', 'bundle', 'execution-host-app'), join(modules, 'dsh-execution-host-app'),
          process.platform === 'win32' ? 'junction' : 'dir')
        await writeFile(join(profile, 'package.json'), JSON.stringify({
          name: 'ssh-worker-fixture', private: true, type: 'module',
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-execution-host-app'], patchReload: 'startup' } },
        }))
        await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'execution-host-worker', config: {
          roots: [{ id: 'project', label: 'Project', path: directory }],
        } }]))
      }
      const childRuns: Promise<void>[] = []
      const childPids: number[] = []
      const clients = new Set<Connection>()
      const workers: Context[] = []
      const failures: unknown[] = []
      const commands: string[] = []
      const authentication: string[] = []
      const frames: string[] = []
      let held: Buffer[] | undefined
      let heldText = ''
      let releaseInput: (() => void) | undefined
      let inspectionEntered: (() => void) | undefined
      let cancellationEntered: (() => void) | undefined
      let sequence = 0
      let protocolOutput: PassThrough | undefined
      let replacement: { readonly value: unknown } | undefined
      const exited = Promise.withResolvers<undefined>()
      const server = new Server({ hostKeys: [serverKey.private] }, (client) => {
        clients.add(client)
        client.on('close', () => { clients.delete(client) })
        client.on('error', () => { /* Authentication refusal and test disconnects close this owned connection. */ })
        client.on('authentication', (auth) => {
          authentication.push(auth.method + ':' + auth.username + (auth.method === 'publickey'
            ? ':' + String(auth.key.data.equals(parsed.getPublicSSH())) + ':' + String(auth.signature !== undefined) : ''))
          if (options.denyAuthentication || auth.method !== 'publickey' || auth.username !== 'worker'
            || !auth.key.data.equals(parsed.getPublicSSH())) { auth.reject(['publickey']); return }
          if (auth.signature !== undefined && ! parsed.verify(auth.blob!, auth.signature, auth.hashAlgo)) {
            auth.reject(['publickey']); return
          }
          auth.accept()
        })
        client.on('ready', () => {
          client.on('session', (accept) => {
            const session = accept()
            session.on('exec', (acceptExec, reject, info) => {
              if (info.command !== 'dsh --profile execution-host') { reject(); return }
              commands.push(info.command)
              const channel = acceptExec()
              const input = new PassThrough()
              const output = protocolOutput = new PassThrough()
              output.on('data', (data: Buffer) => {
                let text = data.toString('utf8')
                if (replacement !== undefined) {
                  const frame: unknown = JSON.parse(text)
                  if (typeof frame !== 'object' || frame === null || !('result' in frame)) throw new Error('expected worker result frame')
                  frame.result = replacement.value
                  replacement = undefined
                  text = JSON.stringify(frame) + '\n'
                }
                frames.push(text)
                channel.write(text)
              })
              channel.on('data', (data: Buffer) => {
                if (held === undefined) { input.write(data); return }
                held.push(Buffer.from(data))
                heldText += data.toString('utf8')
                if (heldText.includes('"method":"inspectDirectory"')) inspectionEntered?.()
                if (heldText.includes('"method":"cancel"')) cancellationEntered?.()
              })
              channel.on('end', () => { input.end() })
              channel.on('close', () => { input.end() })
              releaseInput = () => {
                const chunks = held
                held = undefined
                heldText = ''
                if (chunks !== undefined) input.write(Buffer.concat(chunks))
              }
              if (options.process) {
                const child = spawn(process.execPath, [
                  '--import', pathToFileURL(join(workspace, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href,
                  join(workspace, 'apps', 'cli', 'src', 'bin.ts'), '--profile', 'execution-host',
                ], {
                  cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
                  env: { ...process.env, DSH_HOME: processHome, TSX_TSCONFIG_PATH: join(workspace, 'tsconfig.json') },
                })
                if (child.pid !== undefined) childPids.push(child.pid)
                input.pipe(child.stdin)
                child.stdout.pipe(output)
                child.stderr.pipe(channel.stderr)
                const completed = new Promise<void>((resolve) => {
                  child.once('error', (error) => { failures.push(error) })
                  child.once('close', (code) => {
                    channel.exit(code ?? 1)
                    channel.end()
                    exited.resolve(undefined)
                    resolve()
                  })
                })
                childRuns.push(completed)
                cleanups.push(async () => {
                  if (child.exitCode === null && child.signalCode === null) child.kill()
                  await completed
                })
                return
              }
              const ctx = new Context()
              workers.push(ctx)
              const ready = createAppReady()
              provideCmdline(ctx, { args: [], ready: ready.service, exit: (code) => {
                void ctx.fiber.dispose().then(
                  () => { channel.exit(code); channel.end(); exited.resolve(undefined) },
                  (error: unknown) => { failures.push(error); channel.end() },
                )
              } })
              const roots = options.roots === false ? [] : [{ id: 'project', label: 'Project', path: directory }]
              void load(ctx, join(root, alias, 'worker-' + String(++sequence)), [
                { name: '@deepseek-ai/dsh-execution-host-local' }, { name: '@deepseek-ai/dsh-fs-local' },
                { name: '@deepseek-ai/dsh-subprocess-local' },
                { name: '@deepseek-ai/dsh-execution-host-worker', config: { roots } },
              ], new Map<string, unknown>([
                ['@deepseek-ai/dsh-execution-host-local', ExecutionHostLocal], ['@deepseek-ai/dsh-fs-local', LocalFs],
                ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess],
                ['@deepseek-ai/dsh-execution-host-worker', {
                  ...Worker, apply: (owner: Context, config: Worker.WorkerConfig) => Worker.apply(owner, { ...config, input, output }),
                }],
              ])).then(() => { ready.commit() }, (error: unknown) => { failures.push(error); channel.exit(1); channel.end() })
            })
          })
        })
      })
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      const address = server.address()
      if (typeof address === 'string' || address === null) throw new Error('SSH fixture requires a TCP address')
      const port = address.port
      cleanups.push(async () => {
        releaseInput?.()
        for (const client of clients) client.end()
        for (const ctx of workers) await ctx.fiber.dispose()
        await Promise.all(childRuns)
        await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
        if (failures.length > 0) throw new AggregateError(failures, 'SSH worker fixture failed')
      })
      configuration += [
        'Host ' + alias, '  HostName 127.0.0.1', '  Port ' + String(port), '  User worker',
        '  IdentityFile "' + slash(privateFile) + '"', '  IdentitiesOnly yes',
        '  UserKnownHostsFile "' + slash(knownHosts) + '"', '  GlobalKnownHostsFile none', '',
      ].join('\n')
      trust += '[127.0.0.1]:' + String(port) + ' ' + (options.wrongHostKey ? wrongKey.public : serverKey.public) + '\n'
      await writeFile(configPath, configuration)
      await writeFile(knownHosts, trust)
      return {
        alias, directory, commands, frames, workers, authentication, childPids, exited: exited.promise,
        writeProtocol(frame: string) { protocolOutput?.write(frame) },
        replaceNextResult(value: unknown) { replacement = { value } },
        hold() {
          held = []
          heldText = ''
          const entered = new Promise<void>((resolve) => { inspectionEntered = resolve })
          const cancelled = new Promise<void>((resolve) => { cancellationEntered = resolve })
          return { entered, cancelled, release: () => { releaseInput?.() } }
        },
        drop() { for (const client of clients) client.end() },
      }
    },
  }
}
