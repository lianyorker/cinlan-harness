/** Locale bundles for the bot-studio settings section. */

/** Locale keys the section renders. */
export type BotStudioKey =
  | 'nav'
  | 'sectionIntro'
  | 'empty'
  | 'loadError'
  | 'newBot'
  | 'edit'
  | 'delete'
  | 'audit'
  | 'auditEmpty'
  | 'formTitleCreate'
  | 'formTitleEdit'
  | 'fieldId'
  | 'fieldName'
  | 'fieldDescription'
  | 'fieldPersona'
  | 'fieldTools'
  | 'fieldCredentials'
  | 'fieldOrder'
  | 'save'
  | 'cancel'
  | 'saving'

export const en: Record<BotStudioKey, string> = {
  nav: 'Bot studio',
  sectionIntro: 'Compose bots — persona, tools, and credentials — without editing configuration files. Bots register as agent presets.',
  empty: 'No bots yet. Create one to give an agent a persona, a tool set, and scoped credentials.',
  loadError: 'The bot registry is unavailable.',
  newBot: 'New bot',
  edit: 'Edit',
  delete: 'Delete',
  audit: 'Change audit',
  auditEmpty: 'No changes recorded yet.',
  formTitleCreate: 'New bot',
  formTitleEdit: 'Edit bot',
  fieldId: 'Id',
  fieldName: 'Name',
  fieldDescription: 'Description',
  fieldPersona: 'Persona',
  fieldTools: 'Tools',
  fieldCredentials: 'Credentials',
  fieldOrder: 'Order',
  save: 'Save',
  cancel: 'Cancel',
  saving: 'Saving…',
}

export const zh: Record<BotStudioKey, string> = {
  nav: 'Bot 工作室',
  sectionIntro: '不碰配置文件，组合 Bot——人格、工具与凭据。Bot 会注册为 Agent 预设。',
  empty: '还没有 Bot。新建一个，给 Agent 配上人格、工具集和受限凭据。',
  loadError: 'Bot 注册表不可用。',
  newBot: '新建 Bot',
  edit: '编辑',
  delete: '删除',
  audit: '变更审计',
  auditEmpty: '还没有变更记录。',
  formTitleCreate: '新建 Bot',
  formTitleEdit: '编辑 Bot',
  fieldId: '标识',
  fieldName: '名称',
  fieldDescription: '描述',
  fieldPersona: '人格',
  fieldTools: '工具',
  fieldCredentials: '凭据',
  fieldOrder: '排序',
  save: '保存',
  cancel: '取消',
  saving: '保存中…',
}

export const locales: Record<'en' | 'zh', Record<BotStudioKey, string>> = { en, zh }
