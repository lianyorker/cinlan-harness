/** Native MCP settings rows over complete manager readback and independent draft state. */
import type { ReactNode } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpConnectionState, McpToolDescriptor, McpRemoveRequest, McpSetEnabledRequest, McpServerRequest } from '@deepseek-ai/dsh-api-mcp-controller/types'
import type { McpDraft } from './draft.ts'
import type { createMcpSettingsStore } from './store.ts'
import { canRefreshTools, type McpReadback } from './source.ts'
import { McpForm } from './McpForm.tsx'
import css from './McpSettingsSection.module.css'

/** Apply-owned observable and commands; no transport or source reaches component code. */
export interface McpSettingsInjected {
  hooks: { mcp: HostObservable<McpReadback> }
  retry(): void
  save(draft: McpDraft): Promise<boolean>
  remove(request: McpRemoveRequest): Promise<boolean>
  setEnabled(request: McpSetEnabledRequest): Promise<boolean>
  reconnect(request: McpServerRequest): Promise<boolean>
  probe(request: McpServerRequest): Promise<boolean>
}

/** Settings runtime, interaction store, injected readback and locale shares. */
export type McpSettingsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.mcp'>
  & PropsStore<ReturnType<typeof createMcpSettingsStore>> & InjectFace<McpSettingsInjected>

/**
 * Render saved state independently of readiness and preserve failed edits.
 * @param props - framework-derived settings shares.
 * @returns native settings content.
 */
