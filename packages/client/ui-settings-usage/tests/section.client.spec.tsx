// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { UsageQueryResult } from '@deepseek-ai/dsh-api-usage-controller/types'
import { UsageSection, type UsageSectionProps } from '../src/client/UsageSection.tsx'
import { createUsageFiltersStore } from '../src/client/filters.ts'
import { UsageSource, type QueryUsage } from '../src/client/source.ts'
import { usageCsv } from '../src/client/csv.ts'
import { en, zh, type UsageKey } from '../src/client/locales.ts'
import { deferred, report } from './fixtures.ts'

const sources: UsageSource[] = []
const release: (() => void)[] = []
afterEach(async () => {
  cleanup()
  for (const resolve of release.splice(0)) resolve()
  await Promise.all(sources.splice(0).map(source => source.dispose()))
})

function mount(query: QueryUsage | undefined, dictionary: Record<UsageKey, string> = en) {
  const source = new UsageSource()
  sources.push(source)
  if (query) source.connect(query)
  const store = createUsageFiltersStore().create()
  store.actions.setDate('fromDate', '2026-09-01')
  store.actions.setDate('toDate', '2026-09-08')
  const download = vi.fn<UsageSectionProps['download']>()
  const unused = (() => { throw new Error('unused standard hook') }) as never
  const props: UsageSectionProps = {
    close: vi.fn(),
    useSessions: unused, useWorkspaces: unused, useSessionPendingInteraction: unused, useResource: unused,
    useStore: bindSnapshotSelector(store), actions: store.actions,
    useUsage: bindSnapshotSelector(source), load: source.load, cancel: source.cancel,
    download, t: makeTranslate(dictionary),
  }
  return { ...render(<UsageSection {...props} />), props, source, store, download }
}
function delayed() {
  const value = deferred<UsageQueryResult>()
  release.push(() => { value.resolve(report()) })
  return value
}
function disabled(name: string): boolean { return screen.getByRole<HTMLButtonElement>('button', { name }).disabled }

