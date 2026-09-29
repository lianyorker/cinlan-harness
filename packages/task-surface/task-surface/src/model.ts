/**
 * Declarative Task Surface parser, limits, and submission validation/formatting.
 * @module @deepseek-ai/dsh-task-surface/model
 */

import type {
  TaskSurfaceBlock,
  TaskSurfaceField,
  TaskSurfaceLimits,
  TaskSurfaceModelV1,
  TaskSurfaceOption,
  TaskSurfaceSection,
} from './types.ts'

/** Default configuration bounds for Task Surface. */
export const DEFAULT_TASK_SURFACE_LIMITS: Required<TaskSurfaceLimits> = {
  maxModelBytes: 64 * 1024,
  maxBlocks: 64,
  maxFields: 32,
  maxTableRows: 200,
  maxSubmissionBytes: 32 * 1024,
}

/** Error thrown when a Task Surface model or submission violates the protocol. */
export class TaskSurfaceValidationError extends Error {
  override readonly name = 'TaskSurfaceValidationError'
}

function assertString(val: unknown, name: string): string {
  if (typeof val !== 'string') {
    throw new TaskSurfaceValidationError(`${name} must be a string`)
  }
  return val
}

function parseOption(raw: unknown, index: number): TaskSurfaceOption {
  if (!raw || typeof raw !== 'object') {
    throw new TaskSurfaceValidationError(`option at index ${index} must be an object`)
  }
  const obj = raw as Record<string, unknown>
  const id = assertString(obj['id'], `option[${index}].id`).trim()
  if (id.length === 0) {
    throw new TaskSurfaceValidationError(`option[${index}].id cannot be empty`)
  }
  const label = assertString(obj['label'], `option[${index}].label`)
  const detail = obj['detail'] !== undefined ? assertString(obj['detail'], `option[${index}].detail`) : undefined
  return { id, label, ...(detail !== undefined ? { detail } : {}) }
}

function parseOptions(raw: unknown, fieldId: string): TaskSurfaceOption[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TaskSurfaceValidationError(`field "${fieldId}" options must be a non-empty array`)
  }
  const options = raw.map((opt, i) => parseOption(opt, i))
  const seenIds = new Set<string>()
  for (const opt of options) {
    if (seenIds.has(opt.id)) {
      throw new TaskSurfaceValidationError(`duplicate option id "${opt.id}" in field "${fieldId}"`)
    }
    seenIds.add(opt.id)
  }
  return options
}

