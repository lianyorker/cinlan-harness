// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountingCells, csvCell, downloadCsv, usageCsv } from '../src/client/csv.ts'
import { en, zh, type UsageKey } from '../src/client/locales.ts'
import { report } from './fixtures.ts'

const t = (key: UsageKey) => en[key]
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('displayed Usage CSV', () => {
  it.each(['=1+1', '+SUM(1)', '-1+1', '@cmd', '  =HYPERLINK("url")', '\tplain', '\rplain', '\nplain', '\u0001@cmd'])(
    'escapes spreadsheet interpretation of %j', (value) => {
      expect(csvCell(value)).toBe('"' + "'" + value.replaceAll('"', '""') + '"')
    },
  )

  it('quotes commas, quotes and multiline labels while retaining numeric zero', () => {
    expect(csvCell('provider,"a"\nmodel')).toBe('"provider,""a""\nmodel"')
    expect(csvCell(0)).toBe('0')
    expect(accountingCells({ turns: 1, knownTurns: 1, unknownTurns: 0, attempts: 0, retries: 0,
      tokens: { totalTokens: 0, uncachedInputTokens: 0, outputTokens: 0 } }, t))
      .toEqual([1, 1, 0, 0, 0, 0, 0, 0, en.unavailable, en.unavailable, en.unavailable])
  })

  it('exports exact totals, row order, selected filters, reasons and scan coverage', () => {
    const result = report()
    const data = usageCsv({ ...result, rows: [{ ...result.totals, provider: '=1+1', model: '模型,"A"' }] }, t)
    expect(data.startsWith('\uFEFF"Record","Provider","Model","Turns"')).toBe(true)
    expect(data).toContain('"Route","\'=1+1","模型,""A""",3,2,1,5,2,150,100,40,10,"Unavailable",7')
    expect(data).toContain('"2026-09-01T00:00:00.000Z","2026-09-08T00:00:00.000Z"')
    expect(data).toContain('"Partial report — known subtotal",4,1,73,1')
    expect(data).toContain(en['reason.unknown-usage'] + ' ' + en['reason.source-error'])
    expect(data.endsWith('\r\n')).toBe(true)
    const chinese = usageCsv(result, key => zh[key])
    expect(chinese).toContain('"轮次（Turns）"')
    expect(chinese).toContain('"不可用"')
  })

  it('retains a filtered total and unavailable tokens on mixed rows', () => {
    const result = report()
    const data = usageCsv({ ...result, request: { ...result.request, provider: 'chosen', model: '@model' },
      rows: [{ ...result.totals, tokens: null }], partial: false, reasons: [] }, t)
    expect(data).toContain('"Total","chosen","\'@model"')
    expect(data).toContain('"Route","Mixed / unattributed","Mixed / unattributed",3,2,1,5,2,"Unavailable"')
    expect(data).toContain('"Complete report",4,1,73,1,"None"')
  })

  it('downloads a CSV Blob and removes both temporary resources even if activation fails', async () => {
    let blob: Blob | undefined
    const createObjectURL = vi.fn((value: Blob) => { blob = value; return 'blob:usage' })
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('usage.csv')
      expect(this.href).toBe('blob:usage')
      expect(this.isConnected).toBe(true)
    })
    const csv = usageCsv(report(), t)
    downloadCsv(csv, 'usage.csv')
    expect(blob?.type).toBe('text/csv;charset=utf-8')
    const bytes = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('expected text'))
      }
      reader.onerror = reject
      reader.readAsText(blob!)
    })
    expect(bytes).toBe(csv.slice(1))
    expect(document.querySelector('a')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:usage')
    click.mockImplementation(() => { throw new Error('download blocked') })
    expect(() => { downloadCsv(csv, 'usage.csv') }).toThrow('download blocked')
    expect(document.querySelector('a')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
