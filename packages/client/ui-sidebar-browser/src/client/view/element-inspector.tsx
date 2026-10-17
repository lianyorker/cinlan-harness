/** Browser design mode DOM element inspector overlay component. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import css from './Browser.module.css'
import {
  extractElementData,
  type InspectedElementData,
} from './element-inspector-utils.ts'

export type { InspectedElementData } from './element-inspector-utils.ts'

export interface ElementInspectorOverlayProps {
  readonly viewportId: string
  readonly pageUrl?: string | undefined
  readonly onInspectElement: (data: InspectedElementData) => void
  readonly onCancel: () => void
}

interface HighlightState {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly tagName: string
}

export function ElementInspectorOverlay({
  viewportId: _viewportId,
  pageUrl,
  onInspectElement,
  onCancel,
}: ElementInspectorOverlayProps): ReactNode {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [highlight, setHighlight] = useState<HighlightState | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [onCancel])

  const findTargetElement = (clientX: number, clientY: number): Element | null => {
    const overlay = overlayRef.current
    if (!overlay || typeof document.elementFromPoint !== 'function') return null

    overlay.style.visibility = 'hidden'
    const target = document.elementFromPoint(clientX, clientY)
    overlay.style.visibility = 'visible'

    if (!target) return null

    if (target instanceof HTMLIFrameElement) {
      try {
        const iframeDoc = target.contentDocument
        if (iframeDoc && typeof iframeDoc.elementFromPoint === 'function') {
          const rect = target.getBoundingClientRect()
          const innerTarget = iframeDoc.elementFromPoint(clientX - rect.left, clientY - rect.top)
          if (innerTarget) return innerTarget
        }
      } catch {
        // Cross-origin iframe
      }
    }

    return target
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = findTargetElement(e.clientX, e.clientY)
    const overlay = overlayRef.current
    if (!target || !overlay) {
      setHighlight(null)
      return
    }

    const overlayRect = overlay.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()

    setHighlight({
      left: targetRect.left - overlayRect.left,
      top: targetRect.top - overlayRect.top,
      width: targetRect.width,
      height: targetRect.height,
      tagName: target.tagName.toLowerCase(),
    })
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const target = findTargetElement(e.clientX, e.clientY)
    if (target) {
      const data = extractElementData(target, pageUrl)
      onInspectElement(data)
    } else {
      const overlay = overlayRef.current
      const overlayRect = overlay ? overlay.getBoundingClientRect() : { left: 0, top: 0, width: 400, height: 300 }
      const x = Math.round(e.clientX - overlayRect.left)
      const y = Math.round(e.clientY - overlayRect.top)
      onInspectElement({
        tagName: 'element',
        selector: `viewport[at=${x},${y}]`,
        rect: { x, y, width: 50, height: 30 },
        pageUrl,
      })
    }
  }

  return (
    <div
      ref={overlayRef}
      className={css.inspectorOverlay}
      data-testid="browser-inspector-overlay"
      onPointerMove={handlePointerMove}
      onClick={handleClick}
    >
      {highlight ? (
        <div
          className={css.inspectorHighlight}
          style={{
            left: `${highlight.left}px`,
            top: `${highlight.top}px`,
            width: `${highlight.width}px`,
            height: `${highlight.height}px`,
          }}
        >
          <span className={css.inspectorTagBadge}>
            {highlight.tagName} · {Math.round(highlight.width)}×{Math.round(highlight.height)}
          </span>
        </div>
      ) : null}
    </div>
  )
}
