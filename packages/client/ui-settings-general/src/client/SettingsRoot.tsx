/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel with the section nav rail. In browsers below 768px the panel fills
 * the viewport and the rail turns into a horizontal strip; Windows and macOS
 * desktop windows retain the rail
 * (SettingsRoot.module.css). The shell is a pure composition face —
 * slot-owned text (trigger label, panel title, close label, sections) arrives
 * from registrants through slots; accessible names resolve from localized
 * content (trigger: shell locale; dialog: aria-labelledby the title node;
 * close: visually-hidden slot text). Modal open state and the active section
 * id belong to the declared owner store; the onboarding coordinator mounts
 * exactly one ordered registrant while the sessions-derived empty-Hero fact
 * is active. Visible dialog chrome belongs to the step, so a
 * mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, IconChevronDownOutline14,
  IconCloseOutline16, IconPanelLeftOutline16, IconSearchOutline16, IconSettingsOutline16,
  IconListChecksOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsGroupId, SettingsNavigationTarget } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import { SETTINGS_GROUPS, searchSettings } from './settings-navigation.ts'
import css from './SettingsRoot.module.css'

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  narrow: boolean
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  onSelect: (id: string) => void
  onClose: () => void
  restoreFocus: () => void
  t: SettingsRootComponentProps['t']
}

