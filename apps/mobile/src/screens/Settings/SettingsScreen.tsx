import React, { useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Sliders,
  Globe,
  Mic,
  Bell,
  Wrench,
  Info,
  ShieldCheck,
  LifeBuoy,
} from 'lucide-react'
import { GeneralSettingsScreen } from './GeneralSettingsScreen'
import { BrowserSettingsScreen } from './BrowserSettingsScreen'
import { NotificationsSettingsScreen } from './NotificationsSettingsScreen'
import { VoiceSettingsScreen } from './VoiceSettingsScreen'
import { TroubleshootingScreen } from './TroubleshootingScreen'
import { ExternalLinkConfirmModal } from '../../components/ExternalLinkConfirmModal'
import { useAppConfig } from '../../context/ThemeLanguageContext'
import type { HostConnectionSummary } from '../../types'

export interface SettingsScreenProps {
  readonly onBack: () => void
  /** Paired desktops as the transport reports them; empty before the first pairing. */
  readonly hosts?: readonly HostConnectionSummary[]
  /** Last connection error surfaced by the transport; omitted when none. */
  readonly connectionError?: string
}

interface SettingItem {
  readonly id: string
  readonly title: string
  readonly icon: React.ReactNode
  readonly detail?: string
  readonly unavailable?: boolean
}

type SettingsSubpage =
  | 'general'
  | 'browser'
  | 'voice'
  | 'notifications'
  | 'troubleshooting'
  | null

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  onBack,
  hosts = [],
  connectionError = '',
}) => {
  const { t, language, showNotice } = useAppConfig()
  const [activeSubpage, setActiveSubpage] = useState<SettingsSubpage>(null)
  const [isSupportConfirmOpen, setIsSupportConfirmOpen] = useState(false)

  const isZh = language === 'zh-CN'

  if (activeSubpage === 'general') {
    return (
      <GeneralSettingsScreen
        onBack={() => setActiveSubpage(null)}
      />
    )
  }

  if (activeSubpage === 'browser') {
    return (
      <BrowserSettingsScreen
        onBack={() => setActiveSubpage(null)}
      />
    )
  }

  if (activeSubpage === 'notifications') {
    return (
      <NotificationsSettingsScreen
        onBack={() => setActiveSubpage(null)}
        onGoToTroubleshooting={() => setActiveSubpage('troubleshooting')}
      />
    )
  }

  if (activeSubpage === 'voice') {
    return (
      <VoiceSettingsScreen
        onBack={() => setActiveSubpage(null)}
      />
    )
  }

  if (activeSubpage === 'troubleshooting') {
    return (
      <TroubleshootingScreen
        onBack={() => setActiveSubpage(null)}
        hosts={hosts}
        error={connectionError}
      />
    )
  }

  const group1: readonly SettingItem[] = [
    {
      id: 'general',
      title: t('settings.general'),
      icon: <Sliders className="w-4 h-4" />,
      detail: isZh ? '外观主题、语言偏好、存储与基础参数' : 'Theme, language, storage and basic settings',
    },
    {
      id: 'browser',
      title: t('settings.browser'),
      icon: <Globe className="w-4 h-4" />,
      detail: isZh ? '网络检索与页面内容提取策略' : 'Web search and page content extraction policies',
    },
    {
      id: 'voice',
      title: t('settings.voice'),
      icon: <Mic className="w-4 h-4" />,
      detail: isZh ? '语音输入听写与自然语言交互模式' : 'Voice dictation and natural language interactions',
    },
    {
      id: 'notifications',
      title: t('settings.notifications'),
      icon: <Bell className="w-4 h-4" />,
      detail: isZh ? '闲置 3 分钟后推送完成提醒与重要事件' : 'Notify when agents finish or need assistance',
    },
    {
      id: 'troubleshooting',
      title: t('settings.troubleshooting'),
      icon: <Wrench className="w-4 h-4" />,
      detail: isZh ? '局域网连接诊断、Relay 检查与日志' : 'Network diagnostics and session logs',
    },
    {
      id: 'about',
      title: t('settings.about'),
      icon: <Info className="w-4 h-4" />,
      detail: 'Cinlan Mobile v0.2.1 • All-Plugin Architecture',
    },
  ]

  const group2: readonly SettingItem[] = [
    {
      id: 'privacy',
      title: t('settings.privacy'),
      icon: <ShieldCheck className="w-4 h-4" />,
      detail: isZh ? '端到端局域网通信，数据仅在授权桌面持久化' : 'End-to-end encrypted local network communication',
    },
    {
      id: 'support',
      title: t('settings.support'),
      icon: <LifeBuoy className="w-4 h-4" />,
      detail: isZh ? '社区问答、官方文档与 GitHub' : 'Community, documentation, and GitHub',
    },
  ]

  const handleItemClick = (item: SettingItem) => {
    if (item.id === 'general') {
      setActiveSubpage('general')
      return
    }
    if (item.id === 'browser') {
      setActiveSubpage('browser')
      return
    }
    if (item.id === 'voice') {
      setActiveSubpage('voice')
      return
    }
    if (item.id === 'notifications') {
      setActiveSubpage('notifications')
      return
    }
    if (item.id === 'troubleshooting') {
      setActiveSubpage('troubleshooting')
      return
    }
    if (item.id === 'support') {
      setIsSupportConfirmOpen(true)
      return
    }
    showNotice({
      title: item.title,
      message: item.detail ?? (isZh ? '功能已启用' : 'Enabled'),
      type: 'system',
    })
  }

  return (
    <div className="flex flex-col min-h-screen theme-bg theme-text select-none transition-colors duration-200">
      {/* Header */}
      <header className="safe-top px-4 pt-3 pb-3 flex items-center gap-2 border-b theme-border">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 -ml-1 text-zinc-400 hover:theme-text rounded-full hover:bg-zinc-800/40 active:scale-95 transition"
          aria-label={isZh ? '返回' : 'Back'}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-bold tracking-tight theme-text">{t('settings.title')}</h1>
      </header>

      {/* Main List */}
      <main className="flex-1 px-4 py-5 overflow-y-auto space-y-4">
        {/* Group 1 Card */}
        <div className="theme-card border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] theme-border shadow-sm">
          {group1.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.unavailable}
              title={item.unavailable ? (isZh ? '暂不可用' : 'Unavailable') : undefined}
              onClick={() => handleItemClick(item)}
              className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3.5">
                <span className="w-5 h-5 flex items-center justify-center theme-muted">
                  {item.icon}
                </span>
                <span className="text-xs font-medium theme-text">{item.title}</span>
              </div>
              <ChevronRight className="w-4 h-4 theme-muted" />
            </button>
          ))}
        </div>

        {/* Group 2 Card */}
        <div className="theme-card border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] theme-border shadow-sm">
          {group2.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleItemClick(item)}
              className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3.5">
                <span className="w-5 h-5 flex items-center justify-center theme-muted">
                  {item.icon}
                </span>
                <span className="text-xs font-medium theme-text">{item.title}</span>
              </div>
              <ChevronRight className="w-4 h-4 theme-muted" />
            </button>
          ))}
        </div>
      </main>

      {/* 支持与反馈：确认打开外部浏览器弹窗 */}
      <ExternalLinkConfirmModal
        isOpen={isSupportConfirmOpen}
        onClose={() => setIsSupportConfirmOpen(false)}
        url="https://github.com/lianyorker/cinlan-harness/issues"
      />
    </div>
  )
}
