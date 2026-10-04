/**
 * Durable preferences this entry publishes to the settings document.
 *
 * The document serves only a schema that carries a volatile field, so the
 * Host entry registers this wrapper; consumers keep reading plain values
 * through {@link FloatingWorkspaceSettingsSchema} and the served namespace.
 * The former deployment-only window-observation cadence is gone with the
 * separate app window.
 */
import { FloatingWorkspaceSettingsSchema } from './schema.ts'

/** Live-editable registration schema for this entry. */
export const Config = FloatingWorkspaceSettingsSchema.volatile()
