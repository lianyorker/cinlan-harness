/**
 * The `git` page body: repository facts, one change set, and its AI draft.
 *
 * One state machine: idle loads repository state and the selected diff; the
 * two action buttons start one generation each; results land in an editable
 * textarea with copy and guarded regenerate. Every request is abortable, and a
 * late response for a superseded Session or selection never lands.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  GitAiGenerateResult, GitAiSelectionId,
} from '@cinlan/api-git-ai-controller/types'
import type { GitCompareResult, GitStatusResult } from '@cinlan/api-sidebar-git-controller/types'
import css from './GitReviewBody.module.css'

/** Data and callbacks the apply closure injects; components never see ctx. */
export interface GitReviewBodyInjected {
  /** Read the panel's repository observation. */
  readonly status: (signal: AbortSignal) => Promise<GitStatusResult>
  /** Read the unified diff of one change set. */
  readonly diff: (staged: boolean, signal: AbortSignal) => Promise<{ diff: string }>
  /** Read the pinned comparison or its unavailability reason. */
  readonly compare: (signal: AbortSignal) => Promise<GitCompareResult>
  /** Generate one AI draft. */
  readonly generate: (
    action: 'diff-review' | 'pr-description', selection: GitAiSelectionId, signal: AbortSignal,
  ) => Promise<GitAiGenerateResult>
}

/** Standard runtime, locale, and injected shares derived from the slot. */
export type GitReviewBodyProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'sidebarGitReview'>
  & InjectFace<GitReviewBodyInjected>

/** One panel observation: repository facts, selection diff, comparison base. */
interface PanelState {
  readonly status: GitStatusResult
  readonly diff: string
  readonly compare: GitCompareResult | undefined
}

/** Localize one Remote error code into panel copy. */
function failureMessage(
  t: PropsLocale<'sidebarGitReview'>['t'], code: string, message: string,
): string {
  const withMessage: ReadonlySet<string> = new Set([
    'git-ai/invalid-request', 'git-ai/comparison-unavailable', 'git-ai/model-failed', 'gateway/generic',
  ])
  const key = code === 'gateway/cancelled' ? 'error.cancelled'
    : code.startsWith('git-ai/') ? `error.${code.slice('git-ai/'.length)}` : 'error.generic'
  const localized = t(key as never)
  return withMessage.has(code) || code === 'error.generic'
    ? localized.replace('{message}', message)
    : localized
}

/**
 * The Git review page body.
 * @param props - runtime props, locale, and the injected Remote face.
 * @returns repository header, change-set picker, patch preview, and draft editor.
 */
