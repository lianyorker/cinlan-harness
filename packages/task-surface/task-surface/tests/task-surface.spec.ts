import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, createToolResultMessage, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SessionId,
  SessionLogOffset,
  SessionSeq,
  type SessionEvent,
  type SessionEventMap,
  type SessionEventType,
} from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import {
  apply,
  formatSubmissionMessage,
  parseTaskSurfaceModel,
  TaskSurfaceDismissalId,
  TaskSurfaceId,
  taskSurfaceProjectionDefinition,
  TaskSurfaceSubmissionId,
  TaskSurfaceValidationError,
  validateSubmission,
} from '../src/index.ts'
import type { TaskSurfaceModelV1, TaskSurfacePendingSubmission } from '../src/types.ts'

interface TaskSurfaceTestAccess {
  pendingSubmissions: Map<string, TaskSurfacePendingSubmission>
}

function testAccess(service: unknown): TaskSurfaceTestAccess {
  return service as TaskSurfaceTestAccess
}

function createTestEvent<T extends SessionEventType>(
  type: T,
  data: SessionEventMap[T],
): SessionEvent {
  return {
    type,
    seq: SessionSeq(1),
    time: 0,
    data,
  } as SessionEvent
}

describe('TaskSurface domain and IDs', () => {
  it('creates branded nominal IDs', () => {
    const id = TaskSurfaceId('surf-123')
    const subId = TaskSurfaceSubmissionId('sub-456')
    const disId = TaskSurfaceDismissalId('dis-789')

    expect(String(id)).toBe('surf-123')
    expect(String(subId)).toBe('sub-456')
    expect(String(disId)).toBe('dis-789')
  })
})

