import React, { useState, useEffect } from 'react'
import {
  Pin,
  Pencil,
  Archive,
} from 'lucide-react'
import { useAppConfig } from '../../context/ThemeLanguageContext'
import type { SessionItem } from '../../types'

export interface SessionActionDrawerProps {
  readonly session: SessionItem | null
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onTogglePin: (sessionId: string) => void
  readonly onRename: (sessionId: string, newTitle: string) => void
  readonly onToggleArchive: (sessionId: string) => void
}

export const SessionActionDrawer: React.FC<SessionActionDrawerProps> = ({
  session,
  isOpen,
  onClose,
  onTogglePin,
  onRename,
  onToggleArchive,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'

  const [isRenaming, setIsRenaming] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    if (session) {
      setNewTitle(session.title)
      setIsRenaming(false)
    }
  }, [session, isOpen])

  if (!isOpen || !session) return null

  const handleSaveRename = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!newTitle.trim()) return
    onRename(session.id, newTitle.trim())
    setIsRenaming(false)
    onClose()
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
        aria-labelledby="session-action-title"
        onClick={e => e.stopPropagation()}
        className="w-full theme-card border-t theme-border rounded-t-3xl p-5 pb-8 space-y-4 shadow-2xl safe-bottom animate-slide-up"
      >
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full theme-drag-handle mx-auto" />

        {/* Header: Session Name */}
        <div className="px-1">
          <h2
            id="session-action-title"
            className="text-sm font-bold theme-text truncate tracking-tight"
          >
            {session.title}
          </h2>
        </div>

        {/* In-place rename view */}
        {isRenaming ? (
          <form onSubmit={handleSaveRename} className="space-y-3 pt-1">
            <input
              type="text"
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              className="w-full p-3 theme-card-subtle border theme-border rounded-xl text-xs theme-text focus:outline-none focus:border-zinc-500"
              placeholder={isZh ? '请输入新会话名称...' : 'Enter new session name...'}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!newTitle.trim()}
                className="flex-1 py-2.5 theme-btn-primary rounded-xl text-xs font-semibold"
              >
                {isZh ? '保存' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setIsRenaming(false)}
                className="px-4 py-2.5 theme-card-subtle border theme-border theme-muted hover:theme-text rounded-xl text-xs"
              >
                {isZh ? '取消' : 'Cancel'}
              </button>
            </div>
          </form>
        ) : (
          /* Action buttons list (matching Image 3) */
          <div className="theme-card-subtle border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] theme-border shadow-sm">
            {/* 1. 置顶会话 */}
            <button
              type="button"
              onClick={() => {
                onTogglePin(session.id)
                onClose()
              }}
              className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3">
                <Pin
                  className={`w-4 h-4 ${
                    session.isPinned ? 'text-amber-400 rotate-45' : 'theme-muted'
                  }`}
                />
                <span className="text-xs font-medium theme-text">
                  {session.isPinned
                    ? (isZh ? '取消置顶' : 'Unpin')
                    : (isZh ? '置顶会话' : 'Pin Session')}
                </span>
              </div>
              {session.isPinned && (
                <span className="text-[11px] text-amber-400 font-mono">已置顶</span>
              )}
            </button>

            {/* 2. 重命名 */}
            <button
              type="button"
              onClick={() => setIsRenaming(true)}
              className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <Pencil className="w-4 h-4 theme-muted" />
              <span className="text-xs font-medium theme-text">
                {isZh ? '重命名' : 'Rename'}
              </span>
            </button>

            {/* 3. 归档会话 */}
            <button
              type="button"
              onClick={() => {
                onToggleArchive(session.id)
                onClose()
              }}
              className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition"
            >
              <div className="flex items-center gap-3">
                <Archive className="w-4 h-4 theme-muted" />
                <span className="text-xs font-medium theme-text">
                  {session.isArchived
                    ? (isZh ? '取消归档' : 'Unarchive')
                    : (isZh ? '归档会话' : 'Archive Session')}
                </span>
              </div>
              {session.isArchived && (
                <span className="text-[11px] theme-muted font-mono">已归档</span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
