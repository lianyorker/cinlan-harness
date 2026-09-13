/** Revision-fenced operator scope drafts; reading this form performs no assessment effects. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SecurityResearchScopeSettings } from '@deepseek-ai/dsh-api-remotes/client'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import { SecurityScopeAccessEditor, type EgressDraft } from './SecurityScopeAccessEditor.tsx'
import css from './CapabilitySection.module.css'

type Root = SecurityResearchScopeSettings['root']
type Props = Pick<CapabilitySectionProps, 'useSecurityScope' | 'saveSecurityScope' | 't'>
interface Draft {
  readonly root: Root
  readonly targets: string
  readonly hosts: string
  readonly excluded: string
  readonly egress: readonly EgressDraft[]
  readonly revision: number
}

const ACTIONS = [
  'reconnaissance', 'active-validation', 'credential-use', 'persistence-change',
  'exploit-execution', 'destructive-operation', 'report-download', 'data-export', 'external-reporting',
] as const
const TARGET_KINDS: readonly string[] = ['hostname', 'ip-address', 'url-prefix', 'artifact-scope', 'service']

function lines(value: string): string[] {
  return value.split(/\r?\n/u).map(item => item.trim()).filter(item => item.length > 0)
}

function targetText(root: Root): string {
  return root.targets.map(target => `${target.id}|${target.kind}|${target.value}`).join('\n')
}

function parseEgress(rows: readonly EgressDraft[]): Root['egress'] {
  return rows.map((row) => {
    const port = Number(row.port)
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid egress port')
    return { ...row, port }
  })
}

function parseTargets(value: string): Root['targets'] {
  return lines(value).map((line) => {
    const [id, kind, ...rest] = line.split('|').map(item => item.trim())
    const targetValue = rest.join('|')
    if (!id || !kind || !targetValue || !TARGET_KINDS.includes(kind)) throw new Error('Invalid assessment target row')
    return { id, kind, value: targetValue }
  })
}

/**
 * Edit root authority with explicit egress destinations and credential references; Host validation owns admission.
 * @param props - Framework-bound Settings source, rejecting write callback, and localized copy.
 * @returns The scope form, or an explicit loading/unavailable state.
 */
