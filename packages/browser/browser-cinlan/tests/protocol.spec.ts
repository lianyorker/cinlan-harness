import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserError } from '@deepseek-ai/dsh-browser'
import {
  parseCinlanEnvelope,
  parseClickResult,
  parseElementCapturePayload,
  parseEvalResult,
  parseNavigateResult,
  parseScreenshotResult,
  parseSnapshotResult,
  parseTabCloseResult,
  parseTabCreateResult,
  parseTabListResult,
} from '../src/protocol.ts'

function expectProtocol(run: () => unknown, message?: RegExp): void {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(BrowserError)
  expect(thrown).toMatchObject({ code: 'BROWSER_CINLAN_PROTOCOL' })
  if (message !== undefined) expect((thrown as Error).message).toMatch(message)
}

function success(result: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ id: 'request-1', ok: true, result, _meta: { runtimeId: 'runtime-1' }, ...extra })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Cinlan JSON envelope parser', () => {
  it('parses strict success and failure envelopes', () => {
    expect(parseCinlanEnvelope(success({ tabs: [] }))).toEqual({
      ok: true,
      result: { tabs: [] },
      runtimeId: 'runtime-1',
    })
    expect(parseCinlanEnvelope(JSON.stringify({
      id: 'request-2',
      ok: false,
      error: { code: 'browser_tab_not_found', message: 'missing' },
      _meta: { runtimeId: 'runtime-2' },
    }))).toEqual({
      ok: false,
      error: { code: 'browser_tab_not_found', message: 'missing' },
      runtimeId: 'runtime-2',
    })
  })

  it('accepts a null runtime only on failure envelopes', () => {
    expect(parseCinlanEnvelope(JSON.stringify({
      id: 'request-3',
      ok: false,
      error: { code: 'browser_runtime_unavailable', message: 'unavailable' },
      _meta: { runtimeId: null },
    }))).toEqual({
      ok: false,
      error: { code: 'browser_runtime_unavailable', message: 'unavailable' },
      runtimeId: null,
    })
    expectProtocol(() => parseCinlanEnvelope(JSON.stringify({
      id: 'request-4', ok: true, result: {}, _meta: { runtimeId: null },
    })), /runtimeId must be/)
  })

  it('rejects malformed JSON, records, fields, and non-public keys', () => {
    expectProtocol(() => parseCinlanEnvelope('{'), /not valid JSON/)
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => { throw 'parse-failed' })
    expectProtocol(() => parseCinlanEnvelope('{}'), /parse-failed/)
    expectProtocol(() => parseCinlanEnvelope('null'), /response must be an object/)
    expectProtocol(() => parseCinlanEnvelope('[]'), /response must be an object/)
    expectProtocol(() => parseCinlanEnvelope(JSON.stringify({ id: '', ok: true, result: {}, _meta: { runtimeId: 'r' } })), /id must be/)
    expectProtocol(() => parseCinlanEnvelope(JSON.stringify({ id: 'id', ok: 'yes', result: {}, _meta: { runtimeId: 'r' } })), /ok must be/)
    expectProtocol(() => parseCinlanEnvelope(JSON.stringify({ id: 'id', ok: true, result: {}, _meta: null })), /_meta must be/)
    expectProtocol(() => parseCinlanEnvelope(JSON.stringify({ id: 'id', ok: true, result: {}, _meta: { runtimeId: '', extra: true } })), /extra is not/)
    expectProtocol(() => parseCinlanEnvelope(JSON.stringify({ id: 'id', ok: true, _meta: { runtimeId: 'r' } })), /result is required/)
    expectProtocol(() => parseCinlanEnvelope(success({}, { extra: true })), /extra is not/)
    expectProtocol(() => parseCinlanEnvelope(JSON.stringify({ id: 'id', ok: false, error: [], _meta: { runtimeId: 'r' } })), /error must be an object/)
    expectProtocol(() => parseCinlanEnvelope(JSON.stringify({ id: 'id', ok: false, error: { code: '', message: 'x' }, _meta: { runtimeId: 'r' } })), /code must be/)
    expectProtocol(() => parseCinlanEnvelope(JSON.stringify({ id: 'id', ok: false, error: { code: 'x', message: '', extra: 1 }, _meta: { runtimeId: 'r' } })), /extra is not/)
  })
})

