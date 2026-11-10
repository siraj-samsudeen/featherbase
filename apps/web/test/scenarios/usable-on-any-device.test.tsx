// usable-on-any-device's fenced scenarios (#1070), rendered in jsdom against
// the real in-process server. Each test is one scenario of
// openspec/specs/usable-on-any-device/spec.md, step by step: on a phone a
// Table's list reads as one card per row.
//
// "On a phone" is the screen width the list asks about ((width < 40rem));
// jsdom lays nothing out, so that the cards fit the width without sideways
// scrolling is measured only in a real browser. Here the phone gets the cards
// and not the wide table.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, onTestFinished, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp, onScreen, byTestId } from '../pg-test'

/** The element with this data-testid reads exactly this. */
const reads = (testId: string, text: string) => onScreen().within(byTestId(testId), (el) => el.assertExactText(text))

const scenario = scenarioFor(test, 'usable-on-any-device')
const PAGE_SIZE = 20

/** A phone's screen: the list's narrow query matches. */
function usePhone() {
  const real = window.matchMedia
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('40rem'), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  onTestFinished(() => { window.matchMedia = real })
}

const slug = (table: string) => table.toLowerCase().replace(/[-_\s]+/g, ' ').trim().replace(/ /g, '-')

/** Where the rendered app is (its router's memory history). */
let current: Awaited<ReturnType<typeof renderApp>>
const pathname = () => (current.router.state as { location: { pathname: string } }).location.pathname

async function openList(table: string, as: TestClient) {
  current = await renderApp(`/featherbase/admin/table/${encodeURIComponent(slug(table))}`, as)
  await waitFor(() => expect(within(screen.getByTestId('list-rows')).getAllByRole('listitem').length).toBeGreaterThan(0), { timeout: 8000 })
}

const cardEls = () => within(screen.getByTestId('list-rows')).getAllByRole('listitem')
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** What one card shows: its title and link, the words beside the title, its labelled figures and its "N more" control. */
function readCard(n: number) {
  const li = cardEls()[n]!
  const link = li.querySelector('a')
  const head = link?.closest('.flex-wrap')
  const besideTitle = head ? [...head.children].slice(1).map(text) : []
  const figures = [...li.querySelectorAll('dl dt')].map((dt) => ({ label: text(dt), value: text(dt.nextElementSibling) }))
  const href = link?.getAttribute('href') ?? null
  const rowId = href ? decodeURIComponent(href.split('?')[0]!.split('/').pop()!) : null
  const more = within(li).queryByText(/^\s*\d+ more\b/i)
  return { title: text(link), href, rowId, besideTitle, figures, more: more ? text(more) : null }
}

/** Shown on a phone: the cards, not the wide table. */
function expectCardsNotTable() {
  expect(screen.getByTestId('list-rows').tagName, 'the rows are a list of cards').not.toBe('TBODY')
  expect(screen.queryByTestId('list-table-scroll'), 'the wide table is not shown on a phone').toBeNull()
}

// ---- Checklist runs, from the checklists sample app ----
const CHECKLIST_RUN = 'Checklist Run'
const CHECKLIST_RUN_FIGURES = ['Section', 'Team leader', 'Date', 'Progress']

