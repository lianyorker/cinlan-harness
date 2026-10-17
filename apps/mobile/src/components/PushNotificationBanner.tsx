import React, { useEffect } from 'react'
import { BellRing, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react'

export interface PushNoticeOptions {
  title?: string
  message: string
  time?: string
  icon?: React.ReactNode
  type?: 'default' | 'success' | 'warning' | 'system'
  duration?: number
}

export interface PushNotificationBannerProps {
  notification: PushNoticeOptions | null
  onClose: () => void
}

export const PushNotificationBanner: React.FC<PushNotificationBannerProps> = ({
  notification,
  onClose,
}) => {
  useEffect(() => {
    if (!notification) return

    const timer = setTimeout(() => {
      onClose()
    }, notification.duration ?? 3500)

    return () => clearTimeout(timer)
  }, [notification, onClose])

  if (!notification) return null

  const renderIcon = () => {
    if (notification.icon) return notification.icon
    switch (notification.type) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-amber-400" />
      case 'system':
        return <Sparkles className="w-4 h-4 text-blue-400" />
      default:
        return <BellRing className="w-4 h-4 text-blue-400 animate-bounce" />
    }
  }

  return (
    <div className="fixed top-3 left-3 right-3 z-[100] flex justify-center pointer-events-none">
      <div
        role="alert"
        onClick={onClose}
        className="w-full max-w-md pointer-events-auto p-3.5 bg-zinc-900/95 border border-zinc-700/80 rounded-2xl shadow-2xl backdrop-blur-md animate-slide-down flex items-start gap-3 select-none cursor-pointer transition-all hover:border-zinc-500 active:scale-[0.99]"
      >
        <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
          {renderIcon()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-white tracking-wide truncate">
              {notification.title || 'Cinlan Harness'}
            </span>
            <span className="text-[10px] text-zinc-400 shrink-0 ml-2">
              {notification.time || '刚刚'}
            </span>
          </div>
          <p className="text-xs text-zinc-300 mt-1 leading-relaxed break-words">
            {notification.message}
          </p>
        </div>
      </div>
    </div>
  )
}
