/** Design checks against the Browser-owned page without another iframe. */
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { InspectedElementData } from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import { Button, IconListPenOutlineRegular, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { AntiSlopReport, PinCategory } from '../../types.ts'
import type { BrowserPin, BrowserPinsStore } from '../browser-pins.ts'
import { runAntiSlopLint } from '../services/tasteskill.ts'
import { TASTESKILL_DIRECTIONS } from '../services/directions.ts'
import css from './BrowserDesignTools.module.css'

/** Current Browser viewport and localized design actions. */
export type BrowserDesignToolsProps = Pick<PropsRuntime<'browser.design.tools'>,
  'viewportId' | 'annotationControlId' | 'tabId' | 'pageRevision' | 'loading' | 'mode'
  | 'inspectedElement' | 'dismissInspection' | 'locateElement' | 'injectDraft' | 'readNativeHTML'> & PropsLocale<'cinlanDesign'>
  & PropsStore<BrowserPinsStore>

/**
 * Bind tools to the currently observed Browser navigation.
 * @param props - current viewport, loading state and draft writer.
 * @returns checks and direction presets without a page carrier.
 */
export function BrowserDesignTools(props: BrowserDesignToolsProps): ReactNode {
  return <DesignChecks key={`${props.tabId}:${props.pageRevision}:${props.loading}`} {...props} />
}

function DesignChecks(props: BrowserDesignToolsProps): ReactNode {
  const { viewportId, loading, injectDraft, readNativeHTML, t } = props
  const [audit, setAudit] = useState<{ doc?: Document; html?: string; report: AntiSlopReport } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const runId = useRef(0)
  useEffect(() => () => { runId.current++ }, [])
  useEffect(() => {
    const host = document.getElementById(viewportId)
    if (!host) return
    const invalidate = () => { runId.current++; setAudit(null); setUnavailable(false) }
    const observer = new MutationObserver(invalidate)
    observer.observe(host, { childList: true, subtree: true })
    if (audit?.doc) observer.observe(audit.doc, { childList: true, subtree: true, attributes: true, characterData: true })
    host.addEventListener('load', invalidate, true)
    return () => { observer.disconnect(); host.removeEventListener('load', invalidate, true) }
  }, [viewportId, audit])
  const run = async () => {
    const id = ++runId.current
    const iframe = document.getElementById(viewportId)?.querySelector('iframe')
    let doc: Document | null = null
    try {
      doc = iframe?.contentDocument ?? null
    } catch (_error) {
      // Cross-origin pages and native guests expose no readable document.
    }
    if (loading || !doc || doc.readyState !== 'complete' || !/^https?:/.test(doc.URL)
      || !doc.body.innerHTML.trim()) {
      if (!loading && readNativeHTML && !iframe) {
        let html: string | null = null
        try { html = await readNativeHTML() } catch (_error) {
          // An unavailable or replaced native guest cannot supply a report.
        }
        if (id !== runId.current) return
        if (html !== null) {
          setUnavailable(false)
          setAudit({ html, report: runAntiSlopLint(html) })
          return
        }
      }
      setAudit(null); setUnavailable(true); return
    }
    setUnavailable(false)
    setAudit({ doc, report: runAntiSlopLint(doc.documentElement.outerHTML) })
  }
  const insertFindings = async () => {
    if (!audit) return
    const id = ++runId.current
    if (audit.html !== undefined) {
      let current: string | null = null
      try { current = await readNativeHTML?.() ?? null } catch (_error) {
        // Recheck the native snapshot before writing findings to the draft.
      }
      if (id !== runId.current) return
      if (current !== audit.html) { setAudit(null); setUnavailable(true); return }
    }
    injectDraft(t('prompt.auditFix', { score: audit.report.score,
      findings: audit.report.findings.map(f => `- [${f.level}] ${f.ruleId}: ${f.message}`).join('\n') }))
  }
  return <>
    <section className={css.tools} aria-label={t('audit.title')} hidden={props.mode === 'browse'}>
      {props.mode === 'checks' && <>
        <div className={css.actions}>
          <Button size="sm" onClick={() => { void run() }}>{t('audit.button')}</Button>
          <span>{audit ? t('audit.score', { score: audit.report.score }) : t('audit.unchecked')}</span>
        </div>
        {unavailable && <p role="alert">{t('audit.unavailable')}</p>}
        {audit && <div>
          <p>{t('audit.scope')}</p>
          <p>{t('audit.summary', { fails: audit.report.fails, warns: audit.report.warns })}</p>
          {audit.report.findings.length > 0 && <Button size="sm" onClick={() => { void insertFindings() }}>{t('audit.inject')}</Button>}
        </div>}
      </>}
      {props.mode === 'styles' && <details open>
        <summary>{t('styles.title')}</summary>
        {TASTESKILL_DIRECTIONS.map(direction => <div className={css.direction} key={direction.id}>
          <span>{direction.name}</span>
          <Button size="sm" onClick={() => { injectDraft(t('prompt.direction', { name: direction.name, idea: direction.idea })) }}>
            {t('styles.apply')}
          </Button>
        </div>)}
      </details>}
    </section>
    <BrowserPins {...props} />
  </>
}

const CATEGORIES = ['general', 'typography', 'spatial', 'palette', 'component', 'copy'] as const

function BrowserPins({ viewportId, annotationControlId, tabId, loading, inspectedElement, dismissInspection,
  locateElement, injectDraft, useStore, actions, t }: BrowserDesignToolsProps): ReactNode {
  const pins = useStore(state => state.byTab[tabId]) ?? []
  const [editor, setEditor] = useState<{ element: InspectedElementData; id?: string } | null>(null)
  const [records, setRecords] = useState(false)
  const [comment, setComment] = useState('')
  const [category, setCategory] = useState<PinCategory>('general')
  const reset = () => { setEditor(null); setRecords(false); setComment(''); dismissInspection() }
  const edit = (pin: BrowserPin) => {
    setEditor({ id: pin.id, element: pin.element }); setComment(pin.comment)
    setCategory(pin.category); setRecords(false)
  }
  useEffect(() => {
    if (inspectedElement && !loading) { setEditor({ element: inspectedElement }); setComment(''); setCategory('general') }
  }, [inspectedElement, loading])
  useEffect(() => {
    const host = document.getElementById(viewportId)
    const invalidate = () => { setEditor(null); setRecords(false); setComment(''); dismissInspection() }
    host?.addEventListener('load', invalidate, true)
    const observer = new MutationObserver(invalidate)
    if (host) observer.observe(host, { childList: true })
    return () => { observer.disconnect(); host?.removeEventListener('load', invalidate, true) }
  }, [viewportId, dismissInspection])
  const controls = document.getElementById(annotationControlId)
  const recordsLabel = t('pin.records', { count: pins.length })
  const recordsButton = <Tooltip label={recordsLabel} side="bottom">
    <button type="button" className={css.recordsButton} aria-label={recordsLabel} onClick={() => { setRecords(true) }}>
      <IconListPenOutlineRegular /><span>{pins.length}</span>
    </button>
  </Tooltip>
  return <>
    {controls ? createPortal(recordsButton, controls) : recordsButton}
    <Modal open={editor !== null || records} onClose={reset} closeLabel={t('close')}
      title={editor ? t(editor.id ? 'pin.edit' : 'pin.save') : t('pin.records', { count: pins.length })}
      className={css.pinDialog ?? ''} contentClassName={css.dialogContent ?? ''}>
      {editor ? <form className={css.pinForm} onSubmit={(event) => {
        event.preventDefault()
        if (!comment.trim() || !editor.element.pageUrl || loading) return
        if (editor.id) actions.update(tabId, editor.id, { category, comment: comment.trim() })
        else actions.add(tabId, { id: randomUUID(), element: editor.element, category, comment: comment.trim(), createdAt: Date.now() })
        reset()
      }}>
        <code className={css.location}>{editor.element.pageUrl} · {editor.element.selector}</code>
        <label>{t('pin.category')}
          <select value={category} onChange={(event) => { setCategory(event.currentTarget.value as PinCategory) }}>
            {CATEGORIES.map(value => <option key={value} value={value}>{t(`pin.category.${value}`)}</option>)}
          </select>
        </label>
        <label>{t('pin.comment')}
          <textarea value={comment} placeholder={t('pin.placeholder')}
            onChange={(event) => { setComment(event.currentTarget.value) }} />
        </label>
        <div className={css.actions}>
          <Button type="submit" size="sm" disabled={loading || !editor.element.pageUrl || !comment.trim()}>{t('pin.save')}</Button>
          <Button size="sm" variant="ghost" onClick={reset}>{t('pin.cancel')}</Button>
        </div>
      </form> : <>
        <p>{t('pin.recorded')}</p>
        {pins.length === 0 ? <p>{t('pin.empty')}</p> : <ol className={css.pinList}>
          {pins.map((pin, index) => <li key={pin.id}>
            <code className={css.location}>{pin.element.pageUrl} · {pin.element.selector}</code>
            <span>{t(`pin.category.${pin.category}`)}</span>
            <p className={css.comment}>{pin.comment}</p>
            <div className={css.actions}>
              <Button size="sm" onClick={() => { injectDraft(t('prompt.browserPin', {
                index: index + 1, url: pin.element.pageUrl ?? '', selector: pin.element.selector,
                x: pin.element.rect.x, y: pin.element.rect.y, width: pin.element.rect.width, height: pin.element.rect.height,
                category: t(`pin.category.${pin.category}`), comment: pin.comment,
              })) }}>{t('pin.submit')}</Button>
              <Button size="sm" onClick={() => { edit(pin) }}>{t('pin.edit')}</Button>
              <Button size="sm" variant="ghost" onClick={() => { actions.remove(tabId, pin.id) }}>{t('pin.remove')}</Button>
            </div>
          </li>)}
        </ol>}
      </>}
    </Modal>
    {!loading && !editor && !records && pins.length > 0 && <BrowserMarkers
      pins={pins} locateElement={locateElement} onEdit={edit} t={t} />}
  </>
}

function BrowserMarkers({ pins, locateElement, onEdit, t }: { readonly pins: readonly BrowserPin[]; readonly locateElement: BrowserDesignToolsProps['locateElement']; readonly onEdit: (pin: BrowserPin) => void; readonly t: BrowserDesignToolsProps['t'] }): ReactNode {
  const [locations, setLocations] = useState<readonly { pin: BrowserPin; index: number; rect: InspectedElementData['rect'] }[]>([])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      const values = await Promise.all(pins.map(async (pin, index) => {
        const rect = await locateElement(pin.element)
        return rect ? { pin, index, rect } : null
      }))
      if (!active) return
      setLocations(values.filter(value => value !== null))
      timer = setTimeout(() => { void refresh() }, 250)
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [pins, locateElement])
  return createPortal(locations.map(({ pin, index, rect }) => <button key={pin.id} type="button" className={css.marker} style={{ left: rect.x, top: rect.y }} aria-label={t('pin.marker', { index: index + 1 })} title={pin.comment} onClick={() => { onEdit(pin) }}>{index + 1}</button>), document.body)
}
