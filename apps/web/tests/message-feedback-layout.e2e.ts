// Keyless geometry coverage for the feedback dialog over a cold-seeded transcript.
// Opening it preserves the assistant actions row at each viewport; the modal
// stays outside the conversation clip and centered inside the viewport.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/message-feedback-layout', import.meta.url))
/**
 * Committed golden of the dialog relations at every stop. Booleans and counts
 * only, never absolute coordinates.
 */
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const MODE = webSnapshotMode()
/** Borrowed read-only: this scenario needs any settled assistant message to rate. */
const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const SEED_ID = 'message-feedback-layout-e2e'
/** Viewport widths from full-screen desktop down to a narrow window. */
const WIDTHS = [1680, 1280, 1024, 900, 700, 600]

/** One viewport stop: how the row reads with the feedback dialog closed and open, plus the dialog's own relations. */
export interface DialogMetrics {
  /** Viewport width the stop was measured at. */
  width: number
  /** The row's scrollable overflow with the feedback dialog closed (natural row width). */
  rowOverflowClosed: number
  /** The row's scrollable overflow with the feedback dialog open; must equal the closed value. */
  rowOverflowOpen: number
  /** Flex lines the row occupies with the feedback dialog open; the dialog must not reflow it. */
  rowLines: number
  /** Row items whose right edge escapes the column, dialog closed. */
  itemsOutsideColumnClosed: number
  /** Row items whose right edge escapes the column, dialog open; must equal the closed value. */
  itemsOutsideColumnOpen: number
  /** True when the portaled panel is NOT inside the column (escapes its overflow clip). */
  panelOutsideColumn: boolean
  /** True when the panel lies fully inside the viewport. */
  panelWithinViewport: boolean
  /** True when the modal is centered horizontally and vertically in the viewport. */
  panelCentered: boolean
}

/**
 * Measure the feedback row (and the open dialog, when present) at the current
 * viewport. The same reader serves the closed and open readings so the two
 * sides differ only by whether the dialog is open.
 * @param page - the page under test.
 * @param width - the viewport width already applied, recorded with the reading.
 * @param dialogOpen - true to also read the dialog's relations; throws if it is absent.
 * @returns the stop's relations.
 */
function measureDialog(page: Page, width: number, dialogOpen: boolean): Promise<DialogMetrics> {
  return page.evaluate(({ viewportWidth, open }) => {
    const trigger = document.querySelector<HTMLElement>('button[aria-label="Good response"]')
    if (trigger === null) throw new Error('no feedback control in the DOM')
    const row = trigger.parentElement?.closest<HTMLElement>('div[class*="actions"]') ?? null
    if (row === null) throw new Error('the IconActions row is not an ancestor of the feedback control')

    /**
     * The real flex items of the row. A slot contributor (the feedback strip)
     * arrives as a `display: contents` wrapper (the `assistant-actions` slot
     * renders inside a transparent `data-slot` div), which reports an all-zero
     * rect; a zero box would be miscounted as a phantom flex line. The actual
     * items are the boxes inside it.
     * @param element - the row whose items to read.
     * @returns the real flex-item boxes, in flex/DOM order.
     */
    const flexItemBoxes = (element: HTMLElement): DOMRect[] => {
      const boxes: DOMRect[] = []
      for (const child of Array.from(element.children)) {
        const el = child as HTMLElement
        const rect = el.getBoundingClientRect()
        if (el.style.display === 'contents') {
          boxes.push(...flexItemBoxes(el))
        } else if (rect.height > 0 && rect.width > 0) {
          boxes.push(rect)
        }
      }
      return boxes
    }
    /**
     * Group items into flex lines by overlapping vertical extent.
     * @param boxes - the row items' boxes, in DOM order.
     * @returns the number of distinct lines.
     */
    const countFlexLines = (boxes: DOMRect[]): number => {
      const centres: number[] = []
      for (const box of boxes) {
        const centre = box.top + box.height / 2
        if (!centres.some(known => Math.abs(known - centre) <= box.height / 2)) centres.push(centre)
      }
      return centres.length
    }

    const column = row.closest<HTMLElement>('[data-conversation-scroll]')
    const columnRight = (column?.getBoundingClientRect().left ?? 0) + (column?.clientWidth ?? 0)
    const itemRects = flexItemBoxes(row)
    // A half-pixel tolerance: subpixel layout puts a contained edge a fraction
    // over the boundary on some device scale factors.
    const itemsOutsideColumn = itemRects.filter(box => box.right > columnRight + 0.5).length
    const overflow = row.scrollWidth - row.clientWidth

    let builder: {
      panelOutsideColumn: boolean
      panelWithinViewport: boolean
      panelCentered: boolean
    }
    if (!open) {
      builder = { panelOutsideColumn: true, panelWithinViewport: true, panelCentered: true }
    } else {
      const panel = document.body.querySelector<HTMLElement>('[role="dialog"]')
      if (panel === null) throw new Error('the feedback dialog is not open')
      const panelBox = panel.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      builder = {
        // The panel portals out of the column, so the clip cannot reach it.
        panelOutsideColumn: column === null ? true : !column.contains(panel),
        panelWithinViewport:
          panelBox.left >= -0.5
          && panelBox.right <= vw + 0.5
          && panelBox.top >= -0.5
          && panelBox.bottom <= vh + 0.5,
        panelCentered:
          Math.abs(panelBox.left + panelBox.width / 2 - vw / 2) <= 0.5
          && Math.abs(panelBox.top + panelBox.height / 2 - vh / 2) <= 0.5,
      }
    }

    return {
      width: viewportWidth,
      rowOverflowClosed: overflow,
      rowOverflowOpen: overflow,
      rowLines: countFlexLines(itemRects),
      itemsOutsideColumnClosed: itemsOutsideColumn,
      itemsOutsideColumnOpen: itemsOutsideColumn,
      ...builder,
    }
  }, { viewportWidth: width, open: dialogOpen })
}

