/** Persisted Cinlan Design tab snapshots shared by the body and title slots. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { AntiSlopReport, VisualPin } from '../types.ts'

export type ViewportMode = 'desktop' | 'tablet' | 'mobile'

export interface CinlanDesignTabState {
  url: string
  viewport: ViewportMode
  isPinMode: boolean
  activeDrawer: 'none' | 'audit' | 'styles' | 'tokens'
  pins: VisualPin[]
  auditReport: AntiSlopReport | null
}

export interface CinlanDesignState {
  byTab: Record<TabId, CinlanDesignTabState>
}

type CinlanDesignActions = {
  replace: (draft: CinlanDesignState, tabId: TabId, state: CinlanDesignTabState) => void
  forget: (draft: CinlanDesignState, tabId: TabId) => void
}

export const DEFAULT_DESIGN_TAB_STATE: CinlanDesignTabState = {
  url: 'http://localhost:3000',
  viewport: 'desktop',
  isPinMode: false,
  activeDrawer: 'none',
  pins: [],
  auditReport: null,
}

/**
 * Declare the Session-scoped Cinlan Design persistence store.
 * @returns a fresh store handle for Slot registration.
 */
export function createCinlanDesignStore(): EngineStoreHandle<CinlanDesignState, CinlanDesignActions> {
  return defineStore({
    init: (): CinlanDesignState => ({ byTab: {} }),
    persist: 'cinlan.sidebar-design.v1',
    actions: {
      replace: (draft, tabId: TabId, state: CinlanDesignTabState) => { draft.byTab[tabId] = state },
      forget: (draft, tabId: TabId) => {
        const byTab: CinlanDesignState['byTab'] = {}
        for (const [id, state] of Object.entries(draft.byTab) as [TabId, CinlanDesignTabState][]) {
          if (id !== tabId) byTab[id] = state
        }
        draft.byTab = byTab
      },
    },
  })
}

export type CinlanDesignStore = ReturnType<typeof createCinlanDesignStore>
