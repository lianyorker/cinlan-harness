/** Host loader entry for the browser-only Tool UI plugin. */
// Declared first: the client sessions facade must win the Cordis Context merge over the Host store augmentation.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** Provides no host-side behavior. */
export function apply(): void {}
