/** Injected face and presentation component for the quick-commands card. */
import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QuickCommand, QuickCommandDraft, QuickCommandHostId, QuickCommandWireResult } from '@deepseek-ai/dsh-api-terminal-quick-commands-controller/types'
import css from './QuickCommandsCard.module.css'

/** Data and callbacks the apply closure injects; components never see ctx. */
export interface QuickCommandsCardInjected {
  /** Read one host's commands plus the addressable hosts. */
  list: (hostId: QuickCommandHostId) => Promise<{ commands: readonly QuickCommand[]; hosts: readonly QuickCommandHostId[] }>
  /** Persist a new command. */
  create: (draft: QuickCommandDraft) => Promise<QuickCommandWireResult>
  /** Replace one command. */
  update: (id: string, draft: QuickCommandDraft) => Promise<QuickCommandWireResult>
  /** Delete one command. */
  remove: (id: string) => Promise<QuickCommandWireResult>
}

/** Standard section owner, locale, and injected shares. */
export type QuickCommandsCardProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.quickCommands'> & InjectFace<QuickCommandsCardInjected>

interface DraftState {
  readonly id?: string
  name: string
  command: string
  description: string
  cwd: string
  confirm: boolean
}

const EMPTY_DRAFT: DraftState = { name: '', command: '', description: '', cwd: '', confirm: false }

