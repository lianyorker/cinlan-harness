/** Read-only directory inspection scoped to one ready connection generation. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryInspection, TargetView } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { HostDiagnostic, HostsCallbacks, HostsTranslate } from './types.ts'
import { hostDiagnostic } from './diagnostics.ts'
import { HostErrorNotice } from './HostDetails.tsx'
import css from './HostsSection.module.css'

type ReadyTarget = TargetView & { state: Extract<TargetView['state'], { phase: 'ready' }> }

/**
 * Inspect relative paths and preserve the requested path when a read fails.
 * @param props - ready target, narrow inspection callback and locale.
 * @returns root selector, relative path form, and returned directory entries.
 */
export function DirectoryInspector({ target, inspectDirectory, t }: {
  target: ReadyTarget
  inspectDirectory: HostsCallbacks['inspectDirectory']
  t: HostsTranslate
}): ReactNode {
  const [rootId, setRootId] = useState(target.state.info.roots[0]?.id ?? '')
  const [path, setPath] = useState('')
  const [inspection, setInspection] = useState<DirectoryInspection>()
  const [error, setError] = useState<HostDiagnostic>()
  const [pending, setPending] = useState(false)
  const operation = useRef<AbortController>()
  useEffect(() => () => { operation.current?.abort() }, [])
  const selectedRoot = target.state.info.roots.find(root => root.id === rootId)
  const inspect = async (): Promise<void> => {
    if (pending || selectedRoot === undefined) return
    const controller = new AbortController()
    operation.current = controller
    setPending(true)
    setError(undefined)
    setInspection(undefined)
    try {
      const result = await inspectDirectory(
        { id: target.id, generation: target.state.generation, rootId: selectedRoot.id, path }, controller.signal,
      )
      if (!controller.signal.aborted) setInspection(result.inspection)
    } catch (failure) {
      if (!controller.signal.aborted) setError(hostDiagnostic(failure))
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }
  return <div className={css.inspector}>
    <h4>{t('inspection')}</h4>
    <form onSubmit={(event) => { event.preventDefault(); void inspect() }}>
      <fieldset disabled={pending}>
        <label htmlFor={target.id + '-root'}>{t('root')}</label>
        <select id={target.id + '-root'} value={rootId} onChange={(event) => { setRootId(event.currentTarget.value); setInspection(undefined); setError(undefined) }}>
          {target.state.info.roots.map(root => <option key={root.id} value={root.id}>{root.label} · {root.path}</option>)}
        </select>
        <label htmlFor={target.id + '-path'}>{t('relativePath')}</label>
        <Input id={target.id + '-path'} value={path} placeholder={t('pathPlaceholder')}
          onChange={(event) => { setPath(event.currentTarget.value); setInspection(undefined); setError(undefined) }} />
        <Button type="submit" variant="outline" disabled={pending || selectedRoot === undefined}>{t(pending ? 'inspectBusy' : 'inspect')}</Button>
      </fieldset>
    </form>
    {selectedRoot === undefined && <p>{t('noRoots')}</p>}
    {error !== undefined && <HostErrorNotice error={error} t={t} />}
    {inspection !== undefined && <div aria-label={t('results')}>
      <dl className={css.facts}>
        <dt>{t('inspectionHost')}</dt><dd><code>{inspection.executionHostId}</code></dd>
        <dt>{t('root')}</dt><dd><code>{inspection.rootId}</code></dd>
        <dt>{t('inspectionPath')}</dt><dd><code>{inspection.path}</code></dd>
      </dl>
      {inspection.truncated && <p role="status" className={css.note}>{t('truncated')}</p>}
      {inspection.entries.length === 0 ? <p>{t('inspectionEmpty')}</p> : <table className={css.entries}>
        <thead><tr><th>{t('entryName')}</th><th>{t('entryType')}</th></tr></thead>
        <tbody>{inspection.entries.map(entry =>
          <tr key={entry.name}><td><code>{entry.name}</code></td><td>{t(entry.type)}</td></tr>)}</tbody>
      </table>}
    </div>}
  </div>
}
