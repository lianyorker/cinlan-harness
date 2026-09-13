import { describe, expect, it } from 'vitest'
import {
  parseAction,
  parseCapabilities,
  parseCinlanComputerEnvelope,
  parseListApps,
  parseListWindows,
  parseObservation,
} from '../src/protocol.ts'

function capabilities() {
  return {
    platform: 'win32', provider: 'orca-computer-use-windows', providerVersion: '1', protocolVersion: 1,
    supports: {
      apps: { list: true, bundleIds: true, pids: true },
      windows: { list: true, targetById: true, targetByIndex: true, focus: true, moveResize: false },
      observation: { screenshot: true, annotatedScreenshot: false, elementFrames: true, ocr: false },
      actions: {
        click: true, typeText: true, pressKey: true, hotkey: true, pasteText: true,
        scroll: true, drag: true, setValue: true, performAction: true,
      },
      surfaces: { menus: true, dialogs: true, dock: false, menubar: false },
    },
  }
}

function snapshot(action?: unknown, screenshot: unknown = null, screenshotStatus: unknown = {
  state: 'skipped', reason: 'no_screenshot_flag',
}) {
  return {
    snapshot: {
      id: 'source-observation',
      app: { name: 'App', bundleId: 'com.example.app', pid: 7 },
      window: {
        id: 9, index: null, title: 'Window', x: 1, y: 2, width: 800, height: 600,
        isMinimized: false, isOffscreen: false, screenIndex: 0,
      },
      coordinateSpace: 'window',
      treeText: 'App=App\n\n0 button Continue\n\t7 edit Name',
      elementCount: 2,
      focusedElementId: 7,
      truncation: { truncated: false, maxNodes: 100, maxDepth: 20, maxDepthReached: false },
    },
    screenshot,
    screenshotStatus,
    ...(action === undefined ? {} : { action }),
  }
}

function listedApp() {
  return { name: 'App', bundleId: 'app', pid: 1 }
}

function listedWindow(overrides: Record<string, unknown> = {}) {
  return {
    app: listedApp(), id: 1, index: null, title: 'Window', width: 1, height: 1, ...overrides,
  }
}

describe('Cinlan Computer Use protocol envelope', () => {
  it('parses success and failure envelopes with next steps', () => {
    expect(parseCinlanComputerEnvelope(JSON.stringify({
      id: 'id', ok: true, result: { value: 1 }, _meta: { runtimeId: 'runtime' },
    }))).toEqual({ ok: true, result: { value: 1 }, runtimeId: 'runtime' })
    expect(parseCinlanComputerEnvelope(JSON.stringify({
      id: 'id', ok: false,
      error: { code: 'app_not_found', message: 'missing', data: { nextSteps: ['list apps'], selector: 'ignored' } },
      _meta: { runtimeId: 'runtime' },
    }))).toEqual({
      ok: false,
      error: { code: 'app_not_found', message: 'missing', nextSteps: ['list apps'] },
      runtimeId: 'runtime',
    })
    expect(parseCinlanComputerEnvelope(JSON.stringify({
      id: 'id', ok: false, error: { code: 'failed', message: 'failed' }, _meta: { runtimeId: 'runtime' },
    }))).toMatchObject({ error: { nextSteps: [] } })
    expect(parseCinlanComputerEnvelope(JSON.stringify({
      id: 'id', ok: false, error: { code: 'failed', message: 'failed', data: {} }, _meta: { runtimeId: 'runtime' },
    }))).toMatchObject({ error: { nextSteps: [] } })
  })

  it.each([
    ['not json', /not valid JSON/],
    [JSON.stringify([]), /response must be an object/],
    [JSON.stringify({ id: '', ok: true, result: {}, _meta: { runtimeId: 'runtime' } }), /id must be/],
    [JSON.stringify({ id: 'id', ok: 'yes', result: {}, _meta: { runtimeId: 'runtime' } }), /ok must be/],
    [JSON.stringify({ id: 'id', ok: true, _meta: { runtimeId: 'runtime' } }), /result is required/],
    [JSON.stringify({ id: 'id', ok: true, result: {}, extra: 1, _meta: { runtimeId: 'runtime' } }), /extra is not/],
    [JSON.stringify({ id: 'id', ok: false, error: { code: 'x', message: 'x', data: { nextSteps: [1] } }, _meta: { runtimeId: 'runtime' } }), /array of strings/],
  ])('rejects malformed envelope %s', (text, pattern) => {
    expect(() => parseCinlanComputerEnvelope(text)).toThrow(pattern)
  })
})

