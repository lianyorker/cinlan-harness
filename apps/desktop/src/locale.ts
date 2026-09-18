/** Typed English and Chinese copy owned by the Electron shell. */

export const en = {
  application: 'Application',
  startupFailed: 'DeepSeek Harness could not start',
  startupTitle: 'Opening DeepSeek Harness',
  startupDescription: 'Your workspace will open when preparation is complete.',
  startupOpening: 'Opening the application…',
  startupRecovering: 'Checking the local profile…',
  startupVerifying: 'Verifying application files…',
  startupExtracting: 'Preparing bundled packages…',
  startupInstalling: 'Installing the local runtime…',
  startupChecking: 'Checking the prepared runtime…',
  startupCleaning: 'The background runtime has not stopped. Retrying cleanup…',
  startupActivating: 'Activating the prepared profile…',
  startupHost: 'Starting the workspace…',
  startupLoading: 'Loading your workspace…',
  startupStopping: 'Finishing safely before closing…',
  startupStoppingDetail: 'Waiting for the current operation and background processes to finish.',
  startupFailureDetail: 'Startup stopped. You can restart the application or exit.',
  startupCleanupFailure: 'Background cleanup could not finish. Exit again to retry cleanup.',
  startupDiagnostic: 'Diagnostic file',
  startupDiagnosticUnavailable: 'The diagnostic file could not be saved.',
  startupRestart: 'Restart application',
  startupQuit: 'Exit',
  pluginsMenu: 'Desktop Plugins…',
  pluginsMenuPackagedOnly: 'Desktop Plugins… (available in packaged applications)',
  checkUpdatesMenu: 'Check for Updates…',
  updateCheckFailedTitle: 'Update Check Failed',
  unknownError: 'Unknown error',
  updateCheckTitle: 'Check for Updates',
  updateCurrent: 'You already have the latest version.',
  updateTitle: 'DeepSeek Harness Update',
  updateAvailable: 'An update is available',
  updateDetail: 'DeepSeek Harness {version}\n\nThis release includes its matching dsh version. The application will restart after installation.',
  installAndRestart: 'Install and Restart',
  later: 'Later',
  updateFailedTitle: 'Update Failed',
  pluginManagerTitle: 'Desktop Plugins',
  pluginWindowTitle: 'DeepSeek Harness — Desktop Plugins',
  pluginManagerDescription: 'Plugins are installed only in the Desktop node_modules and are managed by the bundled pnpm.',
  refresh: 'Refresh',
  npmPackage: 'npm package',
  install: 'Install',
  installed: 'Installed',
  noPlugins: 'No Desktop plugins are installed.',
  remove: 'Remove',
  update: 'Update',
  targetVersion: 'Enter the target version for {name}',
  removing: 'Removing {name}…',
  updating: 'Updating {name}…',
  installing: 'Installing {spec}…',
  operationComplete: 'Done. The Desktop backend has restarted.',
  refreshing: 'Refreshing…',
  refreshed: 'Plugin list refreshed.',
  loadingPlugins: 'Reading Desktop plugins…',
} as const

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string }

export const zh = {
  application: '应用',
  startupFailed: 'DeepSeek Harness 无法启动',
  startupTitle: '正在打开 DeepSeek Harness',
  startupDescription: '准备完成后，将自动进入工作区。',
  startupOpening: '正在打开应用…',
  startupRecovering: '正在检查本地配置…',
  startupVerifying: '正在验证应用文件…',
  startupExtracting: '正在准备内置软件包…',
  startupInstalling: '正在安装本地运行环境…',
  startupChecking: '正在检查运行环境…',
  startupCleaning: '后台运行环境尚未停止，正在重试清理…',
  startupActivating: '正在启用准备好的配置…',
  startupHost: '正在启动工作区…',
  startupLoading: '正在加载工作区…',
  startupStopping: '正在安全结束并退出…',
  startupStoppingDetail: '正在等待当前操作和后台进程结束。',
  startupFailureDetail: '启动已停止。您可以重启应用或退出。',
  startupCleanupFailure: '后台清理未能完成。请再次点击退出以重试清理。',
  startupDiagnostic: '诊断文件',
  startupDiagnosticUnavailable: '无法保存诊断文件。',
  startupRestart: '重启应用',
  startupQuit: '退出',
  pluginsMenu: '桌面插件…',
  pluginsMenuPackagedOnly: '桌面插件…（打包应用中可用）',
  checkUpdatesMenu: '检查更新…',
  updateCheckFailedTitle: '更新检查失败',
  unknownError: '未知错误',
  updateCheckTitle: '检查更新',
  updateCurrent: '当前已是最新版本。',
  updateTitle: 'DeepSeek Harness 更新',
  updateAvailable: '发现可用更新',
  updateDetail: 'DeepSeek Harness {version}\n\n新版本绑定匹配的 dsh，安装后将重新启动。',
  installAndRestart: '安装并重启',
  later: '稍后',
  updateFailedTitle: '更新失败',
  pluginManagerTitle: '桌面插件',
  pluginWindowTitle: 'DeepSeek Harness — 桌面插件',
  pluginManagerDescription: '插件只安装到桌面端自己的 node_modules，并由内置 pnpm 管理。',
  refresh: '刷新',
  npmPackage: 'npm 包',
  install: '安装',
  installed: '已安装',
  noPlugins: '还没有安装桌面插件。',
  remove: '移除',
  update: '更新',
  targetVersion: '输入 {name} 的目标版本',
  removing: '正在移除 {name}…',
  updating: '正在更新 {name}…',
  installing: '正在安装 {spec}…',
  operationComplete: '操作完成，桌面后端已重新启动。',
  refreshing: '正在刷新…',
  refreshed: '插件列表已刷新。',
  loadingPlugins: '正在读取桌面插件…',
} as const satisfies DesktopMessages

/** Locale payload exposed to the Desktop-owned renderer. */
export interface DesktopLocale {
  readonly id: 'en' | 'zh-CN'
  readonly messages: DesktopMessages
}

/** Resolve Electron's locale to one shipped Desktop dictionary. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  return locale.toLowerCase().startsWith('zh')
    ? { id: 'zh-CN', messages: zh }
    : { id: 'en', messages: en }
}

/** Replace named placeholders in one locale-owned message. */
export function formatDesktopMessage(
  message: string,
  values: Readonly<Record<string, string>>,
): string {
  return message.replaceAll(/\{([^{}]+)\}/gu, (placeholder, key: string) => values[key] ?? placeholder)
}
