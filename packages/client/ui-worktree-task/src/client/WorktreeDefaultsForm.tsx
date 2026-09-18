/** Revision-checked defaults editor; saving never invokes a lifecycle program. */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeTaskHook, WorktreeTaskSettings } from '@deepseek-ai/dsh-api-worktree-task-controller/types'
import type { WorktreeTaskSectionInjected, WorktreeTaskSectionProps } from './WorktreeTaskSection.tsx'
import css from './WorktreeTaskSection.module.css'

type Translate = WorktreeTaskSectionProps['t']
interface Props {
  t: Translate
  settings: WorktreeTaskSectionInjected['settings']
  updateSettings: WorktreeTaskSectionInjected['updateSettings']
  disabled: boolean
  onBusy: (busy: boolean) => void
}

/**
 * Edit Host defaults with independent drafts and an explicit reload after a conflict.
 * @param props - Localized copy and revisioned Host callbacks.
 * @returns Future-task defaults, loading/error state, and save controls.
 */
export function WorktreeDefaultsForm({ t, settings, updateSettings, disabled, onBusy }: Props) {
  const prefix = useId()
  const [saved, setSaved] = useState<WorktreeTaskSettings | null>(null)
  const [directory, setDirectory] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const [setup, setSetup] = useState<WorktreeTaskHook>({ executable: '', args: [] })
  const [cleanup, setCleanup] = useState<WorktreeTaskHook>({ executable: '', args: [] })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const loadAbort = useRef<AbortController | null>(null)
  const saveAbort = useRef<AbortController | null>(null)

  const adopt = useCallback((value: WorktreeTaskSettings) => {
    setSaved(value)
    setDirectory(value.value.defaultDirectory)
    setBaseRef(value.value.baseRef)
    setSetup(value.value.setup ?? { executable: '', args: [] })
    setCleanup(value.value.cleanup ?? { executable: '', args: [] })
  }, [])

  const reload = useCallback(async () => {
    loadAbort.current?.abort()
    const controller = new AbortController()
    loadAbort.current = controller
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const value = await settings(controller.signal)
      if (!controller.signal.aborted) adopt(value)
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [settings, adopt])

  useEffect(() => {
    void reload()
    return () => { loadAbort.current?.abort(); saveAbort.current?.abort() }
  }, [reload])

  async function save(): Promise<void> {
    if (saved === null || loading || disabled || saveAbort.current !== null) return
    const hook = (value: WorktreeTaskHook): WorktreeTaskHook | null => value.executable.length === 0 ? null : value
    if (!baseRef.trim() || [setup, cleanup].some(value =>
      !value.executable.trim() && (value.executable.length !== 0 || value.args.length !== 0))) {
      setError(t('defaultsInvalid'))
      return
    }
    const controller = new AbortController()
    saveAbort.current = controller
    setSaving(true)
    onBusy(true)
    setError(null)
    setNotice(null)
    try {
      const value = await updateSettings({ expectedRevision: saved.revision,
        value: { defaultDirectory: directory, baseRef, setup: hook(setup), cleanup: hook(cleanup) } }, controller.signal)
      if (!controller.signal.aborted) { adopt(value); setNotice(t('defaultsSaved')) }
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (!controller.signal.aborted) { setSaving(false); onBusy(false) }
      if (saveAbort.current === controller) saveAbort.current = null
    }
  }

  const locked = loading || saving || disabled || saved === null
  return <section aria-label={t('defaultsTitle')} aria-busy={loading || saving}>
    <h2 className={css.sectionTitle}>{t('defaultsTitle')}</h2>
    <p className={css.help}>{t('defaultsHelp')}</p>
    {error !== null && <p className={css.errorBanner} role="alert">{error}</p>}
    {notice !== null && <p className={css.noticeBanner} role="status">{notice}</p>}
    {loading && <p className={css.help} role="status">{t('defaultsLoading')}</p>}
    {saved !== null && <p className={css.help}>{t('managedRoot')}: <code>{saved.managedRoot}</code></p>}
    <div className={css.formRow} data-settings-anchor="worktree-task-default-directory">
      <div><label htmlFor={prefix + '-directory'}>{t('defaultDirectory')}</label><p className={css.help}>{t('directoryHelp')}</p></div>
      <Input id={prefix + '-directory'} value={directory} disabled={locked} onChange={(event) => { setDirectory(event.target.value) }} />
    </div>
    <div className={css.formRow} data-settings-anchor="worktree-task-default-base">
      <div><label htmlFor={prefix + '-base'}>{t('defaultBase')}</label><p className={css.help}>{t('defaultBaseHelp')}</p></div>
      <Input id={prefix + '-base'} value={baseRef} disabled={locked} onChange={(event) => { setBaseRef(event.target.value) }} />
    </div>
    <HookEditor t={t} kind="setup" value={setup} onChange={setSetup} disabled={locked} />
    <HookEditor t={t} kind="cleanup" value={cleanup} onChange={setCleanup} disabled={locked} />
    <div className={css.formActions}>
      <Button variant="outline" disabled={loading || saving || disabled} onClick={() => { void reload() }}>{t('defaultsReload')}</Button>
      <Button variant="primary" disabled={locked} onClick={() => { void save() }}>{t(saving ? 'defaultsSaving' : 'defaultsSave')}</Button>
    </div>
  </section>
}

function HookEditor({ t, kind, value, onChange, disabled }: {
  t: Translate
  kind: 'setup' | 'cleanup'
  value: WorktreeTaskHook
  onChange: (value: WorktreeTaskHook) => void
  disabled: boolean
}) {
  const prefix = useId()
  return <fieldset className={css.hookEditor} disabled={disabled} data-settings-anchor={'worktree-task-default-' + kind}>
    <legend>{t(kind === 'setup' ? 'setupTitle' : 'cleanupTitle')}</legend>
    <p className={css.help}>{t(kind === 'setup' ? 'setupHelp' : 'cleanupHelp')}</p>
    <div className={css.formRow}>
      <label htmlFor={prefix + '-executable'}>{t('hookExecutable')}</label>
      <Input id={prefix + '-executable'} value={value.executable}
        onChange={(event) => { onChange({ ...value, executable: event.target.value }) }} />
    </div>
    {value.args.map((argument, index) => <div className={css.formRow} key={index}>
      <label htmlFor={prefix + '-arg-' + index}>{t('hookArgument', { index: index + 1 })}</label>
      <div className={css.argumentRow}>
        <Input id={prefix + '-arg-' + index} value={argument} onChange={(event) => {
          onChange({ ...value, args: value.args.map((text, position) => position === index ? event.target.value : text) })
        }} />
        <Button variant="outline" onClick={() => { onChange({ ...value, args: value.args.filter((_, position) => position !== index) }) }}>
          {t('removeArgument', { index: index + 1 })}</Button>
      </div>
    </div>)}
    <div className={css.formActions}>
      <Button variant="outline" onClick={() => { onChange({ ...value, args: [...value.args, ''] }) }}>{t('addArgument')}</Button>
      <Button variant="outline" onClick={() => { onChange({ executable: '', args: [] }) }}>{t('disableHook')}</Button>
    </div>
  </fieldset>
}
