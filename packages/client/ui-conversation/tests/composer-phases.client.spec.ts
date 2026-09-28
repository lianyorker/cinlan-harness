import { describe, expect, it } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerChainProps } from '../src/client/contract/slots.ts'
import { PendingQuestion } from '../../ui-user-questions/src/client/contract/slots.ts'
import { PendingApproval } from '../../ui-approval/src/client/contract/slots.ts'
import { QuestionComposer } from '../../ui-user-questions/src/client/QuestionComposer.tsx'
import { ApprovalPanel } from '../../ui-approval/src/client/ApprovalPanel.tsx'
import { SubagentReadOnlyComposer } from '../../ui-subagent/src/client/SubagentReadOnlyComposer.tsx'

const SID = 'session-sub-1' as SessionId

function createOneShotSubagentSession(parentSessionId = 'parent-1' as SessionId): SessionSnapshot {
  return {
    sessionId: SID,
    subagent: {
      address: {
        parentSessionId,
        childSessionId: SID,
        mode: 'one-shot',
      },
      parentAvailable: true,
    },
    running: false,
  } as unknown as SessionSnapshot
}

function selectReadOnlySubagent(owner: ComposerChainProps) {
  const subagent = owner.session?.subagent
  if (subagent === undefined || subagent === null) return null
  if (subagent.address.mode === 'one-shot') return { reason: 'one-shot' as const }
  if (subagent.parentAvailable === false && !owner.session?.running) {
    return { reason: 'parent-unavailable' as const }
  }
  return null
}

function elect(core: SlotCore, owner: ComposerChainProps) {
  const entries = core.entriesOfSlot('conversation.composer')
  for (const entry of entries) {
    const matched = (entry.select as (o: ComposerChainProps) => unknown)(owner)
    if (matched !== null) {
      return { entry, matched }
    }
  }
  return null
}

function setupComposerChain() {
  const core = new SlotCore()
  core.register({
    name: 'root',
    children: {
      'conversation.composer': {
        kind: 'chain',
        scope: 'session',
        phases: ['interaction', 'restriction'] as const,
      },
    },
  }, (() => null) as never)

  const disposeQuestion = core.register({
    name: 'conversation.composer',
    phase: 'interaction',
    priority: 0,
    select: ({ pendingInteraction }: ComposerChainProps): PendingQuestion | null =>
      pendingInteraction instanceof PendingQuestion ? pendingInteraction : null,
  }, QuestionComposer as never)

  const disposeApproval = core.register({
    name: 'conversation.composer',
    phase: 'interaction',
    priority: 1,
    select: ({ pendingInteraction }: ComposerChainProps): PendingApproval | null =>
      pendingInteraction instanceof PendingApproval ? pendingInteraction : null,
  }, ApprovalPanel as never)

  const disposeSubagent = core.register({
    name: 'conversation.composer',
    phase: 'restriction',
    priority: 0,
    select: selectReadOnlySubagent,
  }, SubagentReadOnlyComposer as never)

  return { core, disposeQuestion, disposeApproval, disposeSubagent }
}

