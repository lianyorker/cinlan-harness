/** Assistant Markdown over the same primitives the Web chat renders with. */
import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useAppConfig } from '../context/ThemeLanguageContext'

/** Localized chrome the shared renderer asks for; the Web chat passes its own dictionary. */
const LABELS: Record<'zh-CN' | 'en-US', MarkdownLabels> = {
  'zh-CN': { code: { copyLabel: '复制代码', copiedLabel: '已复制' }, footnotes: '脚注' },
  'en-US': { code: { copyLabel: 'Copy code', copiedLabel: 'Copied' }, footnotes: 'Footnotes' },
}

export interface AssistantMarkdownProps {
  readonly text: string
  /** True while chunks keep arriving; keeps parse work on the tail. */
  readonly streaming?: boolean
  readonly className?: string
}

/**
 * Render assistant Markdown through the shared primitives implementation.
 * @param props - Markdown source, streaming flag and optional wrapper class.
 * @returns the rendered blocks, or nothing for empty input.
 */
export function AssistantMarkdown({ text, streaming = false, className }: AssistantMarkdownProps): ReactNode {
  const { language } = useAppConfig()
  if (text === '') return null
  return (
    <div className={className}>
      <MarkdownText text={text} streaming={streaming} labels={LABELS[language]} />
    </div>
  )
}
