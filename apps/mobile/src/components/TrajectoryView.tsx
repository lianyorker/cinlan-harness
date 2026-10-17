import React, { useState, useEffect, useRef } from 'react'
import { TrajectoryStep, ToolCall } from '../types'
import { Terminal, ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock, Sparkles, AlertCircle } from 'lucide-react'
import { useAppConfig } from '../context/ThemeLanguageContext'
import { AssistantMarkdown } from './AssistantMarkdown'

interface TrajectoryViewProps {
  steps: TrajectoryStep[]
  activeThought?: string
  activeContent?: string
}

export const TrajectoryView: React.FC<TrajectoryViewProps> = ({
  steps,
  activeThought,
  activeContent,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [collapsedThoughts, setCollapsedThoughts] = useState<Record<string, boolean>>({})

  // Auto scroll on new content
  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps, activeThought, activeContent, atBottom])

  const toggleThought = (id: string) => {
    setCollapsedThoughts(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div ref={containerRef} onScroll={(event) => {
      const target = event.currentTarget
      setAtBottom(target.scrollHeight - target.scrollTop - target.clientHeight < 72)
    }} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-36">
      {steps.length === 0 && !activeThought && !activeContent && (
        <div className="h-full flex flex-col items-center justify-center text-center p-8 theme-muted">
          <div className="w-12 h-12 rounded-2xl theme-icon-bg border theme-border flex items-center justify-center mb-3 text-blue-400">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <h3 className="text-sm font-medium theme-text">{isZh ? '等待任务启动' : 'Waiting for task'}</h3>
          <p className="text-xs theme-muted mt-1 max-w-xs">
            {isZh
              ? '在桌面端下达任务后，实时思考链、工具执行轨迹与审批请求将同步显示在这里。'
              : 'Real-time thoughts, tool calls, and approval requests will appear here.'}
          </p>
        </div>
      )}

      {steps.map(step => (
        <div key={step.id} className="space-y-2">
          {/* User Input Prompt */}
          {step.role === 'user' && (
            <div className="flex justify-end">
              <div className="max-w-[85%] bg-blue-600/20 border border-blue-500/40 text-blue-100 rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-xs shadow-md">
                <p className="whitespace-pre-wrap">{step.content}</p>
              </div>
            </div>
          )}

          {/* Assistant Response & Trajectory */}
          {step.role === 'assistant' && (
            <div className="space-y-2">
              {/* Collapsible Thought Chain */}
              {step.thought && (
                <div className="border border-purple-900/40 theme-card rounded-xl overflow-hidden shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleThought(step.id)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-purple-950/20 hover:bg-purple-950/30 text-purple-300 text-[11px] font-medium transition"
                  >
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-purple-400" />
                      {isZh ? '思考过程 (Thinking Process)' : 'Thinking Process'}
                    </span>
                    {collapsedThoughts[step.id] ? (
                      <ChevronRight className="w-3.5 h-3.5 text-purple-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-purple-400" />
                    )}
                  </button>
                  {!collapsedThoughts[step.id] && (
                    <div className="p-3 text-[11px] theme-muted font-mono whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto border-t border-purple-900/30 theme-card-subtle">
                      {step.thought}
                    </div>
                  )}
                </div>
              )}

              {/* Tool Execution Cards */}
              {step.toolCalls && step.toolCalls.map(tc => (
                <ToolCallCard key={tc.id} toolCall={tc} isZh={isZh} />
              ))}

              {/* Main Content */}
              {step.content && (
                <div className="theme-card border rounded-2xl rounded-tl-sm p-3.5 text-xs leading-relaxed theme-text shadow-sm">
                  <div className="flex items-center gap-1.5 text-blue-400 text-[11px] font-semibold mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    Agent
                  </div>
                  <AssistantMarkdown text={step.content} className="break-words" />
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Active Streaming Thought */}
      {activeThought && (
        <div className="border border-purple-900/50 theme-card rounded-xl p-3 shadow-md">
          <div className="flex items-center gap-1.5 text-[11px] text-purple-400 font-medium mb-1.5">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            {isZh ? '正在思考中...' : 'Thinking...'}
          </div>
          <div className="text-[11px] theme-muted font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto theme-card-subtle p-2.5 rounded-lg border border-purple-900/20">
            {activeThought}
          </div>
        </div>
      )}

      {/* Active Streaming Content */}
      {activeContent && (
        <div className="theme-card border rounded-2xl rounded-tl-sm p-3.5 text-xs leading-relaxed theme-text shadow-sm animate-pulse">
          <div className="flex items-center gap-1.5 text-blue-400 text-[11px] font-semibold mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
            {isZh ? 'Agent 正在回复...' : 'Agent replying...'}
          </div>
          <AssistantMarkdown text={activeContent} streaming className="break-words" />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

const ToolCallCard: React.FC<{ toolCall: ToolCall; isZh: boolean }> = ({ toolCall, isZh }) => {
  const [open, setOpen] = useState(false)

  const getStatusIcon = () => {
    switch (toolCall.state) {
      case 'completed':
        return <CheckCircle2 className="w-3 h-3 text-emerald-400" />
      case 'failed':
      case 'denied':
        return <XCircle className="w-3 h-3 text-rose-400" />
      case 'running':
        return <Clock className="w-3 h-3 text-blue-400 animate-spin" />
      default:
        return <AlertCircle className="w-3 h-3 text-amber-400" />
    }
  }

  const getStatusLabel = () => {
    switch (toolCall.state) {
      case 'completed': return isZh ? '已完成' : 'Completed'
      case 'failed': return isZh ? '失败' : 'Failed'
      case 'denied': return isZh ? '已拒绝' : 'Denied'
      case 'running': return isZh ? '执行中' : 'Running'
      default: return isZh ? '待处理' : 'Pending'
    }
  }

  return (
    <div className="theme-card-subtle border rounded-xl overflow-hidden font-mono text-[11px] shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 theme-card hover:opacity-90 transition"
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-3 h-3 text-amber-400" />
          <span className="theme-text font-semibold">{toolCall.tool}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded theme-icon-bg theme-text">
            {getStatusIcon()}
            {getStatusLabel()}
          </span>
          {open ? <ChevronDown className="w-3 h-3 theme-muted" /> : <ChevronRight className="w-3 h-3 theme-muted" />}
        </div>
      </button>

      {open && (
        <div className="p-2.5 space-y-2 border-t theme-border theme-card-subtle">
          <div>
            <span className="text-[10px] theme-muted block mb-1">{isZh ? '入参 (Arguments):' : 'Arguments:'}</span>
            <pre className="theme-muted bg-black/30 p-2 rounded text-[10px] overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <span className="text-[10px] theme-muted block mb-1">{isZh ? '结果 (Result):' : 'Result:'}</span>
              <pre className="text-emerald-400/90 bg-black/30 p-2 rounded text-[10px] overflow-x-auto max-h-32 whitespace-pre-wrap">
                {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
