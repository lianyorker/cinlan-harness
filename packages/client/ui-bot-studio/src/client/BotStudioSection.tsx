/** Bot-studio settings section: roster, form editor, and audit trail. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BotDraft, BotStudioState } from './bot-store.ts'

/** The inject face the section's registrations close over. */
export interface BotStudioInjected {
  hooks: {
    /** The studio store the renderer subscribes to. */
    studio: SnapshotStore<BotStudioState>
  }
  load: () => void
  openCreate: () => void
  openEdit: (botId: string) => void
  closeEditor: () => void
  patchDraft: (patch: Partial<BotDraft>) => void
  save: () => Promise<string | null>
  remove: (botId: string) => Promise<string | null>
}

/** All section data arrives through the derived shares; components read none of it locally. */
export type BotStudioProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.botStudio'> & InjectFace<BotStudioInjected>

/**
 * The section body: roster (or the form editor when a draft is open) plus the
 * audit trail. Presentation only — every mutation routes through the inject face.
 * @param props The shares the registration site derived.
 * @returns The section content.
 */
export function BotStudioSection(props: BotStudioProps): JSX.Element {
  const { useStudio, load, t } = props
  const state = useStudio(value => value)
  load()
  if (state.status === 'loading' || state.status === 'idle') {
    return <section className="bot-studio" aria-busy="true" />
  }
  if (state.status === 'error') {
    return <section className="bot-studio"><p className="error">{state.error ?? t('loadError')}</p></section>
  }
  if (state.draft !== null) {
    return <BotForm draft={state.draft} saving={state.saving} {...props} />
  }
  return (
    <section className="bot-studio">
      <div className="toolbar">
        <p className="intro">{t('sectionIntro')}</p>
        <button type="button" className="primary" onClick={props.openCreate}>{t('newBot')}</button>
      </div>
      {state.rows.length === 0
        ? <p className="empty">{t('empty')}</p>
        : (
          <ul className="roster">
            {state.rows.map(bot => (
              <li key={bot.id} className="row">
                <div className="row-main">
                  <strong>{bot.name}</strong>
                  <span className="row-id">{bot.id}</span>
                  {bot.description !== undefined ? <span className="row-desc">{bot.description}</span> : null}
                  <span className="row-meta">{bot.tools.length} · {bot.credentials.length}</span>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => props.openEdit(bot.id)}>{t('edit')}</button>
                  <button type="button" className="danger" onClick={() => { void props.remove(bot.id) }}>{t('delete')}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      <details className="audit">
        <summary>{t('audit')}</summary>
        {state.audit.length === 0
          ? <p className="empty">{t('auditEmpty')}</p>
          : (
            <ul>
              {[...state.audit].reverse().map(row => (
                <li key={`${row.at}-${row.action}-${row.botId ?? ''}`}>
                  <time>{new Date(row.at).toLocaleString()}</time>
                  <span className="audit-action">{row.action}</span>
                  {row.botId !== undefined ? <code>{row.botId}</code> : null}
                  <span className="audit-summary">{row.summary}</span>
                </li>
              ))}
            </ul>
          )}
      </details>
    </section>
  )
}

/** The form editor over one draft. */
function BotForm({ draft, saving, t, ...actions }: { draft: BotDraft; saving: boolean } & BotStudioProps): JSX.Element {
  return (
    <section className="bot-studio form">
      <h3>{draft.id === '' ? t('formTitleCreate') : t('formTitleEdit')}</h3>
      <label>
        <span>{t('fieldId')}</span>
        <input
          type="text"
          value={draft.id}
          disabled={saving}
          onChange={event => actions.patchDraft({ id: event.currentTarget.value })}
        />
      </label>
      <label>
        <span>{t('fieldName')}</span>
        <input
          type="text"
          value={draft.name}
          disabled={saving}
          onChange={event => actions.patchDraft({ name: event.currentTarget.value })}
        />
      </label>
      <label>
        <span>{t('fieldDescription')}</span>
        <input
          type="text"
          value={draft.description}
          disabled={saving}
          onChange={event => actions.patchDraft({ description: event.currentTarget.value })}
        />
      </label>
      <label>
        <span>{t('fieldPersona')}</span>
        <textarea
          value={draft.persona}
          disabled={saving}
          rows={4}
          onChange={event => actions.patchDraft({ persona: event.currentTarget.value })}
        />
      </label>
      <label>
        <span>{t('fieldTools')}</span>
        <input
          type="text"
          placeholder="tool-fs, tool-goal"
          disabled={saving}
          value={draft.tools.join(', ')}
          onChange={event => actions.patchDraft({ tools: splitList(event.currentTarget.value) })}
        />
      </label>
      <label>
        <span>{t('fieldCredentials')}</span>
        <input
          type="text"
          placeholder="gitee-ro"
          disabled={saving}
          value={draft.credentials.join(', ')}
          onChange={event => actions.patchDraft({ credentials: splitList(event.currentTarget.value) })}
        />
      </label>
      <label>
        <span>{t('fieldOrder')}</span>
        <input
          type="number"
          value={draft.order ?? ''}
          disabled={saving}
          onChange={event => actions.patchDraft({ order: event.currentTarget.value === '' ? null : Number(event.currentTarget.value) })}
        />
      </label>
      <div className="form-actions">
        <button type="button" className="primary" disabled={saving} onClick={() => { void actions.save() }}>
          {saving ? t('saving') : t('save')}
        </button>
        <button type="button" disabled={saving} onClick={actions.closeEditor}>{t('cancel')}</button>
      </div>
    </section>
  )
}

/** A comma-separated input as a string list; blank entries are dropped. */
function splitList(value: string): string[] {
  return value.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
}
