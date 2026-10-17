/** Core logic for Git Source Control AI Author, sensitive file filtering, and prompt templating. */
import type { SourceControlAiActionRecipe, SourceControlAiSettings } from './types.ts'

/** Builtin default recipes and bounds for Source Control AI Author. */
export const DEFAULT_SOURCE_CONTROL_AI_SETTINGS: SourceControlAiSettings = {
  enabled: true,
  maxDiffBytes: 32 * 1024,
  filterSensitiveFiles: true,
  recipes: {
    'commit-message': {
      enabled: true,
      template: 'Write a concise, conventional git commit message summarizing the following staged changes:\n\n{{diff}}',
    },
    'diff-review': {
      enabled: true,
      template: 'Review the following diff on branch {{branch}} and provide key observations and potential risks:\n\n{{diff}}',
    },
    'pr-description': {
      enabled: true,
      template: 'Create a GitHub Pull Request title and description for branch {{branch}} with the following changes:\n\n{{diff}}',
    },
  },
}

const SENSITIVE_FILE_REGEX = /(?:^|[/\\])(?:\.env(?:\..*)?|.*(?:secret|credential|token|password|auth_token).*\.(?:json|ya?ml|txt|ini|conf)|.*\.(?:pem|key|pfx|p12|pkcs12)|id_(?:rsa|ed25519|ecdsa|dsa)(?:\..*)?)$/i

/**
 * Check whether a repository-relative path matches sensitive pattern rules.
 * @param path - Normalized repository path.
 * @returns True if path matches sensitive file heuristics.
 */
export function isSensitivePath(path: string): boolean {
  if (!path || path.trim().length === 0) return false
  const normalized = path.replace(/\\/g, '/')
  return SENSITIVE_FILE_REGEX.test(normalized)
}

/**
 * Filter an array of file paths into safe and sensitive subsets.
 * @param paths - File paths.
 * @returns Partitioned safe and sensitive lists.
 */
export function filterSensitiveFiles(paths: readonly string[]): {
  readonly safe: readonly string[]
  readonly sensitive: readonly string[]
} {
  const safe: string[] = []
  const sensitive: string[] = []
  for (const p of paths) {
    if (isSensitivePath(p)) {
      sensitive.push(p)
    } else {
      safe.push(p)
    }
  }
  return { safe, sensitive }
}

/**
 * Strip diff sections belonging to sensitive files.
 * @param diff - Full git unified diff.
 * @param paths - File paths in the diff.
 * @returns Filtered diff and list of omitted sensitive file paths.
 */
export function filterSensitiveDiff(
  diff: string,
  paths: readonly string[]
): {
  readonly filteredDiff: string
  readonly omittedFiles: readonly string[]
} {
  const { sensitive } = filterSensitiveFiles(paths)
  if (sensitive.length === 0 || diff.trim().length === 0) {
    return { filteredDiff: diff, omittedFiles: [] }
  }

  const sensitiveSet = new Set(sensitive.map(p => p.toLowerCase()))
  const chunks = diff.split(/(?=^diff --git )/m)
  const keptChunks: string[] = []
  const omittedFiles: string[] = []

  for (const chunk of chunks) {
    const match = chunk.match(/^diff --git a\/(.+?) b\/(.+?)$/m)
    if (match) {
      const filePath = match[2] ?? match[1] ?? ''
      if (sensitiveSet.has(filePath.toLowerCase()) || isSensitivePath(filePath)) {
        omittedFiles.push(filePath)
        keptChunks.push(`[Omitted diff for sensitive file: ${filePath}]\n`)
        continue
      }
    }
    keptChunks.push(chunk)
  }

  return {
    filteredDiff: keptChunks.join(''),
    omittedFiles,
  }
}

/**
 * Truncate diff text if it exceeds the maximum byte limit.
 * @param diff - Unified diff string.
 * @param maxBytes - Maximum permitted size in bytes.
 * @returns Truncated diff result with truncation flag.
 */
export function truncateDiff(
  diff: string,
  maxBytes: number
): {
  readonly text: string
  readonly truncated: boolean
  readonly originalBytes: number
} {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(diff)
  const originalBytes = bytes.length

  if (originalBytes <= maxBytes) {
    return { text: diff, truncated: false, originalBytes }
  }

  // Slice within budget
  const slice = bytes.slice(0, Math.max(0, maxBytes - 128))
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let truncatedStr = decoder.decode(slice)

  // Clean cut at line boundary if possible
  const lastNewline = truncatedStr.lastIndexOf('\n')
  if (lastNewline > 0) {
    truncatedStr = truncatedStr.slice(0, lastNewline)
  }

  const notice = `\n\n[Diff truncated: ${originalBytes} bytes exceeds limit of ${maxBytes} bytes]`
  return {
    text: truncatedStr + notice,
    truncated: true,
    originalBytes,
  }
}