// ---- A Table with everything a phone card has to carry ----
const STOCK_COUNT = 'Stock Count'
const STOCK_COUNT_LINE = 'Stock Count Line'
const STATUSES = ['Open', 'Counted', 'Closed']
const ROW_COUNT = 25
const OTHER_LISTED = ['Aisle', 'Shelf', 'Counted By', 'Counted On', 'Quantity']
const stockRows = Array.from({ length: ROW_COUNT }, (_, i) => {
  const n = String(i + 1).padStart(2, '0')
  return {
    row_id: `SC-${n}`, item: `Item ${n}`, count_status: STATUSES[i % STATUSES.length]!, aisle: `Aisle ${(i % 4) + 1}`,
    shelf: `Shelf ${n}`, counted_by: 'Acceptance Counter', counted_on: '2026-10-01', quantity: i + 1, notes: `Note ${n}`,
    lines: [{ instruction: `Count bin ${n}`, done: false }],
  }
})
async function givenStockCount(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: STOCK_COUNT_LINE, kind: 'sub_table',
    columns: [
      { column_name: 'instruction', label: 'Instruction', column_type: 'Data' },
      { column_name: 'done', label: 'Done', column_type: 'Check' },
    ],
  })
  await admin.post('/api/table_def', {
    name: STOCK_COUNT, id_pattern: 'prompt', title_column: 'item',
    columns: [
      { column_name: 'item', label: 'Item', column_type: 'Data', in_list_view: true },
      { column_name: 'count_status', label: 'Status', column_type: 'Choice', choices: STATUSES.join('\n'), in_list_view: true },
      { column_name: 'aisle', label: 'Aisle', column_type: 'Data', in_list_view: true },
      { column_name: 'shelf', label: 'Shelf', column_type: 'Data', in_list_view: true },
      { column_name: 'counted_by', label: 'Counted By', column_type: 'Data', in_list_view: true },
      { column_name: 'counted_on', label: 'Counted On', column_type: 'Date', in_list_view: true },
      { column_name: 'quantity', label: 'Quantity', column_type: 'Int', in_list_view: true },
      { column_name: 'notes', label: 'Notes', column_type: 'Data' },
      { column_name: 'lines', label: 'Lines', column_type: 'Sub-table', row_table: STOCK_COUNT_LINE },
    ],
  })
  for (const row of stockRows) await admin.post(`/api/table/${encodeURIComponent(STOCK_COUNT)}`, row)
}

// ---- Section Mapping, the running example of #738 ----
const SECTION_MAPPING = ['Section', 'MCH', 'Floor', 'Zone', 'Rack', 'Owner', 'Category', 'Remarks', 'Updated By', 'Notes']
const COLUMN_NAMES: Record<string, string> = {
  Section: 'section', MCH: 'mch', Floor: 'floor', Zone: 'zone', Rack: 'rack', Owner: 'owner',
  Category: 'category', Remarks: 'remarks', 'Updated By': 'updated_by_1', Notes: 'notes',
}
const SECTION_ROWS = [
  ['Sarees', 'MCH-101', 'Ground', 'A', 'R1', 'Team North', 'Apparel', 'Check stock weekly', 'Admin', 'Seasonal'],
  ['Kids Wear', 'MCH-202', 'First', 'B', 'R2', 'Team South', 'Apparel', 'Near the lift', 'Admin', 'Year round'],
].map((r, n) => ({ row_id: `SM-${n + 1}`, ...Object.fromEntries(SECTION_MAPPING.map((label, i) => [COLUMN_NAMES[label]!, r[i]!])) }))

