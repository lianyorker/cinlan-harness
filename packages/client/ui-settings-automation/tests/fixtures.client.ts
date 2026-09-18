/** Instance-local task, catalog, and journal fixtures; no provider or timer is started. */
import type { AutomationClientSnapshot, AutomationCatalog, AutomationDefinition, AutomationRun } from '@deepseek-ai/dsh-api-automation-controller/types'

/** @returns one disabled task with a known edit revision. */
export function definition(): AutomationDefinition {
  return { id: 'task-1', revision: 7, scheduleRevision: 1, enabled: false, needsReview: false, nextPlannedAt: null,
    createdAt: 1000, updatedAt: 1000, deletedAt: null,
    spec: { title: 'Check workspace', prompt: 'Private prompt', workspaceId: 'workspace-1', workspacePath: '/private/workspace', agentPresetId: 'agent-1',
      model: { provider: 'provider-1', model: 'model-1' }, permissionPresetId: 'permission-1', permission: { sandbox: 'read-only', approval: 'never' },
      schedule: { kind: 'daily', hour: 8, minute: 30 } },
  } as AutomationDefinition
}

/** @returns actual selectable fixture resources and explicit Host defaults. */
export function catalog(): AutomationCatalog {
  return { workspaces: [{ id: definition().spec.workspaceId, title: 'Workspace', path: '/private/workspace', availability: 'ready' }],
    agentPresets: [{ id: 'agent-1', name: 'Agent', availability: 'ready' }],
    providers: [{ id: 'provider-1', name: 'Provider', availability: 'ready' }],
    models: [{ provider: 'provider-1', id: 'model-1', name: 'Model', availability: 'ready' }],
    permissionPresets: [{ id: 'permission-1', name: 'Read only', availability: 'ready', permission: { sandbox: 'read-only', approval: 'never' } }],
    defaults: { agentPresetId: 'agent-1', model: { provider: 'provider-1', model: 'model-1' }, modelAvailability: 'ready', permissionPresetId: 'permission-1' },
  }
}

/** @param status - recorded lifecycle state. @returns evidence for one admitted invocation. */
export function run(status: AutomationRun['status'] = 'completed'): AutomationRun {
  return { id: 'run-1', automationId: 'task-1', definitionRevision: 7, scheduleRevision: 1, spec: definition().spec,
    trigger: 'manual', requestId: 'request-1', plannedAt: Date.UTC(2026, 0, 2, 3, 4), sessionId: 'session-1', messageId: null,
    turn: 1, status, reason: null, createdAt: 1000, updatedAt: 2000, finishedAt: 2000,
  } as AutomationRun
}

/** @returns a fresh authoritative view per test. */
export function snapshot(): AutomationClientSnapshot {
  return { availability: 'ready', writable: true, loading: false, error: null,
    runtime: { status: 'ready', profile: 'test', revision: 1, definitions: [definition()], activeRuns: [] },
    catalog: catalog(), catalogLoading: false, history: null }
}