/** Grouped navigation, field search and an independently scrolling section. */
function SettingsPage({ rows, narrow, renderSlot, activeId, onSelect, onClose, restoreFocus, t }: PanelProps) {
  const [query, setQuery] = useState('')
  const [folded, setFolded] = useState<ReadonlySet<SettingsGroupId>>(() => new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selection, setSelection] = useState<{ sectionId: string; target: SettingsNavigationTarget }>()
  const active = rows.find(row => row.id === activeId) ?? rows[0]
  const searching = query.trim() !== ''
  const results = searchSettings(rows, query)
  const titleId = useId()
  const groupPrefix = useId()
  const backButton = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLDialogElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const searchHeading = useRef<HTMLHeadingElement>(null)
  const sectionContent = useRef<HTMLDivElement>(null)
  const focusAfterNavigation = useRef(false)
  const target = selection !== undefined && selection.sectionId === active?.id ? selection.target : undefined

  const dismissDrawer = useCallback(() => {
    setDrawerOpen(false)
    menuButton.current?.focus()
  }, [])
  const choose = (id: string, nextTarget?: SettingsNavigationTarget) => {
    onSelect(id)
    setQuery('')
    setSelection(nextTarget === undefined ? undefined : { sectionId: id, target: nextTarget })
    const group = rows.find(row => row.id === id)?.groupId
    setFolded((previous) => {
      const next = new Set(previous)
      if (group !== undefined) next.delete(group)
      return next
    })
    setDrawerOpen(false)
    focusAfterNavigation.current = true
  }

  useLayoutEffect(() => {
    const overflow = document.body.style.overflow
    const appRoot = document.getElementById('root')
    const previousInert = appRoot?.inert ?? false
    document.body.style.overflow = 'hidden'
    if (appRoot !== null) appRoot.inert = true
    return () => {
      document.body.style.overflow = overflow
      if (appRoot !== null) appRoot.inert = previousInert
      restoreFocus()
    }
  }, [restoreFocus])
  useEffect(() => {
    if (narrow) menuButton.current?.focus()
    else { setDrawerOpen(false); backButton.current?.focus() }
  }, [narrow])
  useEffect(() => {
    const dialog = drawer.current
    if (dialog === null) return
    if (drawerOpen && narrow) {
      if (!dialog.open) dialog.showModal()
      searchInput.current?.focus()
    } else if (dialog.open) dialog.close()
  }, [drawerOpen, narrow])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const overlay = document.querySelector('[role="dialog"], dialog[open], [role="menu"]')
      if (overlay !== null && overlay !== drawer.current) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (narrow) setDrawerOpen(true)
        searchInput.current?.focus()
        searchInput.current?.select()
      } else if (event.key === 'Escape' && !(narrow && drawerOpen)) {
        if (searching) { setQuery(''); searchInput.current?.focus() }
        else onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose, narrow, drawerOpen, searching])
  useEffect(() => {
    if (content.current !== null) content.current.scrollTop = 0
    if (focusAfterNavigation.current && !drawerOpen && (target === undefined || searching)) {
      const destination = searching ? searchHeading.current : heading.current ?? sectionContent.current
      destination?.focus({ preventScroll: true })
      focusAfterNavigation.current = false
    }
  }, [active?.id, searching, target, drawerOpen])
  useEffect(() => {
    const container = sectionContent.current
    if (target === undefined || searching || container === null) return
    let highlighted: HTMLElement | undefined
    let addedTabIndex = false
    const reveal = (): boolean => {
      const anchor = Array.from(container.querySelectorAll<HTMLElement>('[data-settings-anchor]'))
        .find(element => element.dataset.settingsAnchor === target.anchorId)
      if (anchor === undefined || anchor.closest('[hidden]') !== null) return false
      highlighted = anchor
      anchor.setAttribute('data-settings-target', 'true')
      anchor.scrollIntoView({ block: 'center' })
      const selector = 'button:enabled, input:enabled:not([type="hidden"]), select:enabled, textarea:enabled, [tabindex="0"]'
      const control = anchor.matches(selector) ? anchor : anchor.querySelector<HTMLElement>(selector)
      if (control !== null) control.focus({ preventScroll: true })
      else {
        addedTabIndex = !anchor.hasAttribute('tabindex')
        if (addedTabIndex) anchor.tabIndex = -1
        anchor.focus({ preventScroll: true })
      }
      focusAfterNavigation.current = false
      return true
    }
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect() })
    if (!reveal()) observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-settings-anchor'] })
    return () => {
      observer.disconnect()
      highlighted?.removeAttribute('data-settings-target')
      if (addedTabIndex) highlighted?.removeAttribute('tabindex')
    }
  }, [selection, target, searching])

  const navigation = (
    <nav className={css.nav} aria-label={t('navigation.label')}>
      <div className={css.navHeader}>
        <button ref={backButton} type="button" className={css.back} onClick={onClose}>
          <IconChevronLeftOutline14 size={14} />
          <span>{renderSlot('settings.close', {})}</span>
        </button>
        {narrow && <button type="button" className={css.iconButton} onClick={dismissDrawer} aria-label={t('navigation.close')}><IconCloseOutline16 /></button>}
      </div>
      <label className={css.search}>
        <IconSearchOutline16 size={16} aria-hidden="true" />
        <input ref={searchInput} type="search" value={query} aria-label={t('search.placeholder')}
          placeholder={t('search.placeholder')} onChange={(event) => { setQuery(event.currentTarget.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && searching && !event.nativeEvent.isComposing) {
              setDrawerOpen(false)
              focusAfterNavigation.current = true
            }
          }} />
        <kbd>{t('search.shortcut')}</kbd>
      </label>
      {narrow && searching && <button className={css.showResults} type="button" onClick={() => {
        setDrawerOpen(false)
        focusAfterNavigation.current = true
      }}>{t('search.showResults')}<IconChevronRightOutline14 /></button>}
      {!searching && <button type="button" className={clsx(css.setupGuide, active?.id === 'models' && css.active)} onClick={() => { choose('models') }}>
        <span className={css.navIcon} aria-hidden="true"><IconListChecksOutline16 size={16} /></span>
        <span className={css.navLabel}>{t('setupGuide')}</span>
      </button>}
      <div className={css.navList}>
        {SETTINGS_GROUPS.map((group) => {
          const members = rows.filter(row => row.groupId === group)
          if (members.length === 0) return null
          const expanded = !folded.has(group)
          return <div className={css.navGroup} key={group}>
            <button type="button" className={css.groupTitle} aria-expanded={expanded} aria-controls={groupPrefix + group}
              onClick={() => { setFolded((previous) => {
                const next = new Set(previous)
                if (next.has(group)) next.delete(group)
                else next.add(group)
                return next
              }) }}>
              <span>{t(`group.${group}`)}</span><IconChevronDownOutline14 />
            </button>
            <div id={groupPrefix + group} hidden={!expanded}>
              {members.map(row => <button key={row.id} type="button"
                className={clsx(css.navCell, !searching && row.id === active?.id && css.active)}
                aria-current={!searching && row.id === active?.id ? 'page' : undefined}
                onClick={() => { choose(row.id) }}>
                <span className={css.navIcon} aria-hidden="true">{renderSlot('settings.section.icon', { size: 16 }, {
                  entryKey: row.id, fallback: <IconSettingsOutline16 size={16} />,
                })}</span><span className={css.navLabel}>{row.label}</span>
              </button>)}
            </div>
          </div>
        })}
      </div>
    </nav>
  )

  return createPortal(
    <section className={css.page} role="region" aria-labelledby={titleId} data-dsh-settings-page="">
      <div id={titleId} className={css.srOnly}>{renderSlot('settings.header', {})}</div>
      {narrow ? <dialog ref={drawer} className={css.drawer} aria-label={t('navigation.label')}
        onCancel={(event) => { event.preventDefault(); dismissDrawer() }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          const rect = event.currentTarget.getBoundingClientRect()
          const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
          if (outside) dismissDrawer()
        }}>{navigation}</dialog> : navigation}
      <div className={css.content}>
        <header className={css.header}>
          <div className={css.breadcrumbs}>
            {narrow && <button ref={menuButton} className={css.iconButton} type="button" onClick={() => { setDrawerOpen(true) }}
              aria-label={t('navigation.open')} aria-haspopup="dialog" aria-expanded={drawerOpen}><IconPanelLeftOutline16 /></button>}
            {active !== undefined && !searching && <><span>{t(`group.${active.groupId}`)}</span><IconChevronRightOutline14 /><strong>{active.label}</strong></>}
            {searching && <span>{t('search.title')}</span>}
          </div>
          <div className={css.actions}>{renderSlot('settings.action', {})}</div>
        </header>
        <div className={css.scroll} ref={content}>
          <div className={css.options}>
            {searching && <>
              <div className={css.pageHeading}><h1 ref={searchHeading} tabIndex={-1}>{t('search.title')}</h1><p>{t('search.description')}</p></div>
              {results.length === 0 && <p className={css.noResults} role="status">{t('search.noResults')}</p>}
              <div className={css.results}>
                {results.map(result => <button type="button" className={css.result} key={result.section.id + '/' + (result.target?.itemId ?? '')}
                  onClick={() => { choose(result.section.id, result.target) }}>
                  <span className={css.resultCopy}><span className={css.resultContext}>{t(`group.${result.section.groupId}`)} / {result.section.label}</span>{' '}
                    <span className={css.resultTitle}>{result.title}</span>{' '}
                    {result.description !== undefined && <span className={css.resultDescription}>{result.description}</span>}
                  </span><IconChevronRightOutline14 />
                </button>)}
              </div>
              <button type="button" className={css.clearSearch} onClick={() => { setQuery(''); searchInput.current?.focus() }}>{t('search.clear')}</button>
            </>}
            <div hidden={searching}>
              {active !== undefined && <div className={css.pageHeading}>
                <h1 ref={heading} tabIndex={-1}>{active.title}</h1>
                {active.description !== undefined && <p>{active.description}</p>}
              </div>}
              <div className={css.sectionContent} ref={sectionContent} tabIndex={-1}>
                {active !== undefined && renderSlot('settings.section', { close: onClose, ...(target === undefined ? {} : { target }) }, { only: active.id })}
              </div>
            </div>
          </div>
  // Portalled beside #root like the Modal primitive: a covering surface mounted
  // inside the root would precede the columns' chrome in document order, so a
  // chrome row that declares window drag after it would override its subtraction.
  // Beside the root, base.css's `body > :not(#root)` rule subtracts it instead.
  return createPortal((
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div ref={panel} tabIndex={-1} data-shortcut-modal="settings" className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {/* The four seats stay direct children of the panel and take their
            places from its grid: title and header share the first row, the
            navigation and the active section the second. */}
        <div className={css.navTitle} id={titleId} tabIndex={-1}
          data-modal-autofocus={active === undefined ? '' : undefined}>{renderSlot('settings.header', {})}</div>
        <nav className={css.nav}>
          <div className={css.navList}>
            {rows.map(row => (
              <button
                key={row.id}
                type="button"
                className={clsx(css.navCell, row.id === active && css.active)}
                aria-current={row.id === active ? 'true' : undefined}
                data-modal-autofocus={row.id === active ? '' : undefined}
                onFocus={(event) => { event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }}
                onClick={() => { onSelect(row.id) }}
              >
                {navIcon(row.id)}
                <span className={css.navLabel}>{row.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className={css.header}>
          <div className={css.actions}>{renderSlot('settings.action', {})}</div>
          <button type="button" className={css.close} onClick={onClose}>
            <IconCloseOutlineRegular size={14} />
            <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
          </button>
        </div>
        <div className={css.options}>
          {active !== undefined && renderSlot('settings.section', { close: onClose }, { only: active })}
        </div>
      </div>
    </section>,
    document.body,
  )
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const { wide, useSections, useOnboardingSteps, useNarrowViewport, useSessions, renderSlot, t } = props
  const [localOpen, setLocalOpen] = useState(false)
  const [localActiveId, setLocalActiveId] = useState<string | undefined>(undefined)
  const storeState = (props as any).useStore ? (props as any).useStore((s: any) => s) : undefined
  const open = storeState !== undefined ? storeState.open : localOpen
  const activeId = storeState !== undefined ? storeState.activeId : localActiveId
  const actions = (props as any).actions
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocus = useCallback(() => { triggerRef.current?.focus() }, [])
  const close = useCallback(() => {
    if (actions) {
      actions.close()
    } else {
      setLocalOpen(false)
      setLocalActiveId(undefined)
    }
  }, [actions])
  const openSection = useCallback((id: string) => {
    if (actions) {
      actions.openSection(id)
    } else {
      setLocalActiveId(id)
      setLocalOpen(true)
    }
  }, [actions])
  const onSelect = useCallback((id: string) => {
    if (actions) {
      actions.select(id)
    } else {
      setLocalActiveId(id)
    }
  }, [actions])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const narrow = useNarrowViewport(value => value)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions((state) => {
    const current = Object.values(state.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)
    return state.phase === 'ready' && (current === undefined || current.blank)
  })
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
        ref={triggerRef}
        type="button"
        className={clsx(css.trigger, !wide && css.rail)}
        aria-expanded={open}
        onClick={() => {
          if (actions) actions.open()
          else setLocalOpen(true)
        }}
      >
        {renderSlot('settings.trigger', { wide })}
      </button>
      {open && (
        <SettingsPage
          rows={rows}
          narrow={narrow}
          renderSlot={renderSlot}
          activeId={activeId}
          onSelect={onSelect}
          onClose={close}
          restoreFocus={restoreFocus}
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
