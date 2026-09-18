/** Native form fields for one revision-bound MCP draft. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpSettingsSectionProps } from './McpSettingsSection.tsx'
import type { McpDraft } from './draft.ts'
import type { McpKey } from './locales.ts'
import css from './McpSettingsSection.module.css'

type FormProps = Pick<McpSettingsSectionProps, 'actions' | 't'> & {
  draft: McpDraft
  pending: boolean
  writable: boolean
  save: () => void
}

/**
 * Render a draft; all mutations use the declared interaction-store actions.
 * @param props - draft, controls and locale seat.
 * @returns the editable form.
 */
export function McpForm({ draft, pending, writable, actions, t, save }: FormProps): ReactNode {
  const field = (name: 'serverName' | 'command' | 'cwd' | 'url', label: McpKey, help?: McpKey): ReactNode =>
    <div className={css.formRow}>
      <label className={css.label} htmlFor={'mcp-draft-' + name}>{t(label)}</label>
      {help !== undefined && <p className={css.help}>{t(help)}</p>}
      <Input id={'mcp-draft-' + name} className={clsx(css.input)} value={draft[name]} disabled={pending}
        autoComplete="off" onChange={(event) => { actions.patch({ [name]: event.target.value }) }} />
    </div>
  const references = draft.transport === 'stdio' ? 'env' : 'headers'
  return <form className={css.form} aria-label={t(draft.id === undefined ? 'newServer' : 'editTitle')}
    onSubmit={(event) => { event.preventDefault(); save() }}>
    <h2 className={css.label}>{t(draft.id === undefined ? 'newServer' : 'editTitle')}</h2>
    {field('serverName', 'serverName', 'serverNameHelp')}
    <div className={css.row}>
      <div><p className={css.label}>{t('enabled')}</p><p className={css.help}>{t('draftEnabledHelp')}</p></div>
      <Switch checked={draft.enabled} label={t('enabled')} disabled={pending}
        onChange={(enabled) => { actions.patch({ enabled }) }} />
    </div>
    <div className={css.formRow}>
      <label className={css.label} htmlFor="mcp-draft-transport">{t('transport')}</label>
      <select id="mcp-draft-transport" className={css.select} value={draft.transport} disabled={pending}
        onChange={(event) => { actions.patch({ transport: event.target.value as McpDraft['transport'] }) }}>
        <option value="stdio">{t('stdio')}</option><option value="streamable-http">{t('http')}</option>
      </select>
    </div>
    {draft.transport === 'stdio' ? <>
      {field('command', 'command')}
      <div className={css.formRow}>
        <label className={css.label} htmlFor="mcp-draft-args">{t('args')}</label>
        <p className={css.help}>{t('argsHelp')}</p>
        <textarea id="mcp-draft-args" className={css.textarea} value={draft.args} disabled={pending} rows={3}
          onChange={(event) => { actions.patch({ args: event.target.value }) }} />
      </div>
      {field('cwd', 'cwd', 'cwdHelp')}
    </> : field('url', 'url', 'urlHelp')}
    <fieldset className={css.references} disabled={pending}>
      <legend className={css.label}>{t(references)}</legend>
      <p className={css.help}>{t('credentialsHelp')}</p>
      {draft[references].map((row, index) => <div className={css.referenceRow} key={index}>
        <label className={css.formRow}><span className={css.help}>{t(references === 'env' ? 'envName' : 'headerName')}</span>
          <Input className={clsx(css.input)} value={row.name} autoComplete="off"
            onChange={(event) => { actions.changeReference(references, index, { name: event.target.value }) }} />
        </label>
        <label className={css.formRow}><span className={css.help}>{t('referenceName')}</span>
          <Input className={clsx(css.input)} value={row.ref} autoComplete="off"
            onChange={(event) => { actions.changeReference(references, index, { ref: event.target.value }) }} />
        </label>
        {references === 'headers' && <label className={css.formRow}><span className={css.help}>{t('prefix')}</span>
          <Input className={clsx(css.input)} value={row.prefix} autoComplete="off"
            onChange={(event) => { actions.changeReference(references, index, { prefix: event.target.value }) }} />
        </label>}
        <Button aria-label={t('removeReference', { number: index + 1 })}
          onClick={() => { actions.removeReference(references, index) }}>{t('remove')}</Button>
      </div>)}
      {references === 'headers' && <p className={css.help}>{t('prefixHelp')}</p>}
      <Button variant="outline" onClick={() => { actions.addReference(references) }}>{t('addReference')}</Button>
    </fieldset>
    <p className={css.help}>{t('advancedHelp')}</p>
    <div className={css.actions}>
      <Button type="submit" variant="primary" disabled={pending || !writable}>{t('save')}</Button>
      <Button disabled={pending} onClick={() => { actions.cancel() }}>{t('cancel')}</Button>
    </div>
  </form>
}
