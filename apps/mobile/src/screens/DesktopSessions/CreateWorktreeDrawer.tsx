import React, { useState } from 'react'
import { ChevronDown, Folder, Sparkles } from 'lucide-react'
import { useAppConfig } from '../../context/ThemeLanguageContext'
import type { WorkspaceGroup } from '../../mock/mock-data'

export interface CreateWorktreeDrawerProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly workspaces: readonly WorkspaceGroup[]
  readonly desktopName: string
  readonly onCreate: (data: {
    workspaceId: string
    sessionTitle: string
  }) => Promise<void>
}

export const CreateWorktreeDrawer: React.FC<CreateWorktreeDrawerProps> = ({
  isOpen,
  onClose,
  workspaces,
  onCreate,
}) => {
  const { t, language } = useAppConfig()
  const isZh = language === 'zh-CN'

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(
    workspaces[0]?.id ?? '',
  )
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!isOpen) return null

  const currentWorkspace =
    workspaces.find(w => w.id === selectedWorkspaceId) ?? workspaces[0]

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const title = workspaceName.trim()
      ? workspaceName.trim()
      : `${currentWorkspace?.name ?? '会话'} · 新任务`
    if (busy) return
    setBusy(true); setError('')
    try {
      await onCreate({ workspaceId: currentWorkspace?.id ?? '', sessionTitle: title })
      setWorkspaceName(''); onClose()
    } catch (_createFailed) { setError(isZh ? '创建失败，请重试' : 'Creation failed') }
    finally { setBusy(false) }
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-worktree-title"
        onClick={e => e.stopPropagation()}
        className="w-full theme-card border-t theme-border rounded-t-3xl p-5 pb-8 space-y-4 shadow-2xl safe-bottom max-h-[85vh] overflow-y-auto animate-slide-up"
      >
        {/* Drag Handle */}
        <div className="w-10 h-1 rounded-full theme-drag-handle mx-auto" />

        {/* Title */}
        <div className="pt-1">
          <h2
            id="create-worktree-title"
            className="text-base font-bold theme-text tracking-tight"
          >
            {isZh ? '新建会话' : 'Create session'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
          {/* Field 1: Project (从已有目录中选择) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold theme-muted block">
              {isZh ? '项目 (选择已有目录)' : 'Project'}
            </label>
            <div className="theme-card-subtle border theme-border rounded-xl overflow-hidden transition-all">
              {/* Trigger Header */}
              <button
                type="button"
                onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
                className="w-full p-3.5 flex items-center justify-between text-left text-xs theme-text hover:bg-black/[0.02] dark:hover:bg-white/[0.02] active:opacity-80 transition"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="font-semibold truncate">
                    {currentWorkspace?.name ??
                      (isZh ? '请选择已有项目目录' : 'Select project directory')}
                  </span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 theme-muted shrink-0 transition-transform duration-200 ${
                    isProjectDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* In-place project selection list */}
              {isProjectDropdownOpen && (
                <div className="border-t theme-border divide-y divide-[var(--border-line)] bg-transparent animate-fade-in">
                  {workspaces.map((ws) => {
                    const isSelected = ws.id === selectedWorkspaceId
                    return (
                      <button
                        key={ws.id}
                        type="button"
                        onClick={() => {
                          setSelectedWorkspaceId(ws.id)
                          setIsProjectDropdownOpen(false)
                        }}
                        className={`w-full px-3.5 py-3 text-xs text-left theme-text flex items-center justify-between transition ${
                          isSelected
                            ? 'bg-emerald-500/[0.08] font-semibold text-emerald-500'
                            : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04] active:bg-black/[0.05] dark:active:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Folder className="w-3.5 h-3.5 theme-muted shrink-0" />
                          <span className="truncate">{ws.name}</span>
                        </div>
                        {isSelected && (
                          <span className="text-emerald-500 font-bold shrink-0 ml-2">✓</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Field 2: Session title [Optional] */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold theme-muted block">
              {isZh ? '会话名称 [可选]' : 'Session title [Optional]'}
            </label>
            <input
              type="text"
              value={workspaceName}
              onChange={e => setWorkspaceName(e.target.value)}
              placeholder={
                isZh ? '输入名称或搜索源...' : 'Type a name or search a source'
              }
              className="w-full p-3.5 theme-card-subtle border theme-border rounded-xl text-xs theme-text placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition"
            />
          </div>

          {/* Submit Action Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3.5 theme-btn-primary rounded-xl font-bold text-xs shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>{isZh ? '创建会话' : 'Create session'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
