/** Explicit endpoint configuration and Host-owned runtime task controls. */
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RuntimeInspection, RuntimeLocation, RuntimeTask, TargetView } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { HostsProps, HostDiagnostic } from './types.ts'
import { hostDiagnostic } from './diagnostics.ts'
import { HostErrorNotice } from './HostDetails.tsx'
import css from './HostsSection.module.css'
import type { HostsKey } from './locales.ts'

type Draft = { target: TargetView; location: RuntimeLocation }
const endpointFields = ['host', 'port', 'username', 'privateKeyFile', 'hostKeySHA256'] as const
const locationFields = ['node', 'installRoot', 'workspace'] as const
const fieldLabels = {
  host: 'runtime.host', port: 'runtime.port', username: 'runtime.username',
  privateKeyFile: 'runtime.privateKeyFile', hostKeySHA256: 'runtime.hostKeySHA256',
  node: 'runtime.node', installRoot: 'runtime.installRoot', workspace: 'runtime.workspace',
} satisfies Record<typeof endpointFields[number] | typeof locationFields[number], HostsKey>
const inspectionLabels = {
  missing: 'runtime.missing', installed: 'runtime.installed',
} satisfies Record<RuntimeInspection['state'], HostsKey>
const operationLabels = {
  install: 'runtime.install', update: 'runtime.update',
} satisfies Record<RuntimeTask['operation'], HostsKey>
const taskLabels = {
  running: 'runtime.running', succeeded: 'runtime.succeeded', failed: 'runtime.failed', cancelled: 'runtime.cancelled',
} satisfies Record<RuntimeTask['state'], HostsKey>

/**
 * Configure explicit SSH execution independently of the inspection alias.
 * @param props - Renderer-bound target/task observations and management callbacks.
 * @returns endpoint form, runtime provenance and cancellable task receipts.
 */
