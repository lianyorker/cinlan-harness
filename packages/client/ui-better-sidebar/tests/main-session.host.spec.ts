import { expect, it } from 'vitest'
import { mainSessionId } from '../src/client/main-session.ts'

it('tracks main-view ownership instead of catalog order or other retained views', () => {
  const byId = {
    first: { id: 'first', displayTitle: 'First', retainedBy: { floatingWorkspace: 1 } },
    second: { id: 'second', displayTitle: 'Second', retainedBy: { mainView: 1 } },
  }
  expect(mainSessionId({ byId })).toBe('second')
  expect(mainSessionId({ byId: { ...byId, second: { ...byId.second, retainedBy: {} } } })).toBeUndefined()
  expect(mainSessionId({ byId: { ...byId, first: { ...byId.first, retainedBy: { mainView: 1 } }, second: { ...byId.second, retainedBy: {} } } })).toBe('first')
})
