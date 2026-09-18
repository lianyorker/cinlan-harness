/** Deployment configuration validation for the stdio directory worker. */

import type { Readable, Writable } from 'node:stream'
import { posix, win32 } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type { ExportedRoot } from './protocol.ts'

/** Worker deployment bounds and runtime-only stream overrides for source Loader tests. */
export interface WorkerConfig {
  /** Explicitly exported absolute directory paths; empty by default. */
  roots?: ExportedRoot[]
  /** Milliseconds before aborting an inspection; acknowledgment still waits for settlement. */
  operationTimeoutMs?: number
  /** UTF-8 byte cap for complete JSON-RPC lines, excluding newline. */
  maxFrameBytes?: number
  /** UTF-8 byte cap for complete WorkerResult values. */
  maxResultBytes?: number
  /** Maximum directory entries emitted by one inspection. */
  maxEntries?: number
  /** Maximum simultaneous inspections. */
  maxConcurrentOperations?: number
  /** Maximum completed IDs retained for cancellation races. */
  maxCompletedOperations?: number
  /** Test-only input override; production reads process.stdin. */
  input?: Readable
  /** Test-only output override; production writes process.stdout. */
  output?: Writable
}

/** Validated deployment fields; transport streams are runtime-only. */
export type ResolvedConfig = Required<Omit<WorkerConfig, 'input' | 'output'>>

/** Cordis configuration; process streams are not YAML fields. */
export const Config: Schema<WorkerConfig> = Schema.object({
  roots: Schema.array(Schema.object({
    id: Schema.string().required(), label: Schema.string().required(), path: Schema.string().required(),
  })).default([]),
  operationTimeoutMs: Schema.number().default(30000),
  maxFrameBytes: Schema.number().default(262144),
  maxResultBytes: Schema.number().default(131072),
  maxEntries: Schema.number().default(1000),
  maxConcurrentOperations: Schema.number().default(16),
  maxCompletedOperations: Schema.number().default(256),
})

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const configSchema = z.object({
  roots: z.array(z.strictObject({
    id: z.string().min(1).max(128), label: z.string().min(1),
    path: z.string().min(1).refine(path => posix.isAbsolute(path) || win32.isAbsolute(path)),
  })),
  operationTimeoutMs: positive.max(2147483647),
  maxFrameBytes: positive.min(1024),
  maxResultBytes: positive.min(256),
  maxEntries: positive,
  maxConcurrentOperations: positive,
  maxCompletedOperations: positive,
}).refine(value => new Set(value.roots.map(root => root.id)).size === value.roots.length, {
  message: 'Exported root IDs must be unique',
}).refine(value => value.maxResultBytes + 1024 <= value.maxFrameBytes, {
  message: 'maxFrameBytes must reserve 1024 bytes beyond maxResultBytes for JSON-RPC metadata',
})

/**
 * Resolve and validate deployment fields before any stream listeners attach.
 * @param config - Cordis configuration with optional runtime stream overrides.
 * @returns Complete bounds and explicit exported roots.
 */
export function resolveConfig(config: WorkerConfig): ResolvedConfig {
  return configSchema.parse(Config(config))
}