function parseBlock(raw: unknown, index: number, maxTableRows: number): TaskSurfaceBlock {
  if (!raw || typeof raw !== 'object') {
    throw new TaskSurfaceValidationError(`block at index ${index} must be an object`)
  }
  const obj = raw as Record<string, unknown>
  const kind = assertString(obj['kind'], `block[${index}].kind`)

  switch (kind) {
    case 'markdown': {
      const text = assertString(obj['text'], `markdown block[${index}].text`)
      return { kind: 'markdown', text }
    }
    case 'metrics': {
      if (!Array.isArray(obj['items'])) {
        throw new TaskSurfaceValidationError(`metrics block[${index}].items must be an array`)
      }
      const items = obj['items'].map((it, i) => {
        if (!it || typeof it !== 'object') {
          throw new TaskSurfaceValidationError(`metrics item[${i}] must be an object`)
        }
        const itemObj = it as Record<string, unknown>
        const label = assertString(itemObj['label'], `metrics item[${i}].label`)
        const value = assertString(itemObj['value'], `metrics item[${i}].value`)
        const detail = itemObj['detail'] !== undefined ? assertString(itemObj['detail'], `metrics item[${i}].detail`) : undefined
        return { label, value, ...(detail !== undefined ? { detail } : {}) }
      })
      return { kind: 'metrics', items }
    }
    case 'table': {
      if (!Array.isArray(obj['columns'])) {
        throw new TaskSurfaceValidationError(`table block[${index}].columns must be an array`)
      }
      const columns = obj['columns'].map((col, i) => {
        if (!col || typeof col !== 'object') throw new TaskSurfaceValidationError(`table column[${i}] must be an object`)
        const colObj = col as Record<string, unknown>
        const id = assertString(colObj['id'], `table column[${i}].id`).trim()
        if (id.length === 0) {
          throw new TaskSurfaceValidationError(`table column[${i}].id cannot be empty`)
        }
        return {
          id,
          label: assertString(colObj['label'], `table column[${i}].label`),
        }
      })
      if (!Array.isArray(obj['rows'])) {
        throw new TaskSurfaceValidationError(`table block[${index}].rows must be an array`)
      }
      if (obj['rows'].length > maxTableRows) {
        throw new TaskSurfaceValidationError(`table rows exceed limit of ${maxTableRows}`)
      }
      const rows = obj['rows'].map((row, i) => {
        if (!row || typeof row !== 'object') throw new TaskSurfaceValidationError(`table row[${i}] must be an object`)
        const rowObj = row as Record<string, unknown>
        for (const [key, val] of Object.entries(rowObj)) {
          if (
            val !== null &&
            typeof val !== 'string' &&
            typeof val !== 'number' &&
            typeof val !== 'boolean'
          ) {
            throw new TaskSurfaceValidationError(`table cell "${key}" in row ${i} must be string, number, boolean, or null`)
          }
        }
        return row as Record<string, string | number | boolean | null>
      })
      return { kind: 'table', columns, rows }
    }
    case 'diff': {
      const before = obj['before'] === null ? null : assertString(obj['before'], `diff block[${index}].before`)
      const after = assertString(obj['after'], `diff block[${index}].after`)
      const path = obj['path'] !== undefined ? assertString(obj['path'], `diff block[${index}].path`) : undefined
      const language = obj['language'] !== undefined ? assertString(obj['language'], `diff block[${index}].language`) : undefined
      return {
        kind: 'diff',
        before,
        after,
        ...(path !== undefined ? { path } : {}),
        ...(language !== undefined ? { language } : {}),
      }
    }
    case 'notice': {
      const tone = assertString(obj['tone'], `notice block[${index}].tone`)
      if (tone !== 'neutral' && tone !== 'info' && tone !== 'warning') {
        throw new TaskSurfaceValidationError(`notice block[${index}].tone must be neutral, info, or warning`)
      }
      const text = assertString(obj['text'], `notice block[${index}].text`)
      return { kind: 'notice', tone, text }
    }
    default:
      throw new TaskSurfaceValidationError(`unknown block kind "${kind}" at index ${index}`)
  }
}