describe('usable-on-any-device', () => {
  scenario('Read a list of checklist runs on a phone', async ({ admin }, step) => {
    let run: { row_id: string; run_title: string; run_status: string }
    await step('the user is on a phone', usePhone)
    await step('the user opens a list', async () => {
      if (await isInstalled('checklists')) await uninstallApp('checklists')
      await installApp('checklists')
      const templates = await admin.get<{ data: { row_id: string }[] }>('/api/table/Checklist%20Template?fields=%5B%22row_id%22%5D&limit_page_length=1')
      const template = templates.data[0]?.row_id
      expect(template, 'the checklists app installed no template').toBeDefined()
      const saved = await admin.post<{ row_id: string }>('/api/save_row', {
        table: CHECKLIST_RUN, row: { template, store: 'ATK', section: 'Denim', team_leader: 'Acceptance TL' },
      })
      run = await admin.get(`/api/table/${encodeURIComponent(CHECKLIST_RUN)}/${encodeURIComponent(saved.row_id)}`)
      await openList(CHECKLIST_RUN, admin)
    })
    await step('each row shows its title, its status in words and its key figures, without sideways scrolling', () => {
      let seen = false
      for (let n = 0; n < cardEls().length; n++) {
        const card = readCard(n)
        expect(card.title, `card ${n + 1} has no title`).toBeTruthy()
        expect(card.title, `card ${n + 1} is led by its row ID, not a title`).not.toBe(card.rowId)
        expect(card.besideTitle.some((w) => /[A-Za-z]/.test(w)), `card ${n + 1} shows no status in words`).toBe(true)
        expect(card.figures.length, `card ${n + 1} shows no figures`).toBeGreaterThan(0)
        for (const { label } of card.figures) expect(CHECKLIST_RUN_FIGURES, `card ${n + 1} shows ${label}, not one of the run's figures`).toContain(label)
        if (card.rowId === run.row_id) {
          seen = true
          expect(card.title).toBe(run.run_title)
          expect(card.besideTitle, `the run's status ${run.run_status} is not shown`).toContain(run.run_status)
        }
      }
      expect(seen, `no card for the run ${run.row_id}`).toBe(true)
      expectCardsNotTable()
    })
  })

  scenario('Work with a Table\'s rows on a phone', async ({ admin }, step) => {
    const user = userEvent.setup()
    const byId = new Map(stockRows.map((r) => [r.row_id, r]))
    await step('the user is on a phone', usePhone)
    await step("the user opens any Table's list", async () => {
      await givenStockCount(admin)
      await openList(STOCK_COUNT, admin)
    })
    await step("each row is a card led by the row's title, which opens the row, never by an opaque id", async () => {
      for (let n = 0; n < cardEls().length; n++) {
        const card = readCard(n)
        const row = byId.get(card.rowId!)
        expect(row, `card ${n + 1} links to ${card.href}, not to one of the rows`).toBeDefined()
        expect(card.title, `card ${n + 1} is not led by its row's title`).toBe(row!.item)
      }
      expectCardsNotTable()
      const first = readCard(0)
      await user.click(cardEls()[0]!.querySelector('a')!)
      await screen.findByTestId('form-view', {}, { timeout: 8000 })
      expect(pathname(), 'the title opens its row').toContain(encodeURIComponent(first.rowId!))
      await openList(STOCK_COUNT, admin)
    })
    await step('the card shows its status in words and up to three other listed columns as labelled figures', () => {
      for (let n = 0; n < cardEls().length; n++) {
        const card = readCard(n)
        const row = byId.get(card.rowId!)!
        expect(card.besideTitle, `card ${n + 1} does not show its status ${row.count_status}`).toContain(row.count_status)
        const labels = card.figures.map((f) => f.label)
        expect(labels.length, `card ${n + 1} shows no figures`).toBeGreaterThan(0)
        expect(labels.length, `card ${n + 1} shows ${labels.join(', ')}`).toBeLessThanOrEqual(3)
        for (const label of labels) expect(OTHER_LISTED, `card ${n + 1} shows ${label}`).toContain(label)
      }
    })
    await step('the user can still select rows one at a time or all on the page, and act on them in bulk', async () => {
      await user.click(within(cardEls()[0]!).getByTestId('row-check'))
      await reads('bulk-count', '1 selected')
      await user.click(screen.getByTestId('select-all'))
      await reads('bulk-count', `${PAGE_SIZE} selected`)
      const onPage = cardEls().map((_, n) => readCard(n).rowId!)
      await onScreen().selectOption('Field to edit', 'Shelf').fillIn('New value', 'Moved').clickButton('Apply')
      await waitFor(async () => {
        const stored = await Promise.all(onPage.map((id) => admin.get<{ shelf: string }>(`/api/table/${encodeURIComponent(STOCK_COUNT)}/${id}`)))
        expect(stored.map((r) => r.shelf)).toEqual(onPage.map(() => 'Moved'))
      }, { timeout: 8000 })
    })
    await step("the user can sort by any listed column, show a row's nested rows in place, and page through the rows", async () => {
      // Every column offered, read whole: assertOptions checks the list in order.
      const sortBy = screen.getByTestId('list-sort-by') as HTMLSelectElement
      const offered = [...sortBy.options].map((o) => o.textContent!.trim()).filter((o) => o !== 'Default order')
      for (const label of ['Item', 'Status', ...OTHER_LISTED]) expect(offered, `"Sort by" does not offer ${label}`).toContain(label)
      const last = `Item ${ROW_COUNT}`
      await onScreen().selectOption('Sort by', 'Item')
      // Only when ascending: the DSL has no verb that branches on what the page shows.
      const toggle = await screen.findByTestId('list-sort-dir')
      if (!(toggle.getAttribute('aria-label') ?? '').includes('descending')) await user.click(toggle)
      await onScreen().within(byTestId('list-sort-dir'), (order) => order.assertAttribute('aria-label', 'Sort order: descending'))
      await waitFor(() => expect(readCard(0).title).toBe(last), { timeout: 8000 })

      await user.click(within(cardEls()[0]!).getByTestId('row-expand'))
      const nested = await within(cardEls()[0]!).findByTestId('expanded-row', {}, { timeout: 8000 })
      await within(nested).findAllByRole('table', {}, { timeout: 8000 })
      await waitFor(() => expect(nested.textContent, 'the nested rows').toContain(`Count bin ${ROW_COUNT}`), { timeout: 8000 })

      await reads('page-info', `1–${PAGE_SIZE} of ${ROW_COUNT}`)
      await onScreen().clickButton('Next')
      await reads('page-info', `${PAGE_SIZE + 1}–${ROW_COUNT} of ${ROW_COUNT}`)
      await waitFor(() => expect(cardEls()).toHaveLength(ROW_COUNT - PAGE_SIZE))
    })
  })

  scenario("Section Mapping's cards show three columns and the rest on request", async ({ admin, createUser }, step) => {
    const user = userEvent.setup()
    const listColumns = SECTION_MAPPING.slice(0, 7)
    let reader: TestClient
    let pathBefore = ''
    await step('the user is on a phone', usePhone)
    await step('the table "Section Mapping" has seven list columns', async () => {
      await admin.post('/api/table_def', {
        name: 'Section Mapping', id_pattern: 'prompt',
        columns: SECTION_MAPPING.map((label) => ({ column_name: COLUMN_NAMES[label], label, column_type: 'Data', in_list_view: listColumns.includes(label) })),
      })
      for (const row of SECTION_ROWS) await admin.post('/api/table/Section%20Mapping', row)
      await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Section Mapping Reader' } })
      await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Section Mapping', role: 'Section Mapping Reader', operation: 'read' } })
      reader = await createUser({ roles: ['Section Mapping Reader'] })
      expect(listColumns).toHaveLength(7)
    })
    await step('the user opens its list', () => openList('Section Mapping', reader))
    await step('each card is titled by its Section and shows three of the other six columns', () => {
      const others = listColumns.filter((c) => c !== 'Section')
      expect(others).toHaveLength(6)
      for (let n = 0; n < cardEls().length; n++) {
        const card = readCard(n)
        const row = SECTION_ROWS.find((r) => r.row_id === card.rowId) as Record<string, string> | undefined
        expect(row, `card ${n + 1} links to ${card.href}, not to one of the rows`).toBeDefined()
        expect(card.title, `card ${n + 1} is not titled by its Section`).toBe(row![COLUMN_NAMES.Section!])
        const figures = card.figures.map((f) => f.label)
        expect(figures, `card ${n + 1} shows ${figures.join(', ')}`).toHaveLength(3)
        for (const label of figures) expect(others, `card ${n + 1} shows ${label}`).toContain(label)
      }
    })
    await step('it says there are 3 more', () => {
      for (let n = 0; n < cardEls().length; n++) expect(readCard(n).more ?? '', `card ${n + 1}`).toMatch(/^3 more\b/)
    })
    await step('the user asks to see them', async () => {
      pathBefore = pathname()
      const more = within(cardEls()[0]!).queryByText(/^\s*\d+ more\b/i)
      expect(more, 'card 1 has no "N more" control').not.toBeNull()
      await user.click(more!)
    })
    await step('the card shows all seven without leaving the list', () => {
      const card = readCard(0)
      const row = SECTION_ROWS.find((r) => r.row_id === card.rowId) as Record<string, string> | undefined
      expect(row, `a card links to ${card.href}, not to one of the rows`).toBeDefined()
      const title = listColumns.filter((label) => row![COLUMN_NAMES[label]!] === card.title)
      const figures = card.figures.map((f) => f.label).filter((label) => listColumns.includes(label))
      expect([...new Set([...title, ...figures])].sort()).toEqual([...listColumns].sort())
      expect(pathname(), 'asking for the other columns left the list').toBe(pathBefore)
      expect(screen.getByTestId('list-rows')).toBeInTheDocument()
    })
  })
})
