/** Presentation component for ephemeral VM catalog, active instances and quota management. */
import { useState, type ReactNode } from 'react'
import {
  Button,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconStopFill16,
  Input,
  Modal,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TargetView } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type {
  DestroyVmRequest,
  EphemeralVm,
  EphemeralVmOverview,
  EphemeralVmState,
  HostsTranslate,
  LaunchVmRequest,
  VmRecipe,
} from './types.ts'
import css from './HostsSection.module.css'

interface EphemeralVmsSectionProps {
  readonly overview: EphemeralVmOverview
  readonly hosts: readonly TargetView[]
  readonly t: HostsTranslate
  readonly disabled?: boolean
  readonly onLaunch: (request: LaunchVmRequest) => Promise<void>
  readonly onDestroy: (request: DestroyVmRequest) => Promise<void>
  readonly onReap: () => Promise<number>
}

const VM_DOT: Record<EphemeralVmState, 'done' | 'ongoing' | 'idle' | 'error'> = {
  running: 'done',
  provisioning: 'ongoing',
  terminating: 'ongoing',
  terminated: 'idle',
  failed: 'error',
}

export function EphemeralVmsSection({
  overview,
  hosts,
  t,
  disabled = false,
  onLaunch,
  onDestroy,
  onReap,
}: EphemeralVmsSectionProps): ReactNode {
  const [launchRecipe, setLaunchRecipe] = useState<VmRecipe>()
  const [vmLabel, setVmLabel] = useState('')
  const [timeoutMinutes, setTimeoutMinutes] = useState<number>()
  const [targetHostId, setTargetHostId] = useState<string>('')
  const [destroying, setDestroying] = useState<EphemeralVm>()
  const [pending, setPending] = useState<string>()
  const [errorMsg, setErrorMsg] = useState<string>()
  const [reapNotice, setReapNotice] = useState<string>()

  const activeVms = overview.vms.filter(vm => vm.state === 'running' || vm.state === 'provisioning')

  const openLaunch = (recipe: VmRecipe) => {
    setErrorMsg(undefined)
    setReapNotice(undefined)
    setLaunchRecipe(recipe)
    setVmLabel(`${recipe.id.replace('recipe-', '')}-${Date.now().toString().slice(-4)}`)
    setTimeoutMinutes(recipe.timeoutMinutes)
    setTargetHostId('')
  }

  const handleLaunchSubmit = async () => {
    if (!launchRecipe) return
    setPending('launch')
    setErrorMsg(undefined)
    try {
      await onLaunch({
        recipeId: launchRecipe.id,
        label: vmLabel.trim(),
        timeoutMinutes,
        targetHostId: targetHostId || undefined,
      })
      setLaunchRecipe(undefined)
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : String(err)
      if (code.includes('quota-exceeded')) {
        setErrorMsg(t('vmErrorQuotaExceeded'))
      } else if (code.includes('duplicate-request')) {
        setErrorMsg(t('vmErrorDuplicateRequest'))
      } else if (code.includes('host-offline')) {
        setErrorMsg(t('vmErrorHostOffline'))
      } else if (code.includes('unauthorized')) {
        setErrorMsg(t('vmErrorUnauthorized'))
      } else if (code.includes('unknown-recipe')) {
        setErrorMsg(t('vmErrorUnknownRecipe'))
      } else {
        setErrorMsg(code || t('errorUnknown'))
      }
    } finally {
      setPending(undefined)
    }
  }

  const handleDestroySubmit = async () => {
    if (!destroying) return
    setPending(`destroy:${destroying.id}`)
    setErrorMsg(undefined)
    try {
      await onDestroy({ id: destroying.id })
      setDestroying(undefined)
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : String(err)
      if (code.includes('destroy-failed')) {
        setErrorMsg(t('vmErrorDestroyFailed'))
      } else if (code.includes('not-found')) {
        setErrorMsg(t('vmErrorNotFound'))
      } else {
        setErrorMsg(code || t('errorUnknown'))
      }
    } finally {
      setPending(undefined)
    }
  }

  const handleReap = async () => {
    setPending('reap')
    setErrorMsg(undefined)
    try {
      const count = await onReap()
      setReapNotice(t('vmReapDone', { count }))
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(undefined)
    }
  }

  return (
    <div className={css.panel} data-settings-anchor="ephemeral-vms" tabIndex={-1}>
      <div className={css.groupHeading}>
        <div>
          <h3>{t('vmsTitle')}</h3>
          <p className={css.note}>{t('vmsDescription')}</p>
        </div>
        <div className={css.actions}>
          <Button
            variant="outline"
            size="sm"
            icon={<IconRefreshOutline16 />}
            disabled={disabled || pending !== undefined}
            onClick={handleReap}
          >
            {t('vmReapOrphaned')}
          </Button>
        </div>
      </div>

      {reapNotice && <p role="status" className={css.note}>{reapNotice}</p>}
      {errorMsg && <p role="alert" className={css.error}>{errorMsg}</p>}

      {/* Quota & Resource Usage */}
      <div className={css.quotaRow} aria-label={t('vmQuotaTitle')}>
        <div className={css.quotaMetric}>
          <span>{t('vmQuotaActive', { used: overview.usage.activeVms, max: overview.quota.maxActiveVms })}</span>
          <strong>{overview.usage.activeVms} / {overview.quota.maxActiveVms}</strong>
        </div>
        <div className={css.quotaMetric}>
          <span>{t('vmQuotaCpu', { used: overview.usage.allocatedCpuCores, max: overview.quota.maxCpuCores })}</span>
          <strong>{overview.usage.allocatedCpuCores} / {overview.quota.maxCpuCores} {t('vmCpuCoresUnit')}</strong>
        </div>
        <div className={css.quotaMetric}>
          <span>{t('vmQuotaMemory', { used: overview.usage.allocatedMemoryMb, max: overview.quota.maxMemoryMb })}</span>
          <strong>{overview.usage.allocatedMemoryMb} / {overview.quota.maxMemoryMb} MB</strong>
        </div>
      </div>

      {/* Approved Recipe Catalog */}
      <h4>{t('vmRecipes')}</h4>
      <div className={css.recipeGrid} aria-label={t('vmRecipes')}>
        {overview.recipes.map(recipe => (
          <div key={recipe.id} className={css.recipeCard} aria-label={recipe.name}>
            <div className={css.recipeCardHeader}>
              <h5 className={css.recipeTitle}>{recipe.name}</h5>
              <Button
                variant="outline"
                size="sm"
                icon={<IconPlusOutline16 />}
                disabled={disabled || pending !== undefined || recipe.status !== 'approved'}
                onClick={() => openLaunch(recipe)}
              >
                {t('vmLaunch')}
              </Button>
            </div>
            <p className={css.recipeDesc}>{recipe.description}</p>
            <div className={css.recipeSpecs}>
              <span className={css.recipeChip}>{t('vmCpu', { cores: recipe.cpuCores })}</span>
              <span className={css.recipeChip}>{t('vmMemory', { mb: recipe.memoryMb })}</span>
              <span className={css.recipeChip}>{t('vmTimeout', { minutes: recipe.timeoutMinutes })}</span>
            </div>
            <span className={css.scope}>{t('vmSkills', { skills: recipe.skills.join(', ') })}</span>
          </div>
        ))}
      </div>

      {/* Active Ephemeral VMs */}
      <h4>{t('vmActiveList')}</h4>
      {activeVms.length === 0 ? (
        <p className={css.empty}>{t('vmNoActive')}</p>
      ) : (
        <div className={css.targets} aria-label={t('vmActiveList')}>
          {activeVms.map(vm => (
            <div key={vm.id} className={css.card} aria-label={vm.label}>
              <div className={css.cardBody}>
                <div className={css.cardTitleRow}>
                  <span className={css.cardLabel}>{vm.label}</span>
                  <StateDot state={VM_DOT[vm.state] ?? 'idle'} size={8} />
                  <span className={css.cardStatus} role="status">
                    {t(`vmStatus${vm.state.charAt(0).toUpperCase() + vm.state.slice(1)}` as any)}
                  </span>
                </div>
                <p className={css.cardLine}>
                  {vm.ipAddress ? `${t('vmIp', { ip: vm.ipAddress })} • ` : ''}
                  {t('vmCpu', { cores: vm.resourceAllocation.cpuCores })} •{' '}
                  {t('vmMemory', { mb: vm.resourceAllocation.memoryMb })} •{' '}
                  {t('vmExpiresAt', { time: new Date(vm.expiresAt).toLocaleTimeString() })}
                </p>
                {vm.targetHostId && (
                  <p className={css.scope}>{t('vmHostPinned', { host: vm.targetHostId })}</p>
                )}
              </div>
              <div className={css.cardActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconStopFill16 />}
                  disabled={disabled || pending !== undefined}
                  onClick={() => setDestroying(vm)}
                >
                  {t('vmDestroy')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Launch VM Modal */}
      <Modal
        open={launchRecipe !== undefined}
        onClose={() => { if (pending === undefined) setLaunchRecipe(undefined) }}
        title={t('vmLaunchTitle')}
        description={launchRecipe ? `${launchRecipe.name}: ${launchRecipe.description}` : ''}
        closeLabel={t('close')}
        footer={
          <div className={css.dialogFooter}>
            <Button
              variant="outline"
              disabled={pending !== undefined}
              onClick={() => setLaunchRecipe(undefined)}
            >
              {t('formCancel')}
            </Button>
            <Button
              variant="primary"
              disabled={disabled || pending !== undefined || !vmLabel.trim()}
              onClick={handleLaunchSubmit}
            >
              {t(pending === 'launch' ? 'vmLaunching' : 'vmLaunchSubmit')}
            </Button>
          </div>
        }
      >
        <div className={css.form}>
          <div className={css.formField}>
            <label htmlFor="vm-modal-label">{t('vmLabel')}</label>
            <Input
              id="vm-modal-label"
              value={vmLabel}
              placeholder={t('vmLabelPlaceholder')}
              onChange={e => setVmLabel(e.currentTarget.value)}
            />
          </div>
          <div className={css.formField}>
            <label htmlFor="vm-modal-timeout">{t('vmTimeoutInput')}</label>
            <Input
              id="vm-modal-timeout"
              type="number"
              value={String(timeoutMinutes ?? '')}
              onChange={e => setTimeoutMinutes(Number(e.currentTarget.value) || undefined)}
            />
          </div>
          {hosts.length > 0 && (
            <div className={css.formField}>
              <label htmlFor="vm-modal-host">{t('vmHostPinned', { host: '' })}</label>
              <select
                id="vm-modal-host"
                value={targetHostId}
                onChange={e => setTargetHostId(e.currentTarget.value)}
              >
                <option value="">{t('vmHostAny')}</option>
                {hosts.map(h => (
                  <option key={h.id} value={h.id}>{h.label} ({h.sshAlias})</option>
                ))}
              </select>
            </div>
          )}
          {launchRecipe && (
            <div className={css.recipeSpecs}>
              <span className={css.recipeChip}>{t('vmCpu', { cores: launchRecipe.cpuCores })}</span>
              <span className={css.recipeChip}>{t('vmMemory', { mb: launchRecipe.memoryMb })}</span>
              <span className={css.recipeChip}>{t('vmSkills', { skills: launchRecipe.skills.join(', ') })}</span>
            </div>
          )}
          {errorMsg && <p role="alert" className={css.error}>{errorMsg}</p>}
        </div>
      </Modal>

      {/* Destroy VM Confirmation Modal */}
      <Modal
        open={destroying !== undefined}
        onClose={() => { if (pending === undefined) setDestroying(undefined) }}
        title={t('vmDestroyTitle')}
        description={t('vmDestroyDescription')}
        closeLabel={t('close')}
        footer={
          <div className={css.dialogFooter}>
            <Button
              variant="outline"
              disabled={pending !== undefined}
              onClick={() => setDestroying(undefined)}
            >
              {t('formCancel')}
            </Button>
            <Button
              variant="primary"
              disabled={disabled || pending !== undefined}
              onClick={handleDestroySubmit}
            >
              {t('vmDestroyConfirm')}
            </Button>
          </div>
        }
      >
        <p><strong>{destroying?.label}</strong> ({destroying?.id})</p>
        {errorMsg && <p role="alert" className={css.error}>{errorMsg}</p>}
      </Modal>
    </div>
  )
}
