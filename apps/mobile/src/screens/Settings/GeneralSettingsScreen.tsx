import React, { useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  Check,
  Moon,
  Trash2,
  Sun,
  Laptop,
} from 'lucide-react'
import { useAppConfig, type LanguageCode, type ThemeMode } from '../../context/ThemeLanguageContext'
import { loadMobilePreferences, saveMobilePreferences, type BusySendMode, type WorkStepsDisplay } from '../../transport/preferences'

export interface GeneralSettingsScreenProps {
  readonly onBack: () => void
}

export const GeneralSettingsScreen: React.FC<GeneralSettingsScreenProps> = ({
  onBack,
}) => {
  const { language, setLanguage, themeMode, setThemeMode, t, showNotice } = useAppConfig()
  const [isLanguageDrawerOpen, setIsLanguageDrawerOpen] = useState(false)
  const [isThemeDrawerOpen, setIsThemeDrawerOpen] = useState(false)
  const [preferences, setPreferences] = useState(loadMobilePreferences)

  const handleChooseLanguage = (lang: LanguageCode) => {
    setLanguage(lang)
    setIsLanguageDrawerOpen(false)
  }

  const handleChooseTheme = (mode: ThemeMode) => {
    setThemeMode(mode)
    setIsThemeDrawerOpen(false)
  }

  const getLanguageLabel = () => {
    return language === 'zh-CN' ? '简体中文' : 'English'
  }

  const getThemeLabel = () => {
    if (themeMode === 'dark') return language === 'zh-CN' ? '深色' : 'Dark'
    if (themeMode === 'light') return language === 'zh-CN' ? '浅色' : 'Light'
    return language === 'zh-CN' ? '自适应 (跟随系统)' : 'System'
  }

  const isZh = language === 'zh-CN'
  const updatePreference = (key: 'workSteps' | 'busySend', value: WorkStepsDisplay | BusySendMode) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    saveMobilePreferences(next)
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
          {t('settings.general')}
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-5 overflow-y-auto space-y-6">

        {/* Section: Language (语言) */}
        <section className="space-y-2">
          <div className="px-0.5">
            <h2 className="text-[11px] font-semibold theme-muted tracking-wider uppercase">
              {isZh ? '语言设置' : 'LANGUAGE'}
            </h2>
            <p className="text-xs theme-secondary mt-1 leading-relaxed">
              {isZh ? '选择应用界面的显示语言，支持在简体中文与英文之间切换。' : 'Choose your interface language (English & Simplified Chinese).'}
            </p>
          </div>

          <div className="theme-card border rounded-2xl overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => setIsLanguageDrawerOpen(true)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-9 h-9 rounded-xl theme-icon-bg border theme-border flex items-center justify-center theme-text">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold theme-text">
                    {isZh ? '语言' : 'Language'}
                  </h3>
                  <p className="text-[11px] theme-muted mt-0.5">{getLanguageLabel()}</p>
                </div>
              </div>

              <ChevronRight className="w-4 h-4 theme-muted" />
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <div className="px-0.5">
            <h2 className="text-[11px] font-semibold theme-muted tracking-wider uppercase">{isZh ? '工作行为' : 'WORK BEHAVIOR'}</h2>
            <p className="text-xs theme-secondary mt-1 leading-relaxed">{isZh ? '与 Web/Desktop 的会话显示和忙碌发送策略保持一致。' : 'Match Web/Desktop session display and busy-send behavior.'}</p>
          </div>
          <div className="theme-card border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] shadow-sm">
            <label className="p-4 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold theme-text">{isZh ? '工作步骤展示' : 'Work steps display'}</span>
              <select value={preferences.workSteps} onChange={event => updatePreference('workSteps', event.target.value as WorkStepsDisplay)} className="theme-card-subtle border theme-border rounded-lg px-2 py-1 text-xs theme-text">
                <option value="always">{isZh ? '始终显示' : 'Always'}</option>
                <option value="running">{isZh ? '运行时显示' : 'While running'}</option>
                <option value="hidden">{isZh ? '隐藏' : 'Hidden'}</option>
              </select>
            </label>
            <label className="p-4 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold theme-text">{isZh ? '繁忙时的发送行为' : 'Busy send behavior'}</span>
              <select value={preferences.busySend} onChange={event => updatePreference('busySend', event.target.value as BusySendMode)} className="theme-card-subtle border theme-border rounded-lg px-2 py-1 text-xs theme-text">
                <option value="steer">{isZh ? '引导当前任务' : 'Steer current task'}</option>
                <option value="queue">{isZh ? '排队等待' : 'Queue'}</option>
              </select>
            </label>
          </div>
        </section>

        {/* Section: Appearance (外观 - 深色/浅色/自适应) */}
        <section className="space-y-2">
          <div className="px-0.5">
            <h2 className="text-[11px] font-semibold theme-muted tracking-wider uppercase">
              {isZh ? '外观偏好' : 'APPEARANCE'}
            </h2>
            <p className="text-xs theme-secondary mt-1 leading-relaxed">
              {isZh ? '定制视觉外观，支持浅色模式、深色模式及跟随系统偏好。' : 'Customize theme mode: Light, Dark, or Match System.'}
            </p>
          </div>

          <div className="theme-card border rounded-2xl overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => setIsThemeDrawerOpen(true)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-9 h-9 rounded-xl theme-icon-bg border theme-border flex items-center justify-center theme-text">
                  {themeMode === 'light' ? (
                    <Sun className="w-4 h-4 text-amber-500" />
                  ) : themeMode === 'system' ? (
                    <Laptop className="w-4 h-4" />
                  ) : (
                    <Moon className="w-4 h-4 text-indigo-400" />
                  )}
                </div>
                <div>
                  <h3 className="text-xs font-semibold theme-text">
                    {isZh ? '外观' : 'Appearance'}
                  </h3>
                  <p className="text-[11px] theme-muted mt-0.5">{getThemeLabel()}</p>
                </div>
              </div>

              <ChevronRight className="w-4 h-4 theme-muted" />
            </button>
          </div>
        </section>

        {/* Section: Storage (缓存与数据) */}
        <section className="space-y-2">
          <div className="px-0.5">
            <h2 className="text-[11px] font-semibold theme-muted tracking-wider uppercase">
              {isZh ? '存储与数据' : 'STORAGE'}
            </h2>
          </div>

          <div className="theme-card border rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3.5">
              <div className="w-9 h-9 rounded-xl theme-icon-bg border theme-border flex items-center justify-center theme-text">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold theme-text">
                  {isZh ? '清理本地缓存' : 'Clear Cache'}
                </h3>
                <p className="text-[11px] theme-muted mt-0.5">
                  {isZh ? '临时数据 1.2 MB' : '1.2 MB cached'}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled
              title={isZh ? '暂不可用' : 'Unavailable'}
              className="text-xs theme-secondary px-3 py-1.5 rounded-lg border theme-border theme-icon-bg opacity-50 cursor-not-allowed transition"
            >
              {isZh ? '暂不可用' : 'Unavailable'}
            </button>
          </div>
        </section>
      </main>

      {/* Language Bottom Sheet Drawer (语言切换抽屉) */}
      {isLanguageDrawerOpen && (
        <div
          role="presentation"
          onClick={() => setIsLanguageDrawerOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-fade-in"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lang-drawer-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full theme-card border-t rounded-t-3xl p-5 pb-8 space-y-4 shadow-2xl safe-bottom animate-slide-up"
          >
            {/* Top Drag Handle */}
            <div className="w-10 h-1 rounded-full theme-drag-handle mx-auto" />

            <div className="px-1 pt-1">
              <h3 id="lang-drawer-title" className="text-xs font-semibold theme-muted tracking-wide uppercase">
                {isZh ? '语言选择' : 'Language'}
              </h3>
            </div>

            {/* Options List */}
            <div className="theme-card-subtle border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] theme-border">
              {/* Option 1: 简体中文 */}
              <button
                type="button"
                onClick={() => handleChooseLanguage('zh-CN')}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
              >
                <div>
                  <h4 className="text-xs font-bold theme-text">简体中文</h4>
                  <p className="text-[11px] theme-muted mt-0.5">中文 (中国大陆)</p>
                </div>
                {language === 'zh-CN' && (
                  <Check className="w-4 h-4 text-emerald-400" />
                )}
              </button>

              {/* Option 2: English */}
              <button
                type="button"
                onClick={() => handleChooseLanguage('en-US')}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
              >
                <div>
                  <h4 className="text-xs font-bold theme-text">English</h4>
                  <p className="text-[11px] theme-muted mt-0.5">English (United States)</p>
                </div>
                {language === 'en-US' && (
                  <Check className="w-4 h-4 text-emerald-400" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Theme Bottom Sheet Drawer (外观切换抽屉：深色/浅色/自适应) */}
      {isThemeDrawerOpen && (
        <div
          role="presentation"
          onClick={() => setIsThemeDrawerOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-fade-in"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="theme-drawer-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full theme-card border-t rounded-t-3xl p-5 pb-8 space-y-4 shadow-2xl safe-bottom animate-slide-up"
          >
            {/* Top Drag Handle */}
            <div className="w-10 h-1 rounded-full theme-drag-handle mx-auto" />

            <div className="px-1 pt-1">
              <h3 id="theme-drawer-title" className="text-xs font-semibold theme-muted tracking-wide uppercase">
                {isZh ? '外观样式' : 'Appearance'}
              </h3>
            </div>

            {/* Options List */}
            <div className="theme-card-subtle border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] theme-border">
              {/* Option 1: 深色 (Dark) */}
              <button
                type="button"
                onClick={() => handleChooseTheme('dark')}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
              >
                <div className="flex items-center gap-3">
                  <Moon className="w-4 h-4 text-indigo-400" />
                  <div>
                    <h4 className="text-xs font-bold theme-text">
                      {isZh ? '深色' : 'Dark'}
                    </h4>
                    <p className="text-[11px] theme-muted mt-0.5">
                      {isZh ? '始终使用深色模式 (OLED Dark)' : 'Always use dark appearance'}
                    </p>
                  </div>
                </div>
                {themeMode === 'dark' && (
                  <Check className="w-4 h-4 text-emerald-400" />
                )}
              </button>

              {/* Option 2: 浅色 (Light) */}
              <button
                type="button"
                onClick={() => handleChooseTheme('light')}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
              >
                <div className="flex items-center gap-3">
                  <Sun className="w-4 h-4 text-amber-500" />
                  <div>
                    <h4 className="text-xs font-bold theme-text">
                      {isZh ? '浅色' : 'Light'}
                    </h4>
                    <p className="text-[11px] theme-muted mt-0.5">
                      {isZh ? '始终使用明亮浅色模式' : 'Always use light appearance'}
                    </p>
                  </div>
                </div>
                {themeMode === 'light' && (
                  <Check className="w-4 h-4 text-emerald-400" />
                )}
              </button>

              {/* Option 3: 自适应 (System) */}
              <button
                type="button"
                onClick={() => handleChooseTheme('system')}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
              >
                <div className="flex items-center gap-3">
                  <Laptop className="w-4 h-4 theme-muted" />
                  <div>
                    <h4 className="text-xs font-bold theme-text">
                      {isZh ? '自适应' : 'System'}
                    </h4>
                    <p className="text-[11px] theme-muted mt-0.5">
                      {isZh ? '根据系统偏好自动切换浅色/深色' : 'Match system light/dark preference'}
                    </p>
                  </div>
                </div>
                {themeMode === 'system' && (
                  <Check className="w-4 h-4 text-emerald-400" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
