import React, { useState, useEffect } from 'react'
import type { ApprovalRequest } from '../types'
import {
  ShieldAlert,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
  HelpCircle,
  Copy,
  Terminal,
} from 'lucide-react'
import { useAppConfig } from '../context/ThemeLanguageContext'

export interface ApprovalFloatingBarProps {
  readonly approval: ApprovalRequest | null
  readonly onDecision: (approved: boolean, selectedOptions?: string[]) => void
}

export const ApprovalFloatingBar: React.FC<ApprovalFloatingBarProps> = ({
  approval,
  onDecision,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'
  const [showArgs, setShowArgs] = useState(false)
  const [copiedArgs, setCopiedArgs] = useState(false)

  // Options selection state (supports multi-select & single-select)
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([])

  useEffect(() => {
    if (!approval) return

    if (approval.options && approval.options.length > 0) {
      const defaults = approval.options
        .filter((opt) => opt.defaultSelected)
        .map((opt) => opt.id)
      setSelectedOptionIds(
        defaults.length > 0
          ? defaults
          : [approval.options[0].id]
      )
    } else {
      // Default permission scope option
      setSelectedOptionIds(['allow-once'])
    }
  }, [approval])

  if (!approval) return null

  const isQuestion = approval.type === 'question' || approval.type === 'multi_select'
  const isMultiSelect = approval.isMultiSelect ?? (approval.type === 'multi_select')

  const handleToggleOption = (id: string) => {
    if (isMultiSelect) {
      setSelectedOptionIds((prev) =>
        prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
      )
    } else {
      setSelectedOptionIds([id])
    }
  }

  const handleCopyArgs = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!approval.args) return
    navigator.clipboard?.writeText(JSON.stringify(approval.args, null, 2))
    setCopiedArgs(true)
    setTimeout(() => setCopiedArgs(false), 2000)
  }

  // Fallback options for permission approval if none explicitly passed
  const displayOptions = approval.options && approval.options.length > 0
    ? approval.options
    : [
        {
          id: 'allow-once',
          label: isZh ? '仅允许本次调用执行' : 'Allow once for this action',
          description: isZh ? '操作完成后恢复拦截' : 'Re-intercept on subsequent calls',
          defaultSelected: true,
        },
      ]

  return (
    <div
      role="presentation"
      onClick={() => onDecision(false)}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full theme-card border-t theme-border rounded-t-3xl p-5 pb-8 space-y-4 shadow-2xl safe-bottom max-h-[88vh] flex flex-col animate-slide-up transition-colors duration-200"
      >
        {/* Top Drag Handle */}
        <div className="w-10 h-1 rounded-full theme-drag-handle mx-auto shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`p-2 rounded-2xl shrink-0 ${
                isQuestion
                  ? 'bg-blue-500/15 text-blue-500'
                  : 'bg-amber-500/15 text-amber-500'
              }`}
            >
              {isQuestion ? (
                <HelpCircle className="w-5 h-5" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
            </div>

            <div className="min-w-0">
              <h2
                id="approval-sheet-title"
                className="text-sm font-bold theme-text tracking-tight flex items-center gap-1.5"
              >
                <span>
                  {isQuestion
                    ? (isZh ? '智能体交互选项决策' : 'Decision Required')
                    : (isZh ? '敏感操作授权确认' : 'Privilege Approval')}
                </span>
                {isMultiSelect && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500 font-normal">
                    {isZh ? '多选' : 'Multiple'}
                  </span>
                )}
              </h2>
              <p className="text-[11px] theme-muted truncate">
                {isQuestion
                  ? (isZh ? '请按需勾选决策项后提交' : 'Select options to guide the agent')
                  : (isZh ? '智能体申请在主机执行受限工具' : 'Agent requested privileged execution')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-lg theme-card-subtle border theme-border theme-text">
              {approval.toolName || 'agent.interact'}
            </span>
            <button
              type="button"
              onClick={() => onDecision(false)}
              className="p-1 theme-muted hover:theme-text rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition"
              aria-label={isZh ? '关闭' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Reason / Prompt Box */}
        <div className="p-3 rounded-2xl theme-card-subtle border theme-border space-y-2 shrink-0">
          <p className="text-xs theme-text font-medium leading-relaxed">
            {approval.reason ||
              (isZh
                ? `智能体请求执行受限操作，需要您的授权。`
                : `Agent requested to execute a privileged operation.`)}
          </p>

          {/* Command / Arguments preview */}
          {approval.args && Object.keys(approval.args).length > 0 && (
            <div className="pt-2 border-t theme-border">
              <div className="flex items-center justify-between text-[11px] theme-muted">
                <button
                  type="button"
                  onClick={() => setShowArgs(!showArgs)}
                  className="flex items-center gap-1 hover:theme-text transition"
                >
                  <Terminal className="w-3 h-3 text-blue-500" />
                  <span>{isZh ? '调用入参及参数详情' : 'Inspect Arguments'}</span>
                  {showArgs ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>

                {showArgs && (
                  <button
                    type="button"
                    onClick={handleCopyArgs}
                    className="flex items-center gap-1 hover:theme-text text-[10px]"
                  >
                    {copiedArgs ? (
                      <Check className="w-2.5 h-2.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-2.5 h-2.5" />
                    )}
                    <span>{copiedArgs ? (isZh ? '已复制' : 'Copied') : (isZh ? '复制' : 'Copy')}</span>
                  </button>
                )}
              </div>

              {showArgs && (
                <pre className="mt-2 text-[10px] font-mono theme-text bg-black/30 dark:bg-black/60 p-2.5 rounded-xl max-h-28 overflow-y-auto whitespace-pre-wrap select-all">
                  {JSON.stringify(approval.args, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Options / Multi-select list */}
        <div className="space-y-1.5 overflow-y-auto max-h-[36vh] pr-0.5">
          <div className="text-[10px] font-semibold theme-muted uppercase tracking-wider px-1">
            {isQuestion
              ? (isZh ? '请选择决策选项' : 'Options')
              : (isZh ? '授权范围策略' : 'Scope Policy')}
          </div>

          <div className="space-y-1.5">
            {displayOptions.map((opt) => {
              const isSelected = selectedOptionIds.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleToggleOption(opt.id)}
                  className={`w-full p-3 rounded-2xl border text-left transition flex items-start gap-3 ${
                    isSelected
                      ? 'theme-card border-blue-500/80 bg-blue-500/[0.04]'
                      : 'theme-card-subtle border-transparent hover:border theme-border opacity-85'
                  }`}
                >
                  <div className="pt-0.5 shrink-0 text-blue-500">
                    {isMultiSelect ? (
                      isSelected ? (
                        <CheckSquare className="w-4 h-4 text-blue-500" />
                      ) : (
                        <Square className="w-4 h-4 theme-muted" />
                      )
                    ) : isSelected ? (
                      <div className="w-4 h-4 rounded-full border-2 border-blue-500 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      </div>
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-zinc-500/50" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold theme-text block">
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="text-[11px] theme-muted block mt-0.5 leading-snug">
                        {opt.description}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Bottom Decision Actions */}
        <div className="flex items-center gap-2.5 pt-2 border-t theme-border shrink-0">
          <button
            type="button"
            onClick={() => onDecision(false)}
            className="flex-1 py-3 px-4 rounded-xl theme-card-subtle border theme-border text-xs font-semibold text-rose-500 hover:bg-rose-500/10 active:scale-[0.98] transition flex items-center justify-center gap-1.5"
          >
            <X className="w-4 h-4" />
            <span>{isZh ? '拒绝操作 (Deny)' : 'Deny'}</span>
          </button>

          <button
            type="button"
            disabled={selectedOptionIds.length === 0}
            onClick={() => onDecision(true, selectedOptionIds)}
            className="flex-1 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 active:bg-blue-700 text-white text-xs font-semibold shadow-lg shadow-blue-900/30 active:scale-[0.98] transition flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>
              {isQuestion
                ? (isZh
                    ? `确认提交 (${selectedOptionIds.length})`
                    : `Submit (${selectedOptionIds.length})`)
                : (isZh ? '授权执行 (Approve)' : 'Approve')}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
