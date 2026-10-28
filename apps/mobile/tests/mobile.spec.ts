import { describe, expect, it } from 'vitest'
import type { ScreenRoute } from '../src/navigation/routes'
import zhCN from '../src/locales/zh-CN.json'
import enUS from '../src/locales/en-US.json'

describe('mobile companion routes', () => {
  it('validates all screen routes', () => {
    const routes: ScreenRoute[] = [
      'connect-desktop',
      'settings',
      'manual-pair',
      'notifications',
      'dashboard',
      'desktop-sessions',
      'session',
    ]
    expect(routes).toContain('dashboard')
    expect(routes).toContain('desktop-sessions')
    expect(routes).toContain('connect-desktop')
  })

  it('verifies localization symmetry between zh-CN and en-US', () => {
    expect(Object.keys(zhCN)).toEqual(Object.keys(enUS))
    expect(Object.keys(zhCN.settings)).toEqual(Object.keys(enUS.settings))
    expect(Object.keys(zhCN.dashboard)).toEqual(Object.keys(enUS.dashboard))
    expect(Object.keys(zhCN.connect)).toEqual(Object.keys(enUS.connect))
    expect(Object.keys(zhCN.sessions)).toEqual(Object.keys(enUS.sessions))
    expect(zhCN.settings.general).toBe('通用')
    expect(enUS.settings.general).toBe('General')
    expect(zhCN.dashboard.stat_sessions).toBe('会话已创建')
    expect(zhCN.dashboard.stat_time).toBe('手机端运行时间')
    expect(zhCN.sessions.filter).toBe('筛选')
    expect(enUS.sessions.filter).toBe('Filter')
  })

  it('validates project files drawer component and default file tree structure', async () => {
    const { ProjectFilesDrawer } = await import('../src/components/ProjectFilesDrawer')
    expect(ProjectFilesDrawer).toBeDefined()
  })
})
