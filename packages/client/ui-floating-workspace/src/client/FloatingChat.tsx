/** Chat-only Conversation occurrence shared by the floating workspace's panel forms. */
import type { ReactNode } from 'react'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Chat-only Conversation occurrence inside the floating overlay panel. */
    'floatingWorkspace.chat': { kind: 'single'; scope: 'session' }
    /** Chat-only Conversation occurrence inside the right-Sidebar tab. */
    'floatingWorkspace.tab.chat': { kind: 'single'; scope: 'session' }
  }
}

/**
 * The only View an embedded occurrence shows: the transcript and its composer.
 * @param props - the Factory-local View seat.
 * @returns the Chat View without the View tabs or the main header.
 */
export function FixedChatView(props: ConversationViewsProps): ReactNode {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Props of the embedded occurrence body. */
export type FloatingChatProps = PropsRuntime<'floatingWorkspace.chat'> & PropsRenderFactories

/**
 * Render the shared Conversation content as one embedded occurrence.
 *
 * The phase is derived from Session facts only, so the occurrence renders from
 * any seat that binds the Session rather than requiring the Conversation
 * domain's own provide to be in scope.
 * @param props - Session binding and the Factory renderer.
 * @returns the transcript plus composer, with no main Conversation header.
 */
export function FloatingChat({ useSession, renderFactorySlot }: FloatingChatProps): ReactNode {
  const session = useSession(value => value)
  const active = session.running || (!session.blank && !session.awaitingFirstTurn)
  const hero = !active && !session.promptAttempted && session.openState === 'open'
  const phase = session.openState === 'loading' ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
    slots: { views: FixedChatView },
  })
}
