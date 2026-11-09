// tables-and-fields' fenced scenarios a person reads on screen (#1070): a new
// table's list columns, who may change them, readable labels, a Table's
// settings and storage, and renaming a Table. Each test is one fenced scenario
// of openspec/specs/tables-and-fields/spec.md, step by step, rendered in jsdom
// against the real in-process server. The readable-labels migration is in
// apps/server/test/scenarios/.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resolve } from 'node:path'
import { describe, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { rowHref, tableHref, tableSlug } from 'shared'
import { sql } from 'server/src/db'
import { invalidateMeta } from 'server/src/meta'
import { invalidateSources } from 'server/src/sources/registry'
import { discoverPackages } from 'server/src/runtime-packages'
import { scenarioFor } from 'server/test/scenario'
import { clearSession } from '../../src/lib/import-session'
import { test, expect, renderApp, onScreen } from '../pg-test'

const scenario = scenarioFor(test, 'tables-and-fields')
const WAIT = { timeout: 15_000 }
type User = ReturnType<typeof userEvent.setup>
const enc = encodeURIComponent

// ---- The running example of #738: Section Mapping's ten columns ----

const SECTION_MAPPING_COLUMNS = ['Section', 'MCH', 'Floor', 'Zone', 'Rack', 'Owner', 'Category', 'Remarks', 'Updated By', 'Notes']
const FIRST_SEVEN = SECTION_MAPPING_COLUMNS.slice(0, 7)
const ROWS = [
  ['Sarees', 'MCH-101', 'Ground', 'A', 'R1', 'Team North', 'Apparel', 'Check stock weekly', 'Admin', 'Seasonal'],
  ['Kids Wear', 'MCH-202', 'First', 'B', 'R2', 'Team South', 'Apparel', 'Near the lift', 'Admin', 'Year round'],
]
const COLUMN_NAMES: Record<string, string> = {
  Section: 'section', MCH: 'mch', Floor: 'floor', Zone: 'zone', Rack: 'rack', Owner: 'owner',
  Category: 'category', Remarks: 'remarks', 'Updated By': 'updated_by_1', Notes: 'notes',
}
const SECTION_MAPPING = 'Section Mapping'

/** Section Mapping as a table whose list columns are exactly `listColumns`, its readers a role of their own. */
async function sectionMappingTable(admin: TestClient, createUser: (o: { roles: string[] }) => Promise<TestClient>, listColumns: string[]) {
  await admin.post('/api/table_def', {
    name: SECTION_MAPPING,
    id_pattern: 'prompt',
    columns: SECTION_MAPPING_COLUMNS.map((label) => ({
      column_name: COLUMN_NAMES[label], label, column_type: 'Data', in_list_view: listColumns.includes(label),
    })),
  })
  const rows = ROWS.map((r, n) => ({
    row_id: `SM-${n + 1}`,
    ...Object.fromEntries(SECTION_MAPPING_COLUMNS.map((label, i) => [COLUMN_NAMES[label]!, r[i]!])),
  }))
  for (const row of rows) await admin.post(`/api/table/${enc(SECTION_MAPPING)}`, row)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: `${SECTION_MAPPING} Reader` } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: SECTION_MAPPING, role: `${SECTION_MAPPING} Reader`, operation: 'read' } })
  return {
    rows,
    user: await createUser({ roles: [`${SECTION_MAPPING} Reader`] }),
    colleague: await createUser({ roles: [`${SECTION_MAPPING} Reader`] }),
  }
}

const toCsv = (columns: string[]) =>
  [columns, ...ROWS.map((r, n) => columns.map((c) => (SECTION_MAPPING_COLUMNS.includes(c) ? r[SECTION_MAPPING_COLUMNS.indexOf(c)] : `${c} ${n + 1}`)))]
    .map((r) => r.join(','))
    .join('\n') + '\n'

// ---- A table's list ----

/** The labels of the columns the list shows after Row ID, in order. */
const columnLabels = () =>
  [...screen.getByTestId('list-view').querySelectorAll('thead [data-testid^="col-"]')]
    .filter((el) => el.getAttribute('data-testid') !== 'col-row_id')
    .map((el) => (el.textContent ?? '').replace(/[↑↓]/g, '').trim())

async function openList(as: TestClient, table: string) {
  cleanup()
  const app = await renderApp(tableHref(table), as)
  await screen.findByTestId('list-view', {}, WAIT)
  await waitFor(() => expect(screen.getByTestId('list-view').querySelector('thead [data-testid^="col-"]')).not.toBeNull(), WAIT)
  return app
}

