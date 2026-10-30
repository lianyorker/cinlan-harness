/** V5 header validation and unchanged tool-role body invariants. */
import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header, assertNativeToolRoleBody } from '@deepseek-ai/dsh-session-format-v3-to-v4'

/**
 * Validate native V5 header fields without modifying the candidate.
 * @param header - untrusted logical V5 metadata.
 */
export function assertReleasedV5Header(header: unknown): void {
  if (!isSessionFormatJsonObject(header) || header['version'] !== 5) throw new SessionFormatError('expected format v5 header')
  assertReleasedV4Header({ ...header, version: 4 })
}

/**
 * Validate native V5 vocabulary, inherited cuts, relationships and active V5 delivery watermarks.
 * @param artifact - complete detached artifact; event objects and payloads remain unchanged.
 * @param knownEventTypes - installed event names; unknown required events are refused.
 * @returns the original validated artifact.
 */
export function restoreReleasedV5Artifact(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): SessionFormatArtifact {
  assertReleasedV5Header(artifact.header)
  assertNativeToolRoleBody(artifact, knownEventTypes, 5)
  return artifact
}
