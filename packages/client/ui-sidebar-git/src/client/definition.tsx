/**
 * The Git review tab type: what the `git` kind of the right Sidebar is.
 *
 * A page, not a viewer: it claims no address. The guide page offers it as an
 * entry box beside files and terminal.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** The tab kind this package owns. */
export const GIT_KIND = 'git'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const GIT_ID = '@cinlan/client-ui-sidebar-git'

/**
 * The Git review type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function gitDefinition(t: TranslateNS<'sidebarGitReview'>): SidebarRightTabDefinition {
  return {
    id: GIT_ID,
    kind: GIT_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      id: 'repository-review',
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconBranchOutlineRegular,
    }],
  }
}
