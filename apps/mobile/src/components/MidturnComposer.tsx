import React, { useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { useAppConfig } from '../context/ThemeLanguageContext'

interface MidturnComposerProps {
  onSend: (text: string) => void
  disabled?: boolean
}

export const MidturnComposer: React.FC<MidturnComposerProps> = ({
  onSend,
  disabled = false,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'
  const [text, setText] = useState('')

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!text.trim() || disabled) return
    onSend(text.trim())
    setText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 theme-card/90 backdrop-blur-md border-t theme-border safe-bottom p-3">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-1.5 mb-1.5 px-1">
          <Sparkles className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] theme-muted">
            {isZh ? 'Mid-turn 追问缓冲：指令将在当前 Step 结束后立即追加执行' : 'Mid-turn steering: prompt appends right after current step'}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder={disabled ? (isZh ? '正在等待主机连接...' : 'Waiting for connection...') : (isZh ? '输入追加指令 (例如: 改用 pytest 测试)...' : 'Type follow-up prompt...')}
              className="w-full pl-3.5 pr-8 py-2.5 theme-card-subtle border theme-border focus:border-blue-500 rounded-xl text-xs theme-text placeholder-zinc-500 focus:outline-none transition"
            />
            {text && (
              <span className="absolute right-2.5 top-2.5 text-[10px] theme-muted font-mono">
                ↵
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={!text.trim() || disabled}
            className="p-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded-xl shadow-md transition active:scale-95 flex items-center justify-center"
            title={isZh ? '发送追问' : 'Send'}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  )
}
