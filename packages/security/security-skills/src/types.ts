import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque installed generation identity; never a caller-supplied path. */
export type SecuritySkillGenerationId = Branded<'SecuritySkillGenerationId'>
/** One Host-owned operation; used to reject stale cancellation requests. */
export type SecuritySkillOperationId = Branded<'SecuritySkillOperationId'>

/** Stable operation admission failures for localized clients. */
export type SecuritySkillResourceErrorCode = 'busy' | 'not-configured' | 'not-installed' | 'already-installed' | 'disposed' | 'stale-operation'

/** Configured release document after HTTP and field validation. */
export interface SecuritySkillRelease {
  version: string
  archiveUrl: string
  bytes: number
  sha256: string
  contentSha256: string
  fileCount: number
  skillCount: number
  files: { path: string; sha256: string; bytes: number }[]
  skills: { name: string; path: string }[]
}

/** Provenance of installed bytes, distinct from their distribution version. */
export interface SecuritySkillResourceSource {
  kind: 'bundled' | 'download'
  url?: string
}

/** One committed immutable resource generation. */
export interface SecuritySkillResourceInstallation {
  version: string
  generation: SecuritySkillGenerationId
  source: SecuritySkillResourceSource
  installedAt: number
  skillCount: number
}

/** Host-owned operation observed independently of the initiating request. */
export interface SecuritySkillResourceOperation {
  id: SecuritySkillOperationId
  kind: 'check-update' | 'install' | 'reinstall' | 'update' | 'install-bundled' | 'remove'
  phase: 'fetching-manifest' | 'downloading' | 'extracting' | 'validating' | 'committing' | 'cancelling'
  bytesReceived: number
  totalBytes?: number
}

/** Resource management snapshot; errors never erase a committed installation. */
export interface SecuritySkillResourceStatus {
  resourceId: 'security-skills'
  state: 'not-installed' | 'installed' | 'error'
  installed?: SecuritySkillResourceInstallation
  available?: { version: string; bytes: number; sha256: string }
  download: { available: boolean; reason?: string }
  operation?: SecuritySkillResourceOperation
  lastError?: string
}

/** Retains resource paths until the consuming Agent realm is disposed. */
export interface SecuritySkillGenerationLease {
  directory: string
  installation: SecuritySkillResourceInstallation
  release(): Promise<void>
}
