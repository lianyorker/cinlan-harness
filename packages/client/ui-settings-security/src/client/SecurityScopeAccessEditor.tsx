/** Explicit destination and credential-reference rows; edits have no network or credential-resolution effects. */
import type { ReactNode } from 'react'
import type { SecurityResearchScopeSettings } from '@deepseek-ai/dsh-api-remotes/client'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import css from './CapabilitySection.module.css'

type Root = SecurityResearchScopeSettings['root']
/** Keep incomplete port text until submission instead of converting an empty input to zero. */
export type EgressDraft = Omit<Root['egress'][number], 'port'> & { readonly port: string }

type Props = Pick<CapabilitySectionProps, 't'> & {
  readonly egress: readonly EgressDraft[]
  readonly credentials: Root['credentials']
  readonly changeEgress: (value: readonly EgressDraft[]) => void
  readonly changeCredentials: (value: Root['credentials']) => void
}
const PROTOCOLS = ['http', 'https', 'tcp', 'udp'] as const
const EGRESS_PURPOSES = ['model-provider', 'web-search', 'target-access', 'artifact-export', 'external-reporting'] as const
const CREDENTIAL_PURPOSES = ['model-provider', 'web-search', 'target-authentication', 'artifact-store', 'external-reporting'] as const

/**
 * Render advanced grant rows inside the owning form's writable fieldset.
 * @param props - Draft rows, replacement callbacks, and localized copy.
 * @returns Labelled rows with explicit add/remove actions and no inferred permissions.
 */
export function SecurityScopeAccessEditor({ egress, credentials, changeEgress, changeCredentials, t }: Props): ReactNode {
  return <>
    <fieldset data-settings-anchor="security-egress"><legend>{t('securityEgress')}</legend>
      <p>{t('securityEgressHelp')}</p>
      {egress.map((row, index) => <fieldset key={index} className={css.accessRow}>
        <legend>{t('securityEgressRow', { index: index + 1 })}</legend>
        <label><span>{t('securityProtocol')}</span><select required value={row.protocol} onChange={(event) => {
          changeEgress(egress.map((item, i) => i === index ? { ...item, protocol: event.currentTarget.value } : item))
        }}><option value="">{t('securityChooseValue')}</option>{PROTOCOLS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label><span>{t('securityDestinationHost')}</span><input type="text" required value={row.host} onChange={(event) => {
          changeEgress(egress.map((item, i) => i === index ? { ...item, host: event.currentTarget.value } : item))
        }} /></label>
        <label><span>{t('securityPort')}</span><input type="number" required min={1} max={65535} step={1} value={row.port} onChange={(event) => {
          changeEgress(egress.map((item, i) => i === index ? { ...item, port: event.currentTarget.value } : item))
        }} /></label>
        <label><span>{t('securityPurpose')}</span><select required value={row.purpose} onChange={(event) => {
          changeEgress(egress.map((item, i) => i === index ? { ...item, purpose: event.currentTarget.value } : item))
        }}><option value="">{t('securityChooseValue')}</option>{EGRESS_PURPOSES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label><span>{t('securityTargetId')}</span><input type="text" required value={row.targetId} onChange={(event) => {
          changeEgress(egress.map((item, i) => i === index ? { ...item, targetId: event.currentTarget.value } : item))
        }} /></label>
        <button className={css.recheckButton} type="button" onClick={() => { changeEgress(egress.filter((_, i) => i !== index)) }}>{t('securityRemoveRow')}</button>
      </fieldset>)}
      <button className={css.recheckButton} type="button" onClick={() => {
        changeEgress([...egress, { protocol: '', host: '', port: '', purpose: '', targetId: '' }])
      }}>{t('securityAddEgress')}</button>
    </fieldset>
    <fieldset data-settings-anchor="security-credentials"><legend>{t('securityCredentials')}</legend>
      <p>{t('securityCredentialsHelp')}</p>
      {credentials.map((row, index) => <fieldset key={index} className={css.accessRow}>
        <legend>{t('securityCredentialRow', { index: index + 1 })}</legend>
        <label><span>{t('securityCredentialRef')}</span><input type="text" required pattern="[A-Za-z_][A-Za-z0-9_]*" autoComplete="off" spellCheck={false} value={row.ref} onChange={(event) => {
          changeCredentials(credentials.map((item, i) => i === index ? { ...item, ref: event.currentTarget.value } : item))
        }} /></label>
        <label><span>{t('securityPurpose')}</span><select required value={row.purpose} onChange={(event) => {
          changeCredentials(credentials.map((item, i) => i === index ? { ...item, purpose: event.currentTarget.value } : item))
        }}><option value="">{t('securityChooseValue')}</option>{CREDENTIAL_PURPOSES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label><span>{t('securityTargetId')}</span><input type="text" required value={row.targetId} onChange={(event) => {
          changeCredentials(credentials.map((item, i) => i === index ? { ...item, targetId: event.currentTarget.value } : item))
        }} /></label>
        <button className={css.recheckButton} type="button" onClick={() => { changeCredentials(credentials.filter((_, i) => i !== index)) }}>{t('securityRemoveRow')}</button>
      </fieldset>)}
      <button className={css.recheckButton} type="button" onClick={() => {
        changeCredentials([...credentials, { ref: '', purpose: '', targetId: '' }])
      }}>{t('securityAddCredential')}</button>
    </fieldset>
  </>
}
