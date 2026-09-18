/** Pure presentation keeps UTC and authority fields distinct. */
import { describe, expect, it } from 'vitest'
import type { AutomationDefinition, AutomationRunStatus } from '@deepseek-ai/dsh-automation/types'
import { changeFrequency, definitionDraft, errorKey, isActive, utcTime } from '../src/client/presentation.ts'

describe('automation presentation', () => {
  it('copies only editable fields, never resolved workspace or permission authority', () => {
    const definition = { spec: { title: 'Task', prompt: 'Prompt', workspaceId: 'workspace', agentPresetId: 'agent',
      model: { provider: 'provider', model: 'model' }, permissionPresetId: 'permission',
      schedule: { kind: 'daily', hour: 8, minute: 15 }, workspacePath: '/private/path', permission: { sandbox: 'read-only', approval: 'never' },
    } } as unknown as AutomationDefinition
    expect(definitionDraft(definition)).toEqual({ title: 'Task', prompt: 'Prompt', workspaceId: 'workspace', agentPresetId: 'agent',
      model: { provider: 'provider', model: 'model' }, permissionPresetId: 'permission', schedule: { kind: 'daily', hour: 8, minute: 15 } })
    expect(definitionDraft(definition).model).not.toBe(definition.spec.model)
  })

  it('keeps UTC fields and requires deliberate weekly day selection', () => {
    expect(changeFrequency({ kind: 'daily', hour: 8, minute: 15 }, 'hourly')).toEqual({ kind: 'hourly', minute: 15 })
    expect(changeFrequency({ kind: 'hourly', minute: 15 }, 'daily')).toEqual({ kind: 'daily', minute: 15, hour: 0 })
    expect(changeFrequency({ kind: 'daily', hour: 8, minute: 15 }, 'weekly')).toEqual({ kind: 'weekly', minute: 15, hour: 8, weekdays: [] })
    expect(changeFrequency({ kind: 'weekly', weekdays: [0, 6], hour: 8, minute: 15 }, 'weekly')).toEqual({ kind: 'weekly', minute: 15, hour: 8, weekdays: [0, 6] })
    expect(utcTime(Date.UTC(2026, 0, 2, 3, 4))).toBe('2026-01-02T03:04:00.000Z')
  })

  it('recognizes only recorded nonterminal states as active', () => {
    const states: AutomationRunStatus[] = ['starting', 'running', 'stopping', 'completed', 'failed', 'cancelled', 'skipped-overlap', 'interrupted', 'ambiguous']
    expect(states.filter(isActive)).toEqual(['starting', 'running', 'stopping'])
  })

  it.each([['conflict', 'conflict'], ['invalid', 'invalid'], ['busy', 'busy'], ['resource', 'resource'], ['storage', 'storage'],
    ['not-found', 'notFound'], ['readonly', 'readonly'], ['unavailable', 'unavailable']])('localizes %s without exposing raw errors', (code, expected) => {
    expect(errorKey({ code, message: '/private/path secret prompt' })).toBe(expected)
    expect(errorKey({ failure: { code, message: 'private details' } })).toBe(expected)
  })

  it('contains unknown transport error text', () => {
    expect(errorKey(new Error('/private/path'))).toBe('operationFailed')
    expect(errorKey(null)).toBe('operationFailed')
    expect(errorKey({ code: 'unknown' })).toBe('operationFailed')
  })
})
