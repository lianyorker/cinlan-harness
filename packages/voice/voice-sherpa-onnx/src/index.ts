/**
 * sherpa-onnx local voice-dictation Provider: registers the sherpa-onnx
 * VoiceEngine and this vertical slice's two shipped models on `ctx.voice`,
 * and owns the `/voice/api` Host route the settings page and Ctrl+Shift+E
 * dictation client call for model status, download, and transcription.
 * @module @deepseek-ai/dsh-voice-sherpa-onnx
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { VoiceModelSummary } from '@deepseek-ai/dsh-voice'
import { sherpaOnnxEngine } from './engine.ts'
import { engineRepairHint } from './engine-repair.ts'
import { cancelModelInstallations, ensureModelDownloaded, forgetModel, readModelStatus, type DownloadOptions, type ExtractArchive } from './model-cache.ts'
import { SHIPPED_MODELS } from './model-registry.ts'
import { describeSherpaOnnxCause, loadSherpaOnnx, sherpaOnnxLoadCause } from './sherpa-deps.ts'
import { isTrustedVoiceApiRequest } from './trust-fence.ts'
import { readJsonBody, requireString, VoiceApiError, writeError, writeJson, writeOk } from './wire.ts'

/** Wire shape of engine.status: mirrors terminal.deps' NodePtyDepsStatus for node-pty. */
type EngineStatus =
  | { ok: true }
  | { ok: false; cause: string; command: string; profile: string | null; note: string }

/** Report whether the sherpa-onnx-node native addon loaded, with a repair command when it did not. */
function engineStatus(): EngineStatus {
  if (loadSherpaOnnx() !== null) return { ok: true }
  const hint = engineRepairHint()
  return { ok: false, cause: describeSherpaOnnxCause(sherpaOnnxLoadCause()), ...hint }
}

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
/** Services required: voice, the generic Host webserver, and managed subprocess execution for native tar. */
export const inject = ['voice', 'webServer', 'subprocess']


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

/** Base64-decode a wire-carried PCM clip into 16kHz mono Float32 samples. */
function decodePcmBase64(pcm16kMonoBase64: string): Float32Array {
  const bytes = Buffer.from(pcm16kMonoBase64, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== pcm16kMonoBase64) {
    throw new VoiceApiError('bad-request', 'pcm16kMonoBase64 is not canonical base64')
  }
  if (bytes.byteLength % 4 !== 0) {
    throw new VoiceApiError('bad-request', 'pcm16kMonoBase64 does not decode to whole float32 samples')
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

/**
 * Install the sherpa-onnx voice engine, register the shipped model roster,
 * and mount the /voice/api route.
 * @param ctx - plugin context; registrations and the route are removed with the plugin fiber.
 * @param config - segmented download range size, concurrency, retry, and timeout settings.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const extractArchive = nativeTarExtractor(ctx)
  const downloadOptions = resolveDownloadOptions(config)
  ctx.effect(() => ctx.voice.registerEngine(sherpaOnnxEngine), 'voice-sherpa-onnx: engine')
  for (const definition of SHIPPED_MODELS) {
    ctx.effect(() => ctx.voice.registerModel(definition), `voice-sherpa-onnx: model ${definition.id}`)
  }

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: '/voice/api',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!isTrustedVoiceApiRequest(req.headers)) {
          writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
          return
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
          return
        }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const method = pathname.startsWith('/voice/api/') ? pathname.slice('/voice/api/'.length) : undefined
        try {
          if (method === 'engine.status') {
            writeOk(res, engineStatus())
            return
          }
          if (method === 'models.list') {
            const summaries: VoiceModelSummary[] = await Promise.all(SHIPPED_MODELS.map(async definition => ({
              definition,
              status: await readModelStatus(definition),
            })))
            writeOk(res, { models: summaries })
            return
          }
          if (method === 'models.download') {
            const payload = await readJsonBody(req)
            const modelId = requireString(payload, 'modelId')
            const definition = SHIPPED_MODELS.find(candidate => candidate.id === modelId)
            if (definition === undefined) throw new VoiceApiError('not-found', `unknown voice model "${modelId}"`, 404)
            const cacheDir = await ensureModelDownloaded(definition, fetch, extractArchive, downloadOptions)
            writeOk(res, { cacheDir })
            return
          }
          if (method === 'models.remove') {
            const payload = await readJsonBody(req)
            const modelId = requireString(payload, 'modelId')
            const definition = SHIPPED_MODELS.find(candidate => candidate.id === modelId)
            if (definition === undefined) throw new VoiceApiError('not-found', `unknown voice model "${modelId}"`, 404)
            await forgetModel(definition.id)
            writeOk(res, {})
            return
          }
          if (method === 'transcribe') {
            const payload = await readJsonBody(req)
            const modelId = requireString(payload, 'modelId')
            const pcm = requireString(payload, 'pcm16kMonoBase64')
            const definition = SHIPPED_MODELS.find(candidate => candidate.id === modelId)
            if (definition === undefined) throw new VoiceApiError('not-found', `unknown voice model "${modelId}"`, 404)
            const status = await readModelStatus(definition)
            if (status.state !== 'ready') throw new VoiceApiError('bad-request', `voice model "${modelId}" is not downloaded`)
            const samples = decodePcmBase64(pcm)
            const recognizer = await ctx.voice.engineOrUndefined?.loadModel(definition, status.cacheDir)
            if (recognizer === undefined) throw new VoiceApiError('internal', 'no voice engine is registered', 503)
            try {
              const text = await recognizer.transcribe(samples)
              writeOk(res, { text })
            } finally {
              recognizer.dispose()
            }
            return
          }
          throw new VoiceApiError('not-found', `unknown voice API method "${method ?? ''}"`, 404)
        } catch (error) {
          writeError(res, error)
        }
      },
    })
    return async () => {
      disposeRoute()
      await cancelModelInstallations(SHIPPED_MODELS.map(definition => definition.id))
    }
  }, 'voice-sherpa-onnx: /voice/api route')
}
