/** Installation and explicit script approval using the Host-owned installation state. */

import { useState, type ReactNode } from 'react'
import { Button, Input, Modal, TerminalBlock, type TerminalBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInspectProblem, PluginInstallFailureKind } from '@deepseek-ai/dsh-api-remotes/client'
import { isInstallPending, type InstallState, type PluginManagerFace } from './manager-store.ts'
import type { PluginManagerLocaleKey } from './locales.ts'
import { managementText, type Translate } from './presentation.ts'
import css from './PluginManagerTab.module.css'

const PROBLEM_KEYS = {
  'invalid-spec': 'installProblemInvalid', 'already-installed': 'installProblemInstalled',
  'not-found': 'installProblemNotFound', 'not-a-package': 'installProblemNotPackage',
  'not-a-bundle': 'installProblemNotBundle', network: 'installProblemNetwork', unknown: 'installProblemUnknown',
} satisfies Record<PluginInspectProblem, PluginManagerLocaleKey>

const FAILURE_KEYS = {
  'pnpm-missing': 'installFailurePnpmMissing', timeout: 'installFailureTimeout', 'not-found': 'installFailureNotFound',
  'no-matching-version': 'installFailureNoMatchingVersion', network: 'installFailureNetwork',
  'disk-full': 'installFailureDiskFull', permission: 'installFailurePermission', 'build-blocked': 'installFailureBuildBlocked',
  integrity: 'installFailureIntegrity', unknown: 'installFailureGeneric',
} satisfies Record<PluginInstallFailureKind, PluginManagerLocaleKey>

function terminalLabels(t: Translate): TerminalBlockLabels {
  return {
    running: t('terminalRunning'), failed: t('terminalFailed'), done: t('terminalDone'),
    copy: t('terminalCopy'), copied: t('terminalCopied'), noOutput: t('terminalNoOutput'),
    collapse: t('terminalCollapse'), collapseAria: t('terminalCollapseAria'),
    signal: signal => t('terminalSignal', { signal }), exitCode: code => t('terminalExitCode', { code: String(code) }),
    expand: n => t('terminalExpand', { n: String(n) }), expandAria: n => t('terminalExpandAria', { n: String(n) }),
  }
}

/**
 * Render a checked install, cancellation, outcome, and package-specific build approval.
 * @param props - the Host-derived install state, callbacks, and dictionary.
 * @returns the install dialog and explicit approval or cancellation confirmation.
 */
