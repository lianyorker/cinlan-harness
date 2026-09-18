/** Required model files used by cache readiness checks. */
import type { VoiceModelArchitecture } from './types.ts'

/**
 * List the file paths required by one recognizer architecture.
 * @param arch - Recognizer file configuration.
 * @returns Required model and token paths.
 */
export function architectureFilePaths(arch: VoiceModelArchitecture): readonly string[] {
  switch (arch.type) {
    case 'transducer': return [arch.encoder, arch.decoder, arch.joiner, arch.tokens]
    case 'paraformer': return [arch.encoder, arch.decoder, arch.tokens]
    case 'whisper': return [arch.encoder, arch.decoder, arch.tokens]
    case 'sense-voice': return [arch.model, arch.tokens]
  }
}
