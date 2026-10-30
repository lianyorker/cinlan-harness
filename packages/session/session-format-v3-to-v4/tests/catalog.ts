/** Released V4 fixtures retain their target generation while sharing installed message validation. */
import { KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION, Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { createSessionFormatCatalog } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalogOptions } from '@deepseek-ai/dsh-session-format-catalog/src/generated.ts'
import { validateInstalledCurrentSessionArtifact, validateInstalledCurrentSessionHeader } from '@deepseek-ai/dsh-session-format-catalog/src/current.ts'
import { assertReleasedV4Header, releasedV4SessionFormatCodec, restoreReleasedV4Artifact, createSessionFormatV3ToV4, sessionFormatV3ToV4 } from '../src/index.ts'
import { sessionFormatCatalog as installedCatalog } from '@deepseek-ai/dsh-session-format-catalog'
export { historicalSessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'

function validateArtifact(artifact: SessionFormatArtifact): SessionFormatArtifact {
  restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES)
  validateInstalledCurrentSessionArtifact({ ...artifact, header: { ...artifact.header, version: SESSION_FORMAT_VERSION } })
  return artifact
}

/** Adopt a validated V4 fixture through the actual installed migration chain. */
export function adoptV4Artifact(artifact: SessionFormatArtifact, projections?: Parameters<typeof Session.fromRestore>[5]): Session {
  const reader = installedCatalog.createRestore(releasedV4SessionFormatCodec.encodeHeader(artifact.header, artifact.inheritedEventCount), { recovery: 'strict', validation: 'current' })
  for (const event of artifact.events) reader.decodeRow(releasedV4SessionFormatCodec.encodeEvent(event))
  const current = reader.finish()
  return Session.fromRestore(SessionId(current.header.id), current.events as SessionEvent[], current.header as SessionHeader,
    SessionLogOffset(current.inheritedEventCount), 'detached', projections)
}

const options = {
  ...sessionFormatCatalogOptions,
  currentVersion: 4,
  codecs: sessionFormatCatalogOptions.codecs.filter(codec => codec.version <= 4),
  migrations: sessionFormatCatalogOptions.migrations.filter(migration => migration.toVersion <= 4),
  currentEncoder: releasedV4SessionFormatCodec,
  restoreCurrent: validateArtifact,
  restoreTransformedCurrent: (artifact: SessionFormatArtifact) => restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES),
  restoreCurrentHeader(header: SessionFormatArtifact['header']) {
    assertReleasedV4Header(header)
    validateInstalledCurrentSessionHeader({ ...header, version: SESSION_FORMAT_VERSION })
    return header
  },
}

export const sessionFormatCatalog = createSessionFormatCatalog(options)

export function createSessionFormatCatalogWithChildren(children: readonly SessionFormatJsonValue[]) {
  const migration = createSessionFormatV3ToV4(children)
  return createSessionFormatCatalog({ ...options, migrations: options.migrations.map(edge => edge === sessionFormatV3ToV4 ? migration : edge) })
}
