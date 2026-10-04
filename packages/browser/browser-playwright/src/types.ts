/** Browser-safe preferences and managed-runtime observations. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Exact identity of one Host-owned browser component operation. */
export type BrowserRuntimeTaskId = Branded<'BrowserRuntimeTaskId'>
/** Bounded progress for the latest operation; retained until the next operation or Host restart. */
export interface BrowserRuntimeTask {
  readonly taskId: BrowserRuntimeTaskId
  readonly operation: 'install' | 'reinstall' | 'remove'
  readonly state: 'running' | 'succeeded' | 'failed' | 'cancelled'
  readonly phase: 'preparing' | 'downloading' | 'committing' | 'complete'
  readonly progressPercent: number | null
  readonly errorCode: 'download-failed' | 'filesystem-failed' | null
}
/** File presence and live context state are independent; detection never launches a browser. */
export interface BrowserRuntimeStatus {
  readonly providerActive: boolean
  readonly source: 'system' | 'managed' | 'custom'
  readonly channel: BrowserPreferences['browserChannel']
  readonly executablePath: string | null
  readonly installed: boolean
  readonly browserState: 'stopped' | 'starting' | 'running'
  /** Whether the active provider attached to a running browser instead of launching one. */
  readonly attached: boolean
  readonly playwrightVersion: string
  readonly browserVersion: string
  readonly revision: string
  readonly managedInstalled: boolean
  /** Origins only: download override credentials and URL paths never cross the Remote. */
  readonly downloadOrigins: readonly string[]
  readonly task: BrowserRuntimeTask | null
}
/** Cancellation is conditional on this exact latest operation identity. */
export interface BrowserRuntimeCancelRequest { readonly taskId: BrowserRuntimeTaskId }


/** Persisted launch preferences; changes apply when the Provider is remounted. */
export interface BrowserPreferences {
  /** Browser channel used when launching a local persistent context. */
  readonly browserChannel: 'chrome' | 'msedge' | 'chromium'
  /** Whether the launched browser has no visible window. */
  readonly headless: boolean
  /** CSS pixel width of the launched browser viewport. */
  readonly viewportWidth: number
  /** CSS pixel height of the launched browser viewport. */
  readonly viewportHeight: number
  /** Named persistent profile; default keeps the configured storage directory. */
  readonly profileName: string
  /** URL opened by the browser_home tool. */
  readonly homePage: string
  /** Default page zoom every document starts with; 1 renders at the configured viewport size. */
  readonly zoom: number
  /** Attach to an already-running Chromium over CDP instead of launching the Harness browser. */
  readonly attach: boolean
  /** CDP port of the running browser this provider attaches to when `attach` is true. */
  readonly attachPort: number
  /** Search provider used by the browser_search tool. */
  readonly searchEngine: 'google' | 'bing' | 'duckduckgo'
}
