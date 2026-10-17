import type { ReactNode } from 'react'

const STROKE = 1.75

export function IconRefresh({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M2.5 8C2.5 4.96243 4.96243 2.5 8 2.5C10.5 2.5 12.6 4.15 13.25 6.45" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
      <path d="M13.5 8C13.5 11.0376 11.0376 13.5 8 13.5C5.5 13.5 3.4 11.85 2.75 9.55" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
      <path d="M14 3.5V6.5H11" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 12.5V9.5H5" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconArrowRight({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M3.5 8H12.5" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
      <path d="M8.5 4L12.5 8L8.5 12" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconShield({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8 2L3 4.5V8.5C3 11.5 5.5 13.8 8 14.5C10.5 13.8 13 11.5 13 8.5V4.5L8 2Z" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round" />
      <path d="M6 8L7.5 9.5L10.5 6.5" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconPalette({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8 2.5C4.96243 2.5 2.5 4.96243 2.5 8C2.5 11.0376 4.96243 13.5 8 13.5C8.8 13.5 9.5 12.8 9.5 12C9.5 11.6 9.35 11.25 9.1 11C8.85 10.75 8.7 10.4 8.7 10C8.7 9.2 9.4 8.5 10.2 8.5H11.5C12.6 8.5 13.5 7.6 13.5 6.5C13.5 4.3 11 2.5 8 2.5Z" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round" />
      <circle cx="5.5" cy="6.5" r="1" fill="currentColor" />
      <circle cx="8" cy="5.25" r="1" fill="currentColor" />
      <circle cx="10.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  )
}

export function IconPin({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M9.5 2.5L13.5 6.5L11 9L11.5 13.5L10 12L8 10L4 14L4.5 10L2.5 8L7 8.5L9.5 2.5Z" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round" />
    </svg>
  )
}

export function IconClose({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M4 4L12 12" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
      <path d="M12 4L4 12" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
    </svg>
  )
}

export function IconSparkle({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8 2V14M2 8H14M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
    </svg>
  )
}
