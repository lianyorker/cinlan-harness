/** Current-window layout settings copy. */
export const zh = {
  nav: '工作区布局',
  description: '调整当前窗口的工作区列宽，不影响会话内容',
  scope: '仅对当前窗口生效，重新加载后恢复默认；不会同步到其他桌面、Web 或手机窗口',
  sidebar: '左侧栏宽度',
  sidebarDescription: '调整后使用该宽度；窄屏仍自动收起，展开后可见',
  rightbar: '右侧面板宽度',
  rightbarDescription: '关闭时也可预设宽度；打开面板后生效，实际宽度随可用空间缩减',
  responsive: '窄屏会自动收起左侧栏；右侧面板空间不足时关闭，调节宽度不会强制打开面板',
  reset: '恢复默认列宽',
  resetDescription: '恢复左侧栏默认宽度和右侧面板自适应初始宽度，不清除会话或面板标签页',
  pixels: '{value} px',
}

/** English copy for the same layout controls. */
export const en: Record<keyof typeof zh, string> = {
  nav: 'Workspace layout',
  description: 'Adjust workspace columns in this window without changing session content',
  scope: 'Applies only to this window and resets on reload. Other desktop, Web and phone windows are not synced.',
  sidebar: 'Left sidebar width',
  sidebarDescription: 'Uses this width after adjustment. Narrow screens still collapse the sidebar until expanded.',
  rightbar: 'Right panel width',
  rightbarDescription: 'Can be set while closed. Applies when opened; available space may reduce the rendered width.',
  responsive: 'Narrow screens collapse the left sidebar. The right panel closes when space is insufficient; changing its width does not force it open.',
  reset: 'Reset column widths',
  resetDescription: 'Restore the default sidebar and adaptive initial right panel width without clearing sessions or panel tabs.',
  pixels: '{value} px',
}
