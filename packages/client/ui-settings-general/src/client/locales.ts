/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '返回应用',
  'search.placeholder': '搜索设置...',
  'search.noResults': '没有匹配的设置',
  'search.title': '搜索结果',
  'search.description': '搜索页面与具体设置，选择结果可直接定位。',
  'search.clear': '清除搜索',
  'search.showResults': '查看搜索结果',
  'search.shortcut': 'Ctrl / ⌘ K',
  'navigation.open': '打开设置导航',
  'navigation.close': '关闭设置导航',
  'navigation.label': '设置导航',
  'group.personal': '个人偏好',
  'group.ai': 'AI 与模型',
  'group.development': '开发工作流',
  'group.tools': '工具与设备',
  'group.extensions': '扩展管理',
  'group.experimental': '实验',
  'general.description': '界面、会话与默认权限，让 Cinlan 更适合你的工作习惯。',
  'openDocument': '打开配置文件',
  'openDocument.fileManager': '在 Explorer 中定位',
  'openDocument.default': '用默认编辑器打开',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Back to app',
  'search.placeholder': 'Search settings...',
  'search.noResults': 'No matching settings',
  'search.title': 'Search results',
  'search.description': 'Find pages and individual settings, then jump to the matching control.',
  'search.clear': 'Clear search',
  'search.showResults': 'Show search results',
  'search.shortcut': 'Ctrl / ⌘ K',
  'navigation.open': 'Open settings navigation',
  'navigation.close': 'Close settings navigation',
  'navigation.label': 'Settings navigation',
  'group.personal': 'Personal preferences',
  'group.ai': 'AI & models',
  'group.development': 'Development workflow',
  'group.tools': 'Tools & devices',
  'group.extensions': 'Extensions',
  'group.experimental': 'Experimental',
  'general.description': 'Customize the interface, conversations, and default permissions for your work.',
  'openDocument': 'Open configuration file',
  'openDocument.fileManager': 'Show in Explorer',
  'openDocument.default': 'Open in default editor',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
} satisfies Record<SettingsKey, string>
