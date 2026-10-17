import React, { useState } from 'react'
import {
  Monitor,
  QrCode,
  Plus,
  Settings,
  MoreVertical,
  LogOut,
  RefreshCw,
} from 'lucide-react'
import { CinlanLogo } from '../../components/CinlanLogo'
import type { DesktopDevice } from '../../mock/mock-data'
import { useAppConfig } from '../../context/ThemeLanguageContext'

export interface DashboardScreenProps {
  readonly desktops: readonly DesktopDevice[]
  readonly sessionsCount: number
  readonly onOpenSettings: () => void
  readonly onPairAnother: () => void
  readonly onNewWorkspace?: () => void
  readonly onOpenDesktop: (desktopId: string) => void
  readonly onReconnect: (desktopId: string) => void
  readonly onDisconnect: (desktopId: string) => void
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  onOpenSettings,
  onPairAnother,
  onNewWorkspace,
  onOpenDesktop,
  desktops,
  sessionsCount,
  onReconnect,
  onDisconnect,
}) => {
  const { t, language } = useAppConfig()
  const [showDesktopMenu, setShowDesktopMenu] = useState<string | null>(null)
  const isZh = language === 'zh-CN'

  return (
    <div className="flex flex-col min-h-screen theme-bg theme-text select-none transition-colors duration-200">
      {/* Top Header */}
      <header className="safe-top px-5 pt-3 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CinlanLogo className="w-5 h-4 theme-text" />
          <span className="font-bold text-base tracking-tight theme-text">Cinlan</span>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="p-2 -mr-2 text-zinc-400 hover:theme-text rounded-full hover:bg-zinc-800/40 active:scale-95 transition"
          aria-label={isZh ? '设置' : 'Settings'}
        >
          <Settings className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-5 pt-2 pb-8 overflow-y-auto space-y-6">
        {/* Title */}
        <section>
          <h1 className="text-[26px] font-bold tracking-tight theme-text">
            {t('dashboard.welcome')}
          </h1>
        </section>

        {/* 2-Column Stats Row (会话已创建 + 手机端运行时间) */}
        <section className="theme-card border rounded-2xl p-4 grid grid-cols-2 divide-x theme-border shadow-sm">
          <div className="px-3 text-center">
            <div className="text-lg font-bold theme-text font-mono">
              {sessionsCount}
            </div>
            <div className="text-[11px] theme-muted mt-1 truncate">
              {t('dashboard.stat_sessions')}
            </div>
          </div>
          <div className="px-3 text-center">
            <div className="text-lg font-bold theme-text font-mono tracking-tight">
              {'--'}
            </div>
            <div className="text-[11px] theme-muted mt-1 truncate">
              {t('dashboard.stat_time')}
            </div>
          </div>
        </section>

        {/* Desktops Section */}
        <section className="space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-[10px] font-semibold theme-muted tracking-wider uppercase">
              {t('dashboard.desktops_header')}
            </h2>
          </div>

          {desktops.map(desktop => <div className="relative" key={desktop.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpenDesktop(desktop.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenDesktop(desktop.id) }}
              className="w-full p-3.5 theme-card border rounded-2xl flex items-center justify-between text-left transition cursor-pointer shadow-sm hover:opacity-90"
            >
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-xl theme-icon-bg border theme-border flex items-center justify-center theme-text shrink-0">
                  <Monitor className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold theme-text truncate">{desktop.name}</h3>
                  </div>
                  <div className="text-[10px] theme-muted mt-0.5">{desktop.os}</div>
                  <div className="flex items-center gap-1.5 text-[10px] theme-secondary mt-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${desktop.isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
                    <span>{`${desktop.isConnected ? (isZh ? '已连接' : 'Connected') : (isZh ? '已断开' : 'Disconnected')} · ${desktop.connectionType}`}</span>
                  </div>
                  <div className="text-[10px] theme-muted mt-0.5">
                    {isZh ? `${desktop.workspaceCount} 个工作区` : `${desktop.workspaceCount} workspaces`}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDesktopMenu(showDesktopMenu === desktop.id ? null : desktop.id)
                }}
                className="p-1.5 theme-muted hover:theme-text rounded-lg hover:bg-zinc-800/30 transition"
                aria-label={isZh ? '更多操作' : 'More'}
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>

            {/* Desktop Quick Dropdown Menu */}
            {showDesktopMenu === desktop.id && (
              <>
                <div
                  role="presentation"
                  onClick={() => setShowDesktopMenu(null)}
                  className="fixed inset-0 z-20"
                />
                <div className="absolute right-2 top-14 z-30 w-44 theme-card border theme-border rounded-2xl shadow-2xl overflow-hidden divide-y divide-[var(--border-line)] text-xs animate-fade-in">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDesktopMenu(null)
                      if (desktop.isConnected) onOpenDesktop(desktop.id)
                      else onReconnect(desktop.id)
                    }}
                    className="w-full px-3.5 py-2.5 flex items-center gap-2.5 theme-text hover:bg-black/[0.03] dark:hover:bg-white/[0.04] text-left transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                    <span>{desktop.isConnected ? (isZh ? '查看会话列表' : 'View Sessions') : (isZh ? '重新连接' : 'Reconnect')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDesktopMenu(null)
                      onDisconnect(desktop.id)
                    }}
                    className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-rose-500 hover:bg-rose-500/10 text-left transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{isZh ? '断开连接' : 'Disconnect'}</span>
                  </button>
                </div>
              </>
            )}
          </div>)}
          {desktops.length === 0 && <div className="py-8 text-center text-xs theme-muted">{isZh ? '暂无已连接桌面' : 'No connected desktops'}</div>}
        </section>

        {/* Quick Actions Section */}
        <section className="space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-[10px] font-semibold theme-muted tracking-wider uppercase">
              {t('dashboard.quick_actions')}
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onPairAnother}
              className="p-3.5 theme-card border rounded-2xl flex items-center justify-center gap-2 text-xs font-medium theme-text transition active:scale-[0.98] shadow-sm hover:opacity-90"
            >
              <QrCode className="w-4 h-4 theme-muted" />
              <span>{t('dashboard.pair_desktop')}</span>
            </button>

            <button
              type="button"
              onClick={onNewWorkspace}
              className="p-3.5 theme-card border rounded-2xl flex items-center justify-center gap-2 text-xs font-medium theme-text transition active:scale-[0.98] shadow-sm hover:opacity-90"
            >
              <Plus className="w-4 h-4 theme-muted" />
              <span>{t('dashboard.new_workspace')}</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
