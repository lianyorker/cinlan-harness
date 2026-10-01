import type { IconProps } from './icons/props.ts'
import { CINLAN_LOGO_DATA_URL } from './FishLogo.tsx'

/** Display options for the official brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading brand mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading brand mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 182 : 156
  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 182 24' : '26 0 156 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark && (
        <image
          href={CINLAN_LOGO_DATA_URL}
          x="0"
          y="0"
          width="24"
          height="24"
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      <text
        x="32"
        y="17"
        fill="currentColor"
        fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
        fontSize="15"
        fontWeight="700"
        letterSpacing="-0.3px"
      >
        Cinlan
      </text>
      <rect
        x="82"
        y="5"
        width="66"
        height="14"
        rx="3"
        fill="currentColor"
      />
      <text
        x="87"
        y="15.5"
        fill="var(--dsw-alias-label-primary-inverted, #ffffff)"
        fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        fontSize="9.5"
        fontWeight="800"
        letterSpacing="0.8px"
      >
        HARNESS
      </text>
    </svg>
  )
}
