import type { SVGProps } from 'react'

/** Cinlan official stylized wing logo. */
export function CinlanLogo({ className = 'w-5 h-4 text-white', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        d="M2 15.5C6.6 15.5 10.5 13.1 13.9 9.8C17.2 6.6 21 4.7 29.6 4C24.7 7.1 21.4 10.1 18.6 13.9C15.6 18 11.6 20.5 5 20.5L2 15.5Z"
        fill="currentColor"
      />
      <path d="M8 8.8C11.8 8.8 14.8 7.2 17.1 4.4C18.3 3 19.8 2.1 22 1.8C20.1 4.7 17.6 7.1 14.7 8.6C12.4 9.8 10.2 10.2 8 8.8Z" fill="currentColor" opacity="0.65" />
      <path d="M10.2 18.2C14.6 18.2 18.1 16.7 21.4 13.3C23.4 11.2 25.9 9.7 30 8.8C26.5 12.2 23.8 15.4 20 17.5C16.9 19.2 13.4 20.2 10.2 18.2Z" fill="currentColor" opacity="0.4" />
    </svg>
  )
}