describe('TaskSurface parser and limits', () => {
  const minimalValidModel: TaskSurfaceModelV1 = {
    version: 1,
    title: 'Minimal Panel',
    sections: [
      {
        id: 'sec-1',
        blocks: [{ kind: 'markdown', text: 'Hello' }],
      },
    ],
    submit: { label: 'Submit' },
  }

  it('parses a valid minimal model', () => {
    const parsed = parseTaskSurfaceModel(minimalValidModel)
    expect(parsed.version).toBe(1)
    expect(parsed.title).toBe('Minimal Panel')
    expect(parsed.sections).toHaveLength(1)
    expect(parsed.submit.label).toBe('Submit')
  })

  it('parses a model with all block types and section layout', () => {
    const fullModel = {
      version: 1,
      title: 'Full Panel',
      description: 'Panel Description',
      sections: [
        {
          id: 'sec-stack',
          title: 'Stack Section',
          layout: { kind: 'stack' },
          blocks: [
            { kind: 'markdown', text: 'Description text' },
            {
              kind: 'metrics',
              items: [
                { label: 'Latency', value: '12ms', detail: 'p95' },
                { label: 'Error Rate', value: '0.01%' },
              ],
            },
            {
              kind: 'table',
              columns: [{ id: 'col1', label: 'Col 1' }],
              rows: [{ col1: 'val1' }, { col1: null }, { col1: 100 }, { col1: true }],
            },
            {
              kind: 'diff',
              path: 'file.txt',
              before: 'line 1',
              after: 'line 1 edited',
              language: 'diff',
            },
            {
              kind: 'notice',
              tone: 'warning',
              text: 'Attention required',
            },
          ],
        },
        {
          id: 'sec-grid',
          layout: { kind: 'grid', columns: 3 },
          blocks: [
            { kind: 'notice', tone: 'info', text: 'Info notice' },
            { kind: 'notice', tone: 'neutral', text: 'Neutral notice' },
            { kind: 'diff', before: null, after: 'new file' },
          ],
        },
      ],
      fields: [
        { kind: 'text', id: 'f-text', label: 'Text Field', multiline: true, required: true, initial: 'hello' },
        {
          kind: 'choice',
          id: 'f-choice',
          label: 'Choice Field',
          options: [
            { id: 'opt1', label: 'Option 1', detail: 'detail 1' },
            { id: 'opt2', label: 'Option 2' },
          ],
          initial: 'opt1',
        },
        {
          kind: 'multi-choice',
          id: 'f-multi',
          label: 'Multi Choice Field',
          options: [
            { id: 'optA', label: 'Option A' },
            { id: 'optB', label: 'Option B' },
          ],
          initial: ['optA'],
        },
        { kind: 'toggle', id: 'f-toggle', label: 'Toggle Field', initial: true },
        {
          kind: 'order',
          id: 'f-order',
          label: 'Order Field',
          options: [
            { id: 'o1', label: 'Order 1' },
            { id: 'o2', label: 'Order 2' },
          ],
          initial: ['o2', 'o1'],
        },
      ],
      submit: { label: 'Complete Task' },
    }

    const parsed = parseTaskSurfaceModel(fullModel)
    expect(parsed.title).toBe('Full Panel')
    expect(parsed.description).toBe('Panel Description')
    expect(parsed.sections).toHaveLength(2)
    expect(parsed.fields).toHaveLength(5)
    expect(parsed.submit.label).toBe('Complete Task')
  })

  it('parses fields with initial values', () => {
    const parsed = parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{ id: 's', blocks: [] }],
      fields: [
        { id: 'f1', label: 'L1', kind: 'choice', options: [{ id: 'o1', label: 'O1' }], initial: 'o1' },
        { id: 'f2', label: 'L2', kind: 'multi-choice', options: [{ id: 'o1', label: 'O1' }], initial: ['o1'] },
        { id: 'f3', label: 'L3', kind: 'toggle', initial: true },
        { id: 'f4', label: 'L4', kind: 'order', options: [{ id: 'o1', label: 'O1' }], initial: ['o1'] },
      ],
      submit: { label: 'S' },
    })
    expect(parsed.fields?.[0]?.initial).toBe('o1')
    expect(parsed.fields?.[1]?.initial).toEqual(['o1'])
    expect(parsed.fields?.[2]?.initial).toBe(true)
    expect(parsed.fields?.[3]?.initial).toEqual(['o1'])
  })

  it('parses fields without initial values', () => {
    const parsed = parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{ id: 's', blocks: [] }],
      fields: [
        { id: 'f0', label: 'L0', kind: 'text' },
        { id: 'f1', label: 'L1', kind: 'choice', options: [{ id: 'o1', label: 'O1' }] },
        { id: 'f2', label: 'L2', kind: 'multi-choice', options: [{ id: 'o1', label: 'O1' }] },
        { id: 'f3', label: 'L3', kind: 'toggle' },
        { id: 'f4', label: 'L4', kind: 'order', options: [{ id: 'o1', label: 'O1' }] },
      ],
      submit: { label: 'S' },
    })
    expect(parsed.fields?.[0]?.initial).toBeUndefined()
    expect(parsed.fields?.[1]?.initial).toBeUndefined()
    expect(parsed.fields?.[2]?.initial).toBeUndefined()
    expect(parsed.fields?.[3]?.initial).toBeUndefined()
    expect(parsed.fields?.[4]?.initial).toBeUndefined()
  })

  it('rejects models violating structural or schema rules', () => {
    expect(() => parseTaskSurfaceModel(null)).toThrow(TaskSurfaceValidationError)
    expect(() => parseTaskSurfaceModel({ version: 2 })).toThrow(/unsupported task surface version/i)
    expect(() => parseTaskSurfaceModel({ version: 1, title: 123 })).toThrow(/title must be a string/)
    expect(() => parseTaskSurfaceModel({ version: 1, title: '   ' })).toThrow(/title cannot be empty/)
    expect(() => parseTaskSurfaceModel({ version: 1, title: 'T', description: 123 })).toThrow(/description must be a string/)
    expect(() => parseTaskSurfaceModel({ version: 1, title: 'T', sections: 'not-array' })).toThrow(/sections must be a non-empty array/)
    expect(() => parseTaskSurfaceModel({ version: 1, title: 'T', sections: [] })).toThrow(/sections must be a non-empty array/)
    expect(() => parseTaskSurfaceModel({ version: 1, title: 'T', sections: ['invalid'] })).toThrow(/section.*must be an object/)
    expect(() => parseTaskSurfaceModel({ version: 1, title: 'T', sections: [{ id: '' }] })).toThrow(/section\[0\].id cannot be empty/)
    expect(() => parseTaskSurfaceModel({ version: 1, title: 'T', sections: [{ id: 's1', title: 123 }] })).toThrow(/section.*title must be a string/)
    expect(() => parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [
        { id: 's1', blocks: [] },
        { id: 's1', blocks: [] },
      ],
      submit: { label: 'S' },
    })).toThrow(/duplicate section id "s1"/)
    expect(() => parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{ id: 's1', layout: 'invalid', blocks: [] }],
      submit: { label: 'S' },
    })).toThrow(/section "s1".layout must be an object/)
    expect(() => parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{ id: 's1', layout: { kind: 'unknown' }, blocks: [] }],
      submit: { label: 'S' },
    })).toThrow(/invalid layout kind "unknown"/)
    expect(() => parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{ id: 's1', layout: { kind: 'grid', columns: 4 }, blocks: [] }],
      submit: { label: 'S' },
    })).toThrow(/layout.*columns must be 2 or 3/)
    expect(() => parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{ id: 's1', blocks: 'invalid' }],
      submit: { label: 'S' },
    })).toThrow(/section "s1".blocks must be an array/)
  })

  it('rejects invalid blocks and fields', () => {
    const base = {
      version: 1,
      title: 'T',
      submit: { label: 'S' },
    }
    expect(() => parseTaskSurfaceModel(undefined)).toThrow(/model must be an object/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [null] }],
    })).toThrow(/block at index 0 must be an object/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'metrics', items: [null] }] }],
    })).toThrow(/metrics item\[0\] must be an object/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'table', columns: [null], rows: [] }] }],
    })).toThrow(/table column\[0\] must be an object/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'table', columns: [{ id: 'c', label: 'L' }], rows: [null] }] }],
    })).toThrow(/table row\[0\] must be an object/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'unknown' }] }],
    })).toThrow(/unknown block kind "unknown"/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'markdown', text: 123 }] }],
    })).toThrow(/markdown block.*text must be a string/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'metrics', items: 'bad' }] }],
    })).toThrow(/metrics block.*items must be an array/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'metrics', items: [{ label: 'L' }] }] }],
    })).toThrow(/metrics item.*value must be a string/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'metrics', items: [{ label: 'L', value: 'V', detail: 123 }] }] }],
    })).toThrow(/metrics item.*detail must be a string/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'table', columns: 'bad', rows: [] }] }],
    })).toThrow(/table block.*columns must be an array/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'table', columns: [{ id: '', label: 'L' }], rows: [] }] }],
    })).toThrow(/table column.*id cannot be empty/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'table', columns: [{ id: 'c', label: 'L' }], rows: 'bad' }] }],
    })).toThrow(/table block.*rows must be an array/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'table', columns: [{ id: 'c', label: 'L' }], rows: [{ c: {} }] }] }],
    })).toThrow(/table cell.*must be string, number, boolean, or null/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'diff', before: null, after: 123 }] }],
    })).toThrow(/diff block.*after must be a string/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'diff', before: 123, after: 'ok' }] }],
    })).toThrow(/diff block.*before must be a string/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'diff', before: null, after: 'ok', path: 123 }] }],
    })).toThrow(/diff block.*path must be a string/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'diff', before: null, after: 'ok', language: 123 }] }],
    })).toThrow(/diff block.*language must be a string/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'notice', text: 123, tone: 'info' }] }],
    })).toThrow(/notice block.*text must be a string/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [{ kind: 'notice', text: 'N', tone: 'danger' }] }],
    })).toThrow(/notice block.*tone must be neutral, info, or warning/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: 'bad',
    })).toThrow(/fields must be an array/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [null],
    })).toThrow(/field at index 0 must be an object/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: '', label: 'L', kind: 'text' }],
    })).toThrow(/field\[0\].id cannot be empty/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: '', kind: 'text' }],
    })).toThrow(/field\[0\].label cannot be empty/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: 'L', kind: 'unknown' }],
    })).toThrow(/unknown field kind "unknown"/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [
        { id: 'f1', label: 'L1', kind: 'text' },
        { id: 'f1', label: 'L2', kind: 'text' },
      ],
    })).toThrow(/duplicate field id "f1"/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: 'L1', kind: 'text', initial: 123 }],
    })).toThrow(/initial must be a string/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: 'L1', kind: 'choice', options: 'bad' }],
    })).toThrow(/options must be a non-empty array/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: 'L1', kind: 'choice', options: [null] }],
    })).toThrow(/option at index 0 must be an object/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: 'L1', kind: 'choice', options: [{ id: '', label: 'L' }] }],
    })).toThrow(/option\[0\].id cannot be empty/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: 'L1', kind: 'choice', options: [{ id: 'o1', label: 'L', detail: 123 }] }],
    })).toThrow(/option\[0\].detail must be a string/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: 'L1', kind: 'choice', options: [{ id: 'o1', label: 'L' }, { id: 'o1', label: 'L' }] }],
    })).toThrow(/duplicate option id "o1"/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: 'L1', kind: 'multi-choice', options: [{ id: 'o1', label: 'L' }], initial: 'not-array' }],
    })).toThrow(/initial must be an array/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: 'L1', kind: 'order', options: [{ id: 'o1', label: 'L' }], initial: 'not-array' }],
    })).toThrow(/initial must be an array/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      submit: null,
    })).toThrow(/submit must be an object/)
    expect(() => parseTaskSurfaceModel({
      ...base,
      sections: [{ id: 's', blocks: [] }],
      submit: { label: '' },
    })).toThrow(/submit.label cannot be empty/)
  })

  it('enforces configured limits', () => {
    expect(() => parseTaskSurfaceModel(minimalValidModel, { maxModelBytes: 20 })).toThrow(/model size .* exceeds limit/)
    expect(() => parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{ id: 's', blocks: [{ kind: 'markdown', text: '1' }, { kind: 'markdown', text: '2' }] }],
      submit: { label: 'S' },
    }, { maxBlocks: 1 })).toThrow(/total blocks across sections exceed limit of 1/)
    expect(() => parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{ id: 's', blocks: [] }],
      fields: [{ id: 'f1', label: 'L', kind: 'text' }, { id: 'f2', label: 'L', kind: 'text' }],
      submit: { label: 'S' },
    }, { maxFields: 1 })).toThrow(/fields count exceeds limit of 1/)
    expect(() => parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{
        id: 's',
        blocks: [{
          kind: 'table',
          columns: [{ id: 'c', label: 'C' }],
          rows: [{ c: 1 }, { c: 2 }, { c: 3 }],
        }],
      }],
      submit: { label: 'S' },
    }, { maxTableRows: 2 })).toThrow(/table rows exceed limit of 2/)
  })
})

