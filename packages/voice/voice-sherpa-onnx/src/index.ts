/** Local sherpa-onnx voice provider with transport-independent operations and an optional HTTP adapter. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subprocess'
import { sherpaOnnxEngine } from './engine.ts'
import type { DownloadOptions, ExtractArchive } from './model-cache.ts'
import { SHIPPED_MODELS } from './model-registry.ts'
import { mountHttpAdapter } from './http.ts'
import { SherpaVoiceOperations } from './operations.ts'

/** Voice model download settings. */
export interface Config {
  /** Maximum bytes requested by one HTTP range. Defaults to 8 MiB. */
  downloadSegmentBytes?: number
  /** Maximum concurrent HTTP range requests. Defaults to four. */
  downloadConcurrency?: number
  /** Maximum attempts for one HTTP range. Defaults to four. */
  downloadMaxAttempts?: number
  /** Initial exponential-backoff delay after a failed HTTP range. Defaults to one second. */
  downloadRetryDelayMs?: number
  /** Maximum duration without bytes from one HTTP range. Defaults to two minutes. */
  downloadRequestTimeoutMs?: number
}

const DEFAULT_DOWNLOAD_SEGMENT_BYTES = 8 * 1024 * 1024
const DEFAULT_DOWNLOAD_CONCURRENCY = 4
const DEFAULT_DOWNLOAD_MAX_ATTEMPTS = 4
const DEFAULT_DOWNLOAD_RETRY_DELAY_MS = 1000
const DEFAULT_DOWNLOAD_REQUEST_TIMEOUT_MS = 120_000

/** Loader schema for voice model download settings. */
export const Config: z<Config> = z.object({
  downloadSegmentBytes: z.number().default(DEFAULT_DOWNLOAD_SEGMENT_BYTES),
  downloadConcurrency: z.number().default(DEFAULT_DOWNLOAD_CONCURRENCY),
  downloadMaxAttempts: z.number().default(DEFAULT_DOWNLOAD_MAX_ATTEMPTS),
  downloadRetryDelayMs: z.number().default(DEFAULT_DOWNLOAD_RETRY_DELAY_MS),
  downloadRequestTimeoutMs: z.number().default(DEFAULT_DOWNLOAD_REQUEST_TIMEOUT_MS),
})

function resolveDownloadOptions(config: Config): DownloadOptions {
  const segmentBytes = config.downloadSegmentBytes ?? DEFAULT_DOWNLOAD_SEGMENT_BYTES
  const concurrency = config.downloadConcurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY
  const maxAttempts = config.downloadMaxAttempts ?? DEFAULT_DOWNLOAD_MAX_ATTEMPTS
  const retryDelayMs = config.downloadRetryDelayMs ?? DEFAULT_DOWNLOAD_RETRY_DELAY_MS
  const requestTimeoutMs = config.downloadRequestTimeoutMs ?? DEFAULT_DOWNLOAD_REQUEST_TIMEOUT_MS
  const values: ReadonlyArray<readonly [string, number]> = [
    ['downloadSegmentBytes', segmentBytes],
    ['downloadConcurrency', concurrency],
    ['downloadMaxAttempts', maxAttempts],
    ['downloadRetryDelayMs', retryDelayMs],
    ['downloadRequestTimeoutMs', requestTimeoutMs],
  ]
  for (const [key, value] of values) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`voice-sherpa-onnx: ${key} must be a positive safe integer`)
    }
  }
  return { segmentBytes, concurrency, maxAttempts, retryDelayMs, requestTimeoutMs }
}

/** Cordis plugin name. */
export const name = 'voice-sherpa-onnx'
/** Voice runtime and managed subprocess execution for native tar; HTTP is optional. */
export const inject = ['voice', 'subprocess']


/**
 * Build the production archive extractor over the managed subprocess seam.
 * Windows 10+ ships bsdtar; macOS and supported Linux distributions ship tar.
 * The entire archive is already downloaded before this call, so stdout is
 * ignored and bounded stderr is retained only for a useful extraction error.
 * @param ctx - plugin context that owns the managed subprocess service.
 * @returns archive extractor that rejects with bounded native-tar diagnostics.
 */
export function nativeTarExtractor(ctx: Context): ExtractArchive {
  return async (archivePath, cacheDir, signal) => {
    const handle = ctx.subprocess.spawn({
      argv: ['tar', '-xjf', archivePath, '-C', cacheDir, '--strip-components', '1'],
      cwd: cacheDir,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 4096 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 5000,
      signal,
    })
    const outcome = await handle.done
    if (outcome.exitCode === 0 && outcome.signal === null) return
    const stderr = handle.collected.stderr?.readFrom(0).text.trim()
    throw new Error(
      `native tar extraction failed (exit ${String(outcome.exitCode)}, signal ${String(outcome.signal)})${stderr === '' || stderr === undefined ? '' : `: ${stderr}`}`,
    )
  }
}

/**
 * Register the engine, models, and management operations independently of HTTP.
 * @param ctx - Plugin context owning operations and optional HTTP registration.
 * @param config - Segmented download, retry, and timeout settings.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const downloadOptions = resolveDownloadOptions(config)
  const extractArchive = nativeTarExtractor(ctx)
  ctx.effect(() => ctx.voice.registerEngine(sherpaOnnxEngine), 'voice-sherpa-onnx: engine')
  for (const definition of SHIPPED_MODELS) {
    ctx.effect(() => ctx.voice.registerModel(definition), 'voice-sherpa-onnx: model ' + definition.id)
  }
  ctx.effect(() => {
    const operations = new SherpaVoiceOperations(ctx.voice, extractArchive, downloadOptions)
    const unregister = ctx.voice.registerOperations(operations)
    return async () => {
      unregister()
      await operations.dispose()
    }
  }, 'voice-sherpa-onnx: operations')
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.webServer
    scope.effect(() => mountHttpAdapter(webServer, ctx.voice), 'voice-sherpa-onnx: HTTP adapter')
  })
}
