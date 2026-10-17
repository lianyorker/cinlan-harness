import React from 'react'
import { Folder, FolderTree, List, Check } from 'lucide-react'
import { useAppConfig } from '../../context/ThemeLanguageContext'

export type GroupMode = 'workspace' | 'tree' | 'list'

export interface GroupModeDrawerProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly groupMode: GroupMode
  readonly onSelectGroupMode: (mode: GroupMode) => void
}

export const GroupModeDrawer: React.FC<GroupModeDrawerProps> = ({
  isOpen,
  onClose,
  groupMode,
  onSelectGroupMode,
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
        aria-labelledby="group-mode-drawer-title"
        onClick={e => e.stopPropagation()}
        className="w-full theme-card border-t theme-border rounded-t-3xl p-5 pb-8 space-y-4 shadow-2xl safe-bottom animate-slide-up"
      >
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full theme-drag-handle mx-auto" />

        {/* Header */}
        <div className="space-y-1">
          <h3
            id="group-mode-drawer-title"
            className="text-[11px] font-semibold theme-muted tracking-wider uppercase px-1"
          >
            {isZh ? '分组方式' : 'GROUP BY'}
          </h3>

          <div className="theme-card-subtle border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] theme-border">
            {/* 按工作区 (打开只有工作区) */}
            <button
              type="button"
              onClick={() => {
                onSelectGroupMode('workspace')
                onClose()
              }}
              className="w-full p-3.5 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3">
                <Folder className="w-4 h-4 theme-muted" />
                <div>
                  <span className="text-xs font-medium theme-text block">
                    {isZh ? '按工作区' : 'By Workspace'}
                  </span>
                  <span className="text-[10px] theme-muted block mt-0.5">
                    {isZh ? '仅展示工作区目录，点击展开会话' : 'Shows workspace folders only'}
                  </span>
                </div>
              </div>
              {groupMode === 'workspace' && (
                <Check className="w-4 h-4 text-emerald-400" />
              )}
            </button>

            {/* 按工作区树 (展开树) */}
            <button
              type="button"
              onClick={() => {
                onSelectGroupMode('tree')
                onClose()
              }}
              className="w-full p-3.5 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3">
                <FolderTree className="w-4 h-4 theme-muted" />
                <div>
                  <span className="text-xs font-medium theme-text block">
                    {isZh ? '按工作区树 (全部展开)' : 'By Workspace Tree'}
                  </span>
                  <span className="text-[10px] theme-muted block mt-0.5">
                    {isZh ? '展开全部工作区及会话树' : 'Expand all workspaces and sessions'}
                  </span>
                </div>
              </div>
              {groupMode === 'tree' && (
                <Check className="w-4 h-4 text-emerald-400" />
              )}
            </button>

            {/* 单列表 */}
            <button
              type="button"
              onClick={() => {
                onSelectGroupMode('list')
                onClose()
              }}
              className="w-full p-3.5 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3">
                <List className="w-4 h-4 theme-muted" />
                <div>
                  <span className="text-xs font-medium theme-text block">
                    {isZh ? '单列表' : 'Single List'}
                  </span>
                  <span className="text-[10px] theme-muted block mt-0.5">
                    {isZh ? '平铺展示全部会话' : 'Flat list of all sessions'}
                  </span>
                </div>
              </div>
              {groupMode === 'list' && (
                <Check className="w-4 h-4 text-emerald-400" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
