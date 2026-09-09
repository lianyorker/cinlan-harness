/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '返回应用',
  'search.placeholder': '搜索设置...',
  'search.noResults': '没有匹配的设置',
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
  'openDocument': 'Open configuration file',
  'openDocument.fileManager': 'Show in Explorer',
  'openDocument.default': 'Open in default editor',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
} satisfies Record<SettingsKey, string>