export function SecurityScopeEditor({ useSecurityScope, saveSecurityScope, t }: Props): ReactNode {
  const snapshot = useSecurityScope(value => value)
  const [draft, setDraft] = useState<Draft>()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const mounted = useRef(false)
  const pending = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const root = draft?.root ?? snapshot.value?.root
  const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const change = (patch: Partial<Root>, text: Partial<Pick<Draft, 'targets' | 'hosts' | 'excluded' | 'egress'>> = {}): void => {
    if (!writable || root === undefined || snapshot.revision === undefined || pending.current) return
    const current = draft ?? {
      root, targets: targetText(root), hosts: root.executionHostIds.join('\n'),
      excluded: root.excludedTargetIds.join('\n'), egress: root.egress.map(row => ({ ...row, port: String(row.port) })), revision: snapshot.revision,
    }
    setDraft({ ...current, ...text, root: { ...root, ...patch } })
    setStatus('idle')
  }
  const save = async (): Promise<void> => {
    if (!writable || draft === undefined || pending.current) return
    pending.current = true
    setStatus('saving')
    try {
      await saveSecurityScope({
        ...draft.root, targets: parseTargets(draft.targets), executionHostIds: lines(draft.hosts),
        excludedTargetIds: lines(draft.excluded), egress: parseEgress(draft.egress),
      }, draft.revision)
      if (mounted.current) { setDraft(undefined); setStatus('saved') }
    } catch (_scopeWriteRejected) {
      if (mounted.current) setStatus('error')
    } finally {
      pending.current = false
    }
  }
  if (snapshot.status !== 'ready' || root === undefined) {
    return <p>{t(snapshot.status === 'loading' ? 'securityScopeLoading' : 'securityScopeUnavailable')}</p>
  }
  return <form className={css.securityEditor} onSubmit={(event) => { event.preventDefault(); void save() }}>
    <h4>{t('securityScopeTitle')}</h4>
    <p>{t('securityScopeEditorDescription')}</p>
    <fieldset disabled={!writable || status === 'saving'}>
      <label><span>{t('securityEngagementId')}</span><input type="text" required value={root.engagementId}
        onChange={(event) => { change({ engagementId: event.currentTarget.value }) }} /></label>
      <label><span>{t('securityGrantId')}</span><input type="text" required value={root.grantId}
        onChange={(event) => { change({ grantId: event.currentTarget.value }) }} /></label>
      <label><span>{t('securityAuthorizationRef')}</span><input type="text" required value={root.authorizationRef}
        onChange={(event) => { change({ authorizationRef: event.currentTarget.value }) }} /></label>
      <label><span>{t('securityNotBefore')}</span><input type="number" required min={0} step={1} value={root.notBefore}
        onChange={(event) => { change({ notBefore: Number(event.currentTarget.value) }) }} /></label>
      <label><span>{t('securityExpiresAt')}</span><input type="number" required min={0} step={1} value={root.expiresAt}
        onChange={(event) => { change({ expiresAt: Number(event.currentTarget.value) }) }} /></label>
      <label><span>{t('securityExecutionHosts')}</span><textarea rows={3} value={draft?.hosts ?? root.executionHostIds.join('\n')}
        onChange={(event) => { change({}, { hosts: event.currentTarget.value }) }} /></label>
      <label><span>{t('securityTargets')}</span><textarea rows={4} value={draft?.targets ?? targetText(root)}
        onChange={(event) => { change({}, { targets: event.currentTarget.value }) }} /></label>
      <label><span>{t('securityExcludedTargets')}</span><textarea rows={2} value={draft?.excluded ?? root.excludedTargetIds.join('\n')}
        onChange={(event) => { change({}, { excluded: event.currentTarget.value }) }} /></label>
      <SecurityScopeAccessEditor egress={draft?.egress ?? root.egress.map(row => ({ ...row, port: String(row.port) }))}
        credentials={root.credentials} changeEgress={(egress) => { change({}, { egress }) }}
        changeCredentials={(credentials) => { change({ credentials }) }} t={t} />
      <fieldset><legend>{t('securityActions')}</legend>{ACTIONS.map(action => <label key={action}>
        <span>{action}</span><input type="checkbox" checked={root.actions.includes(action)} onChange={(event) => {
          const next = new Set(root.actions)
          if (event.currentTarget.checked) next.add(action)
          else next.delete(action)
          change({ actions: ACTIONS.filter(item => next.has(item)),
            approvalRequiredActions: root.approvalRequiredActions.filter(item => next.has(item)) })
        }} /></label>)}</fieldset>
      <fieldset><legend>{t('securityApprovalActions')}</legend>{ACTIONS.map(action => <label key={action}>
        <span>{action}</span><input type="checkbox" disabled={!root.actions.includes(action)}
          checked={root.approvalRequiredActions.includes(action)} onChange={(event) => {
            const next = new Set(root.approvalRequiredActions)
            if (event.currentTarget.checked) next.add(action)
            else next.delete(action)
            change({ approvalRequiredActions: ACTIONS.filter(item => next.has(item)) })
          }} /></label>)}</fieldset>
      <label><span>{t('securityEvidenceRetainUntil')}</span><input type="number" required min={0} step={1}
        value={root.evidence.retainUntil} onChange={(event) => {
          change({ evidence: { ...root.evidence, retainUntil: Number(event.currentTarget.value) } })
        }} /></label>
      <label><span>{t('securityEvidenceRedaction')}</span><select value={root.evidence.minimumRedaction} onChange={(event) => {
        change({ evidence: { ...root.evidence, minimumRedaction: event.currentTarget.value } })
      }}><option value="none">{t('securityRedactionNone')}</option><option value="secrets">{t('securityRedactionSecrets')}</option>
        <option value="sensitive">{t('securityRedactionSensitive')}</option></select></label>
      <label><span>{t('securityExternalReporting')}</span><select value={root.evidence.externalReporting} onChange={(event) => {
        change({ evidence: { ...root.evidence, externalReporting: event.currentTarget.value } })
      }}><option value="deny">{t('securityReportingDeny')}</option><option value="approval-required">{t('securityReportingApproval')}</option>
        <option value="allow">{t('securityReportingAllow')}</option></select></label>
      <div className={css.browserActions}>
        <button className={css.recheckButton} type="submit" disabled={draft === undefined}>
          {t(status === 'saving' ? 'securityScopeSaving' : 'securityScopeSave')}
        </button>
        <button className={css.recheckButton} type="button" disabled={draft === undefined} onClick={() => {
          setDraft(undefined); setStatus('idle')
        }}>{t('securityScopeDiscard')}</button>
      </div>
    </fieldset>
    <p>{t('securityScopeAdvanced')}</p>
    {!writable && <p>{t('securityScopeReadOnly')}</p>}
    {status === 'saved' && <p role="status">{t('securityScopeSaved')}</p>}
    {status === 'error' && <p role="alert" className={css.failure}>{t('securityScopeSaveFailed')}</p>}
  </form>
}
