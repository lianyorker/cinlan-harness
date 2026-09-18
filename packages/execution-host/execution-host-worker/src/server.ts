/** Directory inspection ownership, cancellation settlement, and sanitized wire results. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-execution-host'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { ResolvedConfig } from './config.ts'
import {
  PROTOCOL_VERSION, cancelParamsSchema, initializeParamsSchema, inspectDirectoryParamsSchema,
  shutdownParamsSchema,
} from './protocol.ts'
import type { DirectoryInspection, InspectDirectoryParams, WorkerInfo, WorkerResult } from './protocol.ts'

interface Operation {
  controller: AbortController
  settled: Promise<WorkerResult<DirectoryInspection>>
}

function failure(code: string, message: string): WorkerResult<never> {
  return { ok: false, error: { code, message } }
}

function resultBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function cancelled(signal: AbortSignal): WorkerResult<never> {
  return signal.reason === 'OPERATION_TIMEOUT'
    ? failure('OPERATION_TIMEOUT', 'Directory inspection timed out')
    : failure('CANCELLED', 'Directory inspection was cancelled')
}

function relativePath(path: string): string | undefined {
  if (/^[\\/]/.test(path) || path.includes(':') || path.includes('\0')) return undefined
  const parts = path.split(/[\\/]/)
  if (parts.some(part => part.trimEnd() === '..')) return undefined
  return parts.filter(part => part !== '' && part !== '.').join('/')
}

/** Per-plugin worker state; disposal joins every owned filesystem operation. */
export class WorkerServer {
  private readonly active = new Map<string, Operation>()
  private readonly completed = new Set<string>()
  private readonly roots = new Map<string, FsTarget>()
  private initialized = false
  private stopping = false

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  /**
   * Resolve every configured root before serving requests. Invalid roots fail plugin activation.
   * @returns Settlement of root filesystem checks.
   */
  async prepare(): Promise<void> {
    for (const root of this.config.roots) {
      const target = await this.ctx.fs.resolve(root.path)
      if ((await this.ctx.fs.stat(target))?.type !== 'directory') {
        throw new Error('execution-host-worker: an exported root is not a directory')
      }
      this.roots.set(root.id, target)
    }
    if (resultBytes({ ok: true, value: this.info() }) > this.config.maxResultBytes) {
      throw new Error('execution-host-worker: configured roots and identity exceed maxResultBytes')
    }
  }

  private info(): WorkerInfo {
    return {
      protocolVersion: PROTOCOL_VERSION,
      executionHost: this.ctx.executionHost.current(),
      roots: this.config.roots,
      capabilities: ['directory-inspection'],
    }
  }