/** Workspace settings card: the durable quick-command catalog for one host. */
export function QuickCommandsCard({ t, list, create, update, remove }: QuickCommandsCardProps): ReactNode {
  const injected = { list, create, update, remove }
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [commands, setCommands] = useState<readonly QuickCommand[]>([])
  const [hosts, setHosts] = useState<readonly QuickCommandHostId[]>([])
  const [draft, setDraft] = useState<DraftState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<string>()

  const reload = async (): Promise<void> => {
    try {
      const hostId = (hosts[0] ?? 'local') as QuickCommandHostId
      const next = await injected.list(hostId)
      setHosts(next.hosts)
      setCommands(next.commands)
      setState('ready')
      setError('')
    } catch (reason) {
      setState('error')
      setError(reason instanceof Error ? reason.message : 'list_failed')
    }
  }

  if (state === 'loading') {
    void reload().then(() => { setState(current => current === 'loading' ? 'ready' : current) })
    return <section className={css.section} data-settings-anchor="quick-commands"><p className={css.helper} role="status">{t('loading')}</p></section>
  }

  const save = async (): Promise<void> => {
    if (draft === undefined || busy) return
    setBusy(true)
    setError('')
    const payload: QuickCommandDraft = {
      hostId: hosts[0] ?? ('local' as QuickCommandHostId),
      name: draft.name,
      command: draft.command,
      ...draft.description.trim() === '' ? {} : { description: draft.description },
      ...draft.cwd.trim() === '' ? {} : { cwd: draft.cwd },
      confirm: draft.confirm,
    }
    const result = draft.id === undefined
      ? await injected.create(payload)
      : await injected.update(draft.id, payload)
    setBusy(false)
    if (!result.ok) {
      const reasons: Record<string, string> = {
        'invalid-name': t('invalidName'), 'invalid-command': t('invalidCommand'),
        'invalid-cwd': t('invalidCwd'), 'unknown-command': t('unknownCommand'),
        'host-unknown': t('hostUnknown'), 'storage-unavailable': t('loadFailed'),
      }
      setError(result.reason === undefined ? t('saveFailed', { reason: 'unknown' }) : t('saveFailed', { reason: reasons[result.reason] ?? result.reason }))
      return
    }
    setDraft(undefined)
    await reload()
  }

  const destroy = async (id: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    const result = await injected.remove(id)
    setBusy(false)
    setConfirming(undefined)
    if (!result.ok && result.reason !== 'unknown-command') {
      setError(t('saveFailed', { reason: result.reason ?? 'remove_failed' }))
      return
    }
    await reload()
  }

  return <section className={css.section} data-settings-anchor="quick-commands">
    <div className={css.header}>
      <div>
        <h2>{t('listTitle')}</h2>
        <p className={css.helper}>{t('description')}</p>
      </div>
      <button type="button" className={css.primary} disabled={busy || draft !== undefined}
        onClick={() => { setDraft({ ...EMPTY_DRAFT }) }}>{t('create')}</button>
    </div>

    {error !== '' && <p className={css.alert} role="alert">{error}</p>}

    {draft !== undefined && <div className={css.card} data-testid="quick-command-editor">
      <label className={css.field}>
        <span>{t('hostLabel')}</span>
        <select value={hosts[0] ?? 'local'} disabled
          onChange={() => { /* one host per Host process; the select names the owner */ }}>
          {hosts.map(host => <option key={host} value={host}>{host === 'local' ? t('hostLocal') : host}</option>)}
        </select>
      </label>
      <label className={css.field}>
        <span>{t('nameLabel')}</span>
        <input value={draft.name} placeholder={t('namePlaceholder')}
          onChange={event => { setDraft({ ...draft, name: event.currentTarget.value }) }} />
      </label>
      <label className={css.field}>
        <span>{t('commandLabel')}</span>
        <textarea value={draft.command} rows={3} placeholder={t('commandPlaceholder')}
          onChange={event => { setDraft({ ...draft, command: event.currentTarget.value }) }} />
      </label>
      <label className={css.field}>
        <span>{t('descriptionLabel')}</span>
        <input value={draft.description}
          onChange={event => { setDraft({ ...draft, description: event.currentTarget.value }) }} />
      </label>
      <label className={css.field}>
        <span>{t('cwdLabel')}</span>
        <input value={draft.cwd} placeholder={t('cwdPlaceholder')}
          onChange={event => { setDraft({ ...draft, cwd: event.currentTarget.value }) }} />
      </label>
      <label className={css.check}>
        <input type="checkbox" checked={draft.confirm}
          onChange={event => { setDraft({ ...draft, confirm: event.currentTarget.checked }) }} />
        <span><strong>{t('confirmLabel')}</strong><small>{t('confirmHint')}</small></span>
      </label>
      <div className={css.actions}>
        <button type="button" className={css.quiet} disabled={busy} onClick={() => { setDraft(undefined) }}>{t('cancel')}</button>
        <button type="button" className={css.primary} disabled={busy} onClick={() => { void save() }}>
          {busy ? t('saving') : t('save')}
        </button>
      </div>
    </div>}

    {commands.length === 0 && draft === undefined
      ? <p className={css.empty}>{t('empty')}</p>
      : <ul className={css.rows}>
        {commands.map(command => confirming === command.id
          ? <li key={command.id} className={css.row} data-confirming>
            <span><strong>{t('deleteConfirm', { name: command.name })}</strong></span>
            <span className={css.actions}>
              <button type="button" className={css.quiet} disabled={busy} onClick={() => { setConfirming(undefined) }}>{t('deleteCancel')}</button>
              <button type="button" className={css.danger} disabled={busy} onClick={() => { void destroy(command.id) }}>{t('deleteConfirmAction')}</button>
            </span>
          </li>
          : <li key={command.id} className={css.row}>
            <span className={css.rowMain}>
              <strong>{command.name}</strong>
              {command.description !== undefined && <small>{command.description}</small>}
              <code>{command.command}</code>
            </span>
            <span className={css.actions}>
              <button type="button" className={css.quiet} onClick={() => {
                setDraft({
                  id: command.id, name: command.name, command: command.command,
                  description: command.description ?? '', cwd: command.cwd ?? '', confirm: command.confirm,
                })
              }}>{t('edit')}</button>
              <button type="button" className={css.danger} onClick={() => { setConfirming(command.id) }}>{t('delete')}</button>
            </span>
          </li>)}
      </ul>}
  </section>
}