export function InstallDialog({ state, face, t }: {
  readonly state: InstallState
  readonly face: InjectFace<PluginManagerFace>
  readonly t: Translate
}): ReactNode {
  const [confirmation, setConfirmation] = useState<'cancel' | 'builds' | null>(null)
  const pending = isInstallPending(state.phase)
  const checking = state.phase === 'checking'
  const close = (): (void) => {
    if (confirmation !== null) { setConfirmation(null); return }
    if (state.phase === 'running') setConfirmation('cancel')
    else if (!pending) { setConfirmation(null); face.closeInstall() }
  }
  const failure = state.failure
  const failureText = failure === null ? '' : failure.cancelUnconfirmed === true
    ? t('installCancelUnconfirmed', { reason: failure.reason })
    : failure.code === undefined ? failure.reason : managementText({ code: failure.code, diagnostic: failure.reason }, t)
  const title = t(state.phase === 'done' ? 'installedTitle' : state.phase === 'failed' ? 'installFailedTitle' : pending ? 'installingTitle' : 'installTitle')
  const progress = t(state.phase === 'starting' ? 'installStarting' : state.phase === 'cancelling' ? 'installCancelling' : state.phase === 'applying' ? 'installApplying' : 'installingTitle')
  const pendingBuilds = failure?.pendingBuilds ?? []

  return (
    <>
      <Modal open={state.open} title={title} closeLabel={pending ? t('installCloseCancels') : t('close')} onClose={close}
        className={css.installDialog as string} footer={(
          <>
            {state.phase === 'idle' || checking ? <>
              <Button className={css.control} onClick={close}>{t('cancel')}</Button>
              <Button className={css.control} disabled={checking || state.spec.trim() === ''} onClick={face.runInstall}>{t(checking ? 'installChecking' : 'installRun')}</Button>
            </> : null}
            {pending ? <Button className={css.control} disabled={state.phase !== 'running'} onClick={() => { setConfirmation('cancel') }}>{t('installCancel')}</Button> : null}
            {state.phase === 'failed' ? <>
              <Button className={css.control} onClick={face.cancelInstall}>{t('installEdit')}</Button>
              <Button className={css.control} onClick={face.runInstall}>{t('installRetry')}</Button>
              {pendingBuilds.length > 0 ? <Button className={css.control} onClick={() => { setConfirmation('builds') }}>{t('installApproveAndRetry')}</Button> : null}
            </> : null}
            {state.phase === 'done' ? <>
              <Button className={css.control} disabled={state.enabling} onClick={close}>{t('installClose')}</Button>
              <Button className={css.control} disabled={state.enabling || state.installed === null} onClick={face.enableInstalled}>{t('installEnableNow')}</Button>
            </> : null}
          </>
        )}>
        <div className={css.section}>
          {state.phase === 'idle' || checking ? <>
            <p className={css.hint}>{t('installDescription')}</p>
            <label className={css.field}>
              <span>{t('installSpecLabel')}</span>
              <Input className={css.input ?? ''} value={state.spec} disabled={checking} aria-label={t('installSpecLabel')}
                placeholder={t('installSpecPlaceholder')} onChange={(event) => { face.editInstallSpec(event.currentTarget.value) }} />
            </label>
            <p className={css.hint}>{t('installGuideSafety')}</p>
            {state.inputError === null ? null : <p role="alert" className={css.failure}>{t(PROBLEM_KEYS[state.inputError.problem], { reason: state.inputError.reason })}</p>}
          </> : null}
          {state.subject === null ? null : <p className={css.packageName}>{state.subject.name ?? state.subject.spec}</p>}
          {pending ? <p role="status">{progress}</p> : null}
          {failure === null ? null : <div role="alert" className={css.failure}>
            {failure.kind === undefined ? null : <p>{t(FAILURE_KEYS[failure.kind])}</p>}
            {failureText === '' ? null : <p>{failureText}</p>}
          </div>}
          {state.phase === 'done' ? <p role="status">{t(state.restartRequired ? 'installDoneRestart' : 'installedTitle')}</p> : null}
          {state.approvedBuilds.length === 0 ? null : <p className={css.hint}>{t('installDoneApproved', { names: state.approvedBuilds.join(', ') })}</p>}
          {state.runs.length === 0 ? null : <>
            <Button className={css.control} size="sm" aria-expanded={state.detailsOpen} onClick={face.toggleInstallDetails}>{t(state.detailsOpen ? 'installDetailsHide' : 'installDetailsShow')}</Button>
            {state.detailsOpen ? state.runs.map(run => <TerminalBlock
              key={run.jobId} command={run.command} cwd={run.cwd} output={run.output}
              running={run.exitCode === undefined} exitCode={run.exitCode ?? undefined}
              signal={run.exitCode === null ? t('terminalNoExitCode') : undefined} labels={terminalLabels(t)} />) : null}
          </>}
        </div>
      </Modal>
      <Modal open={state.open && confirmation === 'cancel' && pending} title={t('cancelInstallTitle')}
        description={t('cancelInstallDescription')} closeLabel={t('close')} onClose={() => { setConfirmation(null) }}
        footer={<><Button className={css.control} onClick={() => { setConfirmation(null) }}>{t('cancel')}</Button>
          <Button className={css.control} disabled={state.phase !== 'running'} onClick={() => { setConfirmation(null); face.cancelInstallAndClose() }}>{t('installCancel')}</Button></>} />
      <Modal open={state.open && confirmation === 'builds' && state.phase === 'failed' && pendingBuilds.length > 0}
        title={t('installApprovalTitle')} description={t('installApprovalDescription')} closeLabel={t('close')}
        onClose={() => { setConfirmation(null) }} footer={<>
          <Button className={css.control} onClick={() => { setConfirmation(null) }}>{t('cancel')}</Button>
          <Button className={css.control} onClick={() => { setConfirmation(null); face.approveBuildsAndRetry() }}>{t('installApproveAndRetry')}</Button>
        </>}>
        <div className={css.section}>
          <ul>{pendingBuilds.map(name => <li key={name}><code>{name}</code></li>)}</ul>
          <p>{t('installApprovalConsequence')}</p><p>{t('installApprovalCaution')}</p>
        </div>
      </Modal>
    </>
  )
}
