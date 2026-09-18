import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeStartupDiagnostic } from '../src/startup-diagnostic.ts'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-diagnostic-test-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop startup diagnostics', () => {
  it('writes the latest stack to the default owner-only file', async () => {
    const desktopRoot = join(temporaryRoot(), 'desktop')
    const diagnostic = join(desktopRoot, 'startup-error.log')

    await writeStartupDiagnostic(new Error('first startup failure'), desktopRoot, '')
    await expect(writeStartupDiagnostic(new Error('latest startup failure'), desktopRoot, '')).resolves.toBe(diagnostic)

    const content = readFileSync(diagnostic, 'utf8')
    expect(content).toContain('Error: latest startup failure')
    expect(content).not.toContain('first startup failure')
    if (process.platform !== 'win32') expect(statSync(diagnostic).mode & 0o777).toBe(0o600)
  })

  it('uses an explicit diagnostic path override', async () => {
    const root = temporaryRoot()
    const override = join(root, 'diagnostics', 'explicit.log')

    await expect(writeStartupDiagnostic('explicit startup failure', join(root, 'desktop'), override)).resolves.toBe(override)

    expect(readFileSync(override, 'utf8')).toBe('explicit startup failure\n')
    expect(existsSync(join(root, 'desktop', 'startup-error.log'))).toBe(false)
  })

  it('reports a diagnostic write failure without rejecting startup error handling', async () => {
    const root = temporaryRoot()
    const occupied = join(root, 'occupied')
    writeFileSync(occupied, 'not a directory')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(writeStartupDiagnostic(
        new Error('original startup failure'),
        join(root, 'desktop'),
        join(occupied, 'startup-error.log'),
      )).resolves.toBeUndefined()
      expect(report).toHaveBeenCalledWith(
        'dsh desktop: failed to write startup diagnostic',
        expect.anything(),
      )
    } finally {
      report.mockRestore()
    }
  })
})
