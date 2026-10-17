import { describe, expect, it, vi } from 'vitest'
import {
  filterSensitiveDiff,
  filterSensitiveFiles,
  generateCommitMessageDraft,
  interpolateTemplate,
  isSensitivePath,
  truncateDiff,
} from '../src/ai-author.ts'
import type { SourceControlAiActionRecipe } from '../src/types.ts'

describe('git ai-author: isSensitivePath', () => {
  it('identifies environment, key, certificate, and secret files', () => {
    expect(isSensitivePath('.env')).toBe(true)
    expect(isSensitivePath('.env.production')).toBe(true)
    expect(isSensitivePath('config/.env.local')).toBe(true)
    expect(isSensitivePath('certs/server.pem')).toBe(true)
    expect(isSensitivePath('keys/private.key')).toBe(true)
    expect(isSensitivePath('ssh/id_rsa')).toBe(true)
    expect(isSensitivePath('ssh/id_ed25519.pub')).toBe(true)
    expect(isSensitivePath('auth_tokens.json')).toBe(true)
    expect(isSensitivePath('api_credentials.yaml')).toBe(true)
    expect(isSensitivePath('secrets.txt')).toBe(true)
  })

  it('permits non-sensitive source files and documentation', () => {
    expect(isSensitivePath('src/index.ts')).toBe(false)
    expect(isSensitivePath('package.json')).toBe(false)
    expect(isSensitivePath('README.md')).toBe(false)
    expect(isSensitivePath('packages/client/ui/Button.tsx')).toBe(false)
  })
})

describe('git ai-author: filterSensitiveFiles and filterSensitiveDiff', () => {
  it('partitions files into safe and sensitive groups', () => {
    const paths = ['src/app.ts', '.env.local', 'package.json', 'secret_token.json']
    const result = filterSensitiveFiles(paths)
    expect(result.safe).toEqual(['src/app.ts', 'package.json'])
    expect(result.sensitive).toEqual(['.env.local', 'secret_token.json'])
  })

  it('omits sensitive chunks from unified diff output', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
+console.log('hello');
diff --git a/.env b/.env
--- a/.env
+++ b/.env
@@ -1 +1 @@
-API_KEY=123
+API_KEY=456
`
    const { filteredDiff, omittedFiles } = filterSensitiveDiff(diff, ['src/app.ts', '.env'])
    expect(omittedFiles).toEqual(['.env'])
    expect(filteredDiff).toContain('diff --git a/src/app.ts b/src/app.ts')
    expect(filteredDiff).toContain('+console.log(\'hello\');')
    expect(filteredDiff).not.toContain('API_KEY=456')
    expect(filteredDiff).toContain('[Omitted diff for sensitive file: .env]')
  })
})

describe('git ai-author: truncateDiff', () => {
  it('leaves diffs within budget unchanged', () => {
    const smallDiff = 'diff --git a/a.ts b/a.ts\n+line'
    const result = truncateDiff(smallDiff, 1024)
    expect(result.truncated).toBe(false)
    expect(result.text).toBe(smallDiff)
  })

  it('truncates diffs exceeding maxBytes cleanly with a notice', () => {
    const largeDiff = 'line1\nline2\nline3\nline4\nline5\n'.repeat(100)
    const result = truncateDiff(largeDiff, 256)
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('[Diff truncated:')
    expect(result.text.length).toBeLessThan(largeDiff.length)
  })
})

describe('git ai-author: interpolateTemplate', () => {
  it('replaces diff, branch, and staged files placeholders', () => {
    const template = 'Branch: {{branch}}\nFiles: {{stagedFiles}}\nChanges:\n{{diff}}'
    const output = interpolateTemplate(template, {
      branch: 'feature/login',
      stagedFiles: ['src/login.ts', 'src/auth.ts'],
      diff: '+export function login() {}',
    })
    expect(output).toContain('Branch: feature/login')
    expect(output).toContain('Files: src/login.ts\nsrc/auth.ts')
    expect(output).toContain('Changes:\n+export function login() {}')
  })
})

describe('git ai-author: generateCommitMessageDraft', () => {
  const sampleDiff = `diff --git a/src/auth.ts b/src/auth.ts
@@ -1,2 +1,3 @@
+export function authenticate() { return true }
`

  it('generates a commit message using the runner without auto-committing', async () => {
    const runner = vi.fn().mockResolvedValue('feat(auth): add authenticate helper\n\nImplement authentication logic.')
    const result = await generateCommitMessageDraft({
      diff: sampleDiff,
      branch: 'main',
      stagedFiles: ['src/auth.ts'],
      runner,
    })

    expect(runner).toHaveBeenCalledOnce()
    expect(result.message).toBe('feat(auth): add authenticate helper\n\nImplement authentication logic.')
    expect(result.sensitiveOmitted).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('cleans markdown code fence wrappers from model response', async () => {
    const runner = vi.fn().mockResolvedValue('```git\nfix: correct edge case\n```')
    const result = await generateCommitMessageDraft({
      diff: sampleDiff,
      stagedFiles: ['src/auth.ts'],
      runner,
    })
    expect(result.message).toBe('fix: correct edge case')
  })

  it('throws on empty diff input', async () => {
    const runner = vi.fn()
    await expect(
      generateCommitMessageDraft({
        diff: '   ',
        stagedFiles: [],
        runner,
      })
    ).rejects.toThrow(/No staged diff available/)
    expect(runner).not.toHaveBeenCalled()
  })

  it('throws when all modified files are sensitive', async () => {
    const sensitiveDiff = `diff --git a/.env b/.env
@@ -1 +1 @@
-A=1
+A=2
`
    const runner = vi.fn()
    await expect(
      generateCommitMessageDraft({
        diff: sensitiveDiff,
        stagedFiles: ['.env'],
        runner,
      })
    ).rejects.toThrow(/All staged changes contain sensitive files/)
    expect(runner).not.toHaveBeenCalled()
  })

  it('respects disabled recipe configuration', async () => {
    const recipe: SourceControlAiActionRecipe = {
      enabled: false,
      template: '{{diff}}',
    }
    const runner = vi.fn()
    await expect(
      generateCommitMessageDraft({
        diff: sampleDiff,
        stagedFiles: ['src/auth.ts'],
        recipe,
        runner,
      })
    ).rejects.toThrow(/disabled in settings/)
    expect(runner).not.toHaveBeenCalled()
  })
})