/** The values one column shows, top row first, once rows have arrived. */
async function columnValues(column: string) {
  await waitFor(() => expect(screen.getByTestId('list-rows').querySelectorAll('tr').length).toBeGreaterThan(0), WAIT)
  return [...screen.getByTestId('list-rows').querySelectorAll(`[data-testid="cell-${column}"]`)].map((el) => el.textContent ?? '')
}

async function openColumnsMenu() {
  if (!screen.queryByTestId('list-columns-popup')) fireEvent.click(screen.getByTestId('list-columns'))
  return screen.findByTestId('list-columns-popup')
}

/** Switches one column of this person's view, waiting until it is saved. */
async function switchColumn(as: TestClient, table: string, label: string, on: boolean) {
  // The person's saved arrangement has loaded once the rows show.
  await waitFor(() => expect(screen.getByTestId('list-rows').querySelectorAll('tr').length).toBeGreaterThan(0), WAIT)
  const choice = within(await openColumnsMenu()).getByRole('checkbox', { name: label })
  if ((choice as HTMLInputElement).checked !== on) fireEvent.click(choice)
  await waitFor(async () => {
    const { settings } = await as.get<{ settings: { shownCols?: string[]; hiddenCols?: string[] } | null }>(`/api/user_settings/${enc(table)}`)
    const shown = settings?.shownCols ?? []
    expect(settings, 'the arrangement was saved').not.toBeNull()
    if (on) expect(shown).toContain(COLUMN_NAMES[label])
    else expect(shown).not.toContain(COLUMN_NAMES[label])
  }, WAIT)
}

// ---- The Import Wizard and the Table Builder ----

async function importAsNewTable(user: User, admin: TestClient, columns: string[], name: string, opts: { leaveOut?: string[]; tickAll?: boolean } = {}) {
  clearSession()
  cleanup()
  await renderApp('/featherbase/admin/import', admin)
  const bytes = new TextEncoder().encode(toCsv(columns)).buffer
  const file = new File([bytes], `${name}.csv`, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, WAIT), { target: { files: [file] } })
  await screen.findByTestId('iw-new-grid-0', {}, WAIT)
  await user.clear(screen.getByTestId('iw-new-name-0'))
  await user.type(screen.getByTestId('iw-new-name-0'), name)
  const rows = () => [...screen.getByTestId('iw-new-grid-0').querySelectorAll<HTMLElement>('tbody tr[data-columnrow]')]
  const field = (row: HTMLElement, f: string) => row.querySelector<HTMLInputElement>(`[data-rowfield=${f}]`)!
  for (const label of opts.leaveOut ?? []) {
    const row = rows().find((r) => field(r, 'label').value === label)
    if (!row) throw new Error(`The Import Wizard has no column "${label}"`)
    await user.click(field(row, 'include'))
  }
  // Named by aria-label only: clickButton matches a button's visible text.
  if (opts.tickAll) await user.click(screen.getByRole('button', { name: 'Tick all in the list' }))
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.queryByTestId('iw-done') ?? screen.queryByTestId('list-view')).not.toBeNull(), { timeout: 30_000 })
  const done = screen.queryByTestId('iw-done')
  if (done) expect(screen.getByTestId('iw-result-0').textContent).toMatch(/Imported \d+ rows? into/)
  clearSession()
}

// ---- Readable labels (#826) ----

const CONTACTS = 'Acceptance Readable Contacts'
const RAW = 'create_if_email_domain_allowed'
const DISPLAY = 'Create only for an allowed email domain'
const UNMAPPED = 'Keep_THIS_authored_text'

const definePolicy = (admin: TestClient) =>
  admin.post('/api/table_def', {
    name: CONTACTS,
    columns: [{
      column_name: 'policy', label: 'Policy', column_type: 'Choice', choices: `${RAW}\n${UNMAPPED}`,
      choice_labels: { [RAW]: DISPLAY }, in_list_view: true,
    }],
  })

const policyControl = () => screen.getByTestId('form-view').querySelector<HTMLSelectElement>('select[data-field="policy"]')!
const optionText = (value: string) => policyControl().querySelector(`option[value="${value}"]`)?.textContent

async function openPolicy(admin: TestClient, as: TestClient, value: string) {
  const row = await admin.post<{ row_id: string }>('/api/save_row', { table: CONTACTS, row: { policy: value } })
  cleanup()
  await renderApp(rowHref(CONTACTS, row.row_id), as)
  await screen.findByTestId('form-view', {}, WAIT)
  await waitFor(() => expect(optionText(value)).toBeTruthy(), WAIT)
}

// ---- A Table's settings and storage (#860) ----

const SAP_PLANT = 'SAP Plant'

const defineSapPlant = (admin: TestClient, kind = 'table') =>
  admin.post('/api/table_def', { name: SAP_PLANT, module: 'Custom', kind, columns: [{ column_name: 'plant_name', column_type: 'Data' }] })

