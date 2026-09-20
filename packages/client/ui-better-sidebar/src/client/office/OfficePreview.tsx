/** Read-only Office pages use the Host converter and the browser's PDF viewer. */
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { downloadUrl, type SessionScope } from '../api.ts'
import { t, type CopyKey } from '../locales.ts'
import { OfficePreviewError, type ReadOfficePreview } from './read-office.ts'
import css from './OfficePreview.module.css'
import sidebarCss from '../sidebar.module.css'

interface OfficePreviewProps {
  readonly read?: ReadOfficePreview | undefined
  readonly scope: SessionScope
  readonly path: string
  readonly title: string
}

type PreviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly url: string; readonly missingFonts: readonly string[] }
  | { readonly status: 'error'; readonly key: CopyKey }

/**
 * Keep conversion and render failures inside one file tab.
 * @param props - Authorized reader and current file identity.
 * @returns PDF preview, localized progress or recovery controls.
 */
export function OfficePreview(props: OfficePreviewProps): ReactNode {
  return <OfficeBoundary key={JSON.stringify([props.scope.sessionId, props.path])} {...props}>
    <OfficeDocument {...props} />
  </OfficeBoundary>
}

class OfficeBoundary extends Component<OfficePreviewProps & { readonly children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return <div className={css.preview}>
      <OfficeToolbar scope={this.props.scope} path={this.props.path} failed
        onReload={() => { this.setState({ failed: false }) }} />
      <p className={css.status} role="alert">{t('officeFailed')}</p>
    </div>
  }
}

function OfficeDocument({ read, scope, path, title }: OfficePreviewProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  const frame = useRef<HTMLIFrameElement>(null)
  const shield = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    setState({ status: 'loading' })
    void (async () => {
      try {
        if (read === undefined) throw new OfficePreviewError('officeUnavailable')
        const file = await read(scope.sessionId, path, controller.signal)
        controller.signal.throwIfAborted()
        const binary = atob(file.data)
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
        url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        setState({ status: 'ready', url, missingFonts: file.missingFonts })
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({ status: 'error', key: error instanceof OfficePreviewError ? error.key : 'officeReadFailed' })
        }
      }
    })()
    return () => {
      controller.abort()
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [read, scope.sessionId, path, revision])

  useEffect(() => {
    const block = (): void => {
      if (frame.current !== null) frame.current.style.pointerEvents = 'none'
      if (shield.current !== null) shield.current.style.pointerEvents = 'auto'
    }
    const unblock = (): void => {
      if (frame.current !== null) frame.current.style.pointerEvents = ''
      if (shield.current !== null) shield.current.style.pointerEvents = ''
    }
    const resize = (event: PointerEvent): void => {
      if (event.target instanceof Element
        && event.target.closest(`.${sidebarCss.panelResize}, .${sidebarCss.divider}, [role="separator"]`) !== null) block()
    }
    // Native PDF frames otherwise consume the pointer stream during pane moves.
    document.addEventListener('dragstart', block, true)
    document.addEventListener('dragend', unblock, true)
    document.addEventListener('drop', unblock, true)
    window.addEventListener('pointerdown', resize, true)
    window.addEventListener('pointerup', unblock, true)
    window.addEventListener('pointercancel', unblock, true)
    window.addEventListener('blur', unblock)
    return () => {
      document.removeEventListener('dragstart', block, true)
      document.removeEventListener('dragend', unblock, true)
      document.removeEventListener('drop', unblock, true)
      window.removeEventListener('pointerdown', resize, true)
      window.removeEventListener('pointerup', unblock, true)
      window.removeEventListener('pointercancel', unblock, true)
      window.removeEventListener('blur', unblock)
    }
  }, [])

  return <div className={css.preview} data-office-preview={state.status}>
    <OfficeToolbar scope={scope} path={path} failed={state.status === 'error'}
      loading={state.status === 'loading'} onReload={() => { setRevision(value => value + 1) }} />
    {state.status === 'loading' && <p className={css.status} role="status">{t('officeLoading')}</p>}
    {state.status === 'error' && <p className={css.status} role="alert">{t(state.key)}</p>}
    {state.status === 'ready' && <>
      {state.missingFonts.length > 0 && <details className={css.fontNotice}>
        <summary>{t('officeMissingFonts', { count: state.missingFonts.length })}</summary>
        <p>{t('officeMissingFontsDescription')}</p>
        <ul>{state.missingFonts.map(font => <li key={font}>{font}</li>)}</ul>
      </details>}
      <div className={css.stage}>
        <iframe ref={frame} className={css.frame} src={state.url} title={title}
          onError={() => { setState({ status: 'error', key: 'officePdfFailed' }) }} />
        <div ref={shield} className={css.shield} aria-hidden="true" />
      </div>
    </>}
  </div>
}

function OfficeToolbar(props: {
  readonly scope: SessionScope
  readonly path: string
  readonly failed: boolean
  readonly loading?: boolean
  readonly onReload: () => void
}): ReactNode {
  return <div className={css.toolbar}>
    <a className={css.control} href={downloadUrl(props.scope, props.path)} download>{t('officeDownload')}</a>
    <button className={css.control} type="button" disabled={props.loading} onClick={props.onReload}>
      {t(props.failed ? 'officeRetry' : 'officeReload')}
    </button>
  </div>
}