describe('Cinlan browser result parsers', () => {
  const completeTab = {
    browserPageId: 'page-1',
    index: 0,
    url: 'https://example.com',
    title: 'Example',
    active: true,
    loadError: null,
    certificateFailure: { code: 'none' },
    worktreeId: 'worktree-1',
    profileId: null,
    profileLabel: undefined,
  }

  it('parses page listing and rejects duplicates or invalid optional diagnostics', () => {
    expect(parseTabListResult({ tabs: [completeTab, {
      browserPageId: 'page-2', index: 1, url: '', title: '', active: false,
    }] })).toEqual([
      { pageId: 'page-1', index: 0, url: 'https://example.com', title: 'Example', active: true },
      { pageId: 'page-2', index: 1, url: '', title: '', active: false },
    ])
    expectProtocol(() => parseTabListResult(null), /result must be an object/)
    expectProtocol(() => parseTabListResult({ tabs: 'no' }), /tabs must be an array/)
    expectProtocol(() => parseTabListResult({ tabs: [completeTab, completeTab] }), /duplicate page id/)
    expectProtocol(() => parseTabListResult({ tabs: [{ ...completeTab, index: -1 }] }), /index must be/)
    expectProtocol(() => parseTabListResult({ tabs: [{ ...completeTab, index: Number.MAX_SAFE_INTEGER + 1 }] }), /index must be/)
    expectProtocol(() => parseTabListResult({ tabs: [{ ...completeTab, active: 1 }] }), /active must be/)
    expectProtocol(() => parseTabListResult({ tabs: [{ ...completeTab, loadError: [] }] }), /loadError must be/)
    expectProtocol(() => parseTabListResult({ tabs: [{ ...completeTab, certificateFailure: 'bad' }] }), /certificateFailure must be/)
    expectProtocol(() => parseTabListResult({ tabs: [{ ...completeTab, worktreeId: 3 }] }), /worktreeId must be/)
    expectProtocol(() => parseTabListResult({ tabs: [{ ...completeTab, unknown: true }] }), /unknown is not/)
  })

  it('parses create, navigation, click, and close results strictly', () => {
    expect(parseTabCreateResult({ browserPageId: 'page-1' })).toBe('page-1')
    expect(parseNavigateResult({ url: 'https://example.com/next', title: 'Next' })).toEqual({
      url: 'https://example.com/next', title: 'Next',
    })
    expect(parseClickResult({ clicked: 'e1' })).toBe('e1')
    expect(parseTabCloseResult({ closed: true })).toBe(true)
    expect(parseTabCloseResult({ closed: false })).toBe(false)

    expectProtocol(() => parseTabCreateResult({ browserPageId: '' }), /browserPageId must be/)
    expectProtocol(() => parseNavigateResult({ url: 1, title: 'Next' }), /url must be/)
    expectProtocol(() => parseNavigateResult({ url: '', title: '', extra: true }), /extra is not/)
    expectProtocol(() => parseClickResult({ clicked: '' }), /clicked must be/)
    expectProtocol(() => parseTabCloseResult({ closed: 'yes' }), /closed must be/)
  })

  it('parses accessibility snapshots and rejects invalid or duplicate refs', () => {
    expect(parseSnapshotResult({
      browserPageId: 'page-1',
      snapshot: 'button "Continue" [ref=e1]',
      refs: [
        { ref: 'e1', role: 'button', name: 'Continue' },
        { ref: 'e2', role: '', name: '' },
      ],
      url: 'https://example.com',
      title: 'Example',
    })).toEqual({
      pageId: 'page-1',
      tree: 'button "Continue" [ref=e1]',
      elements: [
        { elementId: 'e1', role: 'button', name: 'Continue' },
        { elementId: 'e2', role: '', name: '' },
      ],
      url: 'https://example.com',
      title: 'Example',
    })
    expectProtocol(() => parseSnapshotResult({
      browserPageId: 'page-1', snapshot: '', refs: 'bad', url: '', title: '',
    }), /refs must be an array/)
    expectProtocol(() => parseSnapshotResult({
      browserPageId: 'page-1', snapshot: '', refs: [null], url: '', title: '',
    }), /refs\[0\] must be an object/)
    expectProtocol(() => parseSnapshotResult({
      browserPageId: 'page-1', snapshot: '', refs: [
        { ref: 'e1', role: 'button', name: 'A' },
        { ref: 'e1', role: 'button', name: 'B' },
      ], url: '', title: '',
    }), /duplicate element ref/)
    expectProtocol(() => parseSnapshotResult({
      browserPageId: 'page-1', snapshot: '', refs: [{ ref: '', role: 'button', name: 'A' }], url: '', title: '',
    }), /ref must be/)
    expectProtocol(() => parseSnapshotResult({
      browserPageId: 'page-1', snapshot: '', refs: [{ ref: 'e1', role: 1, name: 'A' }], url: '', title: '',
    }), /role must be/)
  })

  it('parses eval envelopes and exact element-capture payloads', () => {
    expect(parseEvalResult({ result: 'null', origin: 'https://example.test' })).toEqual({
      result: 'null', origin: 'https://example.test',
    })
    const payload = {
      tagName: 'button', role: 'button', name: 'Continue', text: 'Continue',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      viewport: { width: 800, height: 600 },
    }
    expect(parseElementCapturePayload(JSON.stringify(payload))).toEqual(payload)
    expect(parseElementCapturePayload('null')).toBeNull()

    expectProtocol(() => parseEvalResult({ result: 1, origin: '' }), /result must be/)
    expectProtocol(() => parseElementCapturePayload('{'), /not valid JSON/)
    expectProtocol(() => parseElementCapturePayload(JSON.stringify({ ...payload, extra: true })), /extra is not/)
    expectProtocol(() => parseElementCapturePayload(JSON.stringify({
      ...payload, rect: { ...payload.rect, width: Number.POSITIVE_INFINITY },
    })), /width must be a finite number/)
  })

  it('decodes canonical bounded PNG and JPEG payloads', () => {
    expect(parseScreenshotResult({ data: 'AQID', format: 'png' }, 3)).toEqual({
      format: 'png', data: Uint8Array.of(1, 2, 3),
    })
    expect(parseScreenshotResult({ data: 'AQI=', format: 'jpeg' }, 2)).toEqual({
      format: 'jpeg', data: Uint8Array.of(1, 2),
    })
    expect(parseScreenshotResult({ data: 'AQ==', format: 'png' }, 1)).toEqual({
      format: 'png', data: Uint8Array.of(1),
    })
  })

  it('rejects unsupported, malformed, empty, and oversized screenshot data', () => {
    expectProtocol(() => parseScreenshotResult({ data: 'AQ==', format: 'webp' }, 10), /format must be/)
    expectProtocol(() => parseScreenshotResult({ data: 'not-base64', format: 'png' }, 10), /canonical padded base64/)
    expectProtocol(() => parseScreenshotResult({ data: '', format: 'png' }, 10), /non-empty string/)
    expectProtocol(() => parseScreenshotResult({ data: '====', format: 'png' }, 10), /canonical padded base64/)
    expectProtocol(() => parseScreenshotResult({ data: 'AR==', format: 'png' }, 10), /canonical padded base64/)
    expectProtocol(() => parseScreenshotResult({ data: 'AQJ=', format: 'png' }, 10), /canonical padded base64/)
    expectProtocol(() => parseScreenshotResult({ data: 1, format: 'png' }, 10), /data must be/)
    expectProtocol(() => parseScreenshotResult({ data: 'AQID', format: 'png', extra: true }, 10), /extra is not/)
    expect(() => parseScreenshotResult({ data: 'AQID', format: 'png' }, 2)).toThrow(expect.objectContaining({
      code: 'BROWSER_SCREENSHOT_TOO_LARGE',
    }))
    vi.spyOn(Buffer, 'from').mockReturnValueOnce(Buffer.alloc(0))
    expectProtocol(() => parseScreenshotResult({ data: 'AQ==', format: 'png' }, 1), /empty image/)
  })
})