export function McpSettingsSection({
  useMcp, useStore, actions, t, retry, save, remove, setEnabled, reconnect, probe,
}: McpSettingsSectionProps): ReactNode {
  const readback = useMcp(value => value)
  const { draft, removing } = useStore(value => value)
  const { snapshot, pending } = readback
  const disabled = readback.status !== 'ready' || pending
  const phase = (observed: McpConnectionState): ReactNode => <>
    <p className={css.help}>{t('observed', { phase: t(observed.phase === 'stopped' ? 'stoppedState' : observed.phase) })}</p>
    {observed.errorCode !== undefined && <p className={css.error}>{t(observed.errorCode)}</p>}
  </>
  const descriptors = (tools: readonly McpToolDescriptor[]): ReactNode => tools.length === 0
    ? <p className={css.help}>{t('noTools')}</p>
    : <ul className={css.toolList}>{tools.map(tool => <li className={css.tool} key={tool.name}>
      <h3 className={css.label}>{tool.name}</h3><p className={css.help}>{tool.description}</p>
      <details><summary className={css.help}>{t('schema')}</summary><pre className={css.schema}>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details>
    </li>)}</ul>
  return <section className={css.section}>
    <header className={css.header}><h1 className={css.title}>{t('nav')}</h1><p className={css.description}>{t('description')}</p>
      {snapshot !== null && <p className={css.help}>{t('profile', { profile: snapshot.profile })}</p>}
    </header>
    {readback.status === 'loading' && <p className={css.help} role="status">{t('loading')}</p>}
    {readback.status === 'offline' && <p className={css.help} role="status">{t('offline')}</p>}
    {readback.readError !== null && <div className={css.row}><p className={css.error} role="alert">{t(readback.readError)}</p>
      <Button variant="outline" onClick={retry}>{t('retry')}</Button></div>}
    {readback.actionError !== null && <p className={css.error} role="alert">{t(readback.actionError)}</p>}
    {pending && <p className={css.help} role="status">{t('pending')}</p>}
    {snapshot?.reconciling && <p className={css.help} role="status">{t('reconciling')}</p>}
    <div className={css.row} data-settings-anchor="mcp-server-list">
      <div><h2 className={css.label}>{t('serverList')}</h2><p className={css.help}>{t('serverListHelp')}</p></div>
      <div data-settings-anchor="mcp-add-server"><Button variant="outline" disabled={disabled || draft !== null}
        onClick={snapshot === null ? undefined : () => { actions.open(snapshot.revision) }}>{t('add')}</Button></div>
    </div>
    {draft !== null && <McpForm draft={draft} pending={pending} writable={readback.status === 'ready'} actions={actions} t={t} save={() => { void save(draft) }} />}
    <div className={css.rows} aria-busy={pending}>
      {snapshot !== null && snapshot.servers.length === 0 && <p className={css.empty}>{t('empty')}</p>}
      {snapshot?.servers.map(row => <article className={css.row} key={row.record.id} aria-label={row.record.serverName}>
        <div className={css.copy}>
          <h3 className={css.label}>{row.record.serverName}</h3>
          <p className={css.help}>{t(row.record.transport === 'stdio' ? 'stdio' : 'http')}</p>
          <p className={css.help}>{t('desired', { state: t(row.record.enabled ? 'enabled' : 'disabledState') })}</p>
          {phase(row.observed)}
          {row.applying && <p className={css.help} role="status">{t('applying')}</p>}
        </div>
        <div className={css.actions}>
          <Switch checked={row.record.enabled} label={t('enabledFor', { server: row.record.serverName })} disabled={disabled || row.applying}
            onChange={(enabled) => { void setEnabled({ id: row.record.id, expectedRevision: snapshot.revision, enabled }) }} />
          <Button disabled={disabled || draft !== null} aria-label={t('editServer', { server: row.record.serverName })}
            onClick={() => { actions.open(snapshot.revision, row.record) }}>{t('edit')}</Button>
          <Button disabled={disabled || !row.record.enabled || row.applying}
            onClick={() => { void reconnect({ id: row.record.id }) }}>{t('reconnect')}</Button>
          <Button disabled={disabled || !canRefreshTools(row)} onClick={() => { void probe({ id: row.record.id }) }}>{t('refreshTools')}</Button>
          <Button disabled={disabled} aria-label={t('removeServer', { server: row.record.serverName })}
            onClick={() => { actions.confirmRemove({ id: row.record.id, expectedRevision: snapshot.revision }) }}>{t('remove')}</Button>
        </div>
      </article>)}
    </div>
    {removing !== null && <div className={css.confirm} role="group" aria-label={t('confirmRemove')}>
      <h2 className={css.label}>{t('confirmRemove')}</h2><p className={css.help}>{t('confirmRemoveHelp')}</p>
      <div className={css.actions}><Button variant="outline" disabled={disabled} onClick={() => { void remove(removing) }}>{t('remove')}</Button>
        <Button disabled={pending} onClick={() => { actions.confirmRemove(null) }}>{t('cancel')}</Button></div>
    </div>}
    {snapshot !== null && snapshot.external.length > 0 && <section>
      <h2 className={css.label}>{t('external')}</h2><p className={css.help}>{t('externalHelp')}</p>
      {snapshot.external.map(row => <article className={css.row} key={row.id} aria-label={row.serverName}>
        <div className={css.copy}><h3 className={css.label}>{row.serverName}</h3>
          <p className={css.help}>{t('owner', { owner: row.owner.label })}</p>
          <p className={css.help}>{t(row.transport === 'stdio' ? 'stdio' : 'http')}</p>{phase(row)}</div>
      </article>)}
    </section>}
    <div className={css.row} data-settings-anchor="mcp-transport"><div><h2 className={css.label}>{t('transport')}</h2>
      <p className={css.help}>{t('transportHelp')}</p></div></div>
    <div className={css.row} data-settings-anchor="mcp-credentials"><div><h2 className={css.label}>{t('credentials')}</h2>
      <p className={css.help}>{t('credentialsHelp')}</p></div></div>
    <section data-settings-anchor="mcp-tools"><h2 className={css.label}>{t('tools')}</h2><p className={css.help}>{t('toolsHelp')}</p>
      {snapshot !== null && snapshot.servers.length + snapshot.external.length === 0 && <p className={css.help}>{t('noTools')}</p>}
      {snapshot?.servers.map(row => <div className={css.toolsGroup} key={row.record.id}>
        <h3 className={css.label}>{row.record.serverName}</h3>{descriptors(row.observed.tools)}</div>)}
      {snapshot?.external.map(row => <div className={css.toolsGroup} key={row.id}>
        <h3 className={css.label}>{row.serverName}</h3>{descriptors(row.tools)}</div>)}
    </section>
  </section>
}
