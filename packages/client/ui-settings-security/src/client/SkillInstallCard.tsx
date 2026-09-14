/** Install-guidance card adapted from Orca's AgentSkillSetupPanel visual pattern. */
import { useState, type ReactNode } from 'react'
import { IconCheckOutline16, IconCopyOutline16, IconRefreshOutline16, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import css from './CapabilitySection.module.css'

/** Visual status mapped to the badge data-attribute palette. */
type InstallStatus = 'not-installed' | 'installed' | 'checking' | 'failed'

interface SkillInstallCardProps {
  readonly icon: ReactNode
  readonly title: string
  readonly description: string
  readonly command: string | undefined
  readonly status: InstallStatus
  readonly statusLabel: string
  readonly hint: string
  readonly onRecheck: () => void
  readonly t: CapabilitySectionProps['t']
}

/**
 * Render an install-guidance card following Orca's AgentSkillSetupPanel layout:
 * header (icon + title + status badge), description, command bar, action row, hint.
 * DSH has no inline terminal; the command bar copies the profile launch command.
 */
export function SkillInstallCard({
  icon, title, description, command, status, statusLabel, hint, onRecheck, t,
}: SkillInstallCardProps): ReactNode {
  const [copied, setCopied] = useState(false)
  return <div className={css.computerCard}>
    <div className={css.computerCardHeader}>
      <div className={css.computerIcon} aria-hidden="true">{icon}</div>
      <div className={css.heroText}>
        <div className={css.computerCardTitle}>
          <h3>{title}</h3>
          <span className={css.computerBadge} data-capability-status={status} role="status">
            <span className={css.dot} aria-hidden="true" />{statusLabel}
          </span>
        </div>
        <p className={css.computerCardDescription}>{description}</p>
      </div>
    </div>
    {command !== undefined && <div className={css.commandRow}>
      <code>{command}</code>
      <button type="button" className={css.copyButton} aria-label={t('computerCopyCommand')} onClick={() => {
        void writeClipboard(command).then((ok) => { setCopied(ok) })
      }}>
        {copied ? <IconCheckOutline16 size={18} /> : <IconCopyOutline16 size={18} />}
      </button>
    </div>}
    {copied && <p className={css.copyFeedback} role="status">{t('computerCopied')}</p>}
    <div className={css.installActions}>
      <button type="button" className={css.recheckButton} onClick={onRecheck}>
        <IconRefreshOutline16 size={16} />{t('computerRecheck')}
      </button>
    </div>
    <p className={css.capabilityFact}>{hint}</p>
  </div>
}
