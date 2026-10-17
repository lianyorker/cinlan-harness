import React, { createContext, useContext, useEffect, useState } from 'react'
import zhCN from '../locales/zh-CN.json'
import enUS from '../locales/en-US.json'
import {
  PushNotificationBanner,
  type PushNoticeOptions,
} from '../components/PushNotificationBanner'

export type LanguageCode = 'zh-CN' | 'en-US'
export type ThemeMode = 'dark' | 'light' | 'system'

export interface ThemeLanguageContextType {
  readonly language: LanguageCode
  readonly setLanguage: (lang: LanguageCode) => void
  readonly themeMode: ThemeMode
  readonly setThemeMode: (theme: ThemeMode) => void
  readonly resolvedTheme: 'dark' | 'light'
  readonly t: (path: string) => string
  readonly showNotice: (options: string | PushNoticeOptions) => void
}

const dictionaries: Record<LanguageCode, Record<string, any>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

function resolveNestedKey(obj: Record<string, any>, path: string): string | null {
  const parts = path.split('.')
  let current: any = obj
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') return null
    current = current[part]
  }
  return typeof current === 'string' ? current : null
}

const ThemeLanguageContext = createContext<ThemeLanguageContextType | null>(null)

export const ThemeLanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cinlan_mobile_lang')
      if (saved === 'zh-CN' || saved === 'en-US') return saved
    }
    return 'zh-CN'
  })

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cinlan_mobile_theme')
      if (saved === 'dark' || saved === 'light' || saved === 'system') return saved
    }
    return 'dark'
  })

  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return true
  })

  // Watch system color scheme changes
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const resolvedTheme = themeMode === 'system' ? (systemIsDark ? 'dark' : 'light') : themeMode

  // Apply resolved theme to HTML root
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (resolvedTheme === 'light') {
      root.classList.remove('dark')
      root.classList.add('light')
      root.setAttribute('data-theme', 'light')
    } else {
      root.classList.remove('light')
      root.classList.add('dark')
      root.setAttribute('data-theme', 'dark')
    }
  }, [resolvedTheme])

  const setLanguage = (lang: LanguageCode) => {
    setLanguageState(lang)
    try {
      localStorage.setItem('cinlan_mobile_lang', lang)
    } catch {}
  }

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode)
    try {
      localStorage.setItem('cinlan_mobile_theme', mode)
    } catch {}
  }

  const t = (path: string): string => {
    const dict = dictionaries[language] ?? zhCN
    const found = resolveNestedKey(dict, path)
    if (found !== null) return found
    const fallback = resolveNestedKey(zhCN, path)
    return fallback ?? path
  }

  const [activeNotice, setActiveNotice] = useState<PushNoticeOptions | null>(null)

  const showNotice = (options: string | PushNoticeOptions) => {
    if (typeof options === 'string') {
      setActiveNotice({ message: options })
    } else {
      setActiveNotice(options)
    }
  }

  return (
    <ThemeLanguageContext.Provider
      value={{
        language,
        setLanguage,
        themeMode,
        setThemeMode,
        resolvedTheme,
        t,
        showNotice,
      }}
    >
      {children}
      <PushNotificationBanner
        notification={activeNotice}
        onClose={() => setActiveNotice(null)}
      />
    </ThemeLanguageContext.Provider>
  )
}

export function useAppConfig(): ThemeLanguageContextType {
  const context = useContext(ThemeLanguageContext)
  if (!context) {
    throw new Error('useAppConfig must be used within ThemeLanguageProvider')
  }
  return context
}
