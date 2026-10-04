/** The agent-loop row's live mirror over the `agent-loop` settings namespace. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * Namespace of the agent loop's user-owned settings. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const AGENT_LOOP_NS = 'agent-loop'

/**
 * The agent-loop fields this row edits. The Host section carries only this
 * field — the composed `agents` array is deliberately not part of it.
 */
export interface AgentLoopSettings {
  /** Upper bound on parallel-safe tool calls in flight per step. */
  maxParallelToolCalls?: number
}

/** What the row renders: the accepted cap, its override state, and writability. */
export interface AgentLoopCardState {
  /** False while the namespace is not served to this client; the row renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Accepted parallel tool-call cap; undefined before the first acceptance. */
  maxParallelToolCalls: number | undefined
  /** Whether the user layer carries an override. */
  overridden: boolean
}

/** The registration-side face the row's slot entry injects. */
export interface AgentLoopCardFace {
  hooks: {
    /** Row snapshot bound by the renderer as useAgentLoopCard. */
    agentLoopCard: SnapshotStore<AgentLoopCardState>
  }
  /** Write one accepted whole-number cap. */
  setMaxParallel(value: number): void
  /** Clear the override, so the cap re-inherits the composition default. */
  resetMaxParallel(): void
}

/** Bridges the `agent-loop` scope onto the General row's live state. */
export class AgentLoopCardController {
  private readonly store: SnapshotStore<AgentLoopCardState>
  private readonly unsubscribe: () => void

  /** @param form - the bound settings form for the `agent-loop` namespace. */
  constructor(private readonly form: ConfigForm<AgentLoopSettings>) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = form.subscribe(() => { this.store.set(this.projection()) })
  }

  private projection(): AgentLoopCardState {
    const snapshot = this.form.getSnapshot()
    const user = snapshot.user as Record<string, unknown> | undefined
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      maxParallelToolCalls: snapshot.value?.maxParallelToolCalls,
      overridden: user !== undefined && Object.hasOwn(user, 'maxParallelToolCalls'),
    }
  }

  /**
   * Build the face the row's slot registration injects.
   * @returns the row's snapshot and its write actions.
   */
  inject(): AgentLoopCardFace {
    return {
      hooks: { agentLoopCard: this.store },
      setMaxParallel: (value) => { void this.form.set('maxParallelToolCalls', value) },
      resetMaxParallel: () => { void this.form.unset('maxParallelToolCalls') },
    }
  }
  /** Release accepted-value subscriptions. */
  dispose(): void { this.unsubscribe() }

}
