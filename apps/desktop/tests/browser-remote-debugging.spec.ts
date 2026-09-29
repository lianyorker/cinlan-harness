import { describe, expect, it } from 'vitest'
import { desktopRemoteDebuggingPort } from '../src/browser-remote-debugging.ts'

describe('desktopRemoteDebuggingPort', () => {
  it('returns undefined when no environment variable is set', () => {
    expect(desktopRemoteDebuggingPort({})).toBeUndefined()
  })

  it('reads DSH_DESKTOP_RENDERER_DEBUG_PORT first', () => {
    expect(desktopRemoteDebuggingPort({
      DSH_DESKTOP_RENDERER_DEBUG_PORT: '9222',
      DSH_DESKTOP_CDP_PORT: '9333',
      CINLAN_DESKTOP_CDP_PORT: '9444',
    })).toBe(9222)
  })

  it('falls back to DSH_DESKTOP_CDP_PORT and CINLAN_DESKTOP_CDP_PORT', () => {
    expect(desktopRemoteDebuggingPort({
      DSH_DESKTOP_CDP_PORT: '9333',
      CINLAN_DESKTOP_CDP_PORT: '9444',
    })).toBe(9333)

    expect(desktopRemoteDebuggingPort({
      CINLAN_DESKTOP_CDP_PORT: '9444',
    })).toBe(9444)
  })

  it('treats empty string as undefined', () => {
    expect(desktopRemoteDebuggingPort({
      DSH_DESKTOP_RENDERER_DEBUG_PORT: '',
      DSH_DESKTOP_CDP_PORT: '',
      CINLAN_DESKTOP_CDP_PORT: '',
    })).toBeUndefined()
  })

  it('validates TCP port range boundaries (1024-65535)', () => {
    expect(desktopRemoteDebuggingPort({ DSH_DESKTOP_CDP_PORT: '1024' })).toBe(1024)
    expect(desktopRemoteDebuggingPort({ DSH_DESKTOP_CDP_PORT: '65535' })).toBe(65535)

    expect(() => desktopRemoteDebuggingPort({ DSH_DESKTOP_CDP_PORT: '1023' }))
      .toThrow(/must be an integer between 1024 and 65535/)
    expect(() => desktopRemoteDebuggingPort({ DSH_DESKTOP_CDP_PORT: '65536' }))
      .toThrow(/must be an integer between 1024 and 65535/)
    expect(() => desktopRemoteDebuggingPort({ DSH_DESKTOP_CDP_PORT: 'invalid' }))
      .toThrow(/must be an integer between 1024 and 65535/)
    expect(() => desktopRemoteDebuggingPort({ DSH_DESKTOP_CDP_PORT: '9222.5' }))
      .toThrow(/must be an integer between 1024 and 65535/)
  })
})
