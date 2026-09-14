/** Floating Workspace settings locale dictionaries (zh + en). */

export const zh = {
  navLabel: '浮动工作区',
  title: '浮动工作区',
  description: '配置浮动面板和侧边栏切换行为。',
  enable: '启用浮动工作区',
  enableDescription: '允许侧边栏标签页浮动为独立面板。',
  terminalDirectory: '终端默认目录',
  terminalDirectoryDescription: '新终端标签页的工作目录（空则使用项目根目录）。',
  terminalDirectoryPlaceholder: '例如 /home/user/projects',
  toggleButtonPosition: '切换按钮位置',
  toggleButtonPositionDescription: '侧边栏展开/折叠按钮的显示位置。',
  toggleButtonPositionHeader: '会话头部',
  toggleButtonPositionSidebar: '侧边栏边缘',
  toggleButtonPositionFloating: '浮动面板',
  floatDefaultSize: '浮动面板默认大小',
  floatDefaultSizeDescription: '新浮动面板的初始宽度和高度（像素）。',
  floatDefaultWidth: '宽度',
  floatDefaultHeight: '高度',
  loading: '正在读取设置…',
  error: '设置读取失败。',
} satisfies Record<string, string>

export type FloatingWorkspaceSettingsKey = keyof typeof zh

export const en = {
  navLabel: 'Floating Workspace',
  title: 'Floating Workspace',
  description: 'Configure floating panels and sidebar toggle behavior.',
  enable: 'Enable Floating Workspace',
  enableDescription: 'Allow sidebar tabs to float as independent panels.',
  terminalDirectory: 'Terminal Default Directory',
  terminalDirectoryDescription: 'Working directory for new terminal tabs (empty uses project root).',
  terminalDirectoryPlaceholder: 'e.g. /home/user/projects',
  toggleButtonPosition: 'Toggle Button Position',
  toggleButtonPositionDescription: 'Where the sidebar expand/collapse button appears.',
  toggleButtonPositionHeader: 'Conversation Header',
  toggleButtonPositionSidebar: 'Sidebar Edge',
  toggleButtonPositionFloating: 'Floating Panel',
  floatDefaultSize: 'Float Default Size',
  floatDefaultSizeDescription: 'Initial width and height for new floating panels (pixels).',
  floatDefaultWidth: 'Width',
  floatDefaultHeight: 'Height',
  loading: 'Loading settings...',
  error: 'Failed to load settings.',
} satisfies Record<string, string>
