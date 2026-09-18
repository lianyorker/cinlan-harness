/** Host entry; the keyboard capability owns the durable preference schema. */
import type { Context } from '@deepseek-ai/cordis'

export type { KeyBinding, KeybindingOverride, KeybindingsSettings } from './types.ts'

/** @param _ctx - Host context; this presentation plugin owns no Host service. */
export function apply(_ctx: Context): void {}