export function GitReviewBody(props: GitReviewBodyProps): ReactNode {
  const { sessionId, useSessions, t, status, diff, compare, generate } = props
  const injected = useRef<GitReviewBodyInjected>({ status, diff, compare, generate })
  injected.current = { status, diff, compare, generate }
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [panel, setPanel] = useState<PanelState>()
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<GitAiSelectionId>('staged')
  const [busy, setBusy] = useState<AbortController | undefined>()
  const [draft, setDraft] = useState<GitAiGenerateResult>()
  const [edited, setEdited] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState('')
  const editedRef = useRef(false)
  const loadEpoch = useRef(0)
  const mountEpoch = useRef(0)
  const busyRef = useRef<AbortController | undefined>(undefined)

  const load = useCallback(async (signal: AbortSignal): Promise<void> => {
    const token = ++loadEpoch.current
    setError('')
    if (cwd === undefined) {
      setState('ready')
      setPanel(undefined)
      return
    }
    try {
      const [statusResult, diffResult, compareResult] = await Promise.all([
        injected.current.status(signal), injected.current.diff(selection === 'staged', signal), injected.current.compare(signal),
      ])
      if (signal.aborted || token !== loadEpoch.current) return
      setPanel({ status: statusResult, diff: diffResult.diff, compare: compareResult })
      setState(statusResult.isRepo ? 'ready' : 'error')
      if (!statusResult.isRepo) setError(t('notRepository'))
    } catch (reason: unknown) {
      if (signal.aborted || token !== loadEpoch.current) return
      setState('error')
      setError(t('error.generic').replace('{message}', reason instanceof Error ? reason.message : String(reason)))
    }
  }, [cwd, selection, t])

  const begin = useCallback((): AbortSignal => {
    busyRef.current?.abort()
    const controller = new AbortController()
    busyRef.current = controller
    setBusy(controller)
    return controller.signal
  }, [])

  const refresh = useCallback((): void => {
    const controller = new AbortController()
    setState('loading')
    void load(controller.signal)
  }, [load])

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    void load(controller.signal)
    return () => { controller.abort(); loadEpoch.current++ }
  }, [load])

  // mountEpoch 只在会话重挂载时递增：生成结果不被选择切换的重载作废。
  useEffect(() => {
    return () => {
      mountEpoch.current++
      busyRef.current?.abort()
    }
  }, [sessionId])

  const run = useCallback(async (action: 'diff-review' | 'pr-description'): Promise<void> => {
    const target = action === 'pr-description' ? 'comparison' : selection
    if (action === 'diff-review' && editedRef.current && draft !== undefined
      && !window.confirm(t('regenerateConfirm'))) {
      return
    }
    const signal = begin()
    const token = mountEpoch.current
    setNotice('')
    setError('')
    try {
      const result = await injected.current.generate(action, target, signal)
      if (signal.aborted || token !== mountEpoch.current) return
      setDraft(result)
      setEdited(result.text)
      editedRef.current = false
      setCopied('')
      if (panel !== undefined && result.repository.head !== null
        && (panel.status.repository?.head ?? null) !== result.repository.head) {
        setNotice(t('staleNotice'))
      }
    } catch (reason: unknown) {
      if (signal.aborted || token !== mountEpoch.current) return
      const code = reason instanceof Error && 'code' in reason
        ? String((reason as { code?: unknown }).code) : 'error.generic'
      setError(failureMessage(t, code, reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setBusy(undefined)
    }
  }, [begin, draft, panel, selection, t])

  const copy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(edited)
      setCopied(t('copied'))
    } catch {
      setCopied(t('copyFailed'))
    }
  }, [edited, t])

  const effective = panel === undefined ? undefined : {
    branch: panel.status.repository?.branch ?? panel.status.branch ?? 'HEAD',
    head: panel.status.repository?.head ?? null,
  }

  return <div className={css.page} data-git-review-page>
    <header className={css.header}>
      <h2 className={css.title}>{t('page.title')}</h2>
      <button type="button" className={css.tool} aria-label={t('refresh')} data-git-review-refresh
        disabled={busy !== undefined} onClick={refresh}>{t('refresh')}</button>
    </header>
    {state === 'loading' && <p role="status" className={css.help}>{t('loading')}</p>}
    {cwd === undefined && <p className={css.help}>{t('noWorkspace')}</p>}
    {state === 'error' && error !== '' && <p role="alert" className={css.alert}>{error}</p>}
    {state === 'ready' && panel !== undefined && <>
      <dl className={css.meta}>
        <div><dt>{t('branchLabel')}</dt><dd><code>{effective?.branch}</code></dd></div>
        {panel.compare?.status === 'ready' && <div>
          <dt>{t('compareSource')}</dt>
          <dd><code>{panel.compare.baseRef}</code>{panel.compare.usedFallback
            ? <span className={css.fallback}>{t('compareFallback')}</span> : null}</dd>
        </div>}
      </dl>
      <fieldset className={css.selection} disabled={busy !== undefined}>
        <legend>{t('selectionLabel')}</legend>
        {(['staged', 'worktree', 'comparison'] as const).map(kind => <label key={kind} className={css.radio}>
          <input type="radio" name={`git-review-set-${String(sessionId)}`} value={kind}
            checked={selection === kind} onChange={() => { setSelection(kind); setNotice('') }} />
          {t(`selection.${kind}` as const)}
        </label>)}
        {selection === 'comparison' && panel.compare?.status !== 'ready' && <p role="alert" className={css.alert}>
          {t('error.comparison-unavailable').replace('{message}', String(panel.compare?.reason ?? ''))}
        </p>}
      </fieldset>
      <section className={css.patchBlock}>
        <h3 className={css.sectionTitle}>{t('patchTitle')}</h3>
        {panel.diff.trim().length === 0
          ? <p className={css.help}>{t('noDiff')}</p>
          : <pre className={css.patch} tabIndex={0} aria-label={t('patchTitle')}>{panel.diff}</pre>}
      </section>
      <div className={css.actions}>
        <button type="button" className={css.primary} data-git-review-generate
          disabled={busy !== undefined || panel.diff.trim().length === 0 && selection !== 'comparison'}
          onClick={() => { void run('diff-review') }}>
          {busy !== undefined ? t('generating') : t('reviewAction')}
        </button>
        <button type="button" className={css.primary} data-git-pr-generate
          disabled={busy !== undefined || panel.compare?.status !== 'ready'}
          onClick={() => { setSelection('comparison'); void run('pr-description') }}>
          {t('prAction')}
        </button>
        {busy !== undefined && <button type="button" className={css.quiet} data-git-review-cancel
          onClick={() => { busyRef.current?.abort() }}>{t('cancel')}</button>}
      </div>
      {notice !== '' && <p role="status" className={css.help}>{notice}</p>}
      {error !== '' && <p role="alert" className={css.alert}>{error}</p>}
      {draft !== undefined && <section className={css.draft}>
        <div className={css.draftHeader}>
          <h3 className={css.sectionTitle}>{t('draftTitle')}</h3>
          <div className={css.draftTools}>
            <button type="button" className={css.tool} onClick={() => { void copy() }}>{t('copy')}</button>
            <button type="button" className={css.tool} onClick={() => { void run(draft.action) }}>
              {t('regenerate')}</button>
          </div>
        </div>
        {copied !== '' && <p role="status" className={css.help}>{copied}</p>}
        <textarea className={css.editor} aria-label={t('draftTitle')} data-git-review-draft
          value={edited} placeholder={t('draftPlaceholder')} onChange={(event) => {
            setEdited(event.target.value)
            editedRef.current = true
          }} />
        <p className={css.child}><code>{t('childSession')}: {String(draft.childSessionId)}</code></p>
        {draft.omittedFiles.length > 0 && <p role="status" className={css.help}>
          {t('omittedFiles').replace('{files}', draft.omittedFiles.join(', '))}</p>}
        {draft.truncated && <p role="status" className={css.help}>{t('truncated')}</p>}
      </section>}
    </>}
  </div>
}
