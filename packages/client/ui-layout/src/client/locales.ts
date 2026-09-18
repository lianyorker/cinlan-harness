/** Owner-local labels for shell keyboard commands. */
export const zh = { toggleSidebar: '切换侧栏', toggleSidebarDescription: '在主界面聚焦且未编辑文本时展开或收起侧栏。' }
export const en: Record<keyof typeof zh, string> = { toggleSidebar: 'Toggle sidebar', toggleSidebarDescription: 'Expand or collapse the sidebar while the main shell has focus outside text editing.' }
export type LayoutKeyboardKey = keyof typeof zh
