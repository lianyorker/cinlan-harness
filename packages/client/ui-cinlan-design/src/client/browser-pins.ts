/** Browser annotations use a separate persistence key from standalone Design tabs. */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { InspectedElementData } from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import type { PinCategory } from '../types.ts'

/** A recorded element, not a live locator or a position on the current page. */
export interface BrowserPin {
  readonly id: string
  readonly element: InspectedElementData
  readonly category: PinCategory
  readonly comment: string
  readonly createdAt: number
}

interface BrowserPinsState {
  byTab: Record<TabId, BrowserPin[]>
}

/**
 * Declare session-scoped Browser annotation storage without migrating legacy pins.
 * @returns the store handle for the Browser tools slot.
 */
export function createBrowserPinsStore() {
  return defineStore({
    init: (): BrowserPinsState => ({ byTab: {} }),
    persist: 'cinlan.browser-pins.v1',
    actions: {
      add: (draft, tabId: TabId, pin: BrowserPin) => { (draft.byTab[tabId] ??= []).push(pin) },
      update: (draft, tabId: TabId, id: string, changes: Pick<BrowserPin, 'comment' | 'category'>) => {
        const pin = draft.byTab[tabId]?.find(value => value.id === id)
        if (pin) Object.assign(pin, changes)
      },
      remove: (draft, tabId: TabId, id: string) => {
        draft.byTab[tabId] = (draft.byTab[tabId] ?? []).filter(pin => pin.id !== id)
      },
    },
  })
}

/** Persistence handle owned by the Browser tools slot. */
export type BrowserPinsStore = ReturnType<typeof createBrowserPinsStore>
