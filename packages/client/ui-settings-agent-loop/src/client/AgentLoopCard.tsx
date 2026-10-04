/** The agent loop's General row: how many tool calls one step may run at once. */

import { useState } from 'react'
import {
  IconChevronDownOutlineRegular, IconChevronUpOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentLoopCardFace } from './agent-loop-card-controller.ts'
import css from './AgentLoopRow.module.css'

/** Props the renderer binds for the agent-loop row. */
export type AgentLoopCardProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.agentLoop'>
  & InjectFace<AgentLoopCardFace>

/**
 * The whole-number caps the Host schema accepts: `z.number().step(1).min(1)`.
 * @param text - the draft to parse.
 * @returns the accepted cap, or undefined when the draft is blank or invalid.
 */
function parseCap(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

/**
 * Render the parallel tool-call cap with the same stepper pill as the
 * font-size row: a centered, directly typeable value whose whole-number
 * keystrokes write through, an arrow column that steps from the displayed
 * value, and a reset beside the pill while an override stands.
 * @param props - locale copy, the row snapshot, and its write actions.
 * @returns the preference row, or nothing while the namespace is unavailable.
 */
export function AgentLoopCard(props: AgentLoopCardProps) {
  const { t } = props
  const state = props.useAgentLoopCard(snapshot => snapshot)
  const [draft, setDraft] = useState<string | undefined>(undefined)
  if (!state.available) return null
  const accepted = state.maxParallelToolCalls
  const text = draft ?? (accepted === undefined ? '' : String(accepted))
  const stepBase = (draft !== undefined ? parseCap(draft) : undefined) ?? accepted
  const step = (delta: 1 | -1) => {
    if (stepBase === undefined || !state.writable) return
    const next = stepBase + delta
    if (next < 1) return
    setDraft(String(next))
    props.setMaxParallel(next)
  }
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('maxParallel')}</div>
        <div className={css.desc}>{t('maxParallelHint')}</div>
      </div>
      <div className={css.control}>
        <div className={css.stepper}>
          <input
            type="text"
            inputMode="numeric"
            className={css.value}
            aria-label={t('maxParallel')}
            value={text}
            disabled={!state.writable}
            onChange={(event) => {
              const value = event.target.value
              setDraft(value)
              const cap = parseCap(value)
              if (cap !== undefined) props.setMaxParallel(cap)
            }}
            onBlur={() => {
              if (draft !== undefined && draft.trim() === '' && state.overridden) props.resetMaxParallel()
              setDraft(undefined)
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          />
          <span className={css.arrows}>
            <button type="button" className={css.arrow} aria-label={t('increase')}
              disabled={!state.writable || stepBase === undefined}
              onClick={() => { step(1) }}>
              <IconChevronUpOutlineRegular size={9} />
            </button>
            <button type="button" className={css.arrow} aria-label={t('decrease')}
              disabled={!state.writable || stepBase === undefined || stepBase <= 1}
              onClick={() => { step(-1) }}>
              <IconChevronDownOutlineRegular size={9} />
            </button>
          </span>
        </div>
        {state.overridden
          ? (
            <button type="button" className={css.reset} disabled={!state.writable}
              onClick={props.resetMaxParallel}>{t('reset')}</button>
          )
          : null}
      </div>
    </div>
  )
}

/**
 * Render the existing row at its product settings destination.
 * @param props - Settings owner, locale, and the existing row controller face.
 * @returns the live row with its search anchor.
 */
export function AgentLoopSettingsSection(props: PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.agentLoop'> & InjectFace<AgentLoopCardFace>) {
  return <div data-settings-anchor="agent-loop-settings"><AgentLoopCard {...props} /></div>
}
