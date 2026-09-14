/**
 * Typed fetch wrapper over the /voice/api JSON route (mirrors the
 * /sidebar/api pattern in @deepseek-ai/dsh-client-ui-better-sidebar's
 * api.ts, copied rather than imported because that package does not export
 * the helper and this plugin must not depend on its internals).
 */
import type { VoiceModelStatus } from '@deepseek-ai/dsh-voice'

/** One failure from the /voice/api route. */
export class VoiceApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** One model row as reported by models.list. */
export interface VoiceModelRow {
  readonly definition: {
    readonly id: string
    readonly name: string
    readonly description: string
    readonly recommended: boolean
    readonly approximateBytes: number
  }
  readonly status: VoiceModelStatus
}

/**
 * The sherpa-onnx-node native-addon load state, as reported by engine.status.
 * A degraded engine carries a pasteable repair command and allowlist hint
 * (mirroring node-pty's terminal.deps status in
 * @deepseek-ai/dsh-client-ui-better-sidebar) — transcription fails until the
 * repair command runs, but model download/cache and the settings page
 * itself stay fully usable.
 */
export type VoiceEngineStatus =
  | { readonly ok: true }
  | { readonly ok: false; readonly cause: string; readonly command: string; readonly profile: string | null; readonly note: string }

type RpcResponse = { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }

function isRpcResponse(value: unknown): value is RpcResponse {
  return value !== null && typeof value === 'object'
}

async function call<T>(method: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/voice/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      ...signal === undefined ? {} : { signal },
    })
  } catch (error) {
    throw new VoiceApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: unknown = await response.json().catch(() => null)
  const responseData = isRpcResponse(parsed) ? parsed : null
  if (!response.ok || responseData === null || responseData.ok !== true || responseData.value === undefined) {
    throw new VoiceApiError(
      responseData?.error?.code ?? 'http',
      responseData?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return responseData.value as T
}

/** The voice-dictation API surface. */
export const voiceApi = {
  /** Read the sherpa-onnx-node native-addon load state. */
  engineStatus: (signal?: AbortSignal) => call<VoiceEngineStatus>('engine.status', {}, signal),
  /** List the shipped model roster with live cache status. */
  modelsList: (signal?: AbortSignal) => call<{ models: readonly VoiceModelRow[] }>('models.list', {}, signal),
  /** Start (or await, if already in flight) a model download. */
  modelsDownload: (modelId: string) => call<{ cacheDir: string }>('models.download', { modelId }),
  /** Remove a downloaded model and any retained partial ranges. */
  modelsRemove: (modelId: string) => call<Record<string, never>>('models.remove', { modelId }),
  /** Decode a base64-encoded 16kHz mono PCM float32 clip and return its transcript. */
  transcribe: (modelId: string, pcm16kMonoBase64: string, signal?: AbortSignal) =>
    call<{ text: string }>('transcribe', { modelId, pcm16kMonoBase64 }, signal),
}