describe('Cinlan Computer Use result parsers', () => {
  it('parses protocol capabilities', () => {
    expect(parseCapabilities(capabilities())).toEqual(capabilities())
  })

  it('parses apps and chooses bundle-id or pid selectors', () => {
    expect(parseListApps({ apps: [
      { name: 'App', bundleId: 'com.example.app', pid: 7, isRunning: true, lastUsedAt: null, useCount: 2 },
      { name: 'No Bundle', bundleId: null, pid: 8, isRunning: false, lastUsedAt: 'now', useCount: null },
    ] })).toMatchObject([
      { appId: 'com.example.app', running: true, useCount: 2 },
      { appId: 'pid:8', running: false, lastUsedAt: 'now' },
    ])
    expect(() => parseListApps({ apps: [
      { name: 'A', bundleId: 'same', pid: 1, isRunning: true, lastUsedAt: null, useCount: null },
      { name: 'B', bundleId: 'same', pid: 2, isRunning: true, lastUsedAt: null, useCount: null },
    ] })).toThrow(/duplicate app id/)
  })

  it('parses windows and prefers provider window ids', () => {
    const app = { name: 'App', bundleId: 'com.example.app', pid: 7 }
    expect(parseListWindows({ app, windows: [
      { app, id: 9, index: 0, title: 'One', x: null, y: null, width: 10, height: 20, isMinimized: null, isOffscreen: null, screenIndex: null, platform: {}, isMain: true },
      { app, id: null, index: 1, title: 'Two', width: 30, height: 40, isMain: null },
    ] })).toMatchObject([
      { windowId: 'id:9', main: true },
      { windowId: 'index:1', main: null },
    ])
  })

  it('parses sparse observation fields and provider failure status', () => {
    const base = snapshot(undefined, null, { state: 'failed', code: 'capture_failed', message: 'failed' })
    const sparse = { ...base, snapshot: { ...base.snapshot, focusedElementId: null, truncation: undefined } }
    expect(parseObservation(sparse)).toMatchObject({
      focusedElementId: null,
      screenshotStatus: { state: 'failed', code: 'capture_failed', message: 'failed' },
    })

    expect(parseObservation({
      ...snapshot(),
      snapshot: { ...snapshot().snapshot, truncation: { truncated: false } },
    })).toMatchObject({ truncation: { truncated: false } })
  })

  it('parses observations, sparse elements, truncation, and screenshots', () => {
    const parsed = parseObservation(snapshot(undefined, {
      format: 'png', width: 2, height: 1, scale: 1, data: 'iVBORw0KGgo=', dataOmitted: false,
    }, { state: 'captured', metadata: { engine: 'unknown', windowId: 9 } }))
    expect(parsed).toMatchObject({
      sourceId: 'source-observation',
      app: { appId: 'com.example.app' },
      window: { windowId: 'id:9' },
      elements: [{ elementId: '0', index: 0 }, { elementId: '7', index: 7 }],
      focusedElementId: '7',
      screenshot: { width: 2, height: 1, format: 'png' },
      screenshotStatus: { state: 'captured' },
    })
    expect(parseObservation(snapshot(undefined, {
      format: 'png', width: 2, height: 1, scale: 1, path: 'C:\\shot.png', expiresAt: 'later',
    }, { state: 'captured' }))).toMatchObject({
      screenshot: { path: 'C:\\shot.png', expiresAt: 'later' },
    })
  })

  it('parses redacted verified and unverified action metadata', () => {
    expect(parseAction(snapshot({
      path: 'accessibility', actionName: 'SetValue', fallbackReason: null,
      targetWindowId: 9, targetWindowIndex: null,
      verification: { state: 'verified', property: 'value', expected: 'secret', actualPreview: 'secret' },
    }))).toMatchObject({ action: { path: 'accessibility', verification: { state: 'verified', property: 'value' } } })
    expect(parseAction(snapshot({
      path: 'clipboard', actionName: null, fallbackReason: 'fallback',
      verification: { state: 'unverified', reason: 'clipboard_paste', expected: null, actualPreview: null },
    }))).toMatchObject({ action: { verification: { state: 'unverified', reason: 'clipboard_paste' } } })
    expect(parseAction(snapshot())).not.toHaveProperty('action')
    expect(parseAction(snapshot({ path: 'synthetic' }))).toMatchObject({
      action: { path: 'synthetic', actionName: null, fallbackReason: null },
    })
    for (const reason of ['synthetic_input', 'provider_unavailable', 'window_changed', 'value_mismatch'] as const) {
      expect(parseAction(snapshot({
        path: 'synthetic', verification: { state: 'unverified', reason },
      }))).toMatchObject({ action: { verification: { state: 'unverified', reason } } })
    }
  })

  it.each([
    [() => parseCapabilities({ ...capabilities(), platform: 'unknown' }), /known Node platform/],
    [() => parseCapabilities({ ...capabilities(), protocolVersion: 0 }), /must be positive/],
    [() => parseCapabilities({ ...capabilities(), protocolVersion: -1 }), /non-negative safe integer/],
    [() => parseListApps({ apps: 'bad' }), /must be an array/],
    [() => parseListApps({ apps: [
      { name: 'App', bundleId: 1, pid: 1, isRunning: true, lastUsedAt: null, useCount: null },
    ] }), /bundleId must be/],
    [() => parseListApps({ apps: [
      { name: 'App', bundleId: 'app', pid: 1, isRunning: true, lastUsedAt: null, useCount: -1 },
    ] }), /useCount must be/],
    [() => parseListWindows({ app: { name: 'App', bundleId: 'app', pid: 1 }, windows: 'bad' }), /must be an array/],
    [() => parseListWindows({ app: listedApp(), windows: [listedWindow({ id: null })] }), /publish id or index/],
    [() => parseListWindows({ app: listedApp(), windows: [listedWindow({ title: 1 })] }), /title must be a string/],
    [() => parseListWindows({ app: listedApp(), windows: [listedWindow({ x: 'bad' })] }), /x must be a finite number/],
    [() => parseListWindows({ app: listedApp(), windows: [listedWindow({ platform: 'bad' })] }), /platform must be an object/],
    [() => parseListWindows({
      app: listedApp(), windows: [listedWindow({ app: { name: 'Other', bundleId: 'other', pid: 2 } })],
    }), /does not match/],
    [() => parseListWindows({
      app: listedApp(), windows: [listedWindow(), listedWindow()],
    }), /duplicate window id/],
    [() => parseListWindows({ app: listedApp(), windows: [listedWindow({ isMinimized: 'bad' })] }), /isMinimized must be/],
    [() => parseObservation({ ...snapshot(), action: {} }), /action must be absent/],
    [() => parseObservation({ ...snapshot(), screenshotStatus: { state: 'captured' } }), /disagree/],
    [() => parseObservation({ ...snapshot(), snapshot: { ...snapshot().snapshot, coordinateSpace: 'screen' } }), /coordinateSpace/],
    [() => parseObservation({ ...snapshot(), snapshot: { ...snapshot().snapshot, treeText: '0 a\n0 b' } }), /duplicate element/],
    [() => parseObservation({
      ...snapshot(), snapshot: { ...snapshot().snapshot, elementCount: 1 },
    }), /elementCount is smaller/],
    [() => parseObservation(snapshot(undefined, {
      format: 'jpeg', width: 1, height: 1, scale: 1, data: 'data',
    }, { state: 'captured' })), /format must be "png"/],
    [() => parseObservation(snapshot(undefined, {
      format: 'png', width: 1, height: 1, scale: 1,
    }, { state: 'captured' })), /publish data or path/],
    [() => parseObservation(snapshot(undefined, {
      format: 'png', width: 1, height: 1, scale: 1, data: 1,
    }, { state: 'captured' })), /data must be a string/],
    [() => parseObservation(snapshot(undefined, {
      format: 'png', width: 1, height: 1, scale: Number.NaN, data: 'data',
    }, { state: 'captured' })), /scale must be a finite number/],
    [() => parseObservation(snapshot(undefined, {
      format: 'png', width: 1, height: 1, scale: 1, data: 'data', dataOmitted: 'bad',
    }, { state: 'captured' })), /dataOmitted must be a boolean/],
    [() => parseObservation(snapshot(undefined, null, {
      state: 'skipped', reason: 'unknown',
    })), /reason must be "no_screenshot_flag"/],
    [() => parseObservation(snapshot(undefined, null, { state: 'unknown' })), /state is unsupported/],
    [() => parseAction(snapshot({ path: 'unknown' })), /path is unsupported/],
    [() => parseAction(snapshot({ path: 'synthetic', actionName: 1 })), /actionName must be/],
    [() => parseAction(snapshot({
      path: 'synthetic', verification: { state: 'verified', property: 'unknown' },
    })), /property is unsupported/],
    [() => parseAction(snapshot({
      path: 'synthetic', verification: { state: 'unverified', reason: 'unknown' },
    })), /reason is unsupported/],
    [() => parseAction(snapshot({ path: 'synthetic', verification: { state: 'unknown' } })), /state is unsupported/],
  ])('rejects malformed result values', (run, pattern) => {
    expect(run).toThrow(pattern)
  })
})
