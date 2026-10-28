import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Folder,
  Search,
  ArrowUpDown,
  ChevronsUpDown,
  Pin,
  MoreHorizontal,
  Plus,
  X,
  Archive,
} from 'lucide-react'
import type { WorkspaceGroup, SessionItem, DesktopDevice } from '../../types'
import { useAppConfig } from '../../context/ThemeLanguageContext'
import { CreateWorktreeDrawer } from './CreateWorktreeDrawer'
import { GroupModeDrawer, type GroupMode } from './GroupModeDrawer'
import { SortModeDrawer, type SortMode } from './SortModeDrawer'

export interface DesktopSessionsScreenProps {
  readonly desktopId?: string
  readonly desktop?: DesktopDevice
  readonly workspaces: readonly WorkspaceGroup[]
  readonly onCreateSession: (workspaceId: string, title: string) => Promise<void>
  readonly onBack: () => void
  readonly onSelectSession: (sessionId: string, sessionTitle: string) => void
  readonly onNewSession?: () => void
  readonly initialOpenCreate?: boolean
}

export const DesktopSessionsScreen: React.FC<DesktopSessionsScreenProps> = ({
  desktopId,
  desktop,
  workspaces,
  onCreateSession,
  onBack,
  onSelectSession,
  initialOpenCreate = false,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'

  const resolvedDesktop = desktop ?? { id: desktopId ?? '', name: 'Desktop', os: '' }

  // Workspaces and sessions state
  const [workspacesState, setWorkspacesState] = useState<WorkspaceGroup[]>(
    () => [...workspaces],
  )
  useEffect(() => setWorkspacesState([...workspaces]), [workspaces])

  // Accordion state: "按工作区打开只有工作区" -> 默认全部折叠，仅显示工作区目录
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<
    Record<string, boolean>
  >(() => {
    const initial: Record<string, boolean> = {}
    workspaces.forEach((ws) => {
      initial[ws.id] = false
    })
    return initial
  })

  // Search state (固定在条件栏右侧)
  const [isSearching, setIsSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Group and Sort state
  const [groupMode, setGroupMode] = useState<GroupMode>('workspace')
  const [sortMode, setSortMode] = useState<SortMode>('manual')

  // Drawers state
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(initialOpenCreate)
  const [isGroupDrawerOpen, setIsGroupDrawerOpen] = useState(false)
  const [isSortDrawerOpen, setIsSortDrawerOpen] = useState(false)
  const [_actionSession, setActionSession] = useState<SessionItem | null>(null)
  const [_isActionDrawerOpen, setIsActionDrawerOpen] = useState(false)

  // Long press timer ref for touch interaction
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const _handleTouchStart = (session: SessionItem) => {
    longPressTimerRef.current = setTimeout(() => {
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(40)
        }
      } catch {}
      setActionSession(session)
      setIsActionDrawerOpen(true)
    }, 500)
  }

  const handleTouchEndOrMove = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const _handleOpenActionDrawer = (session: SessionItem, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    setActionSession(session)
    setIsActionDrawerOpen(true)
  }

  const toggleWorkspace = (id: string) => {
    setExpandedWorkspaces(prev => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const isAllCollapsed = useMemo(() => {
    return Object.values(expandedWorkspaces).every(val => val === false)
  }, [expandedWorkspaces])

  const toggleCollapseAll = () => {
    const targetState = isAllCollapsed
    const updated: Record<string, boolean> = {}
    workspacesState.forEach((ws) => {
      updated[ws.id] = targetState
    })
    setExpandedWorkspaces(updated)
  }

  const handleSelectGroupMode = (mode: GroupMode) => {
    setGroupMode(mode)
    if (mode === 'workspace') {
      // 按工作区模式：折叠所有，仅显示工作区
      const updated: Record<string, boolean> = {}
      workspacesState.forEach((ws) => {
        updated[ws.id] = false
      })
      setExpandedWorkspaces(updated)
    } else if (mode === 'tree') {
      // 树形模式：展开所有
      const updated: Record<string, boolean> = {}
      workspacesState.forEach((ws) => {
        updated[ws.id] = true
      })
      setExpandedWorkspaces(updated)
    }
  }

  // Create Worktree handler
  const handleCreateSession = async (data: {
    workspaceId: string
    sessionTitle: string
  }) => {
    await onCreateSession(data.workspaceId, data.sessionTitle)
  }

  // Process sorting and search filtering
  const processedWorkspaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return workspacesState
      .map((ws) => {
        let list = [...ws.sessions]

        // 搜索过滤
        if (query) {
          const wsMatches = ws.name.toLowerCase().includes(query)
          if (!wsMatches) {
            list = list.filter(s => s.title.toLowerCase().includes(query))
          }
        }

        // 排序方式：手动排序 vs 最近更新
        list.sort((a, b) => {
          // 置顶会话永远排在首位
          if (a.isPinned && !b.isPinned) return -1
          if (!a.isPinned && b.isPinned) return 1

          if (sortMode === 'recent') {
            // 最近更新：按时间倒序
            return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
          }

          // 手动排序：保持原有手动顺序
          return 0
        })

        return {
          ...ws,
          sessions: list,
        }
      })
      .filter((ws) => {
        if (query) {
          return ws.sessions.length > 0 || ws.name.toLowerCase().includes(query)
        }
        return true
      })
  }, [workspacesState, searchQuery, sortMode])

  // Flat list mode
  const flattenedSessions = useMemo(() => {
    const flat: Array<{ session: SessionItem; workspaceName: string }> = []
    processedWorkspaces.forEach((ws) => {
      ws.sessions.forEach((s) => {
        flat.push({ session: s, workspaceName: ws.name })
      })
    })
    return flat
  }, [processedWorkspaces])

  return (
    <div className="flex flex-col min-h-screen theme-bg theme-text select-none relative transition-colors duration-200">
      {/* 1. Top Header (简洁，搜索已移入下方条件栏) */}
      <header className="safe-top px-4 pt-3 pb-2 flex items-center justify-between border-b theme-border bg-transparent z-20">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 -ml-1 theme-muted hover:theme-text rounded-full hover:bg-zinc-800/30 active:scale-95 transition"
            aria-label={isZh ? '返回仪表盘' : 'Back to Dashboard'}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <h1 className="text-sm font-bold tracking-tight theme-text">
                {resolvedDesktop.name}
              </h1>
            </div>
            <p className="text-[11px] theme-muted leading-tight mt-0.5 ml-4">
              {resolvedDesktop.os}
            </p>
          </div>
        </div>

        {/* 占位平衡 */}
        <div className="w-6" />
      </header>

      {/* 2. 条件栏 (包含分组方式、排序方式、快速展开/折叠，搜索固定在右侧) */}
      <div className="px-3 py-2 border-b theme-border flex items-center gap-2 bg-transparent shrink-0">
        {/* 左侧可滚动条件胶囊 */}
        <div className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
          {/* Chip 1: 分组方式 (点击打开独立分组抽屉) */}
          <button
            type="button"
            onClick={() => setIsGroupDrawerOpen(true)}
            className="px-3 py-1.5 rounded-full border text-xs flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition theme-card theme-border theme-text font-medium"
          >
            <Folder className="w-3.5 h-3.5 theme-muted" />
            <span>
              {groupMode === 'workspace'
                ? (isZh ? '按工作区' : 'Workspace')
                : groupMode === 'tree'
                  ? (isZh ? '按工作区树' : 'Tree')
                  : (isZh ? '单列表' : 'List')}
            </span>
          </button>

          {/* Chip 2: 排序方式 (点击打开独立排序抽屉) */}
          <button
            type="button"
            onClick={() => setIsSortDrawerOpen(true)}
            className="px-3 py-1.5 rounded-full border text-xs flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition theme-card theme-border theme-text font-medium"
          >
            <ArrowUpDown className="w-3.5 h-3.5 theme-muted" />
            <span>
              {sortMode === 'manual'
                ? (isZh ? '手动排序' : 'Manual')
                : (isZh ? '最近更新' : 'Recent')}
            </span>
          </button>

          {/* Chip 3: 快速展开 / 快速折叠 (直接切换，无抽屉) */}
          <button
            type="button"
            onClick={toggleCollapseAll}
            className="px-3 py-1.5 rounded-full border text-xs flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition theme-card theme-border theme-muted hover:theme-text"
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
            <span>
              {isAllCollapsed
                ? (isZh ? '快速展开' : 'Expand')
                : (isZh ? '快速折叠' : 'Collapse')}
            </span>
          </button>
        </div>

        {/* 右侧固定搜索按钮 (固定在最右侧，带左侧极细分割线) */}
        <div className="shrink-0 pl-1 border-l theme-border flex items-center">
          <button
            type="button"
            onClick={() => setIsSearching(!isSearching)}
            className={`p-1.5 rounded-full transition active:scale-90 ${
              isSearching || searchQuery
                ? 'theme-btn-primary shadow-sm'
                : 'theme-card border theme-border theme-muted hover:theme-text'
            }`}
            aria-label={isZh ? '搜索会话' : 'Search'}
            title={isZh ? '搜索' : 'Search'}
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 3. 展开搜索输入框 */}
      {isSearching && (
        <div className="px-4 py-2 border-b theme-border theme-card animate-fade-in flex items-center gap-2">
          <Search className="w-4 h-4 theme-muted" />
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={
              isZh ? '搜索工作区或会话...' : 'Search workspaces or sessions...'
            }
            className="flex-1 bg-transparent border-none text-xs theme-text placeholder-zinc-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="p-1 theme-muted hover:theme-text"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* 4. 会话列表展示主体 */}
      <main className="flex-1 overflow-y-auto px-4 py-3 pb-28 space-y-4">
        {groupMode === 'list' ? (
          /* 单列表平铺模式 */
          <div className="space-y-1">
            {flattenedSessions.map(({ session, workspaceName }) => (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSession(session.id, session.title)}

                onTouchEnd={handleTouchEndOrMove}
                onTouchMove={handleTouchEndOrMove}

                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSelectSession(session.id, session.title)
                }}
                className={`w-full py-3 px-3 rounded-xl flex items-center justify-between text-left hover:bg-white/[0.04] active:bg-white/[0.08] transition cursor-pointer select-none ${
                  session.isPinned
                    ? 'bg-amber-500/[0.04] border border-amber-500/20'
                    : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                  {session.isPinned && (
                    <Pin className="w-3.5 h-3.5 text-amber-400 rotate-45 shrink-0" />
                  )}
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />

                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium theme-text block truncate">
                      {session.title}
                    </span>
                    <span className="text-[10px] theme-muted block truncate mt-0.5">
                      {workspaceName}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {session.timestamp && (
                    <span className="text-[11px] theme-muted whitespace-nowrap">
                      {session.timestamp}
                    </span>
                  )}
                  {session.isArchived && (
                    <Archive className="w-3.5 h-3.5 theme-muted" />
                  )}
                  <button
                    type="button"
                    disabled title={isZh ? '暂不可用' : 'Unavailable'}
                    className="p-1 theme-muted hover:theme-text rounded-lg"
                    aria-label="操作"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* 工作区模式 (按工作区打开只有工作区，点击展开) */
          processedWorkspaces.map((workspace) => {
            const isExpanded = expandedWorkspaces[workspace.id] ?? false

            return (
              <div key={workspace.id} className="space-y-1.5">
                {/* 工作区文件夹头部 */}
                <button
                  type="button"
                  onClick={() => toggleWorkspace(workspace.id)}
                  className="w-full py-2 px-1 flex items-center justify-between text-left theme-muted hover:theme-text transition active:opacity-75"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 shrink-0 theme-muted" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0 theme-muted" />
                    )}
                    <Folder className="w-4 h-4 shrink-0 theme-muted" />
                    <span className="text-xs font-semibold tracking-wide uppercase theme-text truncate">
                      {workspace.name}
                    </span>
                  </div>

                  <span className="text-[10px] theme-muted px-2 py-0.5 rounded-full theme-card-subtle border theme-border font-mono">
                    {workspace.sessions.length}
                  </span>
                </button>

                {/* 展开的会话列表 */}
                {isExpanded && (
                  <div className="space-y-1 pl-3 animate-fade-in">
                    {workspace.sessions.length === 0 ? (
                      <div className="py-2.5 px-3 text-[11px] theme-muted italic">
                        {isZh ? '暂无会话记录' : 'No active sessions'}
                      </div>
                    ) : (
                      workspace.sessions.map(session => (
                        <div
                          key={session.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectSession(session.id, session.title)}

                          onTouchEnd={handleTouchEndOrMove}
                          onTouchMove={handleTouchEndOrMove}

                          onKeyDown={(e) => {
                            if (e.key === 'Enter')
                              onSelectSession(session.id, session.title)
                          }}
                          className={`w-full py-3 px-3 rounded-xl flex items-center justify-between text-left hover:bg-white/[0.04] active:bg-white/[0.08] transition cursor-pointer select-none ${
                            session.isPinned
                              ? 'bg-amber-500/[0.04] border border-amber-500/20'
                              : ''
                          }`}
                        >
                          {/* 会话左侧图标与标题 */}
                          <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                            {session.isPinned && (
                              <Pin className="w-3.5 h-3.5 text-amber-400 rotate-45 shrink-0" />
                            )}
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />

                            <span className="text-xs font-medium theme-text truncate">
                              {session.title}
                            </span>
                          </div>

                          {/* 会话右侧信息与操作按钮 */}
                          <div className="flex items-center gap-2 shrink-0">
                            {session.unreadCount !== undefined ? (
                              <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 text-[11px] font-mono font-medium">
                                {session.unreadCount}
                              </span>
                            ) : session.timestamp ? (
                              <span className="text-[11px] theme-muted whitespace-nowrap font-sans">
                                {session.timestamp}
                              </span>
                            ) : null}

                            {session.isArchived && (
                              <Archive className="w-3.5 h-3.5 text-amber-400/80" />
                            )}

                            <button
                              type="button"
                              disabled title={isZh ? '暂不可用' : 'Unavailable'}
                              className="p-1 theme-muted hover:theme-text rounded-lg"
                              aria-label={isZh ? '操作' : 'Actions'}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}

        {processedWorkspaces.length === 0 && (
          <div className="py-16 text-center space-y-2">
            <p className="text-xs theme-muted">
              {isZh ? '未找到匹配的工作区或会话' : 'No matching workspaces or sessions'}
            </p>
          </div>
        )}
      </main>

      {/* 5. 悬浮添加按钮 (FAB +) */}
      <button
        type="button"
        onClick={() => setIsCreateDrawerOpen(true)}
        className="fixed right-6 bottom-8 z-30 w-14 h-14 rounded-full theme-btn-primary shadow-2xl flex items-center justify-center active:scale-90 transition shadow-black/60 hover:opacity-95"
        aria-label={isZh ? '新建会话' : 'Create worktree'}
      >
        <Plus className="w-7 h-7 stroke-[2.5]" />
      </button>

      {/* 6. 添加会话抽屉 (仅包含选择项目和工作区名称[可选]) */}
      <CreateWorktreeDrawer
        isOpen={isCreateDrawerOpen}
        onClose={() => setIsCreateDrawerOpen(false)}
        workspaces={workspacesState}
        desktopName={resolvedDesktop.name}
        onCreate={handleCreateSession}
      />

      {/* 7. 分组方式抽屉 */}
      <GroupModeDrawer
        isOpen={isGroupDrawerOpen}
        onClose={() => setIsGroupDrawerOpen(false)}
        groupMode={groupMode}
        onSelectGroupMode={handleSelectGroupMode}
      />

      {/* 8. 排序方式抽屉 */}
      <SortModeDrawer
        isOpen={isSortDrawerOpen}
        onClose={() => setIsSortDrawerOpen(false)}
        sortMode={sortMode}
        onSelectSortMode={setSortMode}
      />

      {/* 8. 会话长按操作抽屉 (置顶会话、重命名、归档会话，无删除) */}

    </div>
  )
}
