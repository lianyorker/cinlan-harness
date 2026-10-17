import React from 'react'
import { ArrowUpDown, Clock, Check } from 'lucide-react'
import { useAppConfig } from '../../context/ThemeLanguageContext'

export type SortMode = 'manual' | 'recent'

export interface SortModeDrawerProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly sortMode: SortMode
  readonly onSelectSortMode: (mode: SortMode) => void
}

export const SortModeDrawer: React.FC<SortModeDrawerProps> = ({
  isOpen,
  onClose,
  sortMode,
  onSelectSortMode,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'

  if (!isOpen) return null

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sort-mode-drawer-title"
        onClick={e => e.stopPropagation()}
        className="w-full theme-card border-t theme-border rounded-t-3xl p-5 pb-8 space-y-4 shadow-2xl safe-bottom animate-slide-up"
      >
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full theme-drag-handle mx-auto" />

        {/* Header */}
        <div className="space-y-1">
          <h3
            id="sort-mode-drawer-title"
            className="text-[11px] font-semibold theme-muted tracking-wider uppercase px-1"
          >
            {isZh ? '排序方式' : 'SORT BY'}
          </h3>

          <div className="theme-card-subtle border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] theme-border">
            {/* 手动排序 */}
            <button
              type="button"
              onClick={() => {
                onSelectSortMode('manual')
                onClose()
              }}
              className="w-full p-3.5 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3">
                <ArrowUpDown className="w-4 h-4 theme-muted" />
                <div>
                  <span className="text-xs font-medium theme-text block">
                    {isZh ? '手动排序' : 'Manual Sort'}
                  </span>
                  <span className="text-[10px] theme-muted block mt-0.5">
                    {isZh ? '固定原有顺序，置顶会话居首' : 'Keep default order, pinned first'}
                  </span>
                </div>
              </div>
              {sortMode === 'manual' && (
                <Check className="w-4 h-4 text-emerald-400" />
              )}
            </button>

            {/* 最近更新 */}
            <button
              type="button"
              onClick={() => {
                onSelectSortMode('recent')
                onClose()
              }}
              className="w-full p-3.5 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 theme-muted" />
                <div>
                  <span className="text-xs font-medium theme-text block">
                    {isZh ? '最近更新' : 'Recently Updated'}
                  </span>
                  <span className="text-[10px] theme-muted block mt-0.5">
                    {isZh ? '按活跃时间倒序排列' : 'Sort by latest activity'}
                  </span>
                </div>
              </div>
              {sortMode === 'recent' && (
                <Check className="w-4 h-4 text-emerald-400" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
