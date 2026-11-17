/** The `git` tab chip title; reads its label through the slot's locale share. */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** Standard locale share for a tab title. */
export type GitTitleProps = PropsLocale<'sidebarGitReview'>

/**
 * The tab chip label.
 * @param props - locale share.
 * @returns the localized type label.
 */
export function GitTitle({ t }: GitTitleProps): ReactNode {
  return <span>{t('type.label')}</span>
}