async function openSettings(as: TestClient, table: string) {
  cleanup()
  await renderApp(rowHref('Table', table), as)
  await screen.findByTestId('form-view', {}, WAIT)
}

async function expectTitle(expected: string) {
  await screen.findByRole('heading', { name: `Table: ${expected}` }, WAIT)
  expect(screen.getByTestId('breadcrumbs').textContent).toMatch(new RegExp(expected))
}

async function expectCopyable(user: User, expected: string[]) {
  const storage = await screen.findByTestId('table-storage', {}, WAIT)
  for (const value of expected) expect(storage.textContent, `missing ${value}`).toContain(value)
  expect(storage.querySelectorAll('input:not([readonly]), textarea:not([readonly]), select')).toHaveLength(0)
  const button = within(storage).getByRole('button', { name: 'Copy storage' })
  button.focus()
  await onScreen().pressKey('Enter')
  await waitFor(() => expect(within(storage).getByRole('status')).toHaveTextContent('Copied'), WAIT)
  const copied = await navigator.clipboard.readText()
  for (const value of expected) expect(copied, `clipboard missing ${value}`).toContain(value)
  expect(screen.getByTestId('form-status').textContent).toBe('Saved')
}

// ---- Renaming a Table (#871) ----

const PLANT_COLUMNS = [
  { column_name: 'plant_code', label: 'Plant Code', column_type: 'Data' },
  { column_name: 'city', label: 'City', column_type: 'Data' },
]

const importPlant = (admin: TestClient, table: string, code: number, city: string, run: string) =>
  admin.post(`/api/table/${enc(table)}:import`, { key_column: 'plant_code', rows: [{ plant_code: String(code), city }], context: { run_id: run } })

async function plantId(admin: TestClient, table: string, code: number) {
  const filters = enc(JSON.stringify([['plant_code', '=', String(code)]]))
  const { data: [row] } = await admin.get<{ data: { row_id: string }[] }>(`/api/table/${enc(table)}?filters=${filters}&fields=${enc(JSON.stringify(['row_id']))}`)
  expect(row, `no plant ${code} in ${table}`).toBeDefined()
  return row!.row_id
}

