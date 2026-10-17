import React, { useState } from 'react'
import {
  ChevronLeft,
  AlertCircle,
} from 'lucide-react'
import { useAppConfig } from '../../context/ThemeLanguageContext'

/** Dictation trigger: press once to start and stop, or dictate while held. */
type DictationMode = 'toggle' | 'hold'

export interface VoiceSettingsScreenProps {
  readonly onBack: () => void
}

export const VoiceSettingsScreen: React.FC<VoiceSettingsScreenProps> = ({
  onBack,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'

  const [enableDictation, setEnableDictation] = useState(
    () => localStorage.getItem('cinlan-mobile:voice-enabled') === 'true',
  )
  const [dictationMode, setDictationMode] = useState<DictationMode>(
    () => localStorage.getItem('cinlan-mobile:voice-mode') === 'hold' ? 'hold' : 'toggle',
  )

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
          {isZh ? '语音' : 'Voice'}
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-5 overflow-y-auto space-y-6">

        {/* Section 1: DICTATION TRIGGER */}
        <section className="space-y-2">
          <div className="px-0.5">
            <h2 className="text-[11px] font-semibold theme-muted tracking-wider uppercase">
              {isZh ? '听写输入' : 'DICTATION'}
            </h2>
          </div>

          <div className="theme-card border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] shadow-sm">
            {/* Enable Voice Dictation */}
            <div className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0 pr-2">
                <h3 className="text-xs font-semibold theme-text">
                  {isZh ? '启用语音听写' : 'Enable Voice Dictation'}
                </h3>
                <p className="text-[11px] theme-muted mt-0.5 leading-relaxed">
                  {isZh
                    ? '在电脑当前聚焦的窗口中听写输入文本。'
                    : 'Dictate text into any focused pane on your desktop.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enableDictation}
                onClick={() => {
                  const next = !enableDictation
                  setEnableDictation(next)
                  localStorage.setItem('cinlan-mobile:voice-enabled', String(next))
                }}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                  enableDictation ? 'bg-blue-600' : 'bg-zinc-700/60'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    enableDictation ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Dictation Mode */}
            <div className="p-4 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 pr-2">
                  <h3 className="text-xs font-semibold theme-text">
                    {isZh ? '听写模式' : 'Dictation Mode'}
                  </h3>
                  <p className="text-[11px] theme-muted mt-0.5 leading-relaxed">
                    {isZh
                      ? '单次点击：按一次开始，再按一次停止。长按：按住时听写。'
                      : 'Toggle: press once to start, again to stop. Hold: dictate while held.'}
                  </p>
                </div>

                {/* Toggle | Hold Segmented control */}
                <div className="bg-zinc-900 border border-zinc-800 p-1 rounded-xl flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setDictationMode('toggle')
                      localStorage.setItem('cinlan-mobile:voice-mode', 'toggle')
                    }}
                    className={`px-3 py-1 rounded-lg text-xs transition ${
                      dictationMode === 'toggle'
                        ? 'bg-zinc-800 text-white font-semibold shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Toggle
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDictationMode('hold')
                      localStorage.setItem('cinlan-mobile:voice-mode', 'hold')
                    }}
                    className={`px-3 py-1 rounded-lg text-xs transition ${
                      dictationMode === 'hold'
                        ? 'bg-zinc-800 text-white font-semibold shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Hold
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: SPEECH MODEL */}
        <section className="space-y-2">
          <div className="px-0.5">
            <h2 className="text-[11px] font-semibold theme-muted tracking-wider uppercase">
              {isZh ? '语音模型' : 'SPEECH MODEL'}
            </h2>
          </div>

          {/* The relay protocol exposes no voice method, so the phone cannot list
              or switch desktop models; it reports the gap instead of inventing one. */}
          <div className="theme-card border rounded-2xl p-4 shadow-sm flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h3 className="text-xs font-semibold theme-text">
                {isZh ? '模型管理不可用' : 'Model management unavailable'}
              </h3>
              <p className="text-[11px] theme-muted mt-1 leading-relaxed">
                {isZh
                  ? '手机端尚未接通桌面端的语音模型接口，无法列出、下载或切换语音识别模型。请在 Web 或桌面端的语音设置中管理模型。'
                  : 'The phone has no route to the desktop voice model interface, so it cannot list, download, or switch speech models. Manage models in the Web or desktop voice settings.'}
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