describe('conversation.composer semantic phase election', () => {
  it('falls through to default InputBar when all selectors decline', () => {
    const { core } = setupComposerChain()
    const owner: ComposerChainProps = {
      sessionId: 'session-main' as SessionId,
      session: undefined,
      pendingInteraction: undefined,
    }
    expect(elect(core, owner)).toBeNull()
  })

  it('elects SubagentReadOnlyComposer in restriction phase when no interaction is pending', () => {
    const { core } = setupComposerChain()
    const owner: ComposerChainProps = {
      sessionId: SID,
      session: createOneShotSubagentSession(),
      pendingInteraction: undefined,
    }
    const elected = elect(core, owner)
    expect(elected).not.toBeNull()
    expect(elected?.entry.component).toBe(SubagentReadOnlyComposer)
    expect(elected?.entry.options.phase).toBe('restriction')
    expect(elected?.matched).toEqual({ reason: 'one-shot' })
  })

  it('elects question over read-only subagent composer (question + read-only)', () => {
    const { core } = setupComposerChain()
    const pendingQuestion = new PendingQuestion(SID, [
      { id: 'q1', question: 'Confirm next step?' },
    ])
    const owner: ComposerChainProps = {
      sessionId: SID,
      session: createOneShotSubagentSession(),
      pendingInteraction: pendingQuestion,
    }

    const elected = elect(core, owner)
    expect(elected).not.toBeNull()
    // Interaction phase dominates restriction phase
    expect(elected?.entry.component).toBe(QuestionComposer)
    expect(elected?.entry.options.phase).toBe('interaction')
    expect(elected?.matched).toBe(pendingQuestion)
  })

  it('elects approval over read-only subagent composer (approval + read-only)', () => {
    const { core } = setupComposerChain()
    const pendingApproval = new PendingApproval(SID, {
      toolName: 'bash',
      reason: 'Run disk cleanup',
    })
    const owner: ComposerChainProps = {
      sessionId: SID,
      session: createOneShotSubagentSession(),
      pendingInteraction: pendingApproval,
    }

    const elected = elect(core, owner)
    expect(elected).not.toBeNull()
    // Approval in interaction phase dominates restriction phase
    expect(elected?.entry.component).toBe(ApprovalPanel)
    expect(elected?.entry.options.phase).toBe('interaction')
    expect(elected?.matched).toBe(pendingApproval)
  })

  it('elects question ahead of approval within interaction phase (question + approval + read-only)', () => {
    const { core } = setupComposerChain()
    const entries = core.entriesOfSlot('conversation.composer')
    expect(entries).toHaveLength(3)
    // Within interaction: question (priority 0) comes before approval (priority 1)
    expect(entries[0]?.component).toBe(QuestionComposer)
    expect(entries[1]?.component).toBe(ApprovalPanel)
    // Restriction phase comes after interaction
    expect(entries[2]?.component).toBe(SubagentReadOnlyComposer)

    // With question pending
    const pendingQuestion = new PendingQuestion(SID, [
      { id: 'q1', question: 'Question?' },
    ])
    const ownerWithQuestion: ComposerChainProps = {
      sessionId: SID,
      session: createOneShotSubagentSession(),
      pendingInteraction: pendingQuestion,
    }
    expect(elect(core, ownerWithQuestion)?.entry.component).toBe(QuestionComposer)

    // With approval pending
    const pendingApproval = new PendingApproval(SID, {
      toolName: 'read_file',
    })
    const ownerWithApproval: ComposerChainProps = {
      sessionId: SID,
      session: createOneShotSubagentSession(),
      pendingInteraction: pendingApproval,
    }
    expect(elect(core, ownerWithApproval)?.entry.component).toBe(ApprovalPanel)
  })

  it('resolves interaction and returns back to read-only subagent composer', () => {
    const { core } = setupComposerChain()
    const pendingQuestion = new PendingQuestion(SID, [
      { id: 'q1', question: 'Choose:' },
    ])
    const session = createOneShotSubagentSession()

    // 1. While question is pending, question wins
    const activeWaitOwner: ComposerChainProps = {
      sessionId: SID,
      session,
      pendingInteraction: pendingQuestion,
    }
    expect(elect(core, activeWaitOwner)?.entry.component).toBe(QuestionComposer)

    // 2. Once wait is resolved (pendingInteraction cleared), read-only composer returns
    const resolvedOwner: ComposerChainProps = {
      sessionId: SID,
      session,
      pendingInteraction: undefined,
    }
    const reelected = elect(core, resolvedOwner)
    expect(reelected?.entry.component).toBe(SubagentReadOnlyComposer)
    expect(reelected?.matched).toEqual({ reason: 'one-shot' })
  })

  it('supports disposal and HMR re-registration without leaving stale elected state', () => {
    const { core, disposeQuestion } = setupComposerChain()
    const pendingQuestion = new PendingQuestion(SID, [
      { id: 'q1', question: 'Q?' },
    ])
    const owner: ComposerChainProps = {
      sessionId: SID,
      session: createOneShotSubagentSession(),
      pendingInteraction: pendingQuestion,
    }

    // Question wins initially
    expect(elect(core, owner)?.entry.component).toBe(QuestionComposer)

    // Dispose question (e.g. HMR unload)
    disposeQuestion()

    // Since pendingInteraction is PendingQuestion, approval declines, so read-only subagent wins
    expect(elect(core, owner)?.entry.component).toBe(SubagentReadOnlyComposer)

    // Re-register question (e.g. HMR reload)
    core.register({
      name: 'conversation.composer',
      phase: 'interaction',
      priority: 0,
      select: ({ pendingInteraction }: ComposerChainProps): PendingQuestion | null =>
        pendingInteraction instanceof PendingQuestion ? pendingInteraction : null,
    }, QuestionComposer as never)

    // Question wins again deterministically
    expect(elect(core, owner)?.entry.component).toBe(QuestionComposer)
  })
})
