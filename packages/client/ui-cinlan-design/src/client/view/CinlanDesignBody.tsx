import { useState, useRef, type ReactNode, type FormEvent, type MouseEvent } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { CinlanDesignStore, CinlanDesignTabState } from '../store.ts'
import { DEFAULT_DESIGN_TAB_STATE } from '../store.ts'
import { runAntiSlopLint } from '../services/tasteskill.ts'
import { TASTESKILL_DIRECTIONS } from '../services/directions.ts'
import { STARTER_PROTOTYPE_HTML } from '../services/demo-prototype.ts'
import type { PinCategory, VisualPin } from '../../types.ts'
import {
  IconRefresh,
  IconArrowRight,
  IconShield,
  IconPalette,
  IconPin,
  IconClose,
  IconSparkle,
} from './icons.tsx'
import css from './CinlanDesign.module.css'

/** Cinlan Design body props assembled by the tab seat. */
export type CinlanDesignBodyProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<CinlanDesignStore>
  & PropsLocale<'cinlanDesign'>
  & {
    readonly onInjectDraft?: (text: string) => void
  }

const STORAGE_KEY_URL = 'clh:cinlan-design:last-url'

function getPersistedUrl(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_URL)
    if (saved && saved.trim()) return saved.trim()
  } catch {
    // ignore
  }
  return 'about:demo'
}

function persistUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_URL, url)
  } catch {
    // ignore
  }
}

