/** Source-loader harness with real host, filesystem, and subprocess providers. */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { AppReady } from '@deepseek-ai/dsh-cmdline'
import ExecutionHostLocal from '@deepseek-ai/dsh-execution-host-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as Worker from '../src/index.ts'
import { createWorkerTransport, workerInfoSchema, workerResultSchema } from '../src/protocol.ts'
import type { WorkerConfig } from '../src/index.ts'

/** Launcher readiness fixture; the source Loader commits it after actual settlement. */
function createReadiness(): { service: AppReady; commit(): void } {
  let committed = false
  const listeners = new Set<() => void>()
  return {
    service: {
      onReady(listener) {
        if (committed) {
          listener()
          return () => {}
        }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    commit() {
      if (committed) return
      committed = true
      for (const listener of listeners) listener()
      listeners.clear()
    },
  }
}

export async function createHarness(config: WorkerConfig = {}, options: { deferReady?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-worker-'))
  const root = join(directory, 'exported')
  const outside = join(directory, 'outside')
  const input = new PassThrough()
  const output = new PassThrough()
  const client = createWorkerTransport(output, input, config.maxFrameBytes ?? 262144)
  const ctx = new Context()
  const ready = createReadiness()
  const exits: number[] = []
  const exitRequested = Promise.withResolvers<undefined>()
  let exitTask: Promise<void> | undefined
  provideCmdline(ctx, {
    args: [], ready: ready.service,
    exit(code) {
      exits.push(code)
      exitTask ??= ctx.fiber.dispose()
      exitRequested.resolve(undefined)
    },
  })
  const frames: string[] = []
  const outputListener = (chunk: Buffer): void => { frames.push(chunk.toString('utf8')) }
  output.on('data', outputListener)
  const dispose = async (): Promise<void> => {
    await ctx.fiber.dispose()
    client.close()
    input.destroy()
    output.off('data', outputListener)
    output.destroy()
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
  try {
    await mkdir(root)
    await mkdir(outside)
    const deployment = { roots: [{ id: 'project', label: 'Project', path: root }], ...config }
    await writeFile(join(directory, 'cordis.yml'), [
      '- name: "@deepseek-ai/dsh-execution-host-local"',
      '- name: "@deepseek-ai/dsh-fs-local"',
      '- name: "@deepseek-ai/dsh-subprocess-local"',
      '- name: "@deepseek-ai/dsh-execution-host-worker"',
      '  config: ' + JSON.stringify(deployment),
      '',
    ].join('\n'))
    ctx.baseUrl = pathToFileURL(directory).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-execution-host-local', ExecutionHostLocal],
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
      ['@deepseek-ai/dsh-execution-host-worker', {
        ...Worker,
        apply: (context: Context, settings: WorkerConfig) => Worker.apply(context, { ...settings, input, output }),
      }],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error('Unexpected test module: ' + specifier)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(directory, 'cordis.yml')).href } })
    await ctx.loader.await()
    client.start()
    if (!options.deferReady) ready.commit()
    return {
      ctx, root, outside, input, output, client, frames, dispose, ready, exits,
      async waitForExit() { await exitRequested.promise; await exitTask },
      async initialize() {
        const result = workerResultSchema(workerInfoSchema).parse(await client.request('initialize', { protocolVersion: 1 }))
        if (!result.ok) throw new Error('Worker initialization failed: ' + result.error.code)
        return result.value
      },
      async inspect(operationId: string, path = '', expectedHostId = ctx.executionHost.current().hostId, rootId = 'project') {
        return client.request('inspectDirectory', { operationId, expectedHostId, rootId, path })
      },
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