/**
 * Render the golden body: one line per stop, relations and counts only. The
 * row-overflow and outside-column readings are deltas (open minus closed) so
 * the golden records that opening the dialog leaves the row untouched, not an
 * absolute count that many unrelated controls could move.
 * @param stops - the measured stops, in sweep order.
 * @returns the golden body, without a trailing newline.
 */
function renderGeometry(stops: DialogMetrics[]): string {
  return [
    '# Assistant actions row with the feedback dialog open',
    '',
    '| viewport | row overflow delta | row lines | items-outside delta '
      + '| panel outside the column | panel within the viewport | panel centered in the viewport |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...stops.map(stop => `| ${String(stop.width)}px | ${String(stop.rowOverflowOpen - stop.rowOverflowClosed)}px `
      + `| ${String(stop.rowLines)} | ${String(stop.itemsOutsideColumnOpen - stop.itemsOutsideColumnClosed)} `
      + `| ${String(stop.panelOutsideColumn)} | ${String(stop.panelWithinViewport)} `
      + `| ${String(stop.panelCentered)} |`),
  ].join('\n')
}

describe('web e2e: the feedback dialog stays centered outside the column', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(SEED, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /**
   * Open the seeded transcript. The first treeitem is the collapsible group
   * row; the session itself is the row beneath it.
   * @returns nothing.
   */
  async function openSeededSession(): Promise<void> {
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 15_000 })
    await sessionRow.click()
  }

  /**
   * Resize to a viewport and read the row once its width stops moving. The
   * frame eases its column tracks, so reading straight after a resize can
   * report the previous viewport's relation.
   * @param width - viewport width to settle at.
   * @param dialogOpen - whether the feedback dialog is currently open; reads the dialog relations when so.
   * @returns the row's (and dialog's) readings at that width.
   */
  const settleAt = async (width: number, dialogOpen: boolean): Promise<DialogMetrics> => {
    await page.setViewportSize({ width, height: 900 })
    let previous = -1
    await expect.poll(async () => {
      const current = await page.evaluate(() =>
        document.querySelector('[data-conversation-scroll]')?.clientWidth ?? -1)
      const settled = current === previous
      previous = current
      return settled
    }, { timeout: 10_000 }).toBe(true)
    return measureDialog(page, width, dialogOpen)
  }

  /**
   * Share each closed/open measurement between the assertions and the golden.
   * @returns the stops in {@link WIDTHS} order.
   */
  let swept: Promise<DialogMetrics[]> | undefined
  const sweep = (): Promise<DialogMetrics[]> => {
    swept ??= (async () => {
      await openSeededSession()
      await page.getByText('DONE', { exact: true }).waitFor({ timeout: 30_000 })
      const like = page.getByRole('button', { name: 'Good response' }).first()
      await like.waitFor({ timeout: 30_000 })
      const dialog = page.getByRole('dialog', { name: 'Submit feedback' })
      const stops: DialogMetrics[] = []
      for (const width of WIDTHS) {
        const closed = await settleAt(width, false)
        await like.scrollIntoViewIfNeeded()
        await like.hover()
        await like.click()
        await dialog.waitFor({ timeout: 10_000 })
        const open = await settleAt(width, true)
        stops.push({
          width,
          rowOverflowClosed: closed.rowOverflowClosed,
          rowOverflowOpen: open.rowOverflowOpen,
          rowLines: open.rowLines,
          itemsOutsideColumnClosed: closed.itemsOutsideColumnClosed,
          itemsOutsideColumnOpen: open.itemsOutsideColumnOpen,
          panelOutsideColumn: open.panelOutsideColumn,
          panelWithinViewport: open.panelWithinViewport,
          panelCentered: open.panelCentered,
        })
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'detached', timeout: 10_000 })
      }
      return stops
    })()
    return swept
  }

  it('keeps the actions row unchanged while the feedback dialog stays centered in the viewport', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-message-feedback-layout'))
    const stops = await sweep()
    for (const stop of stops) {
      expect(stop.rowOverflowOpen - stop.rowOverflowClosed, `viewport ${String(stop.width)}`).toBe(0)
      expect(stop.itemsOutsideColumnOpen - stop.itemsOutsideColumnClosed, `viewport ${String(stop.width)}`).toBe(0)
      expect(stop.rowLines, `viewport ${String(stop.width)}`).toBe(1)
      expect(stop.panelOutsideColumn, `viewport ${String(stop.width)}`).toBe(true)
      expect(stop.panelWithinViewport, `viewport ${String(stop.width)}`).toBe(true)
      expect(stop.panelCentered, `viewport ${String(stop.width)}`).toBe(true)
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 180_000)

  it('matches the committed geometry golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-message-feedback-layout-golden'))
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(await sweep()), MODE)
  }, 180_000)

  it('kept the console clean', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
