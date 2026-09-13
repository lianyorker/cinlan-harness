/** Restricted HTTP(S) browser page. */
import { useCallback, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SidebarContributors.module.css'

type BrowserBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'rightSidebarContributors'>

function validUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch { return false }
}

export function BrowserBody({ t }: BrowserBodyProps): JSX.Element {
  const [input, setInput] = useState('')
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState(false)
  const open = useCallback(() => {
    if (!validUrl(input)) { setError(true); return }
    setError(false)
    setUrl(input)
  }, [input])
  return (
    <section className={css.browserPanel}>
      <div className={css.browserToolbar}>
        <input className={css.input} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') open() }} placeholder={t('browser.placeholder')} aria-label={t('browser.placeholder')} />
        <button type="button" className={css.primaryButton} onClick={open}>{t('browser.open')}</button>
      </div>
      {error ? <p className={css.error} role="alert">{t('browser.invalidUrl')}</p> : null}
      {url === undefined ? <p className={css.muted}>{t('browser.empty')}</p> : <iframe className={css.frame} src={url} sandbox="allow-scripts allow-same-origin allow-forms" title={t('browser.title')} />}
    </section>
  )
}
