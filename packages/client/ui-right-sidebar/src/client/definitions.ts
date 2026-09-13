/** Page-type definitions for the right sidebar contributors. */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** Stable id for the Review page contribution. */
export const REVIEW_TAB_ID = 'right-sidebar-review'
/** Stable id for the Terminal page contribution. */
export const TERMINAL_TAB_ID = 'right-sidebar-terminal'
/** Stable id for the Worktree Tasks page contribution. */
export const TASKS_TAB_ID = 'right-sidebar-tasks'
/** Stable id for the Browser page contribution. */
export const BROWSER_TAB_ID = 'right-sidebar-browser'

type T = TranslateNS<'rightSidebarContributors'>

type PageCopy = {
  readonly id: string
  readonly kind: string
  readonly titleKey: Parameters<T>[0]
  readonly descriptionKey: Parameters<T>[0]
}

function pageDefinition(copy: PageCopy, t: T): SidebarRightTabDefinition {
  return {
    id: copy.id,
    kind: copy.kind,
    title: () => t(copy.titleKey),
    priority: 'extension',
    guide: [{
      order: 600,
      title: () => t(copy.titleKey),
      description: () => t(copy.descriptionKey),
    }],
  }
}

/**
 * Build the localized Review page definition.
 * @param t - Translator for the right-sidebar namespace.
 * @returns The Review page definition.
 */
export function reviewTabDefinition(t: T): SidebarRightTabDefinition {
  return pageDefinition({ id: REVIEW_TAB_ID, kind: 'review', titleKey: 'review.title', descriptionKey: 'review.description' }, t)
}

/**
 * Build the localized Terminal page definition.
 * @param t - Translator for the right-sidebar namespace.
 * @returns The Terminal page definition.
 */
export function terminalTabDefinition(t: T): SidebarRightTabDefinition {
  return pageDefinition({ id: TERMINAL_TAB_ID, kind: 'terminal', titleKey: 'terminal.title', descriptionKey: 'terminal.description' }, t)
}

/**
 * Build the localized Worktree Tasks page definition.
 * @param t - Translator for the right-sidebar namespace.
 * @returns The Worktree Tasks page definition.
 */
export function tasksTabDefinition(t: T): SidebarRightTabDefinition {
  return pageDefinition({ id: TASKS_TAB_ID, kind: 'tasks', titleKey: 'tasks.title', descriptionKey: 'tasks.description' }, t)
}

/**
 * Build the localized Browser page definition.
 * @param t - Translator for the right-sidebar namespace.
 * @returns The Browser page definition.
 */
export function browserTabDefinition(t: T): SidebarRightTabDefinition {
  return pageDefinition({ id: BROWSER_TAB_ID, kind: 'browser', titleKey: 'browser.title', descriptionKey: 'browser.description' }, t)
}
