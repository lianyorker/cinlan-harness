/** Paired-phone shell copy. */
export const en = {
  title: 'Paired session',
  sessions: 'Authorized sessions',
  choose: 'Choose a session',
  loading: 'Loading authorized sessions…',
  empty: 'No sessions are shared with this device.',
  unavailable: 'This operation is unavailable on a paired device.',
} satisfies Record<string, string>

/** Dictionary keys owned by the paired shell. */
export type PairedShellKey = keyof typeof en

/** Simplified Chinese shell copy. */
export const zh: Record<PairedShellKey, string> = {
  title: '配对会话',
  sessions: '已授权会话',
  choose: '选择会话',
  loading: '正在加载已授权会话…',
  empty: '尚未向此设备共享会话。',
  unavailable: '配对设备不支持此操作。',
}
