import React, { useState, useRef, useEffect } from 'react'
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Shield,
  Mic,
  MicOff,
  ArrowUp,
  Plus,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Sparkles,
  Clock,
  CheckCircle2,
  Image as ImageIcon,
  LogOut,
  X,
  FileCode,
  Folder,
  LifeBuoy,
} from 'lucide-react'
import { TrajectoryView } from './TrajectoryView'
import { AssistantMarkdown } from './AssistantMarkdown'
import { ApprovalFloatingBar } from './ApprovalFloatingBar'
import { ProjectFilesDrawer } from './ProjectFilesDrawer'
import { ExternalLinkConfirmModal } from './ExternalLinkConfirmModal'
import type { ApprovalRequest, ConnectionStatus, TrajectoryStep } from '../types'
import { useAppConfig } from '../context/ThemeLanguageContext'
import { loadMobilePreferences } from '../transport/preferences'

export interface MobileSessionViewProps {
  readonly sessionId: string
  readonly sessionTitle: string
  readonly projectPath?: string
  readonly status: ConnectionStatus
  readonly steps: TrajectoryStep[]
  readonly activeThought: string
  readonly activeContent: string
  readonly pendingApproval: ApprovalRequest | null
  readonly onApprovalDecision: (approved: boolean) => Promise<void>
  readonly onInjectPrompt: (text: string) => Promise<void>
  readonly onBack: () => void
  readonly quotaBalance: number
  readonly onOpenQuota: () => void
}

interface ChatMessageItem {
  id: string
  role: 'user' | 'assistant' | 'system'
  content?: string
  imageUri?: string
  timestampStr?: string
  statusType?: 'error' | 'warning' | 'completed'
  errorTitle?: string
  errorCode?: string
  reason?: string
  tableData?: Array<{ key: string; val: string }>
}

