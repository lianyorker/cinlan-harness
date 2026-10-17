import React from 'react'
import { ExternalLink, X, ShieldCheck } from 'lucide-react'
import { useAppConfig } from '../context/ThemeLanguageContext'

export interface ExternalLinkConfirmModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly url?: string
  readonly title?: string
  readonly description?: string
}

export const ExternalLinkConfirmModal: React.FC<ExternalLinkConfirmModalProps> = ({
  isOpen,
  onClose,
  url = 'https://github.com/lianyorker/cinlan-harness/issues',
  title,
  description,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'

  if (!isOpen) return null

  const handleConfirmOpen = () => {
    window.open(url, '_blank')
    onClose()
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-link-title"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm theme-card border theme-border rounded-3xl p-5 shadow-2xl space-y-4 animate-scale-up transition-colors duration-200"
      >
        {/* Header Icon & Close */}
        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-2xl bg-blue-500/15 text-blue-500 flex items-center justify-center">
            <ExternalLink className="w-5 h-5" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 theme-muted hover:theme-text rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition"
            aria-label={isZh ? '取消' : 'Cancel'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Text Content */}
        <div className="space-y-1.5">
          <h2
            id="external-link-title"
            className="text-base font-bold theme-text tracking-tight"
          >
            {title || (isZh ? '打开外部浏览器？' : 'Open external browser?')}
          </h2>
          <p className="text-xs theme-muted leading-relaxed">
            {description ||
              (isZh
                ? '即将离开应用，并在系统默认浏览器中打开支持与反馈页面：'
                : 'You are about to leave the app and open the support page in your default browser:')}
          </p>
        </div>

        {/* URL Box */}
        <div className="p-2.5 rounded-xl theme-card-subtle border theme-border font-mono text-[11px] theme-muted break-all select-all flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="truncate">{url}</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl theme-card-subtle border theme-border text-xs font-semibold theme-text hover:opacity-85 active:scale-[0.98] transition"
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleConfirmOpen}
            className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow-lg shadow-blue-900/30 active:scale-[0.98] transition flex items-center justify-center gap-1.5"
          >
            <span>{isZh ? '打开浏览器' : 'Open Browser'}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