export function RuntimeSettings(props: HostsProps) {
  const { t } = props
  const hosts = props.useHosts(value => value)
  const runtimes = props.useRuntimes(value => value)
  const [draft, setDraft] = useState<Draft>()
  const [inspection, setInspection] = useState<RuntimeInspection>()
  const [error, setError] = useState<HostDiagnostic>()
  const [pending, setPending] = useState(false)
  const current = draft === undefined || hosts.value?.targets.some(target =>
    target.id === draft.target.id && target.revision === draft.target.revision)
  const select = (target: TargetView): void => {
    const execution = target.execution
    setDraft({ target, location: {
      endpoint: execution?.endpoint ?? { host: '', port: 22, username: '', privateKeyFile: '', hostKeySHA256: '' },
      node: execution?.node ?? '', installRoot: '', workspace: execution?.workspace ?? '',
    } })
    setInspection(undefined); setError(undefined)
  }
  const perform = async (action: () => Promise<unknown>): Promise<void> => {
    if (pending) return
    setPending(true); setError(undefined)
    try { await action() } catch (reason) { setError(hostDiagnostic(reason)) }
    finally { setPending(false) }
  }
  const valid = draft !== undefined && current && hosts.status === 'ready'
    && Object.values(draft.location.endpoint).every(value => String(value).trim().length > 0)
    && /^[0-9a-f]{64}$/u.test(draft.location.endpoint.hostKeySHA256)
    && Number.isInteger(draft.location.endpoint.port) && draft.location.endpoint.port > 0 && draft.location.endpoint.port <= 65535
    && locationFields.every(field => draft.location[field].startsWith('/'))
  return <div className={css.group} data-settings-anchor="runtime" tabIndex={-1}>
    <h3>{t('runtime.title')}</h3><p className={css.note}>{t('runtime.description')}</p>
    <div className={css.actions}><Button variant="outline" disabled={pending} onClick={() => { void perform(props.refreshRuntimes) }}>{t('runtime.refresh')}</Button></div>
    <label htmlFor="execution-runtime-target">{t('runtime.target')}</label>
    <select id="execution-runtime-target" disabled={pending || hosts.status !== 'ready'} value={draft?.target.id ?? ''}
      onChange={(event) => {
        const target = hosts.value?.targets.find(value => value.id === event.currentTarget.value)
        if (target !== undefined) select(target)
        else setDraft(undefined)
      }}>
      <option value="">{t('runtime.select')}</option>
      {hosts.value?.targets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
    </select>
    {draft !== undefined && <div className={css.editor}>
      <p>{t('runtime.revision', { revision: draft.target.revision })}</p>
      <fieldset disabled={pending}>
        {endpointFields.map(field => <label key={field}>{t(fieldLabels[field])}
          <Input type={field === 'port' ? 'number' : 'text'} value={draft.location.endpoint[field]}
            onChange={(event) => {
              const value = event.currentTarget.value
              setDraft({ ...draft, location: { ...draft.location, endpoint: { ...draft.location.endpoint, [field]: field === 'port' ? Number(value) : value } } })
              setInspection(undefined)
            }} />
        </label>)}
        {locationFields.map(field => <label key={field}>{t(fieldLabels[field])}
          <Input value={draft.location[field]} onChange={(event) => {
            setDraft({ ...draft, location: { ...draft.location, [field]: event.currentTarget.value } }); setInspection(undefined)
          }} />
        </label>)}
      </fieldset>
      <p className={css.note}>{t('runtime.credentials')}</p>
      <p className={css.note}>{t('runtime.rootRequirement')}</p>
      {!current && <p role="alert" className={css.error}>{t('runtime.changed')}</p>}
      <div className={css.actions}>
        <Button variant="outline" disabled={!valid || pending} onClick={() => { void perform(async () => { setInspection(await props.detectRuntime(draft.location)) }) }}>{t('runtime.detect')}</Button>
        <Button variant="primary" disabled={!valid || pending} onClick={() => { void perform(async () => {
          await props.startRuntime({ ...draft.location, target: { id: draft.target.id, revision: draft.target.revision }, operation: draft.target.execution === undefined ? 'install' : 'update' })
          setDraft(undefined)
        }) }}>{t(draft.target.execution === undefined ? 'runtime.install' : 'runtime.update')}</Button>
      </div>
      {inspection !== undefined && <dl className={css.facts}>
        <dt>{t('runtime.state')}</dt><dd>{t(inspectionLabels[inspection.state])}</dd>
        <dt>{t('platform')}</dt><dd>{inspection.platform} / {inspection.arch}</dd>
        <dt>{t('runtime.node')}</dt><dd>{inspection.node} ({inspection.nodeVersion})</dd>
        <dt>{t('runtime.generation')}</dt><dd>{inspection.generation}</dd>
        <dt>{t('runtime.version')}</dt><dd>{inspection.version}</dd>
      </dl>}
    </div>}
    {error !== undefined && <HostErrorNotice error={error} t={t} />}
    {runtimes.error !== undefined && <HostErrorNotice error={runtimes.error} t={t} />}
    <p className={css.note}>{t('runtime.lifetime')}</p>
    {runtimes.tasks.map(task => <div key={task.id} className={css.target}>
      <h4>{hosts.value?.targets.find(target => target.id === task.target.id)?.label ?? task.target.id}
        {' — '}{t(operationLabels[task.operation])}</h4>
      <p>{t('runtime.revision', { revision: task.target.revision })} · {t(taskLabels[task.state])}</p>
      <code>{task.id}</code>
      {task.error !== undefined && <p role="alert" className={css.error}>{task.error}</p>}
      {task.result !== undefined && <dl className={css.facts}>
        <dt>{t('runtime.generation')}</dt><dd>{task.result.runtime.generation}</dd>
        <dt>{t('runtime.version')}</dt><dd>{task.result.runtime.version}</dd>
        <dt>{t('runtime.node')}</dt><dd>{task.result.runtime.nodeVersion}</dd>
      </dl>}
      {task.state === 'running' && <Button variant="outline" disabled={pending} onClick={() => { void perform(() => props.cancelRuntimeTask({ id: task.id })) }}>{t('runtime.cancel')}</Button>}
    </div>)}
  </div>
}
