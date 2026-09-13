/** Browser-safe preferences owned by the local Playwright Provider. */

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
  /** Search provider used by the browser_search tool. */
  readonly searchEngine: 'google' | 'bing' | 'duckduckgo'
}
