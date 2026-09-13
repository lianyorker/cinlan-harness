/** Reports preserve the Finding state and do not invent a timestamp for empty data. */
import { describe, expect, it, vi } from 'vitest'
import { exportFindingsJson } from '../src/export/json.ts'
import { exportFindingsMarkdown } from '../src/export/markdown.ts'
import { exportFindingsSarif } from '../src/export/sarif.ts'

describe('deterministic empty Finding reports', () => {
  it.each([
    ['json', exportFindingsJson], ['markdown', exportFindingsMarkdown],
    ['sarif', (findings: []) => exportFindingsSarif(findings, 'test')],
  ] as const)('keeps %s output identical across different wall clocks', (_format, render) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const first = render([])
      vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
      expect(render([])).toEqual(first)
    } finally { vi.useRealTimers() }
  })
})
