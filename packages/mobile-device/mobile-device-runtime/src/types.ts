/** Human-facing Android resource management and owned mirroring facts. */
import type { Branded } from '@deepseek-ai/dsh-brand'
/** Fixed resources in the reviewed catalog. */
export type MobileResourceId = 'platform-tools' | 'scrcpy'
/** Exact Host-owned installation task. */
export type MobileResourceTaskId = Branded<'MobileResourceTaskId'>
/** Exact owned native mirror process range. */
export type MobileMirrorId = Branded<'MobileMirrorId'>
/** Durable compare-and-swap revision, retained after removal. */
export type MobileResourceRevision = Branded<'MobileResourceRevision'>
/** Fixed upstream release metadata. */
export interface MobileResourceDefinition {
  readonly id: MobileResourceId
  readonly version: string
  readonly platform: 'win32-x64'
  readonly url: string
  readonly sha256: string
  readonly bytes: number
  readonly archiveRoot: string
  readonly executable: string
  readonly licenseUrl: string
  readonly licenseName: string
}
/** Managed installation facts, independent from connected device readiness. */
export interface MobileResourceStatus {
  readonly definition: MobileResourceDefinition
  readonly supported: boolean
  readonly revision: MobileResourceRevision
  readonly installedVersion: string | null
  readonly installedPath: string | null
  readonly integrity: 'missing' | 'verified' | 'invalid'
  readonly leased: boolean
  readonly updateAvailable: boolean
}
/** Host-owned operation; closing an observer does not cancel it. */
export interface MobileResourceTask {
  readonly id: MobileResourceTaskId
  readonly resourceId: MobileResourceId
  readonly operation: 'install' | 'reinstall' | 'update' | 'remove'
  readonly state: 'running' | 'succeeded' | 'failed' | 'cancelled'
  readonly phase: 'preparing' | 'downloading' | 'verifying' | 'extracting' | 'committing' | 'complete'
  readonly downloadedBytes: number
  readonly totalBytes: number
  readonly error: string | null
}
/** Human request confirms displayed revision and upstream license. */
export interface MobileResourceRequest {
  readonly resourceId: MobileResourceId
  readonly operation: MobileResourceTask['operation']
  readonly expectedRevision: MobileResourceRevision
  readonly acceptLicense: boolean
}
/** Exact native process state; running does not assert visible pixels. */
export interface MobileMirrorStatus {
  readonly id: MobileMirrorId
  readonly deviceId: string
  readonly state: 'starting' | 'running' | 'closed' | 'failed'
  readonly error: string | null
}
/** Exact ADB connection facts for human selection. */
export interface MobileConnectedDevice {
  readonly id: string
  readonly serial: string
  readonly state: string
  readonly transportId: string | null
  readonly available: boolean
}
/** Authoritative resource, executable, and connection snapshot for Settings. */
export interface MobileRuntimeStatus {
  readonly platform: string
  readonly resources: readonly MobileResourceStatus[]
  readonly task: MobileResourceTask | null
  readonly adb: { readonly source: 'custom' | 'managed' | 'path'; readonly path: string; readonly version: string | null; readonly error: string | null }
  readonly devices: readonly MobileConnectedDevice[]
  readonly mirror: MobileMirrorStatus | null
  readonly iosSupported: false
}
/** Immutable managed executable ownership through process and cleanup settlement. */
export interface MobileExecutableLease {
  readonly executable: string
  readonly release: () => Promise<void>
}
/** Deployment choices for private storage, network, and subprocess bounds. */
export interface Config {
  /** Host directory containing verified Android component generations and resource receipts. */
  readonly storageDir?: string
  /** Maximum milliseconds allowed for one component version or device probe. */
  readonly commandTimeoutMs?: number
  /** Maximum milliseconds allowed for one owned installation task. */
  readonly installTimeoutMs?: number
  /** Milliseconds allowed for a process to settle after termination is requested. */
  readonly processGraceMs?: number
  /** Maximum bytes retained from one native subprocess output. */
  readonly maxOutputBytes?: number
  /** Maximum total bytes accepted from one extracted resource archive. */
  readonly maxExpandedBytes?: number
  /** Maximum file entries accepted from one resource archive. */
  readonly maxArchiveFiles?: number
  /** Maximum milliseconds spent waiting for the resource publication lock. */
  readonly lockWaitMs?: number
  /** Milliseconds between checks of an owned mirror process and device identity. */
  readonly mirrorPollMs?: number
  /** Explicit HTTP or HTTPS proxy URL used only for managed resource downloads. */
  readonly downloadProxyUrl?: string
}