describe('validateSubmission & formatSubmissionMessage', () => {
  const model: TaskSurfaceModelV1 = {
    version: 1,
    title: 'Review Task',
    sections: [{ id: 's1', blocks: [] }],
    fields: [
      { kind: 'text', id: 'summary', label: 'Summary', required: true },
      { kind: 'text', id: 'optionalNote', label: 'Optional Note', required: false },
      {
        kind: 'choice',
        id: 'decision',
        label: 'Decision',
        options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }],
      },
      {
        kind: 'multi-choice',
        id: 'tags',
        label: 'Tags',
        options: [{ id: 't1', label: 'Tag 1' }, { id: 't2', label: 'Tag 2' }],
      },
      { kind: 'toggle', id: 'notify', label: 'Notify' },
      {
        kind: 'order',
        id: 'priority',
        label: 'Priority',
        options: [{ id: 'p1', label: 'P1' }, { id: 'p2', label: 'P2' }],
      },
    ],
    submit: { label: 'Submit' },
  }

  it('validates and formats a complete submission', () => {
    const values = {
      summary: 'All checks passed',
      optionalNote: 'Optional detail',
      decision: 'approve',
      tags: ['t1', 't2'],
      notify: true,
      priority: ['p2', 'p1'],
    }

    validateSubmission(model, values)
    const formatted = formatSubmissionMessage(model, values, 'Submitted via web')

    expect(formatted).toContain('## Review Task')
    expect(formatted).toContain('- **Summary**: All checks passed')
    expect(formatted).toContain('- **Decision**: Approve')
    expect(formatted).toContain('- **Tags**: Tag 1, Tag 2')
    expect(formatted).toContain('- **Notify**: Yes')
    expect(formatted).toContain('- **Priority**: 1. P2, 2. P1')
    expect(formatted).toContain('### Note\nSubmitted via web')
  })

  it('rejects invalid submission inputs', () => {
    expect(() => { validateSubmission(model, { summary: 'ok' }, { maxSubmissionBytes: 5 }) }).toThrow(/submission size .* exceeds limit/)
    expect(() => { validateSubmission(model, { unknownField: 'val' }) }).toThrow(/unknown submission field "unknownField"/)
    expect(() => { validateSubmission(model, {}) }).toThrow(/required field "summary" is missing/)
    expect(() => { validateSubmission(model, { summary: 123 }) }).toThrow(/field "summary".*must be a string/)
    expect(() => { validateSubmission(model, { summary: '   ' }) }).toThrow(/required field "summary" cannot be empty/)
    expect(() => { validateSubmission(model, { summary: 'ok', decision: 123 }) }).toThrow(/choice field "decision".*must be a string/)
    expect(() => { validateSubmission(model, { summary: 'ok', decision: 'bad' }) }).toThrow(/is not a valid option for choice field "decision"/)
    expect(() => { validateSubmission(model, { summary: 'ok', tags: 'not-array' }) }).toThrow(/multi-choice field "tags".*must be an array/)
    expect(() => { validateSubmission(model, { summary: 'ok', tags: ['bad'] }) }).toThrow(/is not a valid option for multi-choice field "tags"/)
    expect(() => { validateSubmission(model, { summary: 'ok', notify: 'true' }) }).toThrow(/toggle field "notify".*must be a boolean/)
    expect(() => { validateSubmission(model, { summary: 'ok', priority: 'not-array' }) }).toThrow(/order field "priority".*must be an array/)
    expect(() => { validateSubmission(model, { summary: 'ok', priority: ['p1'] }) }).toThrow(/order field "priority" must include all declared options exactly once/)
    expect(() => { validateSubmission(model, { summary: 'ok', priority: ['p1', 'p1'] }) }).toThrow(/order field "priority" must include all declared options exactly once/)
    expect(() => { validateSubmission(model, { summary: 'ok', priority: ['p1', 'p3'] }) }).toThrow(/value "p3" is not a valid option for order field "priority"/)
  })

  it('formats submissions with absent notes or unselected values cleanly', () => {
    const minimalValues = {
      summary: 'Minimal',
      notify: false,
      tags: [],
    }
    const formatted = formatSubmissionMessage(model, minimalValues)
    expect(formatted).not.toContain('### Note')
    expect(formatted).toContain('- **Notify**: No')
    expect(formatted).toContain('- **Tags**: (None)')
  })

  it('formats submissions with descriptions, unlisted fallback options, and empty fields', () => {
    const noFieldsModel: TaskSurfaceModelV1 = {
      version: 1,
      title: 'No Fields',
      description: 'Model description here',
      sections: [],
      submit: { label: 'S' },
    }
    validateSubmission(noFieldsModel, {})
    expect(formatSubmissionMessage(noFieldsModel, {})).toContain('Model description here')

    const emptyFieldsModel: TaskSurfaceModelV1 = {
      version: 1,
      title: 'Empty Fields',
      sections: [],
      fields: [],
      submit: { label: 'S' },
    }
    expect(formatSubmissionMessage(emptyFieldsModel, {})).toBe('## Empty Fields\n')

    const fallbackModel: TaskSurfaceModelV1 = {
      version: 1,
      title: 'Fallback Model',
      sections: [],
      fields: [
        { id: 'c_str', label: 'ChoiceStr', kind: 'choice', options: [{ id: 'o1', label: 'O1' }] },
        { id: 'c_num', label: 'ChoiceNum', kind: 'choice', options: [{ id: 'o1', label: 'O1' }] },
        { id: 'm', label: 'Multi', kind: 'multi-choice', options: [{ id: 'o1', label: 'O1' }] },
        { id: 'o_empty', label: 'OrderEmpty', kind: 'order', options: [{ id: 'o1', label: 'O1' }] },
        { id: 'o_unlisted', label: 'OrderUnlisted', kind: 'order', options: [{ id: 'o1', label: 'O1' }] },
        { id: 't_num', label: 'TextNum', kind: 'text' },
      ],
      submit: { label: 'S' },
    }
    const formatted = formatSubmissionMessage(fallbackModel, {
      c_str: 'unknown_choice',
      c_num: 123,
      m: ['unknown_multi'],
      o_empty: [],
      o_unlisted: ['unknown_order'],
      t_num: 456,
    })
    expect(formatted).toContain('- **ChoiceStr**: unknown_choice')
    expect(formatted).toContain('- **ChoiceNum**: 123')
    expect(formatted).toContain('- **Multi**: unknown_multi')
    expect(formatted).toContain('- **OrderEmpty**: (None)')
    expect(formatted).toContain('- **OrderUnlisted**: 1. unknown_order')
    expect(formatted).toContain('- **TextNum**: 456')
  })
})

