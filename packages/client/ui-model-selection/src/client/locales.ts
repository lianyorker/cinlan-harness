/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` intentionally matches `trigger.fallback` but remains a
 * separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'defaults.title': '新会话默认值',
  'defaults.model': '默认模型',
  'defaults.reasoning': '推理等级',
  'defaults.scope': '默认值用于新会话。在会话中切换模型也会保存后续会话的默认值；此处的更改不会覆盖已有会话的模型选择。',
  'defaults.reasoningDescription': '使用所选模型支持的推理等级；Default 采用提供方的默认行为。',
  'defaults.unlisted': '未列出的选项：{model}',
  'defaults.unavailable': '此连接未提供新会话默认模型设置。',
  'defaults.readOnly': '此连接的默认模型设置只读。',
  'defaults.loading': '正在加载已保存的默认值…',
  'defaults.catalogError': '无法加载可用模型。请重新加载后再选择。',
  'defaults.catalogPartial': '未能加载全部模型列表。',
  'defaults.reset': '恢复继承值',
  'defaults.saving': '正在保存…',
  'defaults.saved': '已保存',
  'defaults.failed': '未能确认默认值已保存。请重试。',
  'defaults.conflict': '默认值已在其他位置更改。请检查当前值后重试。',
  'defaults.retry': '重试保存',
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '选择模型',
  'trigger.loading': '正在加载模型…',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.aria': '模型与推理等级',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'effort.providerDefault': 'Default',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '当前模型未提供推理等级。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'defaults.title': 'New-session defaults',
  'defaults.model': 'Default model',
  'defaults.reasoning': 'Reasoning effort',
  'defaults.scope': 'Defaults apply to new sessions. Switching a model in a session also saves future defaults; changes here do not overwrite existing session selections.',
  'defaults.reasoningDescription': 'Use an effort supported by the selected model; Default uses the provider’s default behavior.',
  'defaults.unlisted': 'Not listed: {model}',
  'defaults.unavailable': 'This connection does not expose new-session default model settings.',
  'defaults.readOnly': 'Default model settings are read-only on this connection.',
  'defaults.loading': 'Loading saved defaults…',
  'defaults.catalogError': 'Could not load available models. Reload before choosing a model.',
  'defaults.catalogPartial': 'Could not load all model lists.',
  'defaults.reset': 'Reset to inherited',
  'defaults.saving': 'Saving…',
  'defaults.saved': 'Saved',
  'defaults.failed': 'Could not confirm that defaults were saved. Please retry.',
  'defaults.conflict': 'Defaults changed elsewhere. Review the current values and retry.',
  'defaults.retry': 'Retry save',
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.loading': 'Loading models…',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.aria': 'Model and reasoning effort',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model provides no reasoning effort levels.',
} satisfies Record<ModelKey, string>
