/** Native element capture with a verified preview and explicit Session draft handoff. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { BrowserElementCaptureValue, BrowserPageId, BrowserPagesValue, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CaptureInjected } from './contract.ts'
import { NS } from './locales.ts'
import css from './BrowserElementCaptureSection.module.css'

/** Props assembled by the Settings section slot. */
export type BrowserElementCaptureSectionProps = PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & CaptureInjected

type CaptureState =
  | { phase: 'idle' | 'loading' | 'selecting' | 'capturing' | 'cancelled' }
  | { phase: 'error'; message: string }
  | { phase: 'preview'; sessionId: SessionId; sessionTitle: string; value: BrowserElementCaptureValue; loaded: boolean; error?: string }
  | { phase: 'attached'; sessionTitle: string }

/**
 * Render page selection, capture progress, and explicit attachment to the initiating draft.
 * @param props - Slot owner, Session feed, localized copy, and operation callbacks.
 * @returns The native element capture panel.
 */
export function BrowserElementCaptureSection({
  t, useSessions, pages, select, capture, attach,
}: BrowserElementCaptureSectionProps): ReactNode {
  const current = useSessions(snapshot => snapshot.current === undefined ? undefined : snapshot.byId[snapshot.current])
  const [pageList, setPageList] = useState<BrowserPagesValue>()
  const [pageId, setPageId] = useState<BrowserPageId>()
  const [state, setState] = useState<CaptureState>({ phase: 'idle' })
  const operation = useRef<AbortController>()
  useEffect(() => () => { operation.current?.abort() }, [])
  const busy = state.phase === 'loading' || state.phase === 'selecting' || state.phase === 'capturing'

  const run = async (work: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    try {
      await work(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      if (operation.current === controller) operation.current = undefined
    }
  }
  const refresh = (): void => {
    setState({ phase: 'loading' })
    void run(async (signal) => {
      const value = await pages(signal)
      if (signal.aborted) return
      setPageList(value)
      setPageId(previous => value.pages.find(page => page.pageId === previous)?.pageId ?? value.pages[0]?.pageId)
      setState({ phase: 'idle' })
    })
  }
  const start = (): void => {
    if (pageId === undefined || current === undefined) return
    const sessionId = current.id
    const sessionTitle = current.displayTitle
    setState({ phase: 'selecting' })
    void run(async (signal) => {
      const selection = await select(pageId, signal)
      if (signal.aborted) return
      setState({ phase: 'capturing' })
      const value = await capture({ pageId: selection.pageId, selectionId: selection.selectionId }, signal)
      if (signal.aborted) return
      setState({ phase: 'preview', sessionId, sessionTitle, value, loaded: false })
    })
  }
  const cancel = (): void => {
    operation.current?.abort()
    setState({ phase: 'cancelled' })
  }
  const add = (): void => {
    if (state.phase !== 'preview' || !state.loaded) return
    try {
      attach(state.sessionId, state.value)
      setState({ phase: 'attached', sessionTitle: state.sessionTitle })
    } catch (error) {
      setState({ ...state, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return <section className={css.section} data-browser-element-capture="" aria-labelledby="browser-element-capture-title">
    <header className={css.heading}>
      <h1 id="browser-element-capture-title">{t('title')}</h1>
      <p>{t('description')}</p>
    </header>
    <p className={css.notice} data-settings-anchor="capture-availability">{t('availability')}</p>
    {current === undefined && <p role="status" className={css.notice}>{t('sessionRequired')}</p>}
    <ol className={css.steps}>
      <li data-settings-anchor="capture-page">
        <h2>{t('pageTitle')}</h2><p>{t('stepOne')}</p>
        <div className={css.controls}>
          <Button variant="outline" disabled={busy} onClick={refresh}>{t('refresh')}</Button>
          {pageList !== undefined && <label className={css.pageLabel}>
            <span>{t('pageLabel')}</span>
            <select aria-label={t('pageLabel')} value={pageId ?? ''} disabled={busy || pageList.pages.length === 0}
              onChange={(event) => { setPageId(pageList.pages.find(page => page.pageId === event.target.value)?.pageId); setState({ phase: 'idle' }) }}>
              {pageList.pages.map(page => <option key={page.pageId} value={page.pageId}>{page.title ? `${page.title} — ${page.url}` : page.url}</option>)}
            </select>
          </label>}
        </div>
        {pageList?.pages.length === 0 && <p role="status">{t('noPages')}</p>}
      </li>
      <li data-settings-anchor="capture-selection">
        <h2>{t('selectionTitle')}</h2><p>{t('stepTwo')}</p>
        <div className={css.controls}>
          <Button variant="primary" disabled={busy || pageId === undefined || current === undefined} onClick={start}>{t(state.phase === 'error' || state.phase === 'preview' || state.phase === 'cancelled' ? 'retry' : 'select')}</Button>
          {busy && <Button variant="outline" onClick={cancel}>{t('cancel')}</Button>}
        </div>
      </li>
      <li data-settings-anchor="capture-image">
        <h2>{t('imageTitle')}</h2><p>{t('stepThree')}</p>
        <div aria-live="polite">
          {(state.phase === 'loading' || state.phase === 'selecting' || state.phase === 'capturing' || state.phase === 'cancelled') && <p role="status">{t(state.phase)}</p>}
          {state.phase === 'error' && <div role="alert"><p>{t('failed')}</p><p>{state.message}</p></div>}
          {state.phase === 'preview' && <div className={css.preview}>
            <p>{t('verified')}</p>
            <img key={state.value.image.attachmentId}
              src={'data:' + state.value.image.mediaType + ';base64,' + state.value.data}
              alt={t('previewAlt')} width={state.value.image.width} height={state.value.image.height}
              onLoad={() => { setState(previous => previous.phase === 'preview' && previous.value === state.value ? { ...previous, loaded: true } : previous) }}
              onError={() => { setState(previous => previous.phase === 'preview' && previous.value === state.value ? { ...previous, loaded: false, error: t('previewFailed') } : previous) }} />
            <p>{t('imageDetails', { width: state.value.image.width, height: state.value.image.height, bytes: state.value.image.bytes })}</p>
            <p>{t('destination', { session: state.sessionTitle })}</p>
            {state.error !== undefined && <p role="alert">{state.error}</p>}
            <div className={css.controls}>
              <Button variant="primary" disabled={!state.loaded} onClick={add}>{t('attach')}</Button>
              <Button variant="outline" onClick={cancel}>{t('discard')}</Button>
            </div>
          </div>}
          {state.phase === 'attached' && <p role="status">{t('attached', { session: state.sessionTitle })}</p>}
        </div>
      </li>
    </ol>
    <section className={css.safety} data-settings-anchor="capture-permissions" aria-labelledby="browser-element-capture-safety-title">
      <h2 id="browser-element-capture-safety-title">{t('safetyTitle')}</h2>
      <p>{t('safetyBody')}</p>
    </section>
    <p className={css.notice}>{t('providerFact')}</p>
  </section>
}
