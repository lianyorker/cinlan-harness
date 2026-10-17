import React, { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useAppConfig } from '../../context/ThemeLanguageContext'

export interface NotificationsSettingsScreenProps {
  readonly onBack: () => void
  readonly onGoToTroubleshooting?: () => void
}

/** The phone's real system-notification permission, owner of delivery status. */
type SystemPermission = NotificationPermission | 'unsupported'

const readSystemPermission = (): SystemPermission =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission

export const NotificationsSettingsScreen: React.FC<NotificationsSettingsScreenProps> = ({
  onBack,
  onGoToTroubleshooting,
}) => {
  const { language, showNotice } = useAppConfig()
  const isZh = language === 'zh-CN'

  const [enableNotifications, setEnableNotifications] = useState(
    () => localStorage.getItem('cinlan-mobile:notifications-enabled') !== 'false',
  )
  const [systemPermission, setSystemPermission] = useState<SystemPermission>(readSystemPermission)
  // The system can revoke or grant permission outside the app; a preference is
  // not delivery. Re-read on mount so the status line never invents consent.
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    setSystemPermission(Notification.permission)
  }, [])
  const [onlyWhenAway, setOnlyWhenAway] = useState(
    () => localStorage.getItem('cinlan-mobile:notifications-away') === 'true',
  )
  const [notificationSound, setNotificationSound] = useState(
    () => localStorage.getItem('cinlan-mobile:notifications-sound') !== 'false',
  )
  const [suppressWhileFocused, setSuppressWhileFocused] = useState(
    () => localStorage.getItem('cinlan-mobile:notifications-focused') === 'true',
  )

  const handleToggleEnable = () => {
    const nextVal = !enableNotifications
    setEnableNotifications(nextVal)
    localStorage.setItem('cinlan-mobile:notifications-enabled', String(nextVal))
    if (nextVal) {
      showNotice({
        title: isZh ? '通知偏好' : 'Notifications',
        message: isZh ? '已开启智能体消息推送通知' : 'Agent push notifications enabled',
        type: 'system',
      })
    } else {
      showNotice({
        title: isZh ? '通知偏好' : 'Notifications',
        message: isZh ? '已关闭消息推送通知' : 'Notifications disabled',
        type: 'warning',
      })
    }
  }

  const handleOpenSettings = async (): Promise<void> => {
    if (typeof Notification === 'undefined') {
      showNotice({ title: isZh ? '系统设置' : 'System Settings', message: isZh ? '当前浏览器不支持系统通知，无法请求权限。' : 'This browser has no system notification support to request.', type: 'warning' })
      return
    }
    const result = await Notification.requestPermission()
    setSystemPermission(result)
    if (result === 'granted') {
      showNotice({ title: isZh ? '通知权限' : 'Notification permission', message: isZh ? '系统已授予通知权限。' : 'The system granted notification permission.', type: 'system' })
    } else {
      showNotice({ title: isZh ? '通知权限' : 'Notification permission', message: isZh ? '系统仍未允许通知。请在本机浏览器设置里手动开启。' : 'The system still blocks notifications. Enable them in this browser settings.', type: 'warning' })
    }
  }

  const handleSendTestNotification = () => {
    showNotice({ title: isZh ? '通知测试' : 'Notification test', message: isZh ? '手机端通知服务尚未接通，未发送虚假成功结果。' : 'Mobile push service is not connected; no fake success was reported.', type: 'warning' })
  }

  return (
    <div className="flex flex-col min-h-screen theme-bg theme-text select-none relative transition-colors duration-200">
      {/* Top Header */}
      <header className="safe-top px-4 pt-3 pb-3 flex items-center gap-2 border-b theme-border">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 -ml-1 text-zinc-400 hover:theme-text rounded-full hover:bg-zinc-800/40 active:scale-95 transition"
          aria-label={isZh ? '返回设置' : 'Back to Settings'}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-bold tracking-tight theme-text">
          {isZh ? '通知' : 'Notifications'}
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-5 overflow-y-auto space-y-4">

        {/* Card 1: Enable notifications */}
        <div className="theme-card border rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold theme-text">
              {isZh ? '启用通知' : 'Enable notifications'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={enableNotifications}
              onClick={handleToggleEnable}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
                enableNotifications ? 'bg-blue-600' : 'bg-zinc-700/60'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  enableNotifications ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <p className="text-[11px] theme-muted leading-relaxed">
            {systemPermission === 'unsupported'
              ? isZh
                ? '当前浏览器不支持系统通知，应用内仍会显示智能体进度。'
                : 'This browser does not support system notifications; agent progress stays visible in the app.'
              : systemPermission === 'denied'
                ? isZh
                  ? '系统已拒绝通知权限。请在手机浏览器设置中允许后回到本页。'
                  : 'Notification permission is blocked. Allow it in the phone browser settings, then return here.'
                : systemPermission === 'granted'
                  ? isZh
                    ? '系统已授予通知权限，智能体离线时将正常收到提醒。'
                    : 'System permission is granted; alerts arrive while agents run in the background.'
                  : isZh
                    ? '尚未授予系统通知权限，开关只决定是否接收提醒。'
                    : 'System permission has not been granted yet; the switch only decides whether alerts are sent.'}
          </p>

          <div>
            <button
              type="button"
              onClick={handleOpenSettings}
              className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-xs font-medium text-white transition shadow-sm"
            >
              {isZh ? '打开系统设置' : 'Open Settings'}
            </button>
          </div>
        </div>

        {/* Card 2: Detailed toggles */}
        <div className="theme-card border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] shadow-sm">
          {/* Item 1: Only when away from desktop */}
          <div className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0 pr-2">
              <h3 className="text-xs font-semibold theme-text">
                {isZh ? '仅离开电脑时通知' : 'Only when away from desktop'}
              </h3>
              <p className="text-[11px] theme-muted mt-0.5 leading-relaxed">
                {isZh
                  ? '无键盘或鼠标操作 3 分钟后，或电脑锁屏状态时。'
                  : 'After 3 minutes without keyboard or mouse activity, or when locked.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={onlyWhenAway}
              onClick={() => {
                const next = !onlyWhenAway
                setOnlyWhenAway(next)
                localStorage.setItem('cinlan-mobile:notifications-away', String(next))
              }}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                onlyWhenAway ? 'bg-blue-600' : 'bg-zinc-700/60'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  onlyWhenAway ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Item 2: Notification sound */}
          <div className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0 pr-2">
              <h3 className="text-xs font-semibold theme-text">
                {isZh ? '通知提示音' : 'Notification sound'}
              </h3>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={notificationSound}
              onClick={() => {
                const next = !notificationSound
                setNotificationSound(next)
                localStorage.setItem('cinlan-mobile:notifications-sound', String(next))
              }}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                notificationSound ? 'bg-blue-600' : 'bg-zinc-700/60'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  notificationSound ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Item 3: Suppress while focused */}
          <div className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0 pr-2">
              <h3 className="text-xs font-semibold theme-text">
                {isZh ? '聚焦会话时静音' : 'Suppress while focused'}
              </h3>
              <p className="text-[11px] theme-muted mt-0.5 leading-relaxed">
                {isZh
                  ? '手机当前正打开的工作区静音提醒。'
                  : 'Skip alerts for the workspace open on this phone.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={suppressWhileFocused}
              onClick={() => {
                const next = !suppressWhileFocused
                setSuppressWhileFocused(next)
                localStorage.setItem('cinlan-mobile:notifications-focused', String(next))
              }}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                suppressWhileFocused ? 'bg-blue-600' : 'bg-zinc-700/60'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  suppressWhileFocused ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footnote text */}
        <p className="text-[11px] theme-muted px-1 leading-relaxed">
          {isZh
            ? '提醒类型遵循各配对电脑的通知设置。若超过 7 天未使用本应用，通知将自动暂停；打开应用并重新连接即可恢复。'
            : "Alert types follow each paired desktop's notification settings. Notifications pause after 7 days without using this app; open it and reconnect to resume."}
        </p>

        {/* Section: Having trouble receiving alerts? */}
        <div className="pt-2 px-0.5 space-y-2">
          <h2 className="text-xs font-bold theme-text">
            {isZh ? '接收提醒遇到问题？' : 'Having trouble receiving alerts?'}
          </h2>
          <p className="text-[11px] theme-muted leading-relaxed">
            {isZh
              ? '通过 Cinlan 的消息推送服务发送一条测试提醒。'
              : "Send a test through Orca's push service."}
          </p>

          <div className="pt-1">
            <button
              type="button"
              onClick={handleSendTestNotification}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-xs font-medium text-white transition shadow-sm"
            >
              {isZh ? '发送测试通知' : 'Send test notification'}
            </button>
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={onGoToTroubleshooting}
              className="text-xs text-zinc-400 hover:text-white underline font-medium transition"
            >
              {isZh ? '故障排除' : 'Troubleshooting'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