describe('tables-and-fields', () => {
  scenario("A platform table's columns are closed to editing", async ({ admin }, step) => {
    const table = 'Import Log' // a table the platform's own migrations create and depend on
    await step('a table the platform depends on', () => expect(table).toBe('Import Log'))
    await step('a builder opens its Columns screen', async () => {
      await renderApp(`${tableHref(table)}/columns`, admin)
      await screen.findByTestId('column-editor', {}, WAIT)
    })
    await step("it says the table's columns belong to the platform", () =>
      expect(screen.queryByTestId('ce-system')?.textContent ?? 'nothing about it').toContain('belong to the platform'))
    await step('it offers no way to add or rename one', () => {
      const ways: string[] = []
      if (screen.queryByTestId('ce-add')) ways.push('add a column')
      const renames = document.querySelectorAll('[data-testid^="ce-rename-"]').length
      if (renames) ways.push(`${renames} rename control(s)`)
      const editable = [...document.querySelectorAll<HTMLInputElement>('input[data-testid^="ce-label-"]')].filter((i) => !i.disabled).length
      if (editable) ways.push(`${editable} editable label(s)`)
      expect(ways).toEqual([])
    })
  }, 40_000)

  scenario('Only a System Manager changes the list for everyone', async ({ admin, createUser }, step) => {
    let user!: TestClient
    await step('the user is not a System Manager', async () => {
      ;({ user } = await sectionMappingTable(admin, createUser, FIRST_SEVEN))
    })
    await step('the user opens the list of "Section Mapping"', () => openList(user, SECTION_MAPPING))
    await step('the user can change which columns they see themselves', async () => {
      const hidden = SECTION_MAPPING_COLUMNS.find((c) => !FIRST_SEVEN.includes(c))!
      await switchColumn(user, SECTION_MAPPING, hidden, true)
      await waitFor(() => expect(columnLabels(), `switching on ${hidden} did not show it`).toContain(hidden), WAIT)
      await switchColumn(user, SECTION_MAPPING, hidden, false)
      await waitFor(() => expect(columnLabels(), `switching off ${hidden} did not hide it`).not.toContain(hidden), WAIT)
    })
    await step('nothing there changes the list for anyone else', async () => {
      expect(screen.queryByTestId('open-columns'), 'the list offers "Edit columns"').toBeNull()
      const menu = await openColumnsMenu()
      expect(within(menu).queryByRole('button', { name: 'Make this the default for everyone' }),
        'the "Show columns" menu offers to make a default for everyone').toBeNull()
    })
  }, 40_000)

  scenario("A Site table holds the user's sites", async ({ admin }, step) => {
    const registry = () => sql`select * from public.site order by 1`
    let before: unknown[] = []
    await step('no table is called "Site"', async () => {
      expect((await admin.fetch('/api/table/Site:meta')).status).not.toBe(200)
      before = [...(await registry())]
    })
    await step('the user creates a table "Site" and adds the site "Riverside"', async () => {
      await admin.post('/api/table_def', {
        name: 'Site', module: 'Custom',
        columns: [{ column_name: 'site_name', label: 'Site Name', column_type: 'Data', in_list_view: true }],
      })
      await admin.post('/api/table/Site', { site_name: 'Riverside' })
    })
    await step('the table shows "Riverside"', async () => {
      await openList(admin, 'Site')
      await waitFor(async () => expect(await columnValues('site_name')).toEqual(['Riverside']), WAIT)
    })
    await step("the platform's record of its web addresses is unchanged", async () =>
      expect([...(await registry())]).toEqual(before))
  }, 40_000)

  scenario('An imported Section Mapping lists its first seven columns', async ({ admin }, step) => {
    const user = userEvent.setup()
    let sheet: string[] = []
    await step('a sheet with the columns Section, MCH, Floor, Zone, Rack, Owner, Category, Remarks, Updated By and Notes', () => {
      sheet = 'Section, MCH, Floor, Zone, Rack, Owner, Category, Remarks, Updated By and Notes'.split(/, | and /)
      expect(sheet).toEqual(SECTION_MAPPING_COLUMNS)
    })
    await step('the user imports it as a new table "Section Mapping" without changing which columns are in the list', () =>
      importAsNewTable(user, admin, sheet, SECTION_MAPPING))
    await step('the list of "Section Mapping" shows Section, MCH, Floor, Zone, Rack, Owner and Category', async () => {
      await openList(admin, SECTION_MAPPING)
      expect(columnLabels()).toEqual(['Section', 'MCH', 'Floor', 'Zone', 'Rack', 'Owner', 'Category'])
    })
    await step("Remarks, Updated By and Notes show only on each row's form", async () => {
      const formOnly = ['Remarks', 'Updated By', 'Notes']
      await openList(admin, SECTION_MAPPING)
      for (const column of formOnly) expect(columnLabels()).not.toContain(column)
      await waitFor(() => expect(screen.getByTestId('list-rows').querySelector('tr a')).not.toBeNull(), WAIT)
      await user.click(screen.getByTestId('list-rows').querySelector('tr a')!)
      const form = await screen.findByTestId('form-view', {}, WAIT)
      for (const column of formOnly)
        await waitFor(() => expect(within(form).queryAllByLabelText(column, { exact: true }), `the row's form has no ${column}`).not.toHaveLength(0), WAIT)
    })
  }, 60_000)

  scenario('A typed table starts the same way', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the user is building a table by typing the same ten columns', async () => {
      await renderApp('/featherbase/admin/new-table', admin)
      await screen.findByTestId('table-builder', {}, WAIT)
      await user.type(screen.getByTestId('dt-name'), SECTION_MAPPING)
      const rows = () => [...screen.getByTestId('dt-fields').querySelectorAll<HTMLElement>('tbody tr[data-columnrow]')]
      for (const [i, label] of SECTION_MAPPING_COLUMNS.entries()) {
        if (i > 0) await user.click(screen.getByTestId('dt-add-field'))
        const input = rows()[i]!.querySelector<HTMLInputElement>('[data-rowfield=label]')!
        await user.type(input, label)
        fireEvent.blur(input)
        // Where the builder flags the derived name as one every table already has
        // (Updated By), take the one-click fix it offers, as a person would.
        const fix = within(rows()[i]!).queryByRole('button', { name: /^Use “/ })
        if (fix) await user.click(fix)
      }
    })
    await step('the user creates it without changing which columns are in the list', async () => {
      await user.click(screen.getByTestId('dt-create'))
      await screen.findByTestId('list-view', {}, WAIT)
    })
    await step('its list shows Section, MCH, Floor, Zone, Rack, Owner and Category', async () => {
      await openList(admin, SECTION_MAPPING)
      expect(columnLabels()).toEqual(['Section', 'MCH', 'Floor', 'Zone', 'Rack', 'Owner', 'Category'])
    })
  }, 60_000)

  scenario('A column left out of the import makes room for the next', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the same ten-column sheet', () => expect(SECTION_MAPPING_COLUMNS).toHaveLength(10))
    await step('the user leaves MCH out and imports it as a new table', () =>
      importAsNewTable(user, admin, SECTION_MAPPING_COLUMNS, SECTION_MAPPING, { leaveOut: ['MCH'] }))
    await step('MCH is not in the list', async () => {
      await openList(admin, SECTION_MAPPING)
      expect(columnLabels()).not.toContain('MCH')
    })
    await step('Remarks is in the list as the seventh column', async () => {
      await openList(admin, SECTION_MAPPING)
      expect(columnLabels()[6]).toBe('Remarks')
    })
  }, 60_000)

  scenario('All ten in one go', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the same ten-column sheet', () => expect(SECTION_MAPPING_COLUMNS).toHaveLength(10))
    await step('the user switches every column into the list at once and imports it as a new table', () =>
      importAsNewTable(user, admin, SECTION_MAPPING_COLUMNS, SECTION_MAPPING, { tickAll: true }))
    await step('the list shows all ten columns', async () => {
      await openList(admin, SECTION_MAPPING)
      expect(columnLabels()).toEqual(SECTION_MAPPING_COLUMNS)
    })
  }, 60_000)

  scenario('Remarks shows for everyone', async ({ admin, createUser }, step) => {
    let given!: Awaited<ReturnType<typeof sectionMappingTable>>
    await step('the table "Section Mapping" with Remarks not in its list', async () => {
      const list = FIRST_SEVEN.filter((c) => c !== 'Remarks')
      given = await sectionMappingTable(admin, createUser, list)
      expect(list).not.toContain('Remarks')
    })
    await step('a System Manager switches Remarks into its list', async () => {
      await renderApp(`${tableHref(SECTION_MAPPING)}/columns`, admin)
      await screen.findByTestId('column-editor', {}, WAIT)
      const rows = [...screen.getByTestId('ce-columns-table').querySelectorAll<HTMLElement>('tbody tr')]
      const row = rows.find((tr) => tr.querySelector<HTMLInputElement>('input[data-testid^="ce-label-"]')?.value === 'Remarks')
      if (!row) throw new Error('the Edit columns page has no column Remarks')
      const tick = within(row).getByRole('checkbox', { name: /in list/i })
      expect(tick).not.toBeChecked()
      fireEvent.click(tick)
      await waitFor(async () => {
        const meta = await admin.get<{ columns: { label: string; in_list_view?: boolean }[] }>(`/api/table/${enc(SECTION_MAPPING)}:meta`)
        expect(meta.columns.find((c) => c.label === 'Remarks')?.in_list_view).toBeTruthy()
      }, WAIT)
    })
    await step('a colleague opening the list of "Section Mapping" sees Remarks', async () => {
      await openList(given.colleague, SECTION_MAPPING)
      expect(columnLabels()).toContain('Remarks')
    })
    await step("no row's values have changed", async () => {
      for (const row of given.rows) {
        const stored = await admin.get<Record<string, unknown>>(`/api/table/${enc(SECTION_MAPPING)}/${row.row_id}`)
        expect(Object.fromEntries(Object.keys(row).map((key) => [key, stored[key]])), `row ${row.row_id} has changed`).toEqual(row)
      }
    })
  }, 40_000)

  scenario('Generated labels leave authored wording intact', async ({ admin }, step) => {
    await step('the user defines a contact list with an unlabelled client identifier and an authored service label', async () => {
      await admin.post('/api/table_def', {
        name: CONTACTS,
        columns: [
          { column_name: 'client_id', column_type: 'Data', in_list_view: true },
          { column_name: 'service_url', column_type: 'Data', label: 'myService URL — keep this sentence', in_list_view: true },
        ],
      })
      await admin.post(`/api/table/${enc(CONTACTS)}`, { client_id: 'contact-826' })
    })
    await step('the user opens the contact list', () => openList(admin, CONTACTS))
    await step('the generated identifier label is readable with its acronym preserved', () => expect(columnLabels()[0]).toBe('Client ID'))
    await step('the authored service label is unchanged', () => expect(columnLabels()[1]).toBe('myService URL — keep this sentence'))
  }, 40_000)

  scenario('Readable policy choice keeps its original value', async ({ admin }, step) => {
    const user = userEvent.setup()
    let rowId = ''
    await step('the user has a contact list with authored wording for a technical policy choice', () => definePolicy(admin))
    await step('the user chooses that policy and saves a contact', async () => {
      await renderApp(`${tableHref(CONTACTS)}/new`, admin)
      await screen.findByTestId('form-view', {}, WAIT)
      await waitFor(() => expect(policyControl()).not.toBeNull(), WAIT)
      const sent = vi.spyOn(globalThis, 'fetch')
      try {
        await user.selectOptions(policyControl(), RAW)
        await onScreen().clickButton('Save')
        const save = await waitFor(() => {
          const at = sent.mock.calls.findIndex(([url, init]) => String(url).includes('/api/save_row') && init?.method === 'POST')
          expect(at).toBeGreaterThanOrEqual(0)
          return at
        }, WAIT)
        const res = (await sent.mock.results[save]!.value) as Response
        expect(res.status).toBe(201)
        const request = JSON.parse(String(sent.mock.calls[save]![1]!.body)) as { row: { policy: string } }
        expect(request.row.policy, 'save request carries the canonical value').toBe(RAW)
        const { data } = await admin.get<{ data: { row_id: string }[] }>(`/api/table/${enc(CONTACTS)}`)
        expect(data).toHaveLength(1)
        rowId = data[0]!.row_id
      } finally {
        sent.mockRestore()
      }
      await admin.post('/api/save_row', { table: CONTACTS, row: { policy: UNMAPPED } })
    })
    await step('the contact shows the authored policy wording in its form, list and filter control', async () => {
      await waitFor(() => expect(optionText(RAW), 'form option must use authored wording').toBe(DISPLAY), WAIT)
      await openList(admin, CONTACTS)
      await waitFor(async () => expect((await columnValues('policy')).sort()).toEqual([DISPLAY, UNMAPPED].sort()), WAIT)
      expect(screen.getByTestId('std-filter-policy').querySelector(`option[value="${RAW}"]`)?.textContent).toBe(DISPLAY)
    })
    await step('filtering by that policy finds the contact using its original value', async () => {
      const sent = vi.spyOn(globalThis, 'fetch')
      try {
        await user.selectOptions(screen.getByTestId('std-filter-policy'), RAW)
        const filters = await waitFor(() => {
          const call = sent.mock.calls.find(([url]) => String(url).includes('/api/table/') && new URL(String(url), 'http://x').searchParams.has('filters'))
          expect(call).toBeDefined()
          return new URL(String(call![0]), 'http://x').searchParams.get('filters')!
        }, WAIT)
        expect(JSON.parse(filters)).toEqual([['policy', '=', RAW]])
      } finally {
        sent.mockRestore()
      }
      expect((await admin.get<{ policy: string }>(`/api/table/${enc(CONTACTS)}/${enc(rowId)}`)).policy).toBe(RAW)
      const rejected = await admin.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: CONTACTS, row: { policy: DISPLAY } }) })
      expect(rejected.status, 'human display text must not become an allowed raw Choice').toBe(417)
      expect(((await rejected.json()) as { error: { type: string } }).error.type).toBe('ValidationError')
      await waitFor(() => expect(screen.getByTestId('list-rows').querySelectorAll('tr')).toHaveLength(1), WAIT)
      expect(await columnValues('policy')).toEqual([DISPLAY])
    })
  }, 60_000)

  scenario('Unmapped choices keep their authored text', async ({ admin }, step) => {
    await step('the user has a contact list with an unmapped choice containing underscores and no translation', () => definePolicy(admin))
    await step('the user opens that choice in a contact', () => openPolicy(admin, admin, UNMAPPED))
    await step('the choice text is shown verbatim', () => expect(optionText(UNMAPPED)).toBe(UNMAPPED))
  }, 40_000)

  scenario('Installed choice translations keep their wording', async ({ admin, createUser }, step) => {
    let reader!: TestClient
    await step("the user's contact policy has different translations for its original value and its authored wording", async () => {
      await definePolicy(admin)
      reader = await createUser({ email: 'labels-826@example.com', roles: ['System Manager'] })
      const person = await admin.get<{ updated_at: string }>(`/api/table/Person/${enc(reader.user!)}`)
      const res = await admin.fetch(`/api/table/Person/${enc(reader.user!)}`, {
        method: 'PATCH', body: JSON.stringify({ language: 'fr', updated_at: person.updated_at }),
      })
      expect(res.status).toBe(200)
      for (const [source_text, translated_text] of [[RAW, 'Créer SI permis — iD'], [DISPLAY, 'AUTRE traduction']])
        await admin.post('/api/save_row', { table: 'Translation', row: { row_id: `labels-826-${source_text}`, language: 'fr', source_text, translated_text } })
    })
    await step('the user opens that policy in a contact', () => openPolicy(admin, reader, RAW))
    await step('the existing translation of the original value is shown unchanged', async () =>
      await waitFor(() => expect(optionText(RAW)).toBe('Créer SI permis — iD'), WAIT))
  }, 40_000)

  scenario('SAP Plant is identified rather than its module', async ({ admin }, step) => {
    await step('the user has a Table called "SAP Plant" in the "Custom" module', () => defineSapPlant(admin))
    await step('the user opens the settings for "SAP Plant"', () => openSettings(admin, SAP_PLANT))
    await step('the settings identify "SAP Plant" rather than "Custom"', () => expectTitle('SAP Plant'))
  }, 40_000)

  scenario('An authored display name takes precedence', async ({ admin }, step) => {
    await step('the user has a Table called "SAP Plant" in the "Custom" module', () => defineSapPlant(admin))
    await step('its effective authored display name is "Plant catalogue"', async () => {
      await admin.put(`/api/table_def/${enc(SAP_PLANT)}`, {
        name: SAP_PLANT, module: 'Custom', description: 'Plant catalogue', columns: [{ column_name: 'plant_name', column_type: 'Data' }],
      })
      await admin.post('/api/table/Metadata%20Override', { row_id: 'storage-860-title', table_name: 'Table', property: 'title_column', value: 'description' })
    })
    await step('the user opens the settings for "SAP Plant"', () => openSettings(admin, SAP_PLANT))
    await step('the settings identify "Plant catalogue"', () => expectTitle('Plant catalogue'))
  }, 40_000)

  scenario('SAP Plant exposes its local storage', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the user has a Table called "SAP Plant" in the "Custom" module', () => defineSapPlant(admin))
    await step('the user opens the settings for "SAP Plant"', () => openSettings(admin, SAP_PLANT))
    await step('the user can copy schema "featherbase", relation "sap_plant" and row key "row_id" without editing them', () =>
      expectCopyable(user, ['featherbase', 'sap_plant', 'row_id']))
  }, 40_000)

  scenario('SAP Plant belongs to an installed app', async ({ admin, createUser }, step) => {
    const user = userEvent.setup()
    let manager!: TestClient
    await step('an installed app owns "SAP Plant" with explicitly mapped storage', async () => {
      await discoverPackages([resolve('../..', 'example-apps/tasker')])
      await admin.post('/api/install_app', { name: 'tasker' })
      // A System Manager admitted to the app, as its administrator is.
      manager = await createUser({ roles: ['System Manager', 'Tasker Member'] })
      await sql`update table_def set label = 'SAP Plant' where name = 'tasker.task'`
      invalidateMeta()
    })
    await step(`the user opens the settings for the app's "SAP Plant"`, () => openSettings(manager, 'tasker.task'))
    await step("the user can copy the app's mapped storage identity rather than a name inferred from its label", () =>
      expectCopyable(user, ['tasker', 'task', 'row_id']))
  }, 60_000)

  scenario('SAP Plant uses shared Settings storage', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('"SAP Plant" is a Settings Table in the "Custom" module', () => defineSapPlant(admin, 'settings'))
    await step('the user opens the settings for "SAP Plant"', () => openSettings(admin, SAP_PLANT))
    await step('the user can copy shared storage "featherbase.single_value" with key "table_name, field" and discriminator "SAP Plant"', () =>
      expectCopyable(user, ['featherbase', 'single_value', 'table_name, field', 'SAP Plant']))
  }, 40_000)

  scenario('SAP Plant is connected to outside storage', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('"SAP Plant" is connected to an outside Data Source in the "Custom" module', async () => {
      await defineSapPlant(admin)
      await sql`insert into data_source (row_id, engine, url_env) values ('storage-860-source', 'postgres', 'UNSET_STORAGE_860_URL') on conflict do nothing`
      await sql`update table_def set data_source = 'storage-860-source', external_schema = 'erp', external_table = 'plants_actual', external_pk = 'plant_code' where name = 'SAP Plant'`
      invalidateMeta()
      invalidateSources()
    })
    await step('the user opens the settings for "SAP Plant"', () => openSettings(admin, SAP_PLANT))
    await step('its storage identity describes its source binding without credentials', () =>
      expectCopyable(user, ['storage-860-source', 'erp', 'plants_actual', 'plant_code']))
  }, 40_000)

  scenario('SAP Plant metadata is not readable', async ({ admin, createUser }, step) => {
    let reader!: TestClient
    await step('the user can read the definition of "SAP Plant" but not its metadata', async () => {
      await defineSapPlant(admin)
      await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Table Reader' } })
      await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Table', role: 'Table Reader', operation: 'read' } })
      reader = await createUser({ roles: ['Table Reader'] })
    })
    await step('the user opens the settings for "SAP Plant"', () => openSettings(reader, SAP_PLANT))
    await step('its storage identity is not disclosed and the definition form remains usable', async () => {
      await screen.findByRole('heading', { name: 'Table: SAP Plant' }, WAIT)
      expect(screen.queryByTestId('table-storage')).toBeNull()
      // The definition reads Module: Custom — in its text box to whoever may edit it,
      // or as its value, read only, to a reader (#795).
      const module = await waitFor(() => {
        const input = document.querySelector<HTMLInputElement>('[data-field="module"]')
        const value = document.querySelector('[data-form-field="module"] [data-value]')
        expect(input ?? value).not.toBeNull()
        return input ? input.value : (value!.textContent ?? '').trim()
      }, WAIT)
      expect(module).toBe('Custom')
    })
  }, 40_000)

  scenario('SAP Plant has no configured warehouse mapping', async ({ admin }, step) => {
    await step('the user has a Table called "SAP Plant" in the "Custom" module', () => defineSapPlant(admin))
    await step('Featherbase has no configured warehouse mapping for "SAP Plant"', () => {})
    await step('the user opens the settings for "SAP Plant"', () => openSettings(admin, SAP_PLANT))
    await step('no warehouse destination is shown', async () => {
      const storage = await screen.findByTestId('table-storage', {}, WAIT)
      expect(storage.textContent).not.toMatch(/warehouse|bronze_featherbase/i)
    })
  }, 40_000)

  scenario('A corrected plant keeps its correction and history', async ({ admin }, step) => {
    const user = userEvent.setup()
    const source = 'Chenai'
    await step('a table "SAP Plant" whose plant 8151 a person corrected to "Chennai"', async () => {
      await admin.post('/api/table_def', { name: SAP_PLANT, module: 'Custom', columns: PLANT_COLUMNS })
      await importPlant(admin, SAP_PLANT, 8151, source, 'source-1')
      const rowId = await plantId(admin, SAP_PLANT, 8151)
      const row = await admin.get<{ updated_at: string }>(`/api/table/${enc(SAP_PLANT)}/${enc(rowId)}`)
      const res = await admin.fetch(`/api/table/${enc(SAP_PLANT)}/${enc(rowId)}`, {
        method: 'PATCH', body: JSON.stringify({ city: 'Chennai', updated_at: row.updated_at }),
      })
      expect(res.status).toBe(200)
    })
    await step('the System Manager renames the table to "Plant"', async () => {
      const app = await openList(admin, SAP_PLANT)
      await onScreen().clickButton('Table administration')
      await user.click(await screen.findByTestId('rename-table'))
      const dialog = await screen.findByTestId('rename-table-dialog')
      await user.clear(within(dialog).getByTestId('rename-table-input'))
      await user.type(within(dialog).getByTestId('rename-table-input'), 'Plant')
      await user.click(within(dialog).getByTestId('rename-table-confirm'))
      const here = () => (app.router as { state: { location: { pathname: string } } }).state.location.pathname
      await waitFor(() => expect(here()).toBe(`/featherbase/admin/table/${tableSlug('Plant')}`), WAIT)
      await screen.findByTestId('list-view', {}, WAIT)
    })
    await step('plant 8151 of "Plant" reads "Chennai", with the correction in its history', async () => {
      const rowId = await plantId(admin, 'Plant', 8151)
      expect((await admin.get<{ city: string }>(`/api/table/Plant/${enc(rowId)}`)).city).toBe('Chennai')
      const { versions } = await admin.get<{ versions: { data: { changed?: [string, unknown, unknown][] } }[] }>(`/api/activity/Plant/${enc(rowId)}`)
      const changes = versions.flatMap((v) => v.data.changed ?? [])
      expect(changes.some(([field, was, now]) => field === 'city' && was === source && now === 'Chennai'), JSON.stringify(changes)).toBe(true)
    })
    await step('importing the source again keeps "Chennai"', async () => {
      await importPlant(admin, 'Plant', 8151, source, 'source-again')
      expect((await admin.get<{ city: string }>(`/api/table/Plant/${enc(await plantId(admin, 'Plant', 8151))}`)).city).toBe('Chennai')
    })
  }, 60_000)

  scenario('The old address says where the Table went', async ({ admin }, step) => {
    await step('the table "SAP Plant" was renamed to "Plant"', async () => {
      await admin.post('/api/table_def', { name: SAP_PLANT, module: 'Custom', columns: PLANT_COLUMNS })
      await admin.post(`/api/table_def/${enc(SAP_PLANT)}/rename`, { to: 'Plant' })
    })
    await step('the user opens the old address of "SAP Plant"', () => renderApp(`/featherbase/admin/table/${tableSlug(SAP_PLANT)}`, admin))
    await step('the page says "SAP Plant is now called Plant" and links to "Plant"', async () => {
      const notice = await screen.findByTestId('table-renamed', {}, WAIT)
      expect((notice.textContent ?? '').replace(/\s+/g, ' ')).toContain('SAP Plant is now called Plant')
      expect(within(notice).getByRole('link').textContent?.trim()).toBe('Open Plant')
    })
  }, 40_000)
})
