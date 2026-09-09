/**
 * Settings shell root: the sidebar-foot trigger plus a full-viewport page
 * with a searchable section rail and independently scrolling content. The shell is
 * a pure composition face: trigger, page title, back label, actions, and
 * sections arrive through slots. The named page region uses the title node,
 * while page-open and active-section ids remain component-local viewing state.
 * The onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronLeftOutline14, IconSearchOutline16, IconSettingsOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  onSelect: (id: string) => void
  onClose: () => void
  t: SettingsRootComponentProps['t']
}

/** Full-page settings shell with fixed navigation and an independently scrolling content pane. */
function SettingsPage({ rows, renderSlot, activeId, onSelect, onClose, t }: PanelProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleRows = normalizedQuery === ''
    ? rows
    : rows.filter(row => row.label.toLocaleLowerCase().includes(normalizedQuery))
  const active = visibleRows.find(r => r.id === activeId)?.id ?? visibleRows[0]?.id
  const titleId = useId()
  const backButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])
  useEffect(() => { backButton.current?.focus() }, [])

  return (
    <section className={css.page} role="region" aria-labelledby={titleId} data-dsh-settings-page="">
      <nav className={css.nav}>
        <div className={css.navHeader}>
          <button ref={backButton} type="button" className={css.back} onClick={onClose}>
            <IconChevronLeftOutline14 size={14} />
            <span>{renderSlot('settings.close', {})}</span>
          </button>
        </div>
        <label className={css.search}>
          <IconSearchOutline16 size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            aria-label={t('search.placeholder')}
            placeholder={t('search.placeholder')}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
        </label>
        <div className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</div>
        <div className={css.navList}>
          {visibleRows.map(row => (
            <button
              key={row.id}
              type="button"
              className={clsx(css.navCell, row.id === active && css.active)}
              aria-current={row.id === active ? 'page' : undefined}
              onClick={() => { onSelect(row.id) }}
            >
              <span className={css.navIcon} aria-hidden="true">
                {renderSlot('settings.section.icon', { size: 16 }, {
                  entryKey: row.id,
                  fallback: <IconSettingsOutline16 size={16} />,
                })}
              </span>
              <span className={css.navLabel}>{row.label}</span>
            </button>
          ))}
          {visibleRows.length === 0 && (
            <p className={css.noResults} role="status">{t('search.noResults')}</p>
          )}
        </div>
      </nav>
      <div className={css.content}>
        <header className={css.header}>
          <div className={css.actions}>{renderSlot('settings.action', {})}</div>
        </header>
        <div className={css.options}>
          {active !== undefined && renderSlot('settings.section', { close: onClose }, { only: active })}
        </div>
      </div>
    </section>
  )
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const { wide, useSections, useOnboardingSteps, useSessions, renderSlot, t } = props
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
  }, [])
  const openSection = useCallback((id: string) => {
    setActiveId(id)
    setOpen(true)
  }, [])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  const onboardingStep = onboardingActive
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  return (
    <>
      <button
        type="button"
        className={clsx(css.trigger, !wide && css.rail)}
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        {renderSlot('settings.trigger', { wide })}
      </button>
      {open && (
        <SettingsPage
          rows={rows}
          renderSlot={renderSlot}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={close}
          t={t}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