/**
 * Interpolate placeholders in an action template.
 * Supported variables: {{diff}}, {{branch}}, {{stagedFiles}}, {{files}}.
 * @param template - Template string.
 * @param vars - Variables to inject.
 * @returns Interpolated prompt text.
 */
export function interpolateTemplate(
  template: string,
  vars: {
    readonly diff: string
    readonly branch?: string
    readonly stagedFiles?: readonly string[]
  }
): string {
  const filesStr = (vars.stagedFiles ?? []).join('\n')
  return template
    .replace(/\{\{\s*diff\s*\}\}/g, vars.diff)
    .replace(/\{\{\s*branch\s*\}\}/g, vars.branch ?? 'HEAD')
    .replace(/\{\{\s*(?:stagedFiles|files)\s*\}\}/g, filesStr)
}

/** Parameters for generating an AI commit message draft. */
export interface GenerateCommitMessageOptions {
  /** Full or partial staged diff. */
  readonly diff: string
  /** Active Git branch name. */
  readonly branch?: string
  /** List of staged file paths. */
  readonly stagedFiles: readonly string[]
  /** Optional custom action recipe override. */
  readonly recipe?: SourceControlAiActionRecipe
  /** Optional AI settings. */
  readonly settings?: Partial<SourceControlAiSettings>
  /** Model runner function invoking the model/agent. */
  readonly runner: (prompt: string, signal?: AbortSignal) => Promise<string>
  /** Abort signal. */
  readonly signal?: AbortSignal
}

/** Result of AI commit message draft generation. */
export interface GenerateCommitMessageResult {
  /** The generated commit message draft (subject and body). */
  readonly message: string
  /** Files excluded due to sensitivity rules. */
  readonly sensitiveOmitted: readonly string[]
  /** Whether the diff was truncated due to budget constraints. */
  readonly truncated: boolean
}

/**
 * Generate a commit message draft using an AI runner.
 * Filters sensitive files, checks size budgets, interpolates the action recipe,
 * and returns the generated draft without automatically committing.
 * @param options - Generation options and runner.
 * @returns Generation result.
 */
export async function generateCommitMessageDraft(
  options: GenerateCommitMessageOptions
): Promise<GenerateCommitMessageResult> {
  const { diff, branch, stagedFiles, recipe, settings, runner, signal } = options
  const filterSensitive = settings?.filterSensitiveFiles ?? DEFAULT_SOURCE_CONTROL_AI_SETTINGS.filterSensitiveFiles
  const maxBytes = settings?.maxDiffBytes ?? DEFAULT_SOURCE_CONTROL_AI_SETTINGS.maxDiffBytes
  const activeRecipe = recipe ?? DEFAULT_SOURCE_CONTROL_AI_SETTINGS.recipes['commit-message']

  if (!activeRecipe.enabled) {
    throw new Error('Commit message AI recipe is disabled in settings')
  }

  if (!diff || diff.trim().length === 0) {
    throw new Error('No staged diff available to generate commit message')
  }

  let processedDiff = diff
  let sensitiveOmitted: readonly string[] = []

  if (filterSensitive) {
    const filterResult = filterSensitiveDiff(diff, stagedFiles)
    processedDiff = filterResult.filteredDiff
    sensitiveOmitted = filterResult.omittedFiles
  }

  // If all modified files were sensitive and omitted
  if (sensitiveOmitted.length > 0 && processedDiff.replace(/\[Omitted diff for sensitive file: .*?\]\n/g, '').trim().length === 0) {
    throw new Error('All staged changes contain sensitive files and were omitted from AI prompt')
  }

  const { text: finalDiff, truncated } = truncateDiff(processedDiff, maxBytes)
  const prompt = interpolateTemplate(activeRecipe.template, {
    diff: finalDiff,
    ...(branch !== undefined ? { branch } : {}),
    stagedFiles,
  })

  const rawOutput = await runner(prompt, signal)
  const trimmed = rawOutput.trim()
  if (trimmed.length === 0) {
    throw new Error('Model produced an empty commit message')
  }

  // Clean markdown code blocks if the model wrapped it in ```git commit ... ```
  let cleanMessage = trimmed
  if (cleanMessage.startsWith('```')) {
    cleanMessage = cleanMessage.replace(/^```[a-z]*\r?\n?/i, '').replace(/\r?\n?```$/i, '').trim()
  }

  return {
    message: cleanMessage,
    sensitiveOmitted,
    truncated,
  }
}
