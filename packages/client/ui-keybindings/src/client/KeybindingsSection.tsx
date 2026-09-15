/** Keybindings settings section: registry, search, record, conflict detection. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { KeyBinding, KeybindingDefinition, KeybindingOverride, KeybindingsSettings } from '../types.ts'
import { KEYBINDINGS_NAMESPACE, serializeBinding, parseKeyEvent, detectConflicts } from '../types.ts'
import { en, zh, type KeybindingsKey } from './locales.ts'
import css from './KeybindingsSection.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.keybindings': KeybindingsKey
  }
}

/** Injected face: the settings scope for keybindings preferences. */
export interface KeybindingsSectionInjected {
  keybindings: SettingsScope<KeybindingsSettings>
}

export type KeybindingsSectionProps =
  & PropsRuntime<'settings.section'>
  & PropsLocale<'settings.keybindings'>
  & InjectFace<KeybindingsSectionInjected>

const NS = 'settings.keybindings'

/** Built-in command definitions. */
const BUILTIN_COMMANDS: KeybindingDefinition[] = [
  { id: 'conversation.submit', label: 'Submit Conversation', category: 'conversation', defaultBinding: { key: 'Enter', modifiers: {} } },
  { id: 'conversation.newLine', label: 'New Line', category: 'conversation', defaultBinding: { key: 'Enter', modifiers: { shift: true } } },
  { id: 'conversation.navigateUp', label: 'Navigate Up', category: 'conversation', defaultBinding: { key: 'ArrowUp', modifiers: {} } },
  { id: 'conversation.navigateDown', label: 'Navigate Down', category: 'conversation', defaultBinding: { key: 'ArrowDown', modifiers: {} } },
  { id: 'conversation.dismissPopup', label: 'Dismiss Popup', category: 'conversation', defaultBinding: { key: 'Escape', modifiers: {} } },
  { id: 'conversation.complete', label: 'Complete', category: 'conversation', defaultBinding: { key: 'Tab', modifiers: {} } },
  { id: 'editor.save', label: 'Save', category: 'editor', defaultBinding: { key: 's', modifiers: { ctrl: true } } },
  { id: 'editor.find', label: 'Find', category: 'editor', defaultBinding: { key: 'f', modifiers: { ctrl: true } } },
  { id: 'editor.replace', label: 'Replace', category: 'editor', defaultBinding: { key: 'h', modifiers: { ctrl: true } } },
]

export const inject = ['slots', 'locale', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-keybindings: dictionaries')
  const t = ctx.locale.bind(NS)
  const keybindings = ctx.settingsScope.bind<KeybindingsSettings>({ namespace: KEYBINDINGS_NAMESPACE })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'keybindings',
    order: 95,
    label: () => t('navLabel'),
    locale: NS,
    inject: (): KeybindingsSectionInjected => ({ keybindings }),
  }, KeybindingsSection))
}

/** Render the Keybindings settings page. */
export function KeybindingsSection({
  keybindings, t,
}: KeybindingsSectionProps): ReactNode {
  const snapshot = keybindings.getSnapshot()
  const [, forceRender] = useState(0)
  useEffect(() => keybindings.subscribe(() => forceRender(n => n + 1)), [keybindings])

  const [search, setSearch] = useState('')
  const [recordingId, setRecordingId] = useState<string | null>(null)

  const overrides = snapshot.status === 'ready' ? (snapshot.value?.overrides ?? []) : []
  const overrideMap = useMemo(() => {
    const map = new Map<string, KeybindingOverride>()
    for (const o of overrides) map.set(o.commandId, o)
    return map
  }, [overrides])

  const conflicts = useMemo(() => detectConflicts(overrides), [overrides])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return BUILTIN_COMMANDS
    return BUILTIN_COMMANDS.filter(cmd => cmd.label.toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q))
  }, [search])

  const categories = useMemo(() => {
    const map = new Map<string, KeybindingDefinition[]>()
    for (const cmd of filtered) {
      const list = map.get(cmd.category) ?? []
      list.push(cmd)
      map.set(cmd.category, list)
    }
    return map
  }, [filtered])

  const categoryLabel = (cat: string): string => {
    const key = `category${cat.charAt(0).toUpperCase()}${cat.slice(1)}` as KeybindingsKey
    return t(key)
  }

  const getBinding = (cmd: KeybindingDefinition): KeyBinding | null => {
    const override = overrideMap.get(cmd.id)
    if (override !== undefined) return override.binding
    return cmd.defaultBinding
  }

  const setOverride = (commandId: string, binding: KeyBinding | null): void => {
    const next = overrides.filter(o => o.commandId !== commandId)
    next.push({ commandId, binding })
    void keybindings.set('overrides', next)
  }

  const resetOverride = (commandId: string): void => {
    const next = overrides.filter(o => o.commandId !== commandId)
    void keybindings.set('overrides', next)
  }

  useEffect(() => {
    if (recordingId === null) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecordingId(null)
        return
      }
      const binding = parseKeyEvent(event)
      setOverride(recordingId, binding)
      setRecordingId(null)
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [recordingId])

  if (snapshot.status !== 'ready') {
    return <section className={css.section} data-keybindings-section>
      <div className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </div>
      <p className={css.message}>{snapshot.status === 'unavailable' ? t('error') : t('loading')}</p>
    </section>
  }

  const writable = snapshot.writable

  return <section className={css.section} data-keybindings-section>
    <div className={css.heading}>
      <h2>{t('title')}</h2>
      <p>{t('description')}</p>
    </div>
    <input
      type="text"
      className={css.search}
      placeholder={t('search')}
      aria-label={t('search')}
      value={search}
      onChange={e => setSearch(e.currentTarget.value)}
    />
    {filtered.length === 0 && <div className={css.empty}>{t('noResults')}</div>}
    {Array.from(categories.entries()).map(([category, commands]) => (
      <div key={category} className={css.category}>
        <h3 className={css.categoryTitle}>{categoryLabel(category)}</h3>
        {commands.map((cmd) => {
          const binding = getBinding(cmd)
          const bindingStr = binding !== null ? serializeBinding(binding) : null
          const isConflicting = bindingStr !== null && conflicts.has(bindingStr)
          const isRecording = recordingId === cmd.id
          return (
            <div key={cmd.id} className={css.commandRow}>
              <div className={css.commandName}>
                <div>{cmd.label}</div>
                {cmd.description && <div className={css.commandDesc}>{cmd.description}</div>}
              </div>
              <div className={css.binding}>
                {bindingStr !== null ? bindingStr : <span className={css.bindingUnbound}>{t('unbind')}</span>}
              </div>
              {isConflicting && <span className={css.conflict}>{t('conflict')}</span>}
              <div className={css.actions}>
                {isRecording ? (
                  <button type="button" className={`${css.btn} ${css.btnRecord}`} disabled={!writable}>
                    {t('recording')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={css.btn}
                    disabled={!writable}
                    onClick={() => setRecordingId(cmd.id)}
                  >
                    {t('record')}
                  </button>
                )}
                <button
                  type="button"
                  className={css.btn}
                  disabled={!writable}
                  onClick={() => resetOverride(cmd.id)}
                >
                  {t('reset')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    ))}
  </section>
}
