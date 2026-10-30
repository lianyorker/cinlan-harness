/** Optional design tools contributed beside the existing Browser page. */
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { InspectedElementData } from './view/element-inspector-utils.ts'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Design tools must use the current viewport, never mount a second page. */
    'browser.design.tools': {
      kind: 'single'
      scope: 'session'
      owner: {
        readonly viewportId: string
        readonly annotationControlId: string
        readonly tabId: TabId
        readonly pageRevision: string
        readonly loading: boolean
        readonly mode: 'browse' | 'checks' | 'styles'
        /** A toolbar selection awaiting annotation; navigation clears it. */
        readonly inspectedElement: InspectedElementData | null
        readonly dismissInspection: () => void
        /** Resolve a unique matching element to current window coordinates, or null. */
        readonly locateElement: (element: InspectedElementData) => Promise<InspectedElementData['rect'] | null>
        /** Read-only, bounded Desktop guest HTML; no arbitrary script execution. */
        readonly readNativeHTML?: () => Promise<string | null>
        readonly injectDraft: (text: string) => void
      }
    }
  }
}
