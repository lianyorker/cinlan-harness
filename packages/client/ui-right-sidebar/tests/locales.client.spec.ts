/** Locale dictionary tests. */
import { describe, expect, it } from 'vitest'
import { zh, en, NS } from '../src/client/locales.ts'

describe('ui-right-sidebar locales', () => {
  it('exports the contributor namespace', () => {
    expect(NS).toBe('rightSidebarContributors')
  })

  it('zh and en have matching keys', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('contains page labels and operational copy', () => {
    expect(zh['review.title']).toBe('审查')
    expect(zh['terminal.title']).toBe('终端')
    expect(zh['tasks.title']).toBe('任务')
    expect(zh['browser.title']).toBe('浏览器')
    expect(en['review.description']).toBeTruthy()
    expect(en['terminal.start']).toBeTruthy()
    expect(en['tasks.refresh']).toBeTruthy()
    expect(en['browser.invalidUrl']).toBeTruthy()
  })
})
