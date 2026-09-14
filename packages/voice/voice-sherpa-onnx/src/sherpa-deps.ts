/**
 * sherpa-onnx-node dependency loading, mirroring the node-pty lazy-load
 * pattern in @deepseek-ai/dsh-client-ui-better-sidebar's pty-deps.ts. The
 * native addon (and its per-platform optionalDependency binary) is NEVER
 * imported statically: a missing or broken install must degrade this
 * plugin's transcription route instead of aborting the whole Host boot.
 */

import { createRequire } from 'node:module'

/** The minimal sherpa-onnx-node surface this Provider consumes. */
export interface SherpaOnnxModule {
  OnlineRecognizer: new (config: SherpaOnlineRecognizerConfig) => SherpaOnlineRecognizer
}

/** Configuration accepted by sherpa-onnx-node's streaming `OnlineRecognizer`. */
export interface SherpaOnlineRecognizerConfig {
  featConfig: { sampleRate: number; featureDim: number }
  modelConfig: {
    transducer: { encoder: string; decoder: string; joiner: string }
    tokens: string
    numThreads: number
    provider: 'cpu'
    debug: 0 | 1
  }
}

/** One streaming decode session bound to a recognizer instance. */
export interface SherpaOnlineStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void
}

/** The recognizer methods this Provider calls. */
export interface SherpaOnlineRecognizer {
  createStream(): SherpaOnlineStream
  isReady(stream: SherpaOnlineStream): boolean
  decode(stream: SherpaOnlineStream): void
  getResult(stream: SherpaOnlineStream): { text: string }
}

/** A require-compatible loader, injectable for tests. */
export type SherpaOnnxRequire = (id: string) => unknown

const defaultRequire: SherpaOnnxRequire = createRequire(import.meta.url)

type LoadResult = { ok: true; module: SherpaOnnxModule } | { ok: false; cause: unknown }

let cached: LoadResult | undefined

/**
 * Load sherpa-onnx-node once (synchronously) and cache the outcome. Returns
 * null when the package or its native binding cannot be loaded; the cause
 * stays queryable through {@link sherpaOnnxLoadCause}. Never throws.
 * @param requireImpl - injectable require, defaulting to createRequire on this module.
 * @returns the loaded module, or null in degraded mode.
 */
export function loadSherpaOnnx(requireImpl: SherpaOnnxRequire = defaultRequire): SherpaOnnxModule | null {
  if (cached === undefined) {
    try {
      cached = { ok: true, module: requireImpl('sherpa-onnx-node') as SherpaOnnxModule }
    } catch (cause) {
      cached = { ok: false, cause }
    }
  }
  return cached.ok ? cached.module : null
}

/**
 * Read the recorded native-addon load failure.
 * @returns failure value, or undefined when loading succeeded or never ran.
 */
export function sherpaOnnxLoadCause(): unknown {
  return cached !== undefined && !cached.ok ? cached.cause : undefined
}

/** Forget the cached outcome (tests only — a real reload is otherwise one-shot). */
export function resetSherpaOnnxCache(): void {
  cached = undefined
}

/**
 * Render one load-failure cause for a user-visible repair diagnostic.
 * @param cause - native-addon load failure value.
 * @returns one-line failure description.
 */
export function describeSherpaOnnxCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
