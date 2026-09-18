/** Remount-surviving drafts and explicit remove confirmation; Host readback stays in the source. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { McpRemoveRequest, McpServerRecord } from '@deepseek-ai/dsh-api-mcp-controller/types'
import { openDraft, type McpDraft, type ReferenceDraft } from './draft.ts'

/** Settings-only interaction state, never a mirror of the manager snapshot. */
export interface McpSettingsState { draft: McpDraft | null; removing: McpRemoveRequest | null }

const actions = {
  open(d: McpSettingsState, revision: number, record?: McpServerRecord) { d.draft = openDraft(revision, record); d.removing = null },
  cancel(d: McpSettingsState) { d.draft = null },
  patch(d: McpSettingsState, patch: Partial<Pick<McpDraft, 'serverName' | 'enabled' | 'transport' | 'command' | 'args' | 'cwd' | 'url'>>) {
    if (d.draft !== null) Object.assign(d.draft, patch)
  },
  addReference(d: McpSettingsState, field: 'env' | 'headers') { d.draft?.[field].push({ name: '', ref: '', prefix: '' }) },
  changeReference(d: McpSettingsState, field: 'env' | 'headers', index: number, patch: Partial<ReferenceDraft>) {
    const row = d.draft?.[field][index]
    if (row !== undefined) Object.assign(row, patch)
  },
  removeReference(d: McpSettingsState, field: 'env' | 'headers', index: number) { d.draft?.[field].splice(index, 1) },
  confirmRemove(d: McpSettingsState, request: McpRemoveRequest | null) { d.removing = request },
}

/**
 * Create a registration-owned draft store.
 * @returns a fresh, non-persisted interaction store declaration.
 */
export function createMcpSettingsStore(): EngineStoreHandle<McpSettingsState, typeof actions> {
  return defineStore({ init: (): McpSettingsState => ({ draft: null, removing: null }), actions })
}
