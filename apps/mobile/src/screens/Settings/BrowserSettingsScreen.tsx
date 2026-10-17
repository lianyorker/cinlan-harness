import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, Globe, Check, X } from 'lucide-react'
import { useAppConfig } from '../../context/ThemeLanguageContext'
import {
  type BrowserLinkTarget,
} from '../../mock/mock-data'

export interface BrowserSettingsScreenProps {
  readonly onBack: () => void
}

export const BrowserSettingsScreen: React.FC<BrowserSettingsScreenProps> = ({
  onBack,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'

  const [linkTarget, setLinkTarget] = useState<BrowserLinkTarget>(
    () => localStorage.getItem('cinlan-mobile:browser-target') === 'phone' ? 'phone' : 'desktop',
  )
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const getTargetTitle = (target: BrowserLinkTarget) => {
    if (target === 'desktop') {
      return isZh ? '桌面端内置浏览器' : 'Orca browser on desktop'
    }
    return isZh ? '手机浏览器' : 'Phone browser'
  }

  const getTargetDesc = (target: BrowserLinkTarget) => {
    if (target === 'desktop') {
      return isZh
        ? '在已配对电脑的串流浏览器中打开。'
        : 'Open in the streamed browser from your paired desktop.'
    }
    return isZh
      ? '在手机上的 Safari、Chrome 或其他系统默认浏览器中打开。'
      : 'Open in Safari, Chrome, or another browser on this phone.'
  }

  const handleSelect = (target: BrowserLinkTarget) => {
    setLinkTarget(target)
    localStorage.setItem('cinlan-mobile:browser-target', target)
    setIsDrawerOpen(false)
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
          {isZh ? '浏览器' : 'Browser'}
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-5 overflow-y-auto space-y-4">
        {/* Section Heading: LINKS */}
        <div className="px-0.5 space-y-1">
          <h2 className="text-[11px] font-semibold theme-muted tracking-wider uppercase">
            {isZh ? '链接打开方式' : 'LINKS'}
          </h2>
          <p className="text-xs theme-secondary leading-relaxed">
            {isZh
              ? '选择点击终端输出中的 HTTP(S) 链接时的打开位置。'
              : 'Choose where HTTP(S) links tapped in terminal output open.'}
          </p>
        </div>

        {/* Card: Open terminal links */}
        <div className="theme-card border rounded-2xl overflow-hidden shadow-sm">
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
          >
            <div className="flex items-center gap-3.5 min-w-0 pr-2">
              <span className="w-5 h-5 flex items-center justify-center theme-muted shrink-0">
                <Globe className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-xs font-semibold theme-text">
                  {isZh ? '打开终端链接' : 'Open terminal links'}
                </h3>
                <p className="text-[11px] theme-muted mt-0.5 truncate">
                  {getTargetTitle(linkTarget)}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 theme-muted shrink-0" />
          </button>
        </div>
      </main>

      {/* Bottom Sheet Drawer */}
      {isDrawerOpen && (
        <>
          <div
            role="presentation"
            onClick={() => setIsDrawerOpen(false)}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in"
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 theme-card border-t theme-border rounded-t-3xl max-h-[80vh] p-5 safe-bottom animate-slide-up shadow-2xl space-y-3">
            {/* Handle bar */}
            <div className="w-10 h-1 bg-zinc-600/50 rounded-full mx-auto" />

            {/* Title & Close */}
            <div className="flex items-center justify-between pt-1">
              <h3 className="text-sm font-bold theme-text">
                {isZh ? '打开终端链接' : 'Open terminal links'}
              </h3>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="p-1 theme-muted hover:theme-text rounded-full"
                aria-label={isZh ? '关闭' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Options List */}
            <div className="theme-card-subtle border theme-border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] mt-2">
              {/* Option 1: Desktop */}
              <button
                type="button"
                onClick={() => handleSelect('desktop')}
                className={`w-full p-4 flex items-center justify-between text-left transition ${
                  linkTarget === 'desktop'
                    ? 'bg-black/[0.04] dark:bg-white/[0.05]'
                    : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
                }`}
              >
                <div className="pr-3">
                  <h4 className="text-xs font-bold theme-text">
                    {isZh ? '桌面端内置浏览器' : 'Orca browser on desktop'}
                  </h4>
                  <p className="text-[11px] theme-muted mt-0.5 leading-relaxed">
                    {getTargetDesc('desktop')}
                  </p>
                </div>
                {linkTarget === 'desktop' && (
                  <Check className="w-5 h-5 text-blue-500 shrink-0" />
                )}
              </button>

              {/* Option 2: Phone */}
              <button
                type="button"
                onClick={() => handleSelect('phone')}
                className={`w-full p-4 flex items-center justify-between text-left transition ${
                  linkTarget === 'phone'
                    ? 'bg-black/[0.04] dark:bg-white/[0.05]'
                    : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
                }`}
              >
                <div className="pr-3">
                  <h4 className="text-xs font-bold theme-text">
                    {isZh ? '手机浏览器' : 'Phone browser'}
                  </h4>
                  <p className="text-[11px] theme-muted mt-0.5 leading-relaxed">
                    {getTargetDesc('phone')}
                  </p>
                </div>
                {linkTarget === 'phone' && (
                  <Check className="w-5 h-5 text-blue-500 shrink-0" />
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
