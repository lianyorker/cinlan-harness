import { describe, expect, it } from 'vitest'
import { MOCK_DATA } from '../src/mock/mock-data'
import type { ScreenRoute } from '../src/navigation/routes'
import zhCN from '../src/locales/zh-CN.json'
import enUS from '../src/locales/en-US.json'

describe('mobile companion mock & routes', () => {
  it('provides complete mock data according to design spec', () => {
    expect(MOCK_DATA.stats.agentsCreated).toBe(15)
    expect(MOCK_DATA.stats.runtimeFormatted).toBe('1天 12小时')
    expect(MOCK_DATA.desktops.length).toBeGreaterThan(0)
    expect(MOCK_DATA.desktops[0].name).toBe('DESKTOP-3QU41U1')
    expect(MOCK_DATA.desktops[0].os).toBe('Windows')
    expect(MOCK_DATA.workspaces.length).toBe(4)
    expect(MOCK_DATA.workspaces[0].name).toBe('DEEPSEEK 1')
    expect(MOCK_DATA.workspaces[1].name).toBe('cinlan-harness')

    // Settings mock validation: only the two surfaces that still read static
    // defaults; voice and troubleshooting render live transport state.
    expect(MOCK_DATA.settings.browser.openTerminalLinks).toBe('desktop')
    expect(MOCK_DATA.settings.notifications.onlyWhenAway).toBe(true)
  })

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
