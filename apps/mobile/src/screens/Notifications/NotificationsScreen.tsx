import React, { useEffect, useState } from 'react'
import { ChevronLeft, Check, BellOff } from 'lucide-react'
import { CinlanLogo } from '../../components/CinlanLogo'
import { useAppConfig } from '../../context/ThemeLanguageContext'

export interface NotificationsScreenProps {
  readonly onEnableNotifications: () => void
  readonly onSkip: () => void
  readonly onBack?: () => void
}

type PermissionState = NotificationPermission | 'unsupported'

const readPermission = (): PermissionState => {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/**
 * Ask for the phone's real notification permission and report what the browser
 * answered. The page never claims permission it did not get: an unsupported or
 * denied result keeps the primary action available with the reason shown.
 */
export const NotificationsScreen: React.FC<NotificationsScreenProps> = ({
  onEnableNotifications,
  onSkip,
  onBack,
}) => {
  const { t, language } = useAppConfig()
  const isZh = language === 'zh-CN'
  const [permission, setPermission] = useState<PermissionState>(readPermission)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    // Permission can change in the phone's settings while this page is open.
    if (typeof Notification === 'undefined') return
    const sync = (): void => { setPermission(Notification.permission) }
    sync()
    return () => {}
  }, [])

  const granted = permission === 'granted'

  const handleEnable = async (): Promise<void> => {
    if (permission === 'unsupported') { onSkip(); return }
    setRequesting(true)
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result === 'granted') onEnableNotifications()
    } finally {
      setRequesting(false)
    }
  }

  const statusText = (): string => {
    if (permission === 'unsupported') {
      return isZh
        ? '当前浏览器不支持系统通知，连接后仍可在应用内查看智能体进度。'
        : 'This browser does not support system notifications; agent progress stays visible in the app.'
    }
    if (granted) {
      return isZh
        ? '已获得系统通知权限，智能体需要确认或完成时会提醒你。'
        : 'System notification permission is granted for agent approvals and completions.'
    }
    if (permission === 'denied') {
      return isZh
        ? '系统已拒绝通知权限，请在手机的浏览器设置中重新允许后回到本页。'
        : 'Notification permission is blocked. Allow it in the phone browser settings, then return here.'
    }
    return isZh
      ? '尚未授予系统通知权限，点下方按钮向系统请求。'
      : 'System notification permission has not been granted yet.'
  }

  return (
    <div className="flex flex-col min-h-screen theme-bg theme-text select-none transition-colors duration-200">
      {/* Top Header */}
      <header className="safe-top px-4 pt-3 pb-3 flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="p-1 -ml-1 theme-muted hover:theme-text rounded-full hover:bg-zinc-800/30 transition"
            aria-label={isZh ? '返回' : 'Back'}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        ) : (
          <div className="w-6" />
        )}

        <div className="flex items-center gap-2">
          <CinlanLogo className="w-5 h-4 theme-text" />
          <span className="font-bold text-base tracking-tight theme-text">Cinlan</span>
        </div>

        {/* Step indicator dots */}
        <div className="flex items-center gap-1.5 pr-2">
          <span className="w-1.5 h-1.5 rounded-full theme-muted" />
          <span className="w-3.5 h-1.5 rounded-full theme-btn-primary" />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-6 pt-6 pb-8 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-6">
          {/* Real permission status card */}
          <div className="p-3.5 theme-card border rounded-2xl flex items-start gap-3 shadow-md">
            <div className="w-8 h-8 rounded-xl theme-icon-bg border theme-border flex items-center justify-center shrink-0 mt-0.5">
              {granted ? <Check className="w-4 h-4 text-emerald-400" /> : <BellOff className="w-4 h-4 theme-muted" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] theme-muted font-medium">
                {isZh ? '系统权限' : 'System permission'}
              </div>
              <h4 className="text-xs font-bold theme-text mt-0.5" role="status">
                {granted
                  ? isZh ? '已授权' : 'Allowed'
                  : permission === 'denied'
                    ? isZh ? '已被拒绝' : 'Blocked'
                    : permission === 'unsupported'
                      ? isZh ? '系统不支持' : 'Not supported'
                      : isZh ? '尚未请求' : 'Not requested'}
              </h4>
              <p className="text-[11px] theme-muted mt-0.5">{statusText()}</p>
            </div>
          </div>

          {/* Copy description */}
          <div className="space-y-2 pt-2">
            <h1 className="text-xl font-bold tracking-tight theme-text leading-snug">
              {t('notifications.title')}
            </h1>
            <p className="text-xs theme-muted leading-relaxed">
              {t('notifications.desc')}
            </p>
            <p className="text-[11px] theme-secondary leading-normal pt-2">
              {isZh
                ? '通知由这台手机的系统权限决定，主机侧的设置只决定发送哪些提醒。'
                : "Delivery depends on this phone's system permission; the desktop only decides which alerts are sent."}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-6 space-y-2">
          <button
            type="button"
            onClick={() => { void handleEnable() }}
            disabled={requesting || granted}
            className={`w-full py-3.5 rounded-2xl text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-[0.98] disabled:opacity-60 ${
              granted
                ? 'theme-card text-emerald-400 border border-emerald-500/40'
                : 'theme-btn-primary shadow-lg'
            }`}
          >
            {granted ? <Check className="w-4 h-4 text-emerald-400" /> : null}
            <span>
              {granted
                ? isZh ? '通知权限已开启' : 'Notifications Enabled'
                : requesting
                  ? isZh ? '等待系统响应…' : 'Waiting for the system…'
                  : permission === 'denied'
                    ? isZh ? '重新请求权限' : 'Request permission again'
                    : t('notifications.enable')}
            </span>
          </button>

          <button
            type="button"
            onClick={onSkip}
            className="w-full py-2.5 theme-muted hover:theme-text text-xs font-medium transition"
          >
            {t('notifications.skip')}
          </button>
        </div>
      </main>
    </div>
  )
}