  /**
   * Process a parsed JSON-RPC request; provider failures return sanitized results.
   * @param method - Worker method name.
   * @param params - Untrusted request parameters.
   * @returns A worker success or machine-coded failure.
   */
  async handle(method: string, params: Record<string, unknown>): Promise<WorkerResult<unknown>> {
    if (this.stopping) return failure('CANCELLED', 'Worker is shutting down')
    if (method === 'initialize') {
      const parsed = initializeParamsSchema.safeParse(params)
      if (!parsed.success) return failure('INVALID_REQUEST', 'Invalid initialize parameters')
      if (parsed.data.protocolVersion !== PROTOCOL_VERSION) return failure('UNSUPPORTED_VERSION', 'Unsupported worker protocol version')
      await this.ctx.get('loader')?.await()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Shutdown may run during Loader settlement.
      if (this.stopping) return failure('CANCELLED', 'Worker is shutting down')
      this.initialized = true
      return { ok: true, value: this.info() }
    }
    if (method === 'shutdown') {
      if (!shutdownParamsSchema.safeParse(params).success) return failure('INVALID_REQUEST', 'Invalid shutdown parameters')
      await this.dispose()
      return { ok: true, value: {} }
    }
    if (!this.initialized) return failure('INVALID_REQUEST', 'Initialize the worker before requesting operations')
    if (method === 'cancel') {
      const parsed = cancelParamsSchema.safeParse(params)
      if (!parsed.success) return failure('INVALID_REQUEST', 'Invalid cancel parameters')
      const operation = this.active.get(parsed.data.operationId)
      if (operation) {
        operation.controller.abort()
        await operation.settled
      } else if (!this.completed.has(parsed.data.operationId)) {
        return failure('INVALID_REQUEST', 'Unknown or expired operation ID')
      }
      return { ok: true, value: { settled: true } }
    }
    if (method !== 'inspectDirectory') return failure('INVALID_REQUEST', 'Unsupported worker method')
    const parsed = inspectDirectoryParamsSchema.safeParse(params)
    if (!parsed.success) return failure('INVALID_REQUEST', 'Invalid directory inspection parameters')
    const request = parsed.data
    if (request.expectedHostId !== this.ctx.executionHost.current().hostId) return failure('STALE_HOST', 'Execution host identity changed')
    if (this.active.has(request.operationId) || this.completed.has(request.operationId)) {
      return failure('INVALID_REQUEST', 'Operation ID is already in use')
    }
    if (this.active.size >= this.config.maxConcurrentOperations) return failure('BUSY', 'Worker operation limit reached')
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort('OPERATION_TIMEOUT') }, this.config.operationTimeoutMs)
    const settled = this.inspect(request, controller.signal).catch(() => controller.signal.aborted
      ? cancelled(controller.signal)
      : failure('OPERATION_FAILED', 'Directory inspection failed'))
      .finally(() => {
        clearTimeout(timer)
        this.active.delete(request.operationId)
        this.completed.add(request.operationId)
        for (const id of this.completed) {
          if (this.completed.size <= this.config.maxCompletedOperations) break
          this.completed.delete(id)
        }
      })
    this.active.set(request.operationId, { controller, settled })
    return settled
  }

  private async inspect(request: InspectDirectoryParams, signal: AbortSignal): Promise<WorkerResult<DirectoryInspection>> {
    const root = this.roots.get(request.rootId)
    if (!root) return failure('ROOT_UNKNOWN', 'Unknown exported root')
    const path = relativePath(request.path)
    if (path === undefined) return failure('PATH_OUTSIDE_ROOT', 'Path must stay inside the exported root')
    const target = await this.ctx.fs.resolve(path || '.', { cwd: this.ctx.fs.processPath(root), signal })
    signal.throwIfAborted()
    if (!this.ctx.fs.contains(root, target)) return failure('PATH_OUTSIDE_ROOT', 'Path must stay inside the exported root')
    const info = await this.ctx.fs.stat(target, signal)
    signal.throwIfAborted()
    if (info?.type !== 'directory') return failure('NOT_DIRECTORY', 'Requested path is not a directory')
    const entries = await this.ctx.fs.listDir(target, signal)
    signal.throwIfAborted()
    const selected: { name: string; type: 'file' | 'directory' | 'symlink' | 'other' }[] = []
    const response = {
      executionHostId: this.ctx.executionHost.current().hostId,
      rootId: request.rootId,
      path,
      entries: selected,
      truncated: false,
    }
    const result: WorkerResult<DirectoryInspection> = { ok: true, value: response }
    if (resultBytes(result) > this.config.maxResultBytes) return failure('INVALID_REQUEST', 'Inspection metadata exceeds the result byte limit')
    for (const entry of entries) {
      if (selected.length >= this.config.maxEntries) { response.truncated = true; break }
      const metadata = await this.ctx.fs.lstat(entry.name, { cwd: this.ctx.fs.processPath(target) }, signal)
      signal.throwIfAborted()
      selected.push({ name: entry.name, type: metadata?.type ?? entry.type })
      if (resultBytes(result) > this.config.maxResultBytes) {
        selected.pop()
        response.truncated = true
        break
      }
    }
    if (request.expectedHostId !== this.ctx.executionHost.current().hostId) return failure('STALE_HOST', 'Execution host identity changed')
    return result
  }

  /** @returns Settlement of every operation after rejecting new work and requesting cancellation. */
  async dispose(): Promise<void> {
    this.stopping = true
    for (const operation of this.active.values()) operation.controller.abort()
    await Promise.all([...this.active.values()].map(operation => operation.settled))
  }
}
