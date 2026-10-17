// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRChecksView } from '../src/client/PRChecksView.tsx'
import {
  buildFixBrokenChecksPrompt,
  formatCheckDuration,
  getBrokenChecks,
  getCheckConclusion,
  truncateLogTailForPrompt,
} from '../src/client/pr-checks-fix-prompt.ts'
import type { PRCheckDetail, PRSummary } from '../src/client/pr-checks-types.ts'
import { en } from '../src/client/locales.ts'
import { ReviewBody } from '../src/client/ReviewBody.tsx'

afterEach(() => {
  cleanup()
})

const t = (key: keyof typeof en, params?: Record<string, string | number>): string => {
  let val = en[key] ?? String(key)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replace(`{${k}}`, String(v))
    }
  }
  return val
}

const mockPR: PRSummary = {
  number: 101,
  title: 'feat: add resilient retry logic',
  url: 'https://github.com/example/repo/pull/101',
  author: 'alice',
  branch: 'feat/retry',
  baseBranch: 'master',
  state: 'open',
  mergeable: true,
  checks: [
    {
      id: 'check-1',
      name: 'test:unit',
      status: 'completed',
      conclusion: 'success',
      startedAt: '2026-10-17T00:00:00Z',
      completedAt: '2026-10-17T00:01:15Z',
      url: 'https://ci.example.com/check-1',
    },
    {
      id: 'check-2',
      name: 'test:coverage',
      status: 'completed',
      conclusion: 'failure',
      startedAt: '2026-10-17T00:00:00Z',
      completedAt: '2026-10-17T00:02:40Z',
      url: 'https://ci.example.com/check-2',
      logTail: 'FAIL packages/core/retry.spec.ts\nExpected 2 retries, received 1',
    },
    {
      id: 'check-3',
      name: 'lint',
      status: 'in_progress',
      startedAt: '2026-10-17T00:02:00Z',
    },
  ],
}

describe('pr-checks-fix-prompt utilities', () => {
  it('correctly calculates check conclusions', () => {
    expect(getCheckConclusion(mockPR.checks[0]!)).toBe('success')
    expect(getCheckConclusion(mockPR.checks[1]!)).toBe('failure')
    expect(getCheckConclusion(mockPR.checks[2]!)).toBe('pending')
  })

  it('filters broken checks properly', () => {
    const broken = getBrokenChecks(mockPR.checks)
    expect(broken).toHaveLength(1)
    expect(broken[0]!.name).toBe('test:coverage')
  })

  it('formats duration between timestamps', () => {
    expect(formatCheckDuration('2026-10-17T00:00:00Z', '2026-10-17T00:00:45Z')).toBe('45s')
    expect(formatCheckDuration('2026-10-17T00:00:00Z', '2026-10-17T00:02:15Z')).toBe('2m 15s')
    expect(formatCheckDuration(undefined)).toBe('')
  })

  it('truncates log tails exceeding lines limit', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `log line ${i + 1}`)
    const truncated = truncateLogTailForPrompt(lines.join('\n'))
    const outputLines = truncated.split('\n')
    expect(outputLines).toHaveLength(100)
    expect(outputLines[outputLines.length - 1]).toBe('log line 150')
  })

  it('builds actionable prompt including PR and broken checks data', () => {
    const prompt = buildFixBrokenChecksPrompt(mockPR)
    expect(prompt).toContain('Fix the broken checks for Pull Request #101 ("feat: add resilient retry logic")')
    expect(prompt).toContain('test:coverage')
    expect(prompt).toContain('Expected 2 retries, received 1')
  })
})

describe('PRChecksView', () => {
  it('renders empty message when no PR is provided', () => {
    render(<PRChecksView pr={null} t={t} />)
    expect(screen.getByText(en['review.noPR'])).toBeDefined()
  })

  it('renders PR metadata and check items', () => {
    render(<PRChecksView pr={mockPR} t={t} />)

    expect(screen.getByText('#101 feat: add resilient retry logic')).toBeDefined()
    expect(screen.getByText('alice')).toBeDefined()
    expect(screen.getByText('feat/retry')).toBeDefined()
    expect(screen.getByText('master')).toBeDefined()

    expect(screen.getByText('test:unit')).toBeDefined()
    expect(screen.getByText('test:coverage')).toBeDefined()
    expect(screen.getByText('lint')).toBeDefined()
    expect(screen.getByText('1 check(s) failed')).toBeDefined()
  })

  it('allows expanding log tail for failing checks', () => {
    render(<PRChecksView pr={mockPR} t={t} />)

    const viewLogsBtn = screen.getByText(en['review.viewLogs'])
    expect(screen.queryByText(/Expected 2 retries, received 1/)).toBeNull()

    fireEvent.click(viewLogsBtn)
    expect(screen.getByText(/Expected 2 retries, received 1/)).toBeDefined()

    fireEvent.click(viewLogsBtn)
    expect(screen.queryByText(/Expected 2 retries, received 1/)).toBeNull()
  })

  it('triggers onFixBrokenChecks when fix button is clicked', async () => {
    const onFix = vi.fn()
    render(<PRChecksView pr={mockPR} onFixBrokenChecks={onFix} t={t} />)

    const fixBtn = screen.getByText(en['review.fixBrokenChecks'])
    expect(fixBtn).toBeDefined()
    fireEvent.click(fixBtn)

    await waitFor(() => {
      expect(onFix).toHaveBeenCalledWith(mockPR)
      expect(screen.getByText(en['review.fixPromptSent'])).toBeDefined()
    })
  })

  it('triggers onRerunChecks when rerun button is clicked', () => {
    const onRerun = vi.fn()
    render(<PRChecksView pr={mockPR} onRerunChecks={onRerun} t={t} />)

    const rerunBtn = screen.getByText(en['review.rerunChecks'])
    fireEvent.click(rerunBtn)

    expect(onRerun).toHaveBeenCalledWith(mockPR)
  })
})

describe('ReviewBody Subtab switching', () => {
  it('switches between Diff and Checks subtabs', async () => {
    const list = vi.fn().mockResolvedValue({ items: [] })
    const compare = vi.fn()

    render(
      <ReviewBody
        sessionId="session-1" as any
        t={t}
        list={list}
        compare={compare}
        prSummary={mockPR}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(en['review.empty'])).toBeDefined()
    })

    const checksSubtab = screen.getByText(en['review.subtabChecks'])
    fireEvent.click(checksSubtab)

    expect(screen.getByText('#101 feat: add resilient retry logic')).toBeDefined()
    expect(screen.getByText(en['review.fixBrokenChecks'])).toBeDefined()

    const diffSubtab = screen.getByText(en['review.subtabDiff'])
    fireEvent.click(diffSubtab)

    expect(screen.getByText(en['review.empty'])).toBeDefined()
  })
})
