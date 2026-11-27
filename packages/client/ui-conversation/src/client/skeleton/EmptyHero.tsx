// The composer remains in ConversationRoot so switching out of the blank-draft
// phase does not remount its textarea.

import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  FISH_LOGO_PATH, FISH_LOGO_VIEWBOX, IconChevronDownOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { ConversationContentProps } from '../contract/slots.ts'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationContentProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderCloseRegular className={css.folder} size={16} />
        : <IconFolderOpenRegular className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutlineRegular className={css.chevron} size={12} />
    </button>
  )
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationContentProps['renderSlot']
  /** Text shown instead of the default headline and preview badge. */
  headline?: string | undefined
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/* Hover swim morph targets: the resting FISH_LOGO_PATH with weighted
   regional deformation baked in (generated programmatically — parse the
   path's absolute M/C/L/Z commands, displace points with smoothstep falloff
   weights, emit the same command structure so SMIL can interpolate `d`
   between them). Tail: rotation about (15.6, 5.2) with weight growing toward
   the tail tip (x>15, y<8.5) — UP -7°, DOWN +6°. Mouth/fin swoosh: a bend,
   not a rotation — vertical lift with weight-squared falloff from the body
   anchor (14.1, 15.0), so the near end stays seated and the mouth corner
   sweeps most, a smile lift (UP -0.7 units at the tip, DOWN +0.5). The eye
   subpaths carry zero weight and stay fixed. */
const HERO_SWIM_UP_PATH =
  'M16.8 8.52A8.2 8.2 0 1 1 8.6 0.32L8.6 4.32A4.2 4.2 0 1 0 12.8 8.52ZM12.98 2.19L14.43 3.64L12.98 5.09L11.53 3.64Z'
const HERO_SWIM_DOWN_PATH =
  'M16.8 8.52A8.2 8.2 0 1 1 8.6 0.32L8.6 4.32A4.2 4.2 0 1 0 12.8 8.52ZM12.98 3.14L14.43 4.59L12.98 6.04L11.53 4.59Z'

/**
 * The hero fish (34px wide), static at rest. Hovering swims the whale in
 * place: a gentle head-up sway (CSS, on the hitbox hover) while the body
 * itself morphs — SMIL interpolates `d` through the tail-up and tail-down
 * targets on the same 1.6s period, so the tail wags and the fin flutters in
 * real curve deformation. Decorative — hidden from the accessibility tree;
 * reduced motion keeps the static filled logo on hover (sampled at
 * mouseenter; a mid-hover preference change takes effect on the next enter).
 * @param props.hovering - driven by the hitbox parent's pointer state.
 * @returns the fish svg element.
 */
function HeroFish({ hovering }: { hovering: boolean }) {
  return (
    <svg
      className={css.fish}
      width={34}
      height={(34 * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <path d={FISH_LOGO_PATH} fill="currentColor">
        {hovering && (
          <animate
            attributeName="d"
            values={`${FISH_LOGO_PATH};${HERO_SWIM_UP_PATH};${FISH_LOGO_PATH};${HERO_SWIM_DOWN_PATH};${FISH_LOGO_PATH}`}
            keyTimes="0;0.35;0.55;0.75;1"
            calcMode="spline"
            keySplines="0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1"
            dur="1.6s"
            repeatCount="indefinite"
          />
        )}
      </path>
    </svg>
  )
}

/**
 * Render the hero chrome (headline only; no composer, no workspace row).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, renderSlot, headline, children }: HeroShellProps) {
  const [hovering, setHovering] = useState(false)
  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.headline}>
          {/* figma 34:10412: fish 34×25 leading the headline, gap 10. */}
          <span
            className={css.fishHitbox}
            onPointerEnter={(event) => {
              if (event.pointerType !== 'touch'
                && window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) {
                setHovering(true)
              }
            }}
            onPointerLeave={() => { setHovering(false) }}
          >
            {renderSlot('conversation.hero.brand.mark', { size: 34, className: css.fish }, {
              fallback: <HeroFish hovering={hovering} />,
            })}
          </span>
          <span className={css.titleGroup}>
            {/* Own element: keeps the headline text addressable apart from the badge. */}
            <span>{headline ?? t('hero.headline')}</span>
            {headline === undefined && <span className={css.previewBadge}>{t('hero.preview')}</span>}
          </span>
        </div>
        <div className={css.body}>
          {/* The composer remains mounted outside this component. */}
        </div>
      </div>
      {children}
    </div>
  )
}
