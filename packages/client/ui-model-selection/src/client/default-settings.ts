/** Atomic default-model edits confirmed against the durable user layer. */
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelCatalogDirectory } from './catalog.ts'

/** Host namespace for the model inherited by newly created sessions. */
export const DEFAULT_MODEL_NAMESPACE = 'agent-default-model'

/** Current save feedback; persisted values remain in the settings scope. */
export interface DefaultModelWriteState {
  status: 'idle' | 'saving' | 'saved' | 'failed' | 'conflict'
  canRetry: boolean
}

type Edit = { kind: 'select'; selection: ModelSelection } | { kind: 'reset' }
const FIELDS = ['provider', 'model', 'reasoningEffort'] as const

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/**
 * Whether any owned field has a user override, even if it equals its inherited value.
 * @param user - raw user layer from the bound settings scope.
 * @returns whether Reset has an override to remove.
 */
export function hasDefaultModelOverrides(user: unknown): boolean {
  const fields = record(user)
  return fields !== undefined && FIELDS.some(field => Object.hasOwn(fields, field))
}

function confirmed(snapshot: SettingsScopeSnapshot<ModelSelection>, edit: Edit): boolean {
  if (snapshot.status !== 'ready') return false
  if (edit.kind === 'reset') return !hasDefaultModelOverrides(snapshot.user)
  const user = record(snapshot.user)
  return user !== undefined && FIELDS.every((field) => {
    const expected = edit.selection[field]
    return expected === undefined
      ? !Object.hasOwn(user, field)
      : Object.hasOwn(user, field) && user[field] === expected
  })
}

function operations(edit: Edit): SettingsPathOpView[] {
  return FIELDS.map((field) => {
    const value = edit.kind === 'reset' ? undefined : edit.selection[field]
    return value === undefined
      ? { op: 'unset', path: [field] }
      : { op: 'set', path: [field], value }
  })
}

/** One in-flight defaults edit; the scope owns write ordering and recovery reads. */
export class DefaultModelSettingsController {
  /** Interaction feedback bound through the renderer's hooks compartment. */
  readonly store = createSnapshotStore<DefaultModelWriteState>({ status: 'idle', canRetry: false })
  private pending: Promise<void> | undefined
  private lastEdit: Edit | undefined
  private disposed = false

  /**
   * @param scope - authoritative default-model settings snapshot and mutation queue.
   * @param catalog - existing catalog shared with Session model selectors.
   */
  constructor(
    private readonly scope: SettingsScope<ModelSelection>,
    private readonly catalog: ModelCatalogDirectory,
  ) {}

  /**
   * Persist the complete choice; omitted effort removes a stale route-specific override.
   * @param selection - a route and optional effort advertised by the shared catalog.
   * @returns settlement after write confirmation or failure feedback.
   */
  select(selection: ModelSelection): Promise<void> {
    return this.commit({ kind: 'select', selection })
  }

  /** @returns settlement after removing all three user overrides. */
  reset(): Promise<void> {
    return this.commit({ kind: 'reset' })
  }

  /** @returns settlement of the last failed choice using the recovered scope revision. */
  retry(): Promise<void> {
    return this.lastEdit === undefined ? Promise.resolve() : this.commit(this.lastEdit)
  }

  /** @returns quiescence of an active write, without publishing feedback after teardown. */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.pending
  }

  private commit(edit: Edit): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.pending !== undefined) return this.pending
    this.lastEdit = edit
    const pending = this.write(edit).finally(() => { this.pending = undefined })
    this.pending = pending
    return pending
  }

  private async write(edit: Edit): Promise<void> {
    const before = this.scope.getSnapshot()
    const catalog = this.catalog.store.getSnapshot()
    const model = edit.kind === 'select'
      ? catalog.value?.groups.find(group => group.id === edit.selection.provider)
        ?.models.find(candidate => candidate.id === edit.selection.model)
      : undefined
    if (before.status !== 'ready' || !before.writable || before.value === undefined
      || (edit.kind === 'select' && (catalog.status !== 'ready' || model === undefined
        || (edit.selection.reasoningEffort !== undefined
          && !model.reasoning?.efforts.some(effort => effort.id === edit.selection.reasoningEffort))))) {
      this.store.set({ status: 'failed', canRetry: false })
      return
    }
    if (confirmed(before, edit)) {
      this.store.set({ status: 'saved', canRetry: false })
      return
    }
    this.store.set({ status: 'saving', canRetry: false })
    let accepted: boolean
    try {
      accepted = await this.scope.mutate(operations(edit), before.revision)
    } catch (_writeFailure) {
      if (!this.disposed) this.store.set({ status: 'failed', canRetry: true })
      return
    }
    if (this.disposed) return
    const after = this.scope.getSnapshot()
    if (accepted && confirmed(after, edit)) {
      this.store.set({ status: 'saved', canRetry: false })
    } else {
      this.store.set({ status: after.revision !== before.revision ? 'conflict' : 'failed', canRetry: true })
    }
  }
}
