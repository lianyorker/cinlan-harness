/** Page definition tests for the contributor package. */
import { describe, expect, it } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  browserTabDefinition,
  portsTabDefinition,
  reviewTabDefinition,
  tasksTabDefinition,
  BROWSER_TAB_ID,
  PORTS_TAB_ID,
  REVIEW_TAB_ID,
  TASKS_TAB_ID,
} from '../src/client/definitions.ts'

describe('ui-right-sidebar definitions', () => {
  const mockT = ((key: string) => key) as TranslateNS<'rightSidebarContributors'>

  it('exports distinct page identities', () => {
    expect(REVIEW_TAB_ID).toBe('right-sidebar-review')
    expect(TASKS_TAB_ID).toBe('right-sidebar-tasks')
    expect(BROWSER_TAB_ID).toBe('right-sidebar-browser')
    expect(PORTS_TAB_ID).toBe('right-sidebar-ports')
  })

  it('offers every contributor through the guide', () => {
    const defs = [
      reviewTabDefinition(mockT),
      tasksTabDefinition(mockT),
      browserTabDefinition(mockT),
      portsTabDefinition(mockT),
    ]
    expect(defs.map(def => def.kind)).toEqual(['review', 'tasks', 'browser', 'ports'])
    expect(defs.every(def => def.guide?.length === 1)).toBe(true)
    expect(new Set(defs.map(def => def.id)).size).toBe(defs.length)
  })
})
