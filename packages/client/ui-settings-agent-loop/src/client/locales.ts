/** Locale bundles for the agent loop's General row. */

/** Locale keys the row renders. */
export type AgentLoopSettingsLocaleKey =
  | 'maxParallel' | 'maxParallelHint' | 'reset' | 'increase' | 'decrease'

/** English copy. */
export const en: Record<AgentLoopSettingsLocaleKey, string> = {
  maxParallel: 'Parallel tool calls',
  maxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  reset: 'Reset to default',
  increase: 'Increase parallel calls',
  decrease: 'Decrease parallel calls',
}

/** Simplified Chinese copy. */
export const zh: Record<AgentLoopSettingsLocaleKey, string> = {
  maxParallel: '并行工具调用数',
  maxParallelHint: '同一步内最多同时运行多少个可并行的调用。',
  reset: '恢复默认',
  increase: '增大并行数',
  decrease: '减小并行数',
}
