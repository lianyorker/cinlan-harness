/** Page definition tests for the contributor package. */
import { describe, expect, it } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  browserTabDefinition,
  reviewTabDefinition,
  terminalTabDefinition,
  tasksTabDefinition,
  BROWSER_TAB_ID,
  REVIEW_TAB_ID,
  TERMINAL_TAB_ID,
  TASKS_TAB_ID,
} from '../src/client/definitions.ts'

describe('ui-right-sidebar definitions', () => {
  const mockT = ((key: string) => key) as TranslateNS<'rightSidebarContributors'>

  it('exports distinct page identities', () => {
    expect(REVIEW_TAB_ID).toBe('right-sidebar-review')
    expect(TERMINAL_TAB_ID).toBe('right-sidebar-terminal')
    expect(TASKS_TAB_ID).toBe('right-sidebar-tasks')
    expect(BROWSER_TAB_ID).toBe('right-sidebar-browser')
  })

  it('offers every contributor through the guide', () => {
    const defs = [
      reviewTabDefinition(mockT),
      terminalTabDefinition(mockT),
      tasksTabDefinition(mockT),
      browserTabDefinition(mockT),
    ]
    expect(defs.map(def => def.kind)).toEqual(['review', 'terminal', 'tasks', 'browser'])
    expect(defs.every(def => def.guide?.length === 1)).toBe(true)
    expect(new Set(defs.map(def => def.id)).size).toBe(defs.length)
  })
})
