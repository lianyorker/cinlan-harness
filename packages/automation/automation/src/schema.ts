/** Validation at Remote, queued, and durable automation JSON boundaries. */
import { z } from 'zod'
import type { AutomationDefinition, AutomationDraft, AutomationRun, AutomationSchedule, AutomationSpec, AutomationUpdate } from './types.ts'

const minute = z.number().int().min(0).max(59)
const hour = z.number().int().min(0).max(23)
const text = z.string().min(1)
const time = z.number().int().nonnegative()
/** UTC minute schedules; arbitrary cron and timezone fields reject. */
export const scheduleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hourly'), minute }),
  z.strictObject({ kind: z.literal('daily'), hour, minute }),
  z.strictObject({ kind: z.literal('weekly'), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine(days => new Set(days).size === days.length, 'weekdays must be unique'), hour, minute }),
]) as z.ZodType<AutomationSchedule>
const model = z.strictObject({ provider: text, model: text, reasoningEffort: text.optional() })
const draftFields = { title: text, prompt: text, workspaceId: text, agentPresetId: text,
  model, permissionPresetId: text, schedule: scheduleSchema }
/** Explicit editable fields; saved scope and authority are Host-owned. */
export const draftSchema = z.strictObject(draftFields) as unknown as z.ZodType<AutomationDraft>
/** Resolved immutable execution inputs. */
export const specSchema = z.strictObject({
  ...draftFields, workspacePath: text,
  permission: z.strictObject({ sandbox: z.enum(['read-only', 'workspace-write',
    'danger-full-access']), approval: z.enum(['ask', 'never']) }),
}) as unknown as z.ZodType<AutomationSpec>
/** Full revision-fenced edit. */
export const updateSchema = z.strictObject({ id: text, expectedRevision: z.number().int().positive(),
  draft: draftSchema, enabled: z.boolean() }) as unknown as z.ZodType<AutomationUpdate>
/** Persisted definition parser. */
export const definitionSchema = z.strictObject({
  id: text, revision: z.number().int().positive(), scheduleRevision: z.number().int().positive(), spec: specSchema,
  enabled: z.boolean(), needsReview: z.boolean(), nextPlannedAt: time.nullable(),
  createdAt: time, updatedAt: time, deletedAt: time.nullable(),
}) as unknown as z.ZodType<AutomationDefinition>
/** Persisted invocation parser. */
export const runSchema = z.strictObject({
  id: text, automationId: text, definitionRevision: z.number().int().positive(),
  scheduleRevision: z.number().int().positive(), spec: specSchema,
  trigger: z.enum(['scheduled', 'manual']), requestId: text.nullable(),
  plannedAt: time, sessionId: text.nullable(), messageId: text.nullable(),
  turn: z.number().int().nonnegative().nullable(), status: z.enum(['starting',
    'running', 'stopping', 'completed', 'failed', 'cancelled', 'skipped-overlap',
    'interrupted', 'ambiguous']),
  reason: z.string().nullable(), createdAt: time, updatedAt: time, finishedAt: time.nullable(),
}) as unknown as z.ZodType<AutomationRun>
