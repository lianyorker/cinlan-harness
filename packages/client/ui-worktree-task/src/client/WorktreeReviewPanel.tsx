/** Read-only task review with captured programs and durable cleanup settlement. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeTaskReview, WorktreeTaskView } from '@deepseek-ai/dsh-api-worktree-task-controller/types'
import type { WorktreeTaskSectionInjected, WorktreeTaskSectionProps } from './WorktreeTaskSection.tsx'
import css from './WorktreeTaskSection.module.css'

/**
 * Load and display a task's complete bounded review without changing its lifecycle.
 * @param props - Task identity, localized labels, and the Host read callback.
 * @returns Review metadata, literal patch text, untracked names, and cleanup receipt.
 */
export function WorktreeReviewPanel({ task, t, review, onClose }: {
  task: WorktreeTaskView
  t: WorktreeTaskSectionProps['t']
  review: WorktreeTaskSectionInjected['review']
  onClose: () => void
}) {
  const [value, setValue] = useState<WorktreeTaskReview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setLoading(true)
    setError(null)
    setValue(null)
    try {
      const result = await review(task.taskId, controller.signal)
      if (!controller.signal.aborted) setValue(result)
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [review, task.taskId])
  useEffect(() => { void refresh(); return () => { abort.current?.abort() } }, [refresh])
  const receipt = value?.cleanupReceipt
  return <section className={css.reviewPanel} aria-label={t('reviewTitle', { name: task.name })} aria-busy={loading}>
    <div className={css.taskCardHeader}>
      <h2 className={css.sectionTitle}>{t('reviewTitle', { name: task.name })}</h2>
      <div className={css.toolbar}>
        <Button variant="outline" onClick={() => { void refresh() }}>{t('reviewRefresh')}</Button>
        <Button onClick={onClose}>{t('close')}</Button>
      </div>
    </div>
    <p className={css.help}>{t('reviewHelp')}</p>
    {loading && <p role="status" className={css.help}>{t('reviewLoading')}</p>}
    {error !== null && <p role="alert" className={css.errorBanner}>{error}</p>}
    {value !== null && <>
      <dl className={css.taskMeta}>
        <div><dt>{t('reviewBase')}</dt><dd>{value.baseHead}</dd></div>
        <div><dt>{t('reviewHead')}</dt><dd>{value.head}</dd></div>
        <div><dt>{t('checkoutPath')}</dt><dd>{value.checkoutRoot}</dd></div>
        <div><dt>{t('reviewWorkingTree')}</dt><dd>{t(value.dirty ? 'reviewDirty' : 'reviewClean')}</dd></div>
        {(['setup', 'cleanup'] as const).map(kind => <div key={kind}>
          <dt>{t(kind === 'setup' ? 'setupTitle' : 'cleanupTitle')}</dt>
          <dd>{value[kind] === null ? t('hookDisabled') : <code>{JSON.stringify([value[kind].executable, ...value[kind].args])}</code>}</dd>
        </div>)}
        <div><dt>{t('cleanupReceipt')}</dt><dd>{t(receipt === undefined ? 'cleanupNotRun' : receipt.status === 'running'
          ? 'cleanupUnsettled' : receipt.status === 'failed' ? 'cleanupFailed' : 'cleanupSucceeded')}</dd></div>
        {receipt !== undefined && <>
          <div><dt>{t('cleanupOperation')}</dt><dd>{t(receipt.operation)}</dd></div>
          <div><dt>{t('cleanupStarted')}</dt><dd>{receipt.startedAt}</dd></div>
          {receipt.status !== 'running' && <div><dt>{t('cleanupFinished')}</dt><dd>{receipt.finishedAt}</dd></div>}
        </>}
      </dl>
      <h3 className={css.sectionTitle}>{t('reviewPatch')}</h3>
      {value.patch.length === 0 ? <p className={css.help}>{t('reviewNoPatch')}</p>
        : <pre className={css.patch} tabIndex={0} aria-label={t('reviewPatch')}>{value.patch}</pre>}
      <h3 className={css.sectionTitle}>{t('reviewUntracked')}</h3>
      <p className={css.help}>{t('reviewUntrackedHelp')}</p>
      {value.untracked.length === 0 ? <p className={css.help}>{t('reviewNoUntracked')}</p>
        : <ul>{value.untracked.map(path => <li key={path}><code>{path}</code></li>)}</ul>}
    </>}
  </section>
}
