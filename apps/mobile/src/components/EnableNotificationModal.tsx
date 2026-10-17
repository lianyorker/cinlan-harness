import React from 'react'
import { Bell, Sparkles } from 'lucide-react'
import { useAppConfig } from '../context/ThemeLanguageContext'

export interface EnableNotificationModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onEnable: () => void
  readonly onSkip: () => void
}

export const EnableNotificationModal: React.FC<EnableNotificationModalProps> = ({
  isOpen,
  onClose,
  onEnable,
  onSkip,
}) => {
  const { t, language } = useAppConfig()
  const isZh = language === 'zh-CN'

  if (!isOpen) return null

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="enable-notification-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm theme-card border theme-border rounded-3xl p-6 shadow-2xl text-center space-y-4 animate-scale-up"
      >
        {/* Icon */}
        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto shadow-inner">
          <Bell className="w-7 h-7" />
        </div>

        {/* Title & Description */}
        <div className="space-y-2">
          <h3
            id="enable-notification-title"
            className="text-base font-bold theme-text leading-snug px-2"
          >
            {t('notifications.title') || (isZh ? '不要错过智能体需要您的时刻' : 'Never miss when agents need you')}
          </h3>
          <p className="text-xs theme-muted leading-relaxed px-1">
            {t('notifications.desc') ||
              (isZh
                ? '当智能体需要确认高危命令、遇到阻塞或在后台完成任务时，第一时间通过通知提醒您。'
                : 'Get notified immediately when agents request approval or complete tasks in the background.')}
          </p>
          <p className="text-[11px] theme-secondary leading-normal pt-0.5">
            {t('notifications.hint') ||
              (isZh
                ? '您可以在系统设置中随时更改通知偏好。'
                : 'You can adjust notification preferences in settings at any time.')}
          </p>
        </div>

        {/* Actions */}
        <div className="pt-2 space-y-2">
          <button
            type="button"
            onClick={onEnable}
            className="w-full py-3 theme-btn-primary rounded-xl text-xs font-semibold shadow-md transition active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>{t('notifications.enable') || (isZh ? '开启通知' : 'Enable notifications')}</span>
          </button>

          <button
            type="button"
            onClick={onSkip}
            className="w-full py-2.5 theme-muted hover:theme-text text-xs font-medium transition"
          >
            {t('notifications.skip') || (isZh ? '稍后再说' : 'Skip for now')}
          </button>
        </div>
      </div>
    </div>
  )
}