export const MobileSessionView: React.FC<MobileSessionViewProps> = ({
  sessionId,
  sessionTitle,
  projectPath,
  status,
  steps,
  activeThought,
  activeContent,
  pendingApproval,
  onApprovalDecision,
  onInjectPrompt,
  onBack,
}) => {
  const { language, showNotice } = useAppConfig()
  const isZh = language === 'zh-CN'
  const [workStepsDisplay] = useState(() => loadMobilePreferences().workSteps)

  // Tab: 'chat' | 'trajectory'
  const [activeTab, setActiveTab] = useState<'chat' | 'trajectory'>('chat')

  // Menus & Modals (with click-outside handling)
  const [isTitleMenuOpen, setIsTitleMenuOpen] = useState(false)
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isGuardMenuOpen, setIsGuardMenuOpen] = useState(false)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const [isProjectFilesOpen, setIsProjectFilesOpen] = useState(false)
  const [isFeedbackConfirmOpen, setIsFeedbackConfirmOpen] = useState(false)
  const [isStatusExpanded, setIsStatusExpanded] = useState(false)

  const localApproval = pendingApproval
  const [sending, setSending] = useState(false)
  const [deciding, setDeciding] = useState(false)

  // Composer state
  const [inputText, setInputText] = useState('')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [selectedModel, setSelectedModel] = useState('DeepSeek-V41-Flash High')
  const [selectedGuard, setSelectedGuard] = useState('工作区内')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // File input ref for local images
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Scroll ref
  const chatScrollBottomRef = useRef<HTMLDivElement>(null)

  // Close all floating dropdowns
  const closeAllMenus = () => {
    setIsTitleMenuOpen(false)
    setIsMoreMenuOpen(false)
    setIsModelMenuOpen(false)
    setIsGuardMenuOpen(false)
    setIsActionMenuOpen(false)
  }

  const showToast = (msg: string) => {
    showNotice({
      title: 'Cinlan Harness',
      message: msg,
      type: 'default',
    })
  }

  const visibleSteps = workStepsDisplay === 'hidden' || workStepsDisplay === 'running' && !activeThought && !activeContent ? [] : steps
  const chatMessages: ChatMessageItem[] = visibleSteps.map(step => ({
    id: step.id, role: step.role, content: step.content,
    timestampStr: new Date(step.timestamp).toLocaleString(language),
  }))

  // Follow live output only while the user is already at the bottom.
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const [chatAtBottom, setChatAtBottom] = useState(true)
  useEffect(() => {
    const container = chatContainerRef.current
    if (!container || activeTab !== 'chat' || !chatAtBottom) return
    chatScrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, activeTab, activeContent, chatAtBottom])

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const text = inputText.trim()
    if (!text || sending || status !== 'paired') return
    setSending(true)
    try { await onInjectPrompt(text); setInputText('') }
    catch (_sendFailed) { showToast(isZh ? '发送失败，消息未提交' : 'Message was not submitted') }
    finally { setSending(false) }
  }

  const handleLocalApprovalDecision = async (approved: boolean) => {
    if (deciding || status !== 'paired') return
    setDeciding(true)
    try { await onApprovalDecision(approved) }
    catch (_decisionFailed) { showToast(isZh ? '审批提交失败' : 'Decision failed') }
    finally { setDeciding(false) }
  }

  const handleCopyText = (id: string, text?: string) => {
    if (!text) return
    void navigator.clipboard?.writeText(text).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 1800) }, () => showToast(isZh ? '复制失败' : 'Copy failed'))
  }

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => {
        setSelectedImage(reader.result as string)
        setIsActionMenuOpen(false)
        showToast(isZh ? '已选择本地图片' : 'Image attached')
      }
      reader.readAsDataURL(file)
    }
  }

  const hasAnyMenuOpen =
    isTitleMenuOpen || isMoreMenuOpen || isModelMenuOpen || isGuardMenuOpen || isActionMenuOpen

  return (
    <div className="h-screen w-screen theme-bg theme-text flex flex-col overflow-hidden select-none relative font-sans transition-colors duration-200">
      {/* 全局失焦遮罩：点击关闭任何展开的菜单 */}
      {hasAnyMenuOpen && (
        <div
          role="presentation"
          onClick={closeAllMenus}
          className="fixed inset-0 z-30 bg-transparent"
        />
      )}

      {/* ================= 1. Top Header ================= */}
      <header className="safe-top px-4 pt-2.5 pb-2 border-b theme-border theme-card/90 backdrop-blur-md z-40 shrink-0">
        {/* Row 1: 返回 + 会话名 (定宽截断) + 智能体团队 + 创造模式 + 右侧文件图标与更多 */}
        <div className="flex items-center justify-between gap-1.5">
          {/* Left: 返回 + 会话名 (定宽截断) + 智能体团队 + 创造模式 */}
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={onBack}
              className="p-1 -ml-1 theme-muted hover:theme-text rounded-full hover:bg-zinc-800/40 active:scale-95 transition shrink-0"
              aria-label={isZh ? '返回' : 'Back'}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            {/* 会话名称 (固定宽度截断，展开后菜单显示全称) */}
            <button
              type="button"
              onClick={() => {
                closeAllMenus()
                setIsTitleMenuOpen(!isTitleMenuOpen)
              }}
              className="flex items-center gap-0.5 max-w-[84px] shrink-0 text-left hover:opacity-85 transition"
              title={sessionTitle || 'Session'}
            >
              <h1 className="text-sm font-bold theme-text tracking-tight truncate">
                {sessionTitle || 'Session'}
              </h1>
              <ChevronDown className="w-3.5 h-3.5 theme-muted shrink-0" />
            </button>

            {/* 智能体团队、创造模式 紧跟在会话名称后面 */}
            <span className="px-1.5 py-0.5 rounded-full theme-card-subtle theme-text text-[10px] font-medium border theme-border shrink-0">
              {isZh ? '智能体团队' : 'Agents'}
            </span>
            <span className="px-1.5 py-0.5 rounded-full theme-card-subtle theme-text text-[10px] font-medium border theme-border shrink-0">
              {isZh ? '创造模式' : 'Creative'}
            </span>
          </div>

          {/* Right: 文件图标在右侧，文件打开可以浏览当前项目的文件 + 更多操作 */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                closeAllMenus()
                setIsProjectFilesOpen(true)
              }}
              className="p-1.5 theme-muted hover:theme-text rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition"
              aria-label={isZh ? '浏览项目文件' : 'Browse project files'}
              title={isZh ? '浏览项目文件' : 'Browse project files'}
            >
              <Folder className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                closeAllMenus()
                setIsMoreMenuOpen(!isMoreMenuOpen)
              }}
              className="p-1.5 theme-muted hover:theme-text rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition"
              aria-label={isZh ? '更多' : 'More'}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: 项目路径保持不变 (在下方展示) */}
        <div className="pl-7 mt-0.5 flex items-center justify-between text-[10px] theme-muted font-mono truncate">
          <span className="truncate">--</span>
        </div>

        {/* Row 3: 对话跟轨迹 Tabs (对话/轨迹后面没有 files，纯净两项) */}
        <div className="mt-2.5 flex items-center justify-start border-t theme-border pt-2 gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`relative pb-1.5 text-xs font-semibold transition ${
              activeTab === 'chat'
                ? 'theme-text'
                : 'theme-muted hover:theme-text'
            }`}
          >
            <span>{isZh ? '对话' : 'Chat'}</span>
            {activeTab === 'chat' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('trajectory')}
            className={`relative pb-1.5 text-xs font-semibold transition ${
              activeTab === 'trajectory'
                ? 'theme-text'
                : 'theme-muted hover:theme-text'
            }`}
          >
            <span>{isZh ? '轨迹' : 'Trajectory'}</span>
            {activeTab === 'trajectory' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
            )}
          </button>
        </div>
      </header>

      {/* Title Dropdown Menu (带失焦关闭) */}
      {isTitleMenuOpen && (
        <>
          <div
            role="presentation"
            onClick={() => setIsTitleMenuOpen(false)}
            className="fixed inset-0 z-30 bg-transparent"
          />
          <div className="absolute top-16 left-4 z-40 w-64 theme-card border theme-border rounded-2xl shadow-2xl p-2 text-xs space-y-1 animate-fade-in">
            <div className="p-2 border-b theme-border">
              <span className="text-[10px] theme-muted block">{isZh ? '当前会话全称' : 'Full Title'}</span>
              <span className="font-semibold theme-text mt-0.5 block break-words">
                {sessionTitle || sessionId}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                handleCopyText('title', sessionTitle)
                setIsTitleMenuOpen(false)
              }}
              className="w-full text-left p-2 rounded-xl theme-muted hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:theme-text transition"
            >
              {isZh ? '复制会话标题' : 'Copy title'}
            </button>
          </div>
        </>
      )}

      {/* More Options Dropdown (分享会话 / 支持与反馈 / 退出会话) */}
      {isMoreMenuOpen && (
        <>
          <div
            role="presentation"
            onClick={() => setIsMoreMenuOpen(false)}
            className="fixed inset-0 z-30 bg-transparent"
          />
          <div className="absolute top-16 right-4 z-40 w-48 theme-card border theme-border rounded-2xl shadow-2xl p-1.5 text-xs divide-y divide-[var(--border-line)] animate-fade-in">
            <div className="py-1">
              <button
                type="button"
                disabled
                title={isZh ? '暂不可用' : 'Unavailable'}
                className="w-full text-left px-3 py-2.5 rounded-xl theme-text hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-2.5 transition"
              >
                <Share2 className="w-4 h-4 text-blue-500" />
                <span>{isZh ? '分享会话' : 'Share Session'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMoreMenuOpen(false)
                  setIsFeedbackConfirmOpen(true)
                }}
                className="w-full text-left px-3 py-2.5 rounded-xl theme-text hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-2.5 transition"
              >
                <LifeBuoy className="w-4 h-4 text-emerald-500" />
                <span>{isZh ? '支持与反馈' : 'Support & Feedback'}</span>
              </button>
            </div>

            <div className="py-1">
              <button
                type="button"
                onClick={() => {
                  setIsMoreMenuOpen(false)
                  onBack()
                }}
                className="w-full text-left px-3 py-2.5 rounded-xl text-rose-500 hover:bg-rose-500/10 flex items-center gap-2.5 transition"
              >
                <LogOut className="w-4 h-4" />
                <span>{isZh ? '退出会话' : 'Exit Session'}</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ================= 2. Main Body Area (对话跟轨迹) ================= */}
      <main className="flex-1 overflow-hidden flex flex-col relative">
        {activeTab === 'chat' ? (
          /* 对话流 */
          <div ref={chatContainerRef} onScroll={(event) => {
            const target = event.currentTarget
            setChatAtBottom(target.scrollHeight - target.scrollTop - target.clientHeight < 72)
          }} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-48">
            {chatMessages.map((msg) => {
              if (msg.role === 'system') {
                return (
                  <div
                    key={msg.id}
                    className="p-3 theme-card border theme-border rounded-2xl shadow-sm space-y-1.5"
                  >
                    {msg.reason && (
                      <div className="text-[11px] theme-muted font-mono">
                        {msg.reason}
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-rose-500 font-medium leading-relaxed">
                        <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 mt-0.5" />
                        <span>{msg.errorTitle}</span>
                      </div>
                      {msg.errorCode && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded theme-icon-bg theme-muted font-mono shrink-0">
                          {msg.errorCode}
                        </span>
                      )}
                    </div>
                  </div>
                )
              }

              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex flex-col items-end space-y-1">
                    <div className="max-w-[85%] bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-xs shadow-md leading-relaxed break-words font-sans space-y-2">
                      {msg.imageUri && (
                        <img
                          src={msg.imageUri}
                          alt="attached"
                          className="w-full max-h-48 object-cover rounded-xl"
                        />
                      )}
                      {msg.content && <div>{msg.content}</div>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] theme-muted pr-1">
                      {msg.timestampStr && <span>{msg.timestampStr}</span>}
                      <button
                        type="button"
                        onClick={() => handleCopyText(msg.id, msg.content)}
                        className="hover:theme-text transition"
                        title={isZh ? '复制内容' : 'Copy'}
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                )
              }

              // Assistant message
              return (
                <div key={msg.id} className="space-y-2">
                  <div className="p-3.5 theme-card border theme-border rounded-2xl rounded-tl-sm text-xs leading-relaxed theme-text shadow-sm space-y-3">
                    <AssistantMarkdown text={msg.content ?? ''} className="break-words" />

                    {/* Table Data */}
                    {msg.tableData && (
                      <div className="border theme-border rounded-xl overflow-hidden text-[11px]">
                        <div className="grid grid-cols-3 theme-card-subtle px-3 py-1.5 font-semibold theme-text border-b theme-border">
                          <span>项</span>
                          <span className="col-span-2">结果</span>
                        </div>
                        {msg.tableData.map(row => (
                          <div
                            key={row.key}
                            className="grid grid-cols-3 px-3 py-1.5 border-b theme-border last:border-none theme-text"
                          >
                            <span className="theme-muted font-medium">{row.key}</span>
                            <span className="col-span-2 font-mono theme-text break-all">
                              {row.val}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Message Actions Row */}
                    <div className="pt-2 border-t theme-border flex items-center justify-between theme-muted text-[11px]">
                      <div className="flex items-center gap-3">
                        <button type="button" className="hover:theme-text transition">
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" className="hover:theme-text transition">
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyText(msg.id, msg.content)}
                          className="hover:theme-text transition"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" className="hover:theme-text transition">
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="font-mono text-[10px] theme-muted">
                        --
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Active streaming content */}
            {activeContent && (
              <div className="p-3.5 theme-card border theme-border rounded-2xl rounded-tl-sm text-xs leading-relaxed theme-text shadow-sm animate-pulse space-y-1">
                <div className="flex items-center gap-1.5 text-blue-500 text-[11px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                  <span>Agent 正在回复...</span>
                </div>
                <AssistantMarkdown text={activeContent} streaming className="break-words" />
              </div>
            )}

            <div ref={chatScrollBottomRef} />
            {!chatAtBottom && (
              <button
                type="button"
                onClick={() => {
                  setChatAtBottom(true)
                  chatScrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
                }}
                className="absolute right-4 top-3 z-20 p-2 rounded-full theme-card border theme-border shadow-lg theme-text"
                aria-label={isZh ? '滚动到底部' : 'Scroll to bottom'}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          /* 轨迹流 */
          <div className="flex-1 overflow-y-auto pb-48">
            <TrajectoryView
              steps={visibleSteps}
              activeThought={activeThought}
              activeContent={activeContent}
            />
          </div>
        )}
      </main>

      {/* ================= 3. Bottom Composer & Floating Area ================= */}
      {/* (按正常的底部设计，自适应舒适高度，杜绝挤压与溢出) */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 theme-bg/95 backdrop-blur-xl border-t theme-border safe-bottom px-3 pt-2 pb-2">
        <div className="max-w-xl mx-auto space-y-2">
          {/* Status pill: 已完成，用时 37秒 v */}
          <div className="flex items-center justify-start px-1">
            <button
              type="button"
              onClick={() => setIsStatusExpanded(value => !value)}
              className="inline-flex items-center gap-1.5 text-xs theme-muted hover:theme-text active:scale-95 transition py-0.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="font-medium">{status === 'paired' ? (isZh ? '已连接' : 'Connected') : status === 'reconnecting' || status === 'connecting' ? (isZh ? '重连中' : 'Reconnecting') : (isZh ? '已断开' : 'Disconnected')}</span>
              {isStatusExpanded ? (
                <ChevronUp className="w-3.5 h-3.5 theme-muted" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 theme-muted" />
              )}
            </button>
          </div>

          {/* Status expanded quick summary */}
          {isStatusExpanded && (
            <div className="p-2.5 theme-card border theme-border rounded-xl text-xs theme-text space-y-1 animate-fade-in shadow-lg">
              <div className="flex items-center justify-between text-[11px] theme-muted font-mono">
                <span>{isZh ? '连接状态' : 'Connection status'}</span>
                <span className={status === 'paired' ? 'text-emerald-500' : 'text-amber-500'}>{status === 'paired' ? 'ONLINE' : status === 'reconnecting' || status === 'connecting' ? 'RECONNECTING' : 'OFFLINE'}</span>
              </div>
              <p className="text-[11px] theme-muted">
                {status === 'paired' ? (isZh ? '已连接到当前桌面 Host。' : 'Connected to the selected desktop Host.') : isZh ? '当前无法访问桌面 Host，消息不会伪造提交成功。' : 'The desktop Host is unavailable; messages are not reported as submitted.'}
              </p>
            </div>
          )}

          {/* 选中的本地图片预览栏 */}
          {selectedImage && (
            <div className="flex items-center gap-2 p-2 theme-card border theme-border rounded-xl animate-fade-in">
              <img
                src={selectedImage}
                alt="Selected preview"
                className="w-10 h-10 object-cover rounded-lg"
              />
              <span className="text-xs theme-text flex-1 truncate">{isZh ? '已添加本地图片' : 'Local Image Attached'}</span>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="p-1 theme-muted hover:theme-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Composer Card */}
          <form
            onSubmit={handleSendMessage}
            className="w-full theme-card border theme-border rounded-2xl p-2.5 shadow-xl space-y-2 transition-all focus-within:border-zinc-500"
          >
            {/* 隐藏的本地图片选择器 input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageFileChange}
            />

            {/* Input textarea */}
            <div className="w-full">
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
                rows={1}
                placeholder={
                  isRecording
                    ? (isZh ? '正在聆听语音输入...' : 'Listening...')
                    : (isZh
                      ? '发消息或创建任务，/ 调用指令，@ 文件或对话'
                      : 'Send message, / command, @ file or chat')
                }
                className="w-full bg-transparent text-xs theme-text placeholder-zinc-500 focus:outline-none resize-none min-h-[34px] max-h-[110px] leading-relaxed pt-1"
              />
            </div>

            {/* Bottom Toolbar inside composer */}
            <div className="flex items-center justify-between pt-1 border-t theme-border">
              {/* Left tools: + (添加本地图片) and 🛡️ 安全权限模式 (工作区内) */}
              <div className="flex items-center gap-2">
                {/* + 菜单 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      closeAllMenus()
                      setIsActionMenuOpen(!isActionMenuOpen)
                    }}
                    className="p-1 theme-muted hover:theme-text rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition"
                    title={isZh ? '添加操作' : 'Add action'}
                  >
                    <Plus className="w-4 h-4" />
                  </button>

                  {/* + 操作弹窗：添加本地图片 / 敏感操作审批 / 多选决策征询 */}
                  {isActionMenuOpen && (
                    <>
                      <div
                        role="presentation"
                        onClick={() => setIsActionMenuOpen(false)}
                        className="fixed inset-0 z-30 bg-transparent"
                      />
                      <div className="absolute bottom-9 left-0 z-40 w-52 theme-card border theme-border rounded-2xl shadow-2xl overflow-hidden divide-y divide-[var(--border-line)] text-xs animate-fade-in">
                        <button
                          type="button"
                          onClick={() => {
                            setIsActionMenuOpen(false)
                            fileInputRef.current?.click()
                          }}
                          className="w-full px-3.5 py-2.5 flex items-center gap-2.5 theme-text hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-left transition"
                        >
                          <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                          <span>{isZh ? '添加本地图片' : 'Add local image'}</span>
                        </button>

                      </div>
                    </>
                  )}
                </div>

                {/* 🛡️ 工作区内 (边框修正，不挤压) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      closeAllMenus()
                      setIsGuardMenuOpen(!isGuardMenuOpen)
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl theme-card-subtle border theme-border text-[11px] theme-text font-medium hover:opacity-85 transition"
                  >
                    <Shield className="w-3 h-3 text-blue-500 shrink-0" />
                    <span>{selectedGuard}</span>
                    <ChevronDown className="w-3 h-3 theme-muted shrink-0" />
                  </button>

                  {/* Guard Dropdown */}
                  {isGuardMenuOpen && (
                    <>
                      <div
                        role="presentation"
                        onClick={() => setIsGuardMenuOpen(false)}
                        className="fixed inset-0 z-30 bg-transparent"
                      />
                      <div className="absolute bottom-9 left-0 z-40 w-36 theme-card border theme-border rounded-2xl shadow-2xl overflow-hidden divide-y divide-[var(--border-line)] text-xs animate-fade-in">
                        {['工作区内', '全盘读写', '严格沙箱'].map(mode => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => {
                              setSelectedGuard(mode)
                              setIsGuardMenuOpen(false)
                            }}
                            className={`w-full text-left px-3 py-2 transition ${
                              selectedGuard === mode
                                ? 'text-blue-500 font-semibold bg-blue-500/10'
                                : 'theme-text hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                            }`}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Center / Right tools: Model pill + Voice mic + Send arrow */}
              <div className="flex items-center gap-2">
                {/* Model selector (边框修正，与安全按钮对称) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      closeAllMenus()
                      setIsModelMenuOpen(!isModelMenuOpen)
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-xl theme-card-subtle border theme-border text-[11px] theme-text font-mono hover:opacity-85 transition"
                  >
                    <span className="truncate max-w-[105px]">{selectedModel}</span>
                    <ChevronDown className="w-3 h-3 theme-muted shrink-0" />
                  </button>

                  {/* Model Dropdown */}
                  {isModelMenuOpen && (
                    <>
                      <div
                        role="presentation"
                        onClick={() => setIsModelMenuOpen(false)}
                        className="fixed inset-0 z-30 bg-transparent"
                      />
                      <div className="absolute bottom-9 right-0 z-40 w-48 theme-card border theme-border rounded-2xl shadow-2xl overflow-hidden divide-y divide-[var(--border-line)] text-xs animate-fade-in">
                        {[
                          'DeepSeek-V41-Flash High',
                          'DeepSeek-R1 Full Reasoning',
                          'Claude-3.7-Sonnet Hybrid',
                          'GPT-4o Omnipresent',
                        ].map(model => (
                          <button
                            key={model}
                            type="button"
                            onClick={() => {
                              setSelectedModel(model)
                              setIsModelMenuOpen(false)
                            }}
                            className={`w-full text-left px-3 py-2 transition ${
                              selectedModel === model
                                ? 'text-blue-500 font-semibold bg-blue-500/10'
                                : 'theme-text hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                            }`}
                          >
                            {model}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Voice Input Mic */}
                <button
                  type="button"
                  onClick={() => setIsRecording(value => !value)}
                  className={`p-1.5 rounded-full transition ${
                    isRecording
                      ? 'bg-rose-600 text-white animate-pulse'
                      : 'theme-muted hover:theme-text hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                  title={isZh ? '语音输入' : 'Voice input'}
                >
                  {isRecording ? (
                    <MicOff className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </button>

                {/* Send Button */}
                <button
                  type="submit"
                  disabled={!inputText.trim() || sending || status !== 'paired'}
                  className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white flex items-center justify-center shadow transition active:scale-90"
                  aria-label={isZh ? '发送' : 'Send'}
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </form>

          {/* Footer Metrics Row */}
          <div className="flex items-center justify-between text-[10px] theme-muted font-mono px-1">
            <div className="flex items-center gap-1 truncate">
              <Clock className="w-3 h-3 theme-muted shrink-0" />
              <span>--</span>
            </div>

            <div className="flex items-center gap-1 truncate">
              <Sparkles className="w-3 h-3 theme-muted shrink-0" />
              <span>--</span>
            </div>

            <div className="flex items-center gap-1 font-semibold theme-text shrink-0">
              <span>--</span>
            </div>
          </div>
        </div>
      </footer>

      {/* 权限审批与多选决策弹窗 (Bottom Action Sheet) */}
      <ApprovalFloatingBar
        approval={status === 'paired' && !deciding ? localApproval : null}
        onDecision={handleLocalApprovalDecision}
      />

      {/* Project Files Drawer (浏览当前项目文件) */}
      <ProjectFilesDrawer
        isOpen={isProjectFilesOpen}
        onClose={() => setIsProjectFilesOpen(false)}
        projectPath={projectPath ?? '--'}
        onSelectFile={(filePath) => {
          setIsProjectFilesOpen(false)
          setInputText(prev => (prev ? `${prev} @${filePath}` : `@${filePath} `))
          showToast(isZh ? `已引用文件: @${filePath}` : `Referenced: @${filePath}`)
        }}
      />

      {/* 支持与反馈：确认打开浏览器弹窗 */}
      <ExternalLinkConfirmModal
        isOpen={isFeedbackConfirmOpen}
        onClose={() => setIsFeedbackConfirmOpen(false)}
        url="https://github.com/lianyorker/cinlan-harness/issues"
      />
    </div>
  )
}
