/** A retained child Session rendered by the ordinary Conversation registration. */
import { useEffect, useState, type ReactNode } from 'react'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { Context } from '../context-types.ts'
import { parseSubagentChatAddress, subagentChatAddress, SUBAGENT_CHAT_TYPE } from './subagent-chat.ts'
import { t } from './locales.ts'
import css from './SubagentChatView.module.css'

type ChatState = { status: 'loading' } | { status: 'ready'; reference: SessionReference }
  | { status: 'error'; message: string }

/** Plain callbacks supplied by the tab registration. */
export interface SubagentChatViewProps {
  path: string
  open: (address: SubagentAddress, signal: AbortSignal) => Promise<SessionReference>
  renderConversation: (sessionId: SessionId) => ReactNode
}

/**
 * Keep one child reference for this mounted tab, including inactive split tabs.
 * @param props - Durable address and owner callbacks.
 * @returns The ordinary scoped Conversation, or loading and retry status.
 */
export function SubagentChatView({ path, open, renderConversation }: SubagentChatViewProps): ReactNode {
  const [state, setState] = useState<ChatState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let reference: SessionReference | undefined
    setState({ status: 'loading' })
    const address = parseSubagentChatAddress(path)
    if (address === undefined) {
      setState({ status: 'error', message: t('error') })
      return () => { controller.abort() }
    }
    void open(address, controller.signal).then((next) => {
      if (controller.signal.aborted) {
        next.release()
        return
      }
      reference = next
      setState({ status: 'ready', reference: next })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })
    return () => {
      controller.abort()
      reference?.release()
    }
  }, [path, open, attempt])

  return <div className={css.root} data-subagent-chat="">
    {state.status === 'ready'
      ? renderConversation(state.reference.sessionId)
      : <div className={css.status} role={state.status === 'error' ? 'alert' : 'status'}>
        {state.status === 'loading' ? t('loading') : <>
          <span>{state.message}</span>
          <button type="button" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button>
        </>}
      </div>}
  </div>
}

/**
 * Register the hidden child tab using standard Session transport and slot bindings.
 * @param ctx - Sidebar activation context; disposal removes the tab implementation.
 */
export function registerSubagentChat(ctx: Context): void {
  const sessions = ctx.sessions as unknown as ISessions
  const slots = ctx.slots as unknown as SlotRegistry
  const open = async (address: SubagentAddress, signal: AbortSignal): Promise<SessionReference> => {
    await sessions.refreshSubagents(address.parentSessionId)
    signal.throwIfAborted()
    const listed = sessions.list.getSnapshot()
    const entry = listed.subagentsByParent[address.parentSessionId]?.entries.find(child => child.id === address.childSessionId)
    const title = entry?.kind === 'child' ? entry.label : undefined
    ctx.betterSidebar.updateTab(subagentChatAddress(address), {
      title: title || listed.byId[address.childSessionId]?.displayTitle || address.childSessionId,
    })
    const reference = sessions.retainSubagent(address, { signal })
    try {
      await reference.ready
      signal.throwIfAborted()
      return reference
    } catch (error) {
      reference.release()
      throw error
    }
  }
  const renderConversation = (sessionId: SessionId): ReactNode =>
    slots.renderSessionView('conversation', { embedded: true }, sessionId)
  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: SUBAGENT_CHAT_TYPE,
    title: () => t('subagent'),
    hidden: true,
    dedupeKey: tab => tab.path ?? tab.id,
    component: ({ tab }) => <SubagentChatView
      path={tab.path ?? ''} open={open} renderConversation={renderConversation}
    />,
  }), 'better-sidebar: child conversation tabs')
}
