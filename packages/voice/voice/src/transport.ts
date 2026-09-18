/** Shared JSON validation for HTTP and Remote voice consumers; providers receive decoded samples. */
import { z } from 'zod'
import { VoiceError, VoiceModelId } from './index.ts'
import type { VoiceTranscribeRequest } from './types.ts'

/** Maximum decoded PCM bytes accepted across voice transports. */
export const MAX_VOICE_PCM_BYTES = 16 * 1024 * 1024
/** Maximum complete legacy HTTP request body, including JSON and base64 overhead. */
export const MAX_VOICE_BODY_BYTES = 32 * 1024 * 1024
const modelId = z.string().min(1).max(256)
const modelRequest = z.strictObject({ modelId })
const transcribeRequest = z.strictObject({ modelId, pcm16kMonoBase64: z.string().min(1).max(Math.ceil(MAX_VOICE_PCM_BYTES / 3) * 4) })

/**
 * Validate a model-management JSON request.
 * @param payload - Untrusted transport payload.
 * @returns Branded selector; the provider resolves its registered definition.
 */
export function parseVoiceModelRequest(payload: unknown): VoiceModelId {
  const result = modelRequest.safeParse(payload)
  if (!result.success) throw new VoiceError('missing or invalid "modelId"', 'VOICE_INVALID_REQUEST')
  return VoiceModelId(result.data.modelId)
}

/**
 * Validate and decode canonical little-endian PCM without admitting non-finite samples.
 * @param payload - Untrusted JSON transcription request.
 * @returns Native model selector and bounded float32 samples.
 */
export function parseVoiceTranscribeRequest(payload: unknown): VoiceTranscribeRequest {
  const result = transcribeRequest.safeParse(payload)
  if (!result.success) throw new VoiceError('invalid voice transcription request', 'VOICE_INVALID_REQUEST')
  const encoded = result.data.pcm16kMonoBase64
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_VOICE_PCM_BYTES || bytes.toString('base64') !== encoded || bytes.byteLength % 4 !== 0) {
    throw new VoiceError('pcm16kMonoBase64 must contain bounded canonical float32 PCM', 'VOICE_INVALID_REQUEST')
  }
  const samples = new Float32Array(bytes.byteLength / 4)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = bytes.readFloatLE(index * 4)
    if (!Number.isFinite(sample)) throw new VoiceError('PCM samples must be finite', 'VOICE_INVALID_REQUEST')
    samples[index] = sample
  }
  return { modelId: VoiceModelId(result.data.modelId), samples }
}