describe('Usage settings page', () => {
  it.each([en, zh])('renders localized exact accounting, coverage, and the displayed CSV', async (dictionary) => {
    let displayed: UsageQueryResult | undefined
    const query = vi.fn<QueryUsage>(async (request) => { displayed = report(request); return displayed })
    const h = mount(query, dictionary)
    await screen.findByText(dictionary.partial)
    expect(screen.getByText(dictionary.accountingHelp)).toBeTruthy()
    expect(screen.getByText(dictionary['reason.source-error'])).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: dictionary.turns })).toBeTruthy()
    expect(within(table).getByRole('cell', { name: '150' })).toBeTruthy()
    expect(within(table).getByRole('cell', { name: dictionary.unavailable })).toBeTruthy()
    expect(screen.getByText('2026-09-08T12:00:00.000Z')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: dictionary.export }))
    expect(h.download).toHaveBeenCalledWith(usageCsv(displayed!, key => dictionary[key]), dictionary.csvFilename)
    expect(query).toHaveBeenCalledOnce()
  })

  it('sends exact date and route filters, cancels a stale query, and refreshes live data', async () => {
    const late = delayed()
    const query = vi.fn<QueryUsage>().mockImplementationOnce(async request => report(request))
      .mockImplementationOnce(() => late.promise).mockImplementation(async request => report(request))
    const h = mount(query)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText(en.provider), { target: { value: 'route:=SUM(1,2)' } })
    expect(disabled(en.export)).toBe(true)
    expect(query.mock.calls[1]![0]).toEqual({ from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 8, 8), provider: '=SUM(1,2)' })
    fireEvent.change(screen.getByLabelText(en.from), { target: { value: '2026-09-02' } })
    expect(query.mock.calls[1]![1].signal.aborted).toBe(true)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText(en.model), { target: { value: 'route:model-b' } })
    await screen.findByRole('table')
    expect(query.mock.lastCall![0]).toEqual({ from: Date.UTC(2026, 8, 2), to: Date.UTC(2026, 8, 8), provider: '=SUM(1,2)', model: 'model-b' })
    const before = query.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await screen.findByRole('table')
    expect(query).toHaveBeenCalledTimes(before + 1)
    await act(async () => { late.resolve(report()); await late.promise })
    fireEvent.click(screen.getByRole('button', { name: en.export }))
    expect(h.download.mock.lastCall![0]).toContain('2026-09-02T00:00:00.000Z')
  })

  it('distinguishes an empty report, known zero, and unavailable token accounting', async () => {
    const empty = { turns: 0, knownTurns: 0, unknownTurns: 0, attempts: 0, retries: 0, tokens: null }
    const zero = { ...empty, turns: 1, knownTurns: 1, tokens: { totalTokens: 0, uncachedInputTokens: 0, outputTokens: 0 } }
    const query = vi.fn<QueryUsage>().mockImplementationOnce(async request => report(request, {
      totals: empty, rows: [], partial: false, reasons: [],
    })).mockImplementationOnce(async request => report(request, {
      totals: zero, rows: [{ ...zero, provider: 'p', model: 'm' }], partial: false, reasons: [],
    })).mockImplementation(async request => report(request, {
      totals: { ...empty, turns: 1, unknownTurns: 1 }, rows: [{ ...empty, turns: 1, unknownTurns: 1 }],
    }))
    mount(query)
    await screen.findByText(en.empty)
    expect(screen.getAllByText(en.unavailable).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    const table = await screen.findByRole('table')
    expect(screen.queryByText(en.empty)).toBeNull()
    expect(within(table).getAllByRole('cell', { name: '0' }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await screen.findByText(en.partial)
    expect(within(screen.getByRole('table')).getAllByText(en.mixed)).toHaveLength(2)
    expect(within(screen.getByRole('table')).getAllByRole('cell', { name: en.unavailable })).toHaveLength(6)
  })

  it('shows localized unavailable and failure states, blocks export, and can recover', async () => {
    const h = mount(undefined)
    expect(screen.getByText(en.serviceUnavailable)).toBeTruthy()
    expect(disabled(en.export)).toBe(true)
    expect(disabled(en.refresh)).toBe(true)
    const query = vi.fn<QueryUsage>().mockRejectedValueOnce(new Error('private transport detail'))
      .mockImplementation(async request => report(request))
    await act(async () => { h.source.connect(query) })
    expect(screen.getByRole('alert').textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    expect(disabled(en.export)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await screen.findByRole('table')
    h.download.mockImplementation(() => { throw new Error('blocked download') })
    fireEvent.click(screen.getByRole('button', { name: en.export }))
    expect(screen.getByRole('alert').textContent).toBe(en.exportError)
  })

  it('rejects invalid ranges without a query and aborts page work on unmount', async () => {
    const late = delayed()
    const query = vi.fn<QueryUsage>().mockImplementationOnce(async request => report(request))
      .mockImplementation(() => late.promise)
    const h = mount(query)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText(en.to), { target: { value: '2026-08-31' } })
    expect(screen.getByRole('alert').textContent).toBe(en.invalidRange)
    expect(disabled(en.export)).toBe(true)
    expect(disabled(en.refresh)).toBe(true)
    expect(query).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByLabelText(en.to), { target: { value: '2026-09-10' } })
    expect(screen.getByText(en.loading)).toBeTruthy()
    h.unmount()
    expect(query.mock.lastCall![1].signal.aborted).toBe(true)
    late.resolve(report())
    await late.promise
    expect(h.source.getSnapshot()).toEqual({ status: 'idle' })
  })

  it('keeps empty route identities distinct from clearing the route filters', async () => {
    const query = vi.fn<QueryUsage>(async (request) => {
      const result = report(request)
      return { ...result, providers: [''], models: [''], rows: [{ ...result.totals, provider: '', model: '' }] }
    })
    mount(query)
    const table = await screen.findByRole('table')
    expect(within(table).getAllByText(en.blankLabel)).toHaveLength(2)
    fireEvent.change(screen.getByLabelText(en.provider), { target: { value: 'route:' } })
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText(en.model), { target: { value: 'route:' } })
    await screen.findByRole('table')
    expect(query.mock.lastCall![0]).toMatchObject({ provider: '', model: '' })
    fireEvent.change(screen.getByLabelText(en.provider), { target: { value: '' } })
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText(en.model), { target: { value: '' } })
    await screen.findByRole('table')
    expect(query.mock.lastCall![0]).toEqual({ from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 8, 8) })
  })

  it('describes a partial scan with no observed rows without claiming a complete empty result', async () => {
    mount(async request => report(request, {
      rows: [], totals: { turns: 0, knownTurns: 0, unknownTurns: 0, attempts: 0, retries: 0, tokens: null },
      scannedSessions: 0, skippedSessions: 4, examinedEvents: 0, unattributedTurns: 0, reasons: ['source-error'],
    }))
    await screen.findByText(en.noObserved)
    expect(screen.getByText(en.partialHelp)).toBeTruthy()
    expect(screen.queryByText(en.empty)).toBeNull()
  })
})
