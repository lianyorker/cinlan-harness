/**
 * Vulnerability playbook domain types. The corpus is a directory tree of
 * Markdown entries, one file per vulnerability playbook, with a small
 * frontmatter block carrying match metadata.
 *
 * @module @cinlan/vuln-playbook/types
 */

/** One parsed frontmatter block of a playbook entry. */
export interface PlaybookFrontmatter {
  readonly title?: string
  readonly cve?: string
  readonly severity?: string
  readonly cvss?: string
  readonly product?: string
  readonly versions?: string
  readonly ports?: string
  readonly keywords?: string
  readonly entry?: string
  readonly verified?: string
  readonly sources?: string
}

/** One indexed playbook entry. `file` is the stable relative id. */
export interface PlaybookEntry {
  /** Stable entry id: `<category>/<file>` relative to the corpus root. */
  readonly file: string
  /** Corpus category directory (e.g. `web-cms`, `java-deser`). */
  readonly category: string
  readonly title: string
  readonly cve: string
  readonly severity: string
  readonly cvss: string
  readonly product: string
  readonly versions: string
  readonly entry: string
  readonly ports: readonly number[]
  readonly keywordTokens: readonly string[]
  readonly rawKeywords: readonly string[]
  readonly textTokens: readonly string[]
  /** Absolute path of the backing Markdown file. */
  readonly path: string
}

/** Fingerprint input for {@link matchPlaybooks}. Every field is optional. */
export interface PlaybookMatchInput {
  /** Single observed port. */
  readonly port?: number
  /** Observed open ports. */
  readonly ports?: readonly number[]
  /** Service banner or fingerprint text. */
  readonly banner?: string
  /** Declared product name. */
  readonly product?: string
  /** Header values joined for matching. */
  readonly headers?: Readonly<Record<string, string>>
  /** Free-form text (response body snippet, error string, ...). */
  readonly text?: string
}

/** One scored candidate returned by {@link matchPlaybooks}. */
export interface PlaybookMatchHit {
  readonly file: string
  readonly category: string
  readonly title: string
  readonly cve: string
  readonly severity: string
  readonly product: string
  readonly versions: string
  readonly entry: string
  readonly ports: readonly number[]
  readonly score: number
  /** Human-readable match reasons, one per scored signal. */
  readonly why: readonly string[]
}

/** Full playbook entry content returned by {@link VulnPlaybookLike.read}. */
export interface PlaybookReadResult {
  readonly file: string
  readonly category: string
  readonly title: string
  readonly cve: string
  readonly severity: string
  readonly content: string
  readonly truncated: boolean
}

/** Public surface exposed as `ctx.vulnPlaybook` and used by sibling packages. */
export interface VulnPlaybookLike {
  /** Score the whole corpus against one fingerprint; returns ranked hits. */
  match(input: PlaybookMatchInput, limit?: number): PlaybookMatchHit[]
  /** Read one entry's Markdown body by its stable `file` id. */
  read(file: string, maxBytes?: number): PlaybookReadResult
  /** Corpus size and per-category counts. */
  stats(): { readonly entries: number; readonly categories: Readonly<Record<string, number>> }
}