describe('taskSurfaceProjectionDefinition', () => {
  it('folds tool/result, task-surface/dismissed, and user/message', () => {
    const init = taskSurfaceProjectionDefinition.init({} as any, SessionLogOffset(0))
    expect(init).toEqual({ active: null })

    // Unrelated event does nothing
    expect(taskSurfaceProjectionDefinition.apply(init, createTestEvent('turn/start', { turn: 1 }))).toBe(init)

    // tool/result without meta does nothing
    expect(taskSurfaceProjectionDefinition.apply(init, createTestEvent('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: ToolCallId('c1'), content: [], isError: false }),
    }))).toBe(init)

    // tool/result with task-surface meta sets active
    const activeState = taskSurfaceProjectionDefinition.apply(init, createTestEvent('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-1'),
        content: [],
        isError: false,
      }),
      meta: {
        kind: 'dsh/task-surface',
        version: 1,
        surfaceId: 'surf-1',
        model: { version: 1, title: 'T', sections: [], submit: { label: 'S' } },
      },
    }))
    expect(activeState).toEqual({
      active: { callId: ToolCallId('call-1'), surfaceId: TaskSurfaceId('surf-1') },
    })

    // task-surface/dismissed for another surface does not close
    const nonMatchingDismiss = taskSurfaceProjectionDefinition.apply(activeState, createTestEvent('task-surface/dismissed', {
      surfaceId: TaskSurfaceId('other-surf'),
      dismissalId: TaskSurfaceDismissalId('d-other'),
    }))
    expect(nonMatchingDismiss).toBe(activeState)

    // task-surface/dismissed matching active surface closes it
    const dismissedState = taskSurfaceProjectionDefinition.apply(activeState, createTestEvent('task-surface/dismissed', {
      surfaceId: TaskSurfaceId('surf-1'),
      dismissalId: TaskSurfaceDismissalId('d-1'),
    }))
    expect(dismissedState).toEqual({ active: null })

    // user/message closes active surface
    const userMessageState = taskSurfaceProjectionDefinition.apply(activeState, createTestEvent('user/message', createUserMessage({
      content: [],
      source: { kind: 'user' },
    })))
    expect(userMessageState).toEqual({ active: null })

    // wire.view returns same state
    expect(taskSurfaceProjectionDefinition.wire.view(activeState)).toBe(activeState)

    // stateSchema transforms string IDs to nominal types
    const parsedState = taskSurfaceProjectionDefinition.stateSchema.parse({
      active: { callId: 'c1', surfaceId: 's1' },
    })
    expect(parsedState.active?.callId).toBe(ToolCallId('c1'))
    expect(parsedState.active?.surfaceId).toBe(TaskSurfaceId('s1'))

    // user/message when already idle stays idle
    expect(taskSurfaceProjectionDefinition.apply(init, createTestEvent('user/message', createUserMessage({
      content: [],
      source: { kind: 'user' },
    })))).toBe(init)
  })
})

