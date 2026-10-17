import React from 'react'
import { X, ExternalLink, Zap, CreditCard } from 'lucide-react'
import { useAppConfig } from '../context/ThemeLanguageContext'

interface QuotaModalProps {
  isOpen: boolean
  onClose: () => void
  balance: number
  quotaTotal: number
  quotaUsed: number
  billingUrl: string
}

export const QuotaModal: React.FC<QuotaModalProps> = ({
  isOpen,
  onClose,
  balance,
  quotaTotal,
  quotaUsed,
  billingUrl,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'

  if (!isOpen) return null

  const usagePercent = Math.min(100, Math.round((quotaUsed / Math.max(1, quotaTotal)) * 100))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="theme-card border rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b theme-border">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
              <Zap className="w-4 h-4 fill-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold theme-text">sub2api 账户与额度</h3>
              <p className="text-[10px] theme-muted">Cinlan AI 模型接入网关</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg theme-muted hover:theme-text hover:bg-zinc-800/30 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Balance Card */}
        <div className="theme-card-subtle border rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs theme-muted">{isZh ? '当前可用余额' : 'Current balance'}</span>
            <span className="text-xl font-bold font-mono text-emerald-400">
              ${balance.toFixed(2)}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] theme-muted">
              <span>{isZh ? 'Token 配额消耗' : 'Token usage'}</span>
              <span className="font-mono">{usagePercent}% ({quotaUsed.toLocaleString()} / {quotaTotal.toLocaleString()})</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${usagePercent > 80 ? 'bg-rose-500' : 'bg-blue-500'}`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Commercial Diversion Card */}
        <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-700/40 rounded-xl p-3 text-xs space-y-2">
          <div className="flex items-center gap-1.5 text-blue-300 font-semibold text-[11px]">
            <CreditCard className="w-3.5 h-3.5 text-blue-400" />
            {isZh ? '官方商业订阅通道' : 'Commercial Subscription'}
          </div>
          <p className="text-[11px] theme-secondary leading-relaxed">
            {isZh
              ? '支持 DeepSeek-V3 / R1 与 Claude / GPT-4o 多模型高速并发。额度不足时请前往收银台充值或兑换激活码。'
              : 'Supports DeepSeek-V3 / R1, Claude, and GPT-4o high-speed concurrency.'}
          </p>

          <a
            href={billingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-blue-950/50 transition active:scale-95"
          >
            <span>{isZh ? '前往 sub2api 收银台充值 / 购买' : 'Go to sub2api billing'}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="text-center pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-xs theme-muted hover:theme-text underline"
          >
            {isZh ? '返回监控面板' : 'Back to dashboard'}
          </button>
        </div>
      </div>
    </div>
  )
}
