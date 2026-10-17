/** Mobile emulator commands and copyable example prompts. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconCheckOutline16, IconCopyOutline16, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CapabilitySection.module.css'

const MOBILE_TOOLS = ['mobile_list_devices', 'mobile_observe', 'mobile_touch', 'mobile_type', 'mobile_button'] as const
const EXAMPLE_KEYS = ['mobileExample', 'mobileExampleTwo', 'mobileExampleThree'] as const

type Props = PropsLocale<'settings.cinlanCapabilities'>

/**
 * Render supported mobile commands and copyable example prompts.
 * @param props - Localized command and example copy.
 * @returns The command and example sections without capability-management controls.
 */
export function MobileAgentCard({ t }: Props): ReactNode {
  const [copied, setCopied] = useState<string>()
  const active = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const copyPrompt = (key: string, text: string): void => {
    void writeClipboard(text).then((ok) => { if (active.current) setCopied(ok ? key : 'copyFailed') })
  }
  return <section className={css.computerCard}>
    <div className={css.computerHowTo} data-settings-anchor="mobile-commands">
      <h3>{t('mobileCommandsTitle')}</h3><p>{t('mobileCommandsDescription')}</p>
      <div className={css.commandGrid}>
        <code>{t('mobileLaunchCommand')}</code>
        {MOBILE_TOOLS.map(tool => <code key={tool}>{tool}</code>)}
      </div>
    </div>
    <div className={css.computerHowTo} data-settings-anchor="mobile-usage">
      <h3>{t('examplesTitle')}</h3><p>{t('mobileExamplesDescription')}</p>
      {EXAMPLE_KEYS.map(key => <div key={key} className={css.commandRow}>
        <code>{t(key)}</code>
        <button type="button" className={css.copyButton} aria-label={t('copyExample')}
          onClick={() => { copyPrompt(key, t(key)) }}>
          {copied === key ? <IconCheckOutline16 size={18} /> : <IconCopyOutline16 size={18} />}
        </button>
      </div>)}
      {copied === 'copyFailed' ? <p role="status">{t('copyFailed')}</p>
        : copied !== undefined && <p role="status">{t('mobileCopied')}</p>}
    </div>
  </section>
}