describe('TaskSurfaceServiceImpl', () => {
  async function createHarness() {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(apply)

    const session = ctx.sessions.create()
    return { ctx, session }
  }

  const sampleModel: TaskSurfaceModelV1 = {
    version: 1,
    title: 'Test Surface',
    sections: [{ id: 's', blocks: [{ kind: 'markdown', text: 'Hi' }] }],
    fields: [{ kind: 'text', id: 'name', label: 'Name', required: true }],
    submit: { label: 'Submit' },
  }

  it('handles getActive when surface is open, stale, or missing', async () => {
    const { ctx, session } = await createHarness()
    const surfId = TaskSurfaceId('surf-test')

    // No session
    expect(await ctx.taskSurface.getActive({ sessionId: SessionId('non-existent') })).toEqual({
      active: false,
      reason: 'not-open',
    })

    // Session exists but no active surface
    expect(await ctx.taskSurface.getActive({ sessionId: session.id })).toEqual({
      active: false,
      reason: 'not-open',
    })

    // Surface opened via tool/result event in session at index 0
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-test'),
        content: [],
        isError: false,
      }),
      meta: {
        kind: 'dsh/task-surface',
        version: 1,
        surfaceId: surfId,
        model: sampleModel,
      },
    }, { surfaceOp: 'append' })

    // Non-matching tool/result event at index 1
    session.append('tool/result', {
      turn: 1,
      step: 2,
      message: createToolResultMessage({
        callId: ToolCallId('call-other'),
        content: [],
        isError: false,
      }),
      meta: { kind: 'other' },
    }, { surfaceOp: 'append' })

    // Non-tool/result event at index 2
    session.append('turn/start', { turn: 2 })

    // Active surface matches
    const active = await ctx.taskSurface.getActive({ sessionId: session.id, surfaceId: surfId })
    expect(active.active).toBe(true)
    if (active.active) {
      expect(active.surfaceId).toBe(surfId)
      expect(active.callId).toBe(ToolCallId('call-test'))
      expect(active.model.title).toBe('Test Surface')
      expect(active.pending).toBeNull()
    }

    // When projection has active surface but history does not contain matching meta
    const origSnapshot = session.snapshotEvents.bind(session)
    session.snapshotEvents = () => []
    expect(await ctx.taskSurface.getActive({ sessionId: session.id, surfaceId: surfId })).toEqual({
      active: false,
      reason: 'not-open',
    })
    session.snapshotEvents = origSnapshot

    // Querying with mismatched surfaceId returns not-open
    expect(await ctx.taskSurface.getActive({ sessionId: session.id, surfaceId: TaskSurfaceId('wrong-id') })).toEqual({
      active: false,
      reason: 'not-open',
    })
  })

  it('manages submission lifecycle, pending claim, and idempotency', async () => {
    const { ctx, session } = await createHarness()
    const surfId = TaskSurfaceId('surf-test')

    // Open surface
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-test'),
        content: [],
        isError: false,
      }),
      meta: {
        kind: 'dsh/task-surface',
        version: 1,
        surfaceId: surfId,
        model: sampleModel,
      },
    }, { surfaceOp: 'append' })

    const subId = TaskSurfaceSubmissionId('sub-1')

    // Submit invalid values
    const invalidResult = await ctx.taskSurface.submit({
      sessionId: session.id,
      surfaceId: surfId,
      submissionId: subId,
      values: {}, // missing required 'name'
    })
    expect(invalidResult).toEqual({ accepted: false, reason: 'invalid-submission' })

    // If another submission is already pending, submit is rejected with submission-pending
    testAccess(ctx.taskSurface).pendingSubmissions.set(`${session.id}:${surfId}`, {
      submissionId: TaskSurfaceSubmissionId('conflict-sub'),
      messageId: MessageId('msg-prev'),
      phase: 'queued',
    })
    const conflictSubmit = await ctx.taskSurface.submit({
      sessionId: session.id,
      surfaceId: surfId,
      submissionId: TaskSurfaceSubmissionId('new-sub'),
      values: { name: 'Alice' },
    })
    expect(conflictSubmit).toEqual({ accepted: false, reason: 'submission-pending' })

    // If submission is pending, dismissal is also rejected with submission-pending
    const conflictDismiss = await ctx.taskSurface.dismiss({
      sessionId: session.id,
      surfaceId: surfId,
      dismissalId: TaskSurfaceDismissalId('dis-while-pending'),
    })
    expect(conflictDismiss).toEqual({ dismissed: false, reason: 'submission-pending' })

    // Cross-session pending cleanup test
    testAccess(ctx.taskSurface).pendingSubmissions.set(`other-sess:${surfId}`, {
      submissionId: TaskSurfaceSubmissionId('other-sub'),
      messageId: MessageId('msg-other'),
      phase: 'queued',
    })
    session.append('user/message', {
      id: MessageId('m-clear'),
      role: 'user',
      content: [{ type: 'text', text: 'clearing' }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' })
    expect(testAccess(ctx.taskSurface).pendingSubmissions.has(`other-sess:${surfId}`)).toBe(true)
    expect(testAccess(ctx.taskSurface).pendingSubmissions.has(`${session.id}:${surfId}`)).toBe(false)

    // Re-open surface for submission
    session.append('tool/result', {
      turn: 2,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-test'),
        content: [],
        isError: false,
      }),
      meta: {
        kind: 'dsh/task-surface',
        version: 1,
        surfaceId: surfId,
        model: sampleModel,
      },
    }, { surfaceOp: 'append' })

    // Valid submission
    const res1 = await ctx.taskSurface.submit({
      sessionId: session.id,
      surfaceId: surfId,
      submissionId: subId,
      values: { name: 'Alice' },
      note: 'My note',
    })
    expect(res1.accepted).toBe(true)
    if (res1.accepted) {
      expect(res1.phase).toBe('queued')
      expect(res1.messageId).toBeDefined()
    }

    // Resubmission with same submissionId is idempotent
    const res2 = await ctx.taskSurface.submit({
      sessionId: session.id,
      surfaceId: surfId,
      submissionId: subId,
      values: { name: 'Alice' },
    })
    expect(res2).toEqual(res1)

    // Note: because session.append('user/message') fired synchronously, the event listener
    // on session/event already cleared pending claims and the projection closed!
    // Now submitting again with another subId returns not-open because the projection closed.
    const res3 = await ctx.taskSurface.submit({
      sessionId: session.id,
      surfaceId: surfId,
      submissionId: TaskSurfaceSubmissionId('sub-2'),
      values: { name: 'Bob' },
    })
    expect(res3).toEqual({ accepted: false, reason: 'not-open' })
  })

  it('rejects submissions for missing sessions or unopen surfaces', async () => {
    const { ctx } = await createHarness()
    const res = await ctx.taskSurface.submit({
      sessionId: SessionId('non-existent'),
      surfaceId: TaskSurfaceId('s'),
      submissionId: TaskSurfaceSubmissionId('sub'),
      values: {},
    })
    expect(res).toEqual({ accepted: false, reason: 'not-open' })
  })

  it('manages dismissal lifecycle and idempotency', async () => {
    const { ctx, session } = await createHarness()
    const surfId = TaskSurfaceId('surf-dismiss')

    // Non-existent session
    expect(await ctx.taskSurface.dismiss({
      sessionId: SessionId('no-session'),
      surfaceId: surfId,
      dismissalId: TaskSurfaceDismissalId('d1'),
    })).toEqual({ dismissed: false, reason: 'not-open' })

    // Session without open surface
    expect(await ctx.taskSurface.dismiss({
      sessionId: session.id,
      surfaceId: surfId,
      dismissalId: TaskSurfaceDismissalId('d1'),
    })).toEqual({ dismissed: false, reason: 'not-open' })

    // Open surface
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-dis'),
        content: [],
        isError: false,
      }),
      meta: {
        kind: 'dsh/task-surface',
        version: 1,
        surfaceId: surfId,
        model: sampleModel,
      },
    }, { surfaceOp: 'append' })

    const disId = TaskSurfaceDismissalId('dis-1')
    const dismissRes = await ctx.taskSurface.dismiss({
      sessionId: session.id,
      surfaceId: surfId,
      dismissalId: disId,
    })
    expect(dismissRes.dismissed).toBe(true)

    // Idempotent retry returns same eventSeq
    const retryDismiss = await ctx.taskSurface.dismiss({
      sessionId: session.id,
      surfaceId: surfId,
      dismissalId: disId,
    })
    expect(retryDismiss).toEqual(dismissRes)

    // Subsequent dismissal with new id returns not-open because surface is now dismissed
    expect(await ctx.taskSurface.dismiss({
      sessionId: session.id,
      surfaceId: surfId,
      dismissalId: TaskSurfaceDismissalId('dis-2'),
    })).toEqual({ dismissed: false, reason: 'not-open' })
  })
})
