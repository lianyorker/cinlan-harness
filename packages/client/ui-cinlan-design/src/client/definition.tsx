/** Static Cinlan Design tab type and guide declaration. */
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './locales.ts'

/** Cinlan Design tab kind. */
export const CINLAN_DESIGN_KIND = 'cinlan-design'

/** Implementation identity and Slot dispatch key. */
export const CINLAN_DESIGN_ID = '@deepseek-ai/dsh-client-ui-cinlan-design'

/** Ornamental artwork icon for the guide entry. */
export function GuideArtworkCinlanDesign(props: IconProps) {
  const { size = 36, className } = props
  return (
    <svg width={size} height={size} className={className} aria-hidden="true" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="7" width="26" height="22" rx="4" stroke="#A78BFA" strokeWidth="2" />
      <path d="M5 13H31" stroke="#A78BFA" strokeWidth="2" />
      <circle cx="9" cy="10" r="1.5" fill="#EC4899" />
      <circle cx="14" cy="10" r="1.5" fill="#F59E0B" />
      <circle cx="19" cy="10" r="1.5" fill="#10B981" />
      <path d="M12 24L16 18L20 22L24 16" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Build the Cinlan Design type definition. */
export function cinlanDesignDefinition(t: TranslateNS<'cinlanDesign'>): SidebarRightTabDefinition {
  return {
    id: CINLAN_DESIGN_ID,
    kind: CINLAN_DESIGN_KIND,
    multiple: true,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      id: 'new',
      commandId: 'design.new' as ShortcutCommandId,
      order: 35,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: GuideArtworkCinlanDesign,
    }],
  }
}