export function CinlanDesignBody(props: CinlanDesignBodyProps): ReactNode {
  const { useTabInfo, t, onInjectDraft } = props
  const { tab } = useTabInfo()

  const tabParamUrl = (tab.navigation.params as { url?: string } | undefined)?.url
  const initialUrl = tabParamUrl ?? getPersistedUrl()

  const [tabState, setTabState] = useState<CinlanDesignTabState>({
    ...DEFAULT_DESIGN_TAB_STATE,
    url: initialUrl,
  })

  const [inputUrl, setInputUrl] = useState(initialUrl === 'about:demo' ? '' : initialUrl)
  const [selectedPinCategory, setSelectedPinCategory] = useState<PinCategory>('typography')
  const [pinComment, setPinComment] = useState('')
  const [pendingPinCoords, setPendingPinCoords] = useState<{ x: number; y: number; targetInfo?: string } | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const updateState = (updater: (prev: CinlanDesignTabState) => CinlanDesignTabState) => {
    setTabState(prev => updater(prev))
  }

  const navigateTo = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed || trimmed === 'about:demo') {
      persistUrl('about:demo')
      setInputUrl('')
      updateState(prev => ({ ...prev, url: 'about:demo' }))
      if (iframeRef.current) {
        iframeRef.current.removeAttribute('src')
        iframeRef.current.srcdoc = STARTER_PROTOTYPE_HTML
      }
      return
    }

    let url = trimmed
    if (!/^https?:\/\//i.test(url)) {
      url = `http://${url}`
    }
    persistUrl(url)
    setInputUrl(url)
    updateState(prev => ({ ...prev, url }))
    if (iframeRef.current) {
      if (iframeRef.current.src === url) {
        iframeRef.current.src = 'about:blank'
        setTimeout(() => {
          if (iframeRef.current) iframeRef.current.src = url
        }, 30)
      } else {
        iframeRef.current.removeAttribute('srcdoc')
        iframeRef.current.src = url
      }
    }
  }

  const handleNavigate = (e: FormEvent) => {
    e.preventDefault()
    navigateTo(inputUrl)
  }

  const handleReload = () => {
    const trimmed = inputUrl.trim()
    if (trimmed && trimmed !== tabState.url) {
      navigateTo(trimmed)
      return
    }
    if (iframeRef.current) {
      if (tabState.url === 'about:demo') {
        iframeRef.current.removeAttribute('src')
        iframeRef.current.srcdoc = STARTER_PROTOTYPE_HTML
      } else {
        const currentSrc = tabState.url
        iframeRef.current.src = 'about:blank'
        setTimeout(() => {
          if (iframeRef.current) iframeRef.current.src = currentSrc
        }, 30)
      }
    }
  }

  const handleLoadDemo = () => {
    navigateTo('about:demo')
  }

  const handleRunAudit = () => {
    const report = runAntiSlopLint(STARTER_PROTOTYPE_HTML)
    updateState(prev => ({ ...prev, auditReport: report, activeDrawer: 'audit' }))
  }

  const handleApplyDirection = (dirName: string, dirIdea: string) => {
    if (onInjectDraft) {
      const template = t('prompt.direction')
      const text = template.replace('{name}', dirName).replace('{idea}', dirIdea)
      onInjectDraft(text)
    }
    updateState(prev => ({ ...prev, activeDrawer: 'none' }))
  }

  const handleInjectAuditFix = () => {
    if (!tabState.auditReport || !onInjectDraft) return
    const findingsText = tabState.auditReport.findings
      .map(f => `- **[${f.level}] ${f.ruleId}**: ${f.message} (${t('audit.line', { line: String(f.line ?? 1) })})`)
      .join('\n')
    const template = t('prompt.auditFix')
    const prompt = template
      .replace('{score}', String(tabState.auditReport.score))
      .replace('{findings}', findingsText)
    onInjectDraft(prompt)
    updateState(prev => ({ ...prev, activeDrawer: 'none' }))
  }

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100)
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100)

    let targetInfo = ''
    try {
      if (iframeRef.current) {
        const iframeDoc = iframeRef.current.contentDocument
        if (iframeDoc && typeof iframeDoc.elementFromPoint === 'function') {
          const ifRect = iframeRef.current.getBoundingClientRect()
          const el = iframeDoc.elementFromPoint(e.clientX - ifRect.left, e.clientY - ifRect.top)
          if (el) {
            const tag = el.tagName.toLowerCase()
            const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
            const id = el.id ? `#${el.id}` : ''
            const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : ''
            targetInfo = text ? `<${tag}${id}${cls}> ("${text}")` : `<${tag}${id}${cls}>`
          }
        }
      }
    } catch {
      // Cross-origin iframe
    }

    setPendingPinCoords({ x, y, targetInfo })
  }

  const handleSubmitPin = () => {
    if (!pendingPinCoords || !pinComment.trim()) return
    const newPin: VisualPin = {
      id: `pin-${Date.now()}`,
      xPercent: pendingPinCoords.x,
      yPercent: pendingPinCoords.y,
      comment: pinComment.trim(),
      category: selectedPinCategory,
      target: pendingPinCoords.targetInfo,
      createdAt: Date.now(),
    }
    const updatedPins = [...tabState.pins, newPin]
    updateState(prev => ({ ...prev, pins: updatedPins }))

    if (onInjectDraft) {
      const categoryLabel = t(`pin.category.${selectedPinCategory}` as const)
      const template = t('prompt.pin')
      const targetLabel = pendingPinCoords.targetInfo
        || t('pin.targetAuto').replace('{x}', String(newPin.xPercent)).replace('{y}', String(newPin.yPercent))
      const pinMsg = template
        .replace('{index}', String(updatedPins.length))
        .replace('{target}', targetLabel)
        .replace('{x}', String(newPin.xPercent))
        .replace('{y}', String(newPin.yPercent))
        .replace('{category}', categoryLabel)
        .replace('{comment}', newPin.comment)
      onInjectDraft(pinMsg)
    }

    setPendingPinCoords(null)
    setPinComment('')
  }

  const score = tabState.auditReport?.score ?? 100
  const scoreClass = score >= 90 ? css.scoreClean : score >= 70 ? css.scoreWarn : css.scoreFail

  const viewportWrapperClass =
    tabState.viewport === 'mobile'
      ? css.deviceWrapperMobile
      : tabState.viewport === 'tablet'
      ? css.deviceWrapperTablet
      : css.deviceWrapperDesktop

  let isAppSelfOrigin = false
  try {
    if (tabState.url !== 'about:demo') {
      const u = new URL(tabState.url)
      if (u.origin === window.location.origin) {
        isAppSelfOrigin = true
      }
    }
  } catch {
    // ignore
  }

  return (
    <div className={css.container}>
      {/* Top Studio Toolbar */}
      <div className={css.toolbar}>
        <button
          type="button"
          className={css.iconButton}
          onClick={handleReload}
          title={t('reload')}
          aria-label={t('reload')}
        >
          <IconRefresh size={14} />
        </button>

        <form onSubmit={handleNavigate} className={css.addressBar}>
          <input
            type="text"
            className={css.addressInput}
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            placeholder={t('address.placeholder')}
          />
          {tabState.url === 'about:demo' && !inputUrl.trim() && (
            <span className={css.demoBadgeInBar}>{t('demo.badge')}</span>
          )}
          <button type="submit" className={css.iconButton} title={t('go')} aria-label={t('go')}>
            <IconArrowRight size={13} />
          </button>
          {tabState.url !== 'about:demo' && (
            <button
              type="button"
              className={css.demoButton}
              onClick={handleLoadDemo}
              title={t('demo.load')}
            >
              <IconSparkle size={11} /> {t('demo.badge')}
            </button>
          )}
        </form>

        {/* Viewport Switcher */}
        <div className={css.buttonGroup}>
          <button
            type="button"
            className={`${css.toolButton} ${tabState.viewport === 'desktop' ? css.activeButton : ''}`}
            onClick={() => updateState(prev => ({ ...prev, viewport: 'desktop' }))}
            title={t('viewport.desktop')}
          >
            1440
          </button>
          <button
            type="button"
            className={`${css.toolButton} ${tabState.viewport === 'tablet' ? css.activeButton : ''}`}
            onClick={() => updateState(prev => ({ ...prev, viewport: 'tablet' }))}
            title={t('viewport.tablet')}
          >
            768
          </button>
          <button
            type="button"
            className={`${css.toolButton} ${tabState.viewport === 'mobile' ? css.activeButton : ''}`}
            onClick={() => updateState(prev => ({ ...prev, viewport: 'mobile' }))}
            title={t('viewport.mobile')}
          >
            390
          </button>
        </div>

        {/* Anti-Slop Audit Button */}
        <button
          type="button"
          className={`${css.toolButton} ${css.scoreBadge} ${scoreClass}`}
          onClick={handleRunAudit}
          title={t('audit.title')}
        >
          <IconShield size={13} /> {score}
        </button>

        {/* 20 Master Directions Gallery */}
        <button
          type="button"
          className={`${css.toolButton} ${tabState.activeDrawer === 'styles' ? css.activeButton : ''}`}
          onClick={() =>
            updateState(prev => ({
              ...prev,
              activeDrawer: prev.activeDrawer === 'styles' ? 'none' : 'styles',
            }))
          }
          title={t('styles.title')}
        >
          <IconPalette size={13} /> {t('styles.button')}
        </button>

        {/* Visual Pin Annotation Toggle */}
        <button
          type="button"
          className={`${css.toolButton} ${tabState.isPinMode ? css.activeButton : ''}`}
          onClick={() => updateState(prev => ({ ...prev, isPinMode: !prev.isPinMode }))}
          title={t('pin.toggle')}
        >
          <IconPin size={13} /> {tabState.pins.length > 0 ? `(${tabState.pins.length})` : ''}
        </button>
      </div>

      {/* Main Canvas / Sandbox Viewport */}
      <div className={css.sandboxViewport}>
        <div className={`${css.deviceWrapper} ${viewportWrapperClass}`}>
          {isAppSelfOrigin ? (
            <div className={css.selfOriginContainer}>
              <div className={css.selfOriginCard}>
                <div className={css.selfOriginIcon}>
                  <IconShield size={24} />
                </div>
                <div className={css.selfOriginTitle}>{t('notice.selfOrigin.title')}</div>
                <div className={css.selfOriginDesc}>{t('notice.selfOrigin.desc')}</div>
                <div className={css.selfOriginActions}>
                  <button
                    type="button"
                    className={css.primaryAction}
                    onClick={handleLoadDemo}
                  >
                    <IconSparkle size={13} /> {t('notice.selfOrigin.loadDemo')}
                  </button>
                  <button
                    type="button"
                    className={css.secondaryAction}
                    onClick={() => navigateTo('http://localhost:5173')}
                  >
                    <IconArrowRight size={13} /> {t('notice.selfOrigin.loadVite')}
                  </button>
                </div>
              </div>
            </div>
          ) : tabState.url === 'about:demo' ? (
            <iframe
              key="sandbox-demo"
              ref={iframeRef}
              srcDoc={STARTER_PROTOTYPE_HTML}
              className={css.iframe}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title={t('type.label')}
            />
          ) : (
            <iframe
              key={tabState.url}
              ref={iframeRef}
              src={tabState.url}
              className={css.iframe}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title={t('type.label')}
            />
          )}

          {/* Interactive Annotation Overlay */}
          {tabState.isPinMode && (
            <div
              className={css.annotationOverlay}
              onClick={handleOverlayClick}
              role="button"
              tabIndex={0}
              aria-label={t('pin.active')}
            >
              {tabState.pins.map((pin, idx) => (
                <div
                  key={pin.id}
                  className={css.pinMarker}
                  style={{ left: `${pin.xPercent}%`, top: `${pin.yPercent}%` }}
                  title={`${t(`pin.category.${pin.category}` as const)}: ${pin.comment}`}
                >
                  {idx + 1}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pin Input Popover */}
      {pendingPinCoords && (
        <div
          style={{
            position: 'absolute',
            bottom: 30,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--dsw-alias-bg-layer-2)',
            border: '0.5px solid var(--dsw-alias-border-l2)',
            borderRadius: 8,
            padding: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            width: 320,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('pin.active')}</span>
            <button
              type="button"
              className={css.iconButton}
              onClick={() => setPendingPinCoords(null)}
              title={t('close')}
              aria-label={t('close')}
            >
              <IconClose size={13} />
            </button>
          </div>
          <select
            value={selectedPinCategory}
            onChange={e => setSelectedPinCategory(e.target.value as PinCategory)}
            style={{
              padding: 4,
              borderRadius: 4,
              border: '0.5px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 11,
            }}
          >
            <option value="typography">{t('pin.category.typography')}</option>
            <option value="spatial">{t('pin.category.spatial')}</option>
            <option value="palette">{t('pin.category.palette')}</option>
            <option value="component">{t('pin.category.component')}</option>
            <option value="copy">{t('pin.category.copy')}</option>
            <option value="general">{t('pin.category.general')}</option>
          </select>
          {pendingPinCoords.targetInfo && (
            <div style={{ fontSize: 10, color: 'var(--dsw-alias-brand-primary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pendingPinCoords.targetInfo}
            </div>
          )}
          <input
            type="text"
            value={pinComment}
            onChange={e => setPinComment(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubmitPin()
              if (e.key === 'Escape') setPendingPinCoords(null)
            }}
            placeholder={t('pin.placeholder')}
            autoFocus
            style={{
              padding: '6px 8px',
              borderRadius: 4,
              border: '0.5px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 12,
            }}
          />
          <button
            type="button"
            className={`${css.toolButton} ${css.activeButton}`}
            onClick={handleSubmitPin}
            style={{ width: '100%', height: 30 }}
          >
            {t('pin.submit')}
          </button>
        </div>
      )}

      {/* Anti-Slop Audit Drawer */}
      {tabState.activeDrawer === 'audit' && tabState.auditReport && (
        <div className={css.drawer}>
          <div className={css.drawerHeader}>
            <span className={css.drawerTitle}>{t('audit.title')}</span>
            <button
              type="button"
              className={css.iconButton}
              onClick={() => updateState(prev => ({ ...prev, activeDrawer: 'none' }))}
              title={t('close')}
              aria-label={t('close')}
            >
              <IconClose size={13} />
            </button>
          </div>
          <div className={css.drawerContent}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`${css.scoreBadge} ${scoreClass}`} style={{ fontSize: 13, height: 28 }}>
                {score} / 100
              </span>
              <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
                {tabState.auditReport.fails === 0
                  ? t('audit.clean')
                  : t('audit.summary', { fails: String(tabState.auditReport.fails), warns: String(tabState.auditReport.warns) })}
              </span>
            </div>

            {tabState.auditReport.findings.length > 0 && (
              <button
                type="button"
                className={`${css.toolButton} ${css.activeButton}`}
                onClick={handleInjectAuditFix}
                style={{ width: '100%', height: 32 }}
              >
                {t('audit.inject')}
              </button>
            )}

            {tabState.auditReport.findings.map((f, i) => (
              <div
                key={`${f.ruleId}-${i}`}
                className={`${css.findingItem} ${f.level === 'WARN' ? css.findingItemWarn : ''}`}
              >
                <div className={css.findingHeader}>
                  <span style={{ color: f.level === 'FAIL' ? '#ef4444' : '#f59e0b' }}>
                    [{f.level}] {f.ruleId}
                  </span>
                  <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>
                    {t('audit.line', { line: String(f.line ?? 1) })}
                  </span>
                </div>
                <div className={css.findingMessage}>{f.message}</div>
                {f.sample && <div className={css.findingSample}>{f.sample}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 20 Master Directions Drawer */}
      {tabState.activeDrawer === 'styles' && (
        <div className={css.drawer}>
          <div className={css.drawerHeader}>
            <span className={css.drawerTitle}>{t('styles.title')}</span>
            <button
              type="button"
              className={css.iconButton}
              onClick={() => updateState(prev => ({ ...prev, activeDrawer: 'none' }))}
              title={t('close')}
              aria-label={t('close')}
            >
              <IconClose size={13} />
            </button>
          </div>
          <div className={css.drawerContent}>
            {TASTESKILL_DIRECTIONS.map(dir => (
              <div
                key={dir.id}
                className={css.directionCard}
                onClick={() => handleApplyDirection(dir.name, dir.idea)}
                role="button"
                tabIndex={0}
              >
                <div className={css.directionName}>{dir.name}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {dir.tones.map(tone => (
                    <span key={tone} className={css.toneBadge}>
                      {tone}
                    </span>
                  ))}
                </div>
                <div className={css.directionIdea}>{dir.idea}</div>
                <button
                  type="button"
                  className={css.applyButton}
                >
                  {t('styles.apply')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
