/**
 * Authoritative durable quick-command records, validated on read and mutation.
 * A command whose text or working directory cannot be trusted is a command
 * that must not be run, so an unparsable record never reaches a terminal.
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { QuickCommandId, QuickCommandRecord } from './types.ts'

const recordSchema = z.strictObject({
  id: z.string().min(1).max(128),
  // Hosts are addressed by their own opaque id; the local machine uses the
  // reserved `local`, so an empty id is always a bug rather than a default.
  hostId: z.string().min(1).max(256),
  name: z.string().trim().min(1).max(120),
  command: z.string().min(1).max(8192),
  description: z.string().trim().max(400).optional(),
  cwd: z.string().min(1).max(4096).optional(),
  confirm: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

/** Storage domain holding every saved quick command. */
export const quickCommandsDomain = defineDomain({
  name: 'terminal_quick_commands', version: 1,
  tables: { commands: domainTable<QuickCommandId, QuickCommandRecord>(recordSchema) },
})

/** Reserved host id for the machine running the Host. */
export const LOCAL_QUICK_COMMAND_HOST = 'local'

/** Outcome of validating a user-supplied draft. */
export type DraftValidation =
  | { readonly ok: true; readonly name: string; readonly command: string; readonly cwd?: string; readonly description?: string }
  | { readonly ok: false; readonly reason: 'invalid-name' | 'invalid-command' | 'invalid-cwd' }

/**
 * Validate a user-supplied command before it is stored.
 * @param name - Label the menu shows.
 * @param command - Text sent to the terminal.
 * @param cwd - Optional working directory override.
 * @param description - Optional description shown beside the label.
 * @returns the normalized fields, or the reason the draft is unusable.
 */
export function validateDraft(
  name: string,
  command: string,
  cwd: string | undefined,
  description: string | undefined,
): DraftValidation {
  const trimmedName = name.trim()
  if (trimmedName.length === 0 || trimmedName.length > 120) return { ok: false, reason: 'invalid-name' }
  if (command.trim().length === 0 || command.length > 8192) return { ok: false, reason: 'invalid-command' }
  const trimmedDescription = description?.trim()
  if (trimmedDescription !== undefined && trimmedDescription.length > 400) return { ok: false, reason: 'invalid-name' }
  if (cwd !== undefined) {
    const trimmedCwd = cwd.trim()
    if (trimmedCwd.length === 0 || trimmedCwd.length > 4096) return { ok: false, reason: 'invalid-cwd' }
    return {
      ok: true, name: trimmedName, command, cwd: trimmedCwd,
      ...trimmedDescription === undefined || trimmedDescription === '' ? {} : { description: trimmedDescription },
    }
  }
  return {
    ok: true, name: trimmedName, command,
    ...trimmedDescription === undefined || trimmedDescription === '' ? {} : { description: trimmedDescription },
  }
}
