// @vitest-environment jsdom
/** Browser pins persist per session and tab without touching standalone Design data. */
import { afterEach, expect, it } from 'vitest'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { createBrowserPinsStore, type BrowserPin } from '../src/client/browser-pins.ts'

afterEach(() => { localStorage.clear() })

it('restores metadata and isolates sessions, tabs and legacy storage', () => {
  const legacy = JSON.stringify({ byTab: { legacy: { pins: ['unchanged'] } } })
  localStorage.setItem('cinlan.sidebar-design.v1.first', legacy)
  const tab = 'browser' as TabId
  const other = 'other' as TabId
  const pin: BrowserPin = { id: 'pin', comment: 'Tighten padding', category: 'spatial', createdAt: 123,
    element: { tagName: 'BUTTON', selector: '#real', pageUrl: 'https://preview.test/actual',
      rect: { x: 10, y: 20, width: 120, height: 44 } } }
  const first = createBrowserPinsStore().create('first')
  first.actions.add(tab, pin)
  first.actions.add(other, { ...pin, id: 'other-pin' })
  const saved = localStorage.getItem('cinlan.browser-pins.v1.first')
  expect(saved).not.toBeNull()
  expect(JSON.parse(saved!)).toEqual(first.getSnapshot())
  const restored = createBrowserPinsStore().create('first')
  expect(restored.getSnapshot().byTab[tab]).toEqual([pin])
  expect(createBrowserPinsStore().create('second').getSnapshot().byTab).toEqual({})
  restored.actions.update(tab, pin.id, { comment: 'Updated feedback', category: 'component' })
  expect(createBrowserPinsStore().create('first').getSnapshot().byTab[tab]).toEqual([
    { ...pin, comment: 'Updated feedback', category: 'component' },
  ])
  restored.actions.update(tab, 'missing', { comment: 'Ignored', category: 'general' })
  expect(restored.getSnapshot().byTab[tab]).toHaveLength(1)
  restored.actions.remove(tab, pin.id)
  expect(restored.getSnapshot().byTab[tab]).toEqual([])
  expect(restored.getSnapshot().byTab[other]).toEqual([{ ...pin, id: 'other-pin' }])
  expect(localStorage.getItem('cinlan.sidebar-design.v1.first')).toBe(legacy)
})
