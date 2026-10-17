/** Route identifiers for Cinlan Mobile app navigation. */
export type ScreenRoute =
  | 'connect-desktop'
  | 'settings'
  | 'manual-pair'
  | 'notifications'
  | 'dashboard'
  | 'desktop-sessions'
  | 'session'

export interface NavigationState {
  readonly currentRoute: ScreenRoute
  readonly previousRoute?: ScreenRoute
  readonly activeSessionId?: string
}