function parseField(raw: unknown, index: number): TaskSurfaceField {
  if (!raw || typeof raw !== 'object') {
    throw new TaskSurfaceValidationError(`field at index ${index} must be an object`)
  }
  const obj = raw as Record<string, unknown>
  const id = assertString(obj['id'], `field[${index}].id`).trim()
  if (id.length === 0) {
    throw new TaskSurfaceValidationError(`field[${index}].id cannot be empty`)
  }
  const kind = assertString(obj['kind'], `field "${id}".kind`)
  const label = assertString(obj['label'], `field[${index}].label`).trim()
  if (label.length === 0) {
    throw new TaskSurfaceValidationError(`field[${index}].label cannot be empty`)
  }

  switch (kind) {
    case 'text': {
      const multiline = typeof obj['multiline'] === 'boolean' ? obj['multiline'] : undefined
      const required = typeof obj['required'] === 'boolean' ? obj['required'] : undefined
      const initial = obj['initial'] !== undefined ? assertString(obj['initial'], `field "${id}".initial`) : undefined
      return {
        kind: 'text',
        id,
        label,
        ...(multiline !== undefined ? { multiline } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(initial !== undefined ? { initial } : {}),
      }
    }
    case 'choice': {
      const options = parseOptions(obj['options'], id)
      const initial = obj['initial'] !== undefined ? assertString(obj['initial'], `field "${id}".initial`) : undefined
      return {
        kind: 'choice',
        id,
        label,
        options,
        ...(initial !== undefined ? { initial } : {}),
      }
    }
    case 'multi-choice': {
      const options = parseOptions(obj['options'], id)
      let initial: string[] | undefined
      if (obj['initial'] !== undefined) {
        if (!Array.isArray(obj['initial'])) throw new TaskSurfaceValidationError(`field "${id}".initial must be an array`)
        initial = obj['initial'].map((v, i) => assertString(v, `field "${id}".initial[${i}]`))
      }
      return {
        kind: 'multi-choice',
        id,
        label,
        options,
        ...(initial !== undefined ? { initial } : {}),
      }
    }
    case 'toggle': {
      const initial = typeof obj['initial'] === 'boolean' ? obj['initial'] : undefined
      return {
        kind: 'toggle',
        id,
        label,
        ...(initial !== undefined ? { initial } : {}),
      }
    }
    case 'order': {
      const options = parseOptions(obj['options'], id)
      let initial: string[] | undefined
      if (obj['initial'] !== undefined) {
        if (!Array.isArray(obj['initial'])) throw new TaskSurfaceValidationError(`field "${id}".initial must be an array`)
        initial = obj['initial'].map((v, i) => assertString(v, `field "${id}".initial[${i}]`))
      }
      return {
        kind: 'order',
        id,
        label,
        options,
        ...(initial !== undefined ? { initial } : {}),
      }
    }
    default:
      throw new TaskSurfaceValidationError(`unknown field kind "${kind}" for field "${id}"`)
  }
}

/**
 * Parse and normalize a raw Task Surface model V1, checking bounds and uniqueness.
 * @param raw - candidate model payload.
 * @param limits - optional configuration bounds.
 * @returns normalized TaskSurfaceModelV1.
 */
export function parseTaskSurfaceModel(
  raw: unknown,
  limits?: TaskSurfaceLimits,
): TaskSurfaceModelV1 {
  const effectiveLimits = { ...DEFAULT_TASK_SURFACE_LIMITS, ...limits }
  if (!raw || typeof raw !== 'object') {
    throw new TaskSurfaceValidationError('model must be an object')
  }
  const jsonStr = JSON.stringify(raw)
  const byteLength = new TextEncoder().encode(jsonStr).length
  if (byteLength > effectiveLimits.maxModelBytes) {
    throw new TaskSurfaceValidationError(
      `model size ${byteLength} bytes exceeds limit of ${effectiveLimits.maxModelBytes} bytes`,
    )
  }

  const obj = raw as Record<string, unknown>
  if (obj['version'] !== 1) {
    throw new TaskSurfaceValidationError(`unsupported task surface version: ${String(obj['version'])}; expected 1`)
  }
  const title = assertString(obj['title'], 'title').trim()
  if (title.length === 0) {
    throw new TaskSurfaceValidationError('title cannot be empty')
  }
  const description = obj['description'] !== undefined ? assertString(obj['description'], 'description') : undefined

  if (!Array.isArray(obj['sections']) || obj['sections'].length === 0) {
    throw new TaskSurfaceValidationError('sections must be a non-empty array')
  }

  const seenSectionIds = new Set<string>()
  let totalBlocks = 0
  const sections: TaskSurfaceSection[] = []

  for (const [sIndex, secRaw] of obj['sections'].entries()) {
    if (!secRaw || typeof secRaw !== 'object') {
      throw new TaskSurfaceValidationError(`section[${sIndex}] must be an object`)
    }
    const secObj = secRaw as Record<string, unknown>
    const id = assertString(secObj['id'], `section[${sIndex}].id`).trim()
    if (id.length === 0) {
      throw new TaskSurfaceValidationError(`section[${sIndex}].id cannot be empty`)
    }
    if (seenSectionIds.has(id)) {
      throw new TaskSurfaceValidationError(`duplicate section id "${id}"`)
    }
    seenSectionIds.add(id)

    const secTitle = secObj['title'] !== undefined ? assertString(secObj['title'], `section "${id}".title`) : undefined
    let layout: TaskSurfaceSection['layout']
    if (secObj['layout'] !== undefined) {
      if (!secObj['layout'] || typeof secObj['layout'] !== 'object') {
        throw new TaskSurfaceValidationError(`section "${id}".layout must be an object`)
      }
      const layoutObj = secObj['layout'] as Record<string, unknown>
      const layoutKind = assertString(layoutObj['kind'], `section "${id}".layout.kind`)
      if (layoutKind === 'stack') {
        layout = { kind: 'stack' }
      } else if (layoutKind === 'grid') {
        const columns = layoutObj['columns']
        if (columns !== 2 && columns !== 3) {
          throw new TaskSurfaceValidationError(`section "${id}".layout.columns must be 2 or 3`)
        }
        layout = { kind: 'grid', columns }
      } else {
        throw new TaskSurfaceValidationError(`invalid layout kind "${layoutKind}" in section "${id}"`)
      }
    }

    if (!Array.isArray(secObj['blocks'])) {
      throw new TaskSurfaceValidationError(`section "${id}".blocks must be an array`)
    }
    totalBlocks += secObj['blocks'].length
    if (totalBlocks > effectiveLimits.maxBlocks) {
      throw new TaskSurfaceValidationError(`total blocks across sections exceed limit of ${effectiveLimits.maxBlocks}`)
    }

    const blocks = secObj['blocks'].map((b, bIndex) => parseBlock(b, bIndex, effectiveLimits.maxTableRows))
    sections.push({
      id,
      ...(secTitle !== undefined ? { title: secTitle } : {}),
      ...(layout !== undefined ? { layout } : {}),
      blocks,
    })
  }

  let fields: TaskSurfaceField[] | undefined
  if (obj['fields'] !== undefined) {
    if (!Array.isArray(obj['fields'])) {
      throw new TaskSurfaceValidationError('fields must be an array when present')
    }
    if (obj['fields'].length > effectiveLimits.maxFields) {
      throw new TaskSurfaceValidationError(`fields count exceeds limit of ${effectiveLimits.maxFields}`)
    }
    const seenFieldIds = new Set<string>()
    fields = []
    for (const [fIndex, fRaw] of obj['fields'].entries()) {
      const field = parseField(fRaw, fIndex)
      if (seenFieldIds.has(field.id)) {
        throw new TaskSurfaceValidationError(`duplicate field id "${field.id}"`)
      }
      seenFieldIds.add(field.id)
      fields.push(field)
    }
  }

  if (!obj['submit'] || typeof obj['submit'] !== 'object') {
    throw new TaskSurfaceValidationError('submit must be an object { label: string }')
  }
  const submitObj = obj['submit'] as Record<string, unknown>
  const submitLabel = assertString(submitObj['label'], 'submit.label').trim()
  if (submitLabel.length === 0) {
    throw new TaskSurfaceValidationError('submit.label cannot be empty')
  }

  return {
    version: 1,
    title,
    ...(description !== undefined ? { description } : {}),
    sections,
    ...(fields !== undefined ? { fields } : {}),
    submit: { label: submitLabel },
  }
}

/**
 * Validate that submitted field values conform strictly to the declared Task Surface model.
 * @param model - declared surface model.
 * @param values - submitted values key-value map.
 * @param limits - optional configuration bounds.
 */
export function validateSubmission(
  model: TaskSurfaceModelV1,
  values: Record<string, unknown>,
  limits?: TaskSurfaceLimits,
): void {
  const effectiveLimits = { ...DEFAULT_TASK_SURFACE_LIMITS, ...limits }
  const jsonStr = JSON.stringify(values)
  const byteLength = new TextEncoder().encode(jsonStr).length
  if (byteLength > effectiveLimits.maxSubmissionBytes) {
    throw new TaskSurfaceValidationError(
      `submission size ${byteLength} bytes exceeds limit of ${effectiveLimits.maxSubmissionBytes} bytes`,
    )
  }

  const declaredFields = new Map<string, TaskSurfaceField>()
  for (const field of model.fields ?? []) {
    declaredFields.set(field.id, field)
  }

  // Reject undeclared field keys
  for (const key of Object.keys(values)) {
    if (!declaredFields.has(key)) {
      throw new TaskSurfaceValidationError(`unknown submission field "${key}" not declared in model`)
    }
  }

  // Validate declared fields
  for (const [id, field] of declaredFields.entries()) {
    const val = values[id]
    if (val === undefined || val === null) {
      if (field.kind === 'text' && field.required === true) {
        throw new TaskSurfaceValidationError(`required field "${id}" is missing`)
      }
      continue
    }

    switch (field.kind) {
      case 'text': {
        if (typeof val !== 'string') {
          throw new TaskSurfaceValidationError(`field "${id}" value must be a string`)
        }
        if (field.required === true && val.trim().length === 0) {
          throw new TaskSurfaceValidationError(`required field "${id}" cannot be empty`)
        }
        break
      }
      case 'choice': {
        if (typeof val !== 'string') {
          throw new TaskSurfaceValidationError(`choice field "${id}" value must be a string option id`)
        }
        const optionExists = field.options.some(opt => opt.id === val)
        if (!optionExists) {
          throw new TaskSurfaceValidationError(`value "${val}" is not a valid option for choice field "${id}"`)
        }
        break
      }
      case 'multi-choice': {
        if (!Array.isArray(val) || !val.every(item => typeof item === 'string')) {
          throw new TaskSurfaceValidationError(`multi-choice field "${id}" value must be an array of string option ids`)
        }
        const validOptionIds = new Set(field.options.map(opt => opt.id))
        for (const item of val) {
          if (!validOptionIds.has(item)) {
            throw new TaskSurfaceValidationError(`value "${item}" is not a valid option for multi-choice field "${id}"`)
          }
        }
        break
      }
      case 'toggle': {
        if (typeof val !== 'boolean') {
          throw new TaskSurfaceValidationError(`toggle field "${id}" value must be a boolean`)
        }
        break
      }
      case 'order': {
        if (!Array.isArray(val) || !val.every(item => typeof item === 'string')) {
          throw new TaskSurfaceValidationError(`order field "${id}" value must be an array of string option ids`)
        }
        const expectedIds = new Set(field.options.map(opt => opt.id))
        if (val.length !== expectedIds.size || new Set(val).size !== expectedIds.size) {
          throw new TaskSurfaceValidationError(`order field "${id}" must include all declared options exactly once`)
        }
        for (const item of val) {
          if (!expectedIds.has(item)) {
            throw new TaskSurfaceValidationError(`value "${item}" is not a valid option for order field "${id}"`)
          }
        }
        break
      }
    }
  }
}

/**
 * Format submitted values into a readable human prompt string for subsequent turns.
 * @param model - declared surface model.
 * @param values - submitted values.
 * @param note - optional human note.
 * @returns formatted markdown prompt message.
 */
export function formatSubmissionMessage(
  model: TaskSurfaceModelV1,
  values: Record<string, unknown>,
  note?: string,
): string {
  const lines: string[] = [`## ${model.title}`]
  if (model.description !== undefined) {
    lines.push(model.description)
  }
  lines.push('')

  const fields = model.fields ?? []
  if (fields.length > 0) {
    lines.push('### Submitted Values')
    for (const field of fields) {
      const val = values[field.id]
      if (val === undefined || val === null) continue
      let displayVal: string
      if (field.kind === 'choice') {
        const opt = field.options.find(o => o.id === val)
        displayVal = opt ? opt.label : (typeof val === 'string' ? val : JSON.stringify(val))
      } else if (field.kind === 'multi-choice') {
        const arr = val as string[]
        displayVal = arr.length === 0
          ? '(None)'
          : arr
            .map((v) => {
              const opt = field.options.find(o => o.id === v)
              return opt ? opt.label : v
            })
            .join(', ')
      } else if (field.kind === 'order') {
        const arr = val as string[]
        displayVal = arr.length === 0
          ? '(None)'
          : arr
            .map((v, idx) => {
              const opt = field.options.find(o => o.id === v)
              return `${idx + 1}. ${opt ? opt.label : v}`
            })
            .join(', ')
      } else if (field.kind === 'toggle') {
        displayVal = val === true ? 'Yes' : 'No'
      } else {
        displayVal = typeof val === 'string' ? val : JSON.stringify(val)
      }
      lines.push(`- **${field.label}**: ${displayVal}`)
    }
  }

  if (note !== undefined && note.trim().length > 0) {
    lines.push('')
    lines.push(`### Note\n${note.trim()}`)
  }

  return lines.join('\n')
}
