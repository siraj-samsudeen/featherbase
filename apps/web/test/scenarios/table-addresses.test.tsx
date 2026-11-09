// table-addresses' fenced scenarios (#1070), rendered in jsdom against the
// real in-process server. Each test is one scenario of
// openspec/specs/table-addresses/spec.md, step by step: a Table's address is
// its readable segment, and a row's is its exact ID.
//
// Expected addresses are literal, deliberately independent of the app's URL
// builders. A browser reload is the app rendered again at the same address.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from 'server/src/db'
import { invalidateMeta } from 'server/src/meta'
import { scenarioFor } from 'server/test/scenario'
import { clearSession } from '../../src/lib/import-session'
import { test, expect, renderApp, onScreen, inside, byTestId } from '../pg-test'

const scenario = scenarioFor(test, 'table-addresses')
const WAIT = { timeout: 8000 }

const ROOT = '/featherbase/admin/table/route-probe'
const STOCK = '/featherbase/admin/table/route-probe/row/Stock%20review'
const IDS = ['columns', 'merge', 'new', 'A / B?x#%']
const PATHS = [
  '/featherbase/admin/table/route-probe/row/columns',
  '/featherbase/admin/table/route-probe/row/merge',
  '/featherbase/admin/table/route-probe/row/new',
  '/featherbase/admin/table/route-probe/row/A%20%2F%20B%3Fx%23%25',
]
const FILTERS = [['subject', '=', 'Stock review']]
const PREFILL = { subject: 'A / B?x#%', notes: 'Route Probe unchanged' }

type Rendered = Awaited<ReturnType<typeof renderApp>>
let app: Rendered
let as: TestClient

/** Opens an address, as typing it into the address bar (or reloading it) does. */
async function visit(path: string, who: TestClient = as) {
  as = who
  app?.unmount()
  app = await renderApp(path, who)
}
/** Where the app is now, spelled as the address bar spells it. */
const href = () => (app.router.state as { location: { href: string } }).location.href
const reload = () => visit(href())
const pathname = () => href().split('?')[0]
const search = (key: string) => {
  const raw = new URLSearchParams(href().split('?')[1] ?? '').get(key)
  expect(raw, `missing ${key} query parameter`).not.toBeNull()
  const value = JSON.parse(raw!)
  return typeof value === 'string' ? JSON.parse(value) : value
}
const expectPath = (expected: string) => waitFor(() => expect(pathname()).toBe(expected), WAIT)
const byLabel = (label: string) => screen.getByLabelText(label, { exact: true, selector: 'input, textarea, select' }) as HTMLInputElement
const formReady = () => screen.findByTestId('form-view', {}, WAIT)
const rowLink = async (name: string) => within(await screen.findByTestId('list-rows', {}, WAIT)).findByRole('link', { name }, WAIT)
const enc = encodeURIComponent

async function arrange(admin: TestClient, name = 'Route Probe', ids = ['Stock review', 'Unselected review']) {
  await admin.post('/api/table_def', {
    name, module: 'Route acceptance', id_pattern: 'field:subject', title_column: 'subject',
    columns: [
      { column_name: 'subject', column_type: 'Data', label: 'Review title', reqd: true, in_list_view: true },
      { column_name: 'notes', column_type: 'Data', label: 'Review notes', in_list_view: true },
    ],
  })
  for (const subject of ids) await admin.post(`/api/table/${enc(name)}`, { subject, notes: `Existing ${subject}` })
}
async function role(admin: TestClient, name: string, operations: string[]) {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: name } })
  for (const operation of operations) await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Route Probe', role: name, operation } })
  return name
}
/** Route Probe with Stock review, a reader role, and the route editor who may read, change and add its rows. */
async function routeProbe(admin: TestClient, createUser: (o: { roles: string[] }) => Promise<TestClient>) {
  await arrange(admin)
  await role(admin, 'Route Probe Reader', ['read'])
  return createUser({ roles: [await role(admin, 'Route Probe Editor', ['read', 'update', 'create'])] })
}
const row = (admin: TestClient, table: string, id: string) => admin.get<Record<string, unknown>>(`/api/table/${enc(table)}/${enc(id)}`)

/** Saves the open form; returns the row the form sent. */
async function save() {
  const sent: Record<string, unknown>[] = []
  const bridged = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await bridged(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/api/save_row') && init?.method === 'POST') {
      expect(res.status, await res.clone().text()).toBe(201)
      const body = JSON.parse(String(init.body))
      expect(body.table).toBe('Route Probe')
      sent.push(body.row)
    }
    return res
  }) as typeof fetch
  try {
    await userEvent.click(screen.getByTestId('form-save'))
    await waitFor(() => expect(sent).toHaveLength(1), WAIT)
    await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent(/^Saved$/), WAIT)
  } finally { globalThis.fetch = bridged }
  return sent[0]!
}
async function fill(label: string, value: string) {
  await userEvent.clear(byLabel(label))
  await userEvent.type(byLabel(label), value)
}
async function navigate(name: string, who: TestClient) {
  await visit('/featherbase/admin/all-tables', who)
  await userEvent.click(await within(await screen.findByTestId('table-nav', {}, WAIT)).findByRole('link', { name }, WAIT))
}

async function upload(csv: string, name: string) {
  const bytes = new TextEncoder().encode(csv).buffer
  const file = new File([bytes], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, WAIT), { target: { files: [file] } })
  await screen.findByTestId('iw-target-0', {}, WAIT)
}
async function importAsNewTable(admin: TestClient, csv: string, file: string, name: string) {
  clearSession()
  await visit('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('import-data-link', {}, WAIT))
  await screen.findByTestId('import-wizard', {}, WAIT)
  await upload(csv, file)
  const target = screen.getByTestId('iw-target-0') as HTMLInputElement
  if (target.value !== 'New Table…') {
    await userEvent.click(target)
    await userEvent.click(await screen.findByTestId('iw-target-new-0'))
  }
  const box = await screen.findByTestId('iw-new-name-0', {}, WAIT)
  // Typing trims nothing: a trailing space stays part of the name.
  fireEvent.change(box, { target: { value: name } })
}

/** What a refused twin must not change. */
async function snapshot(admin: TestClient) {
  return { meta: await admin.get('/api/table/route-probe:meta'), stock: await row(admin, 'Route Probe', 'Stock review') }
}
async function unchanged(admin: TestClient, before: Awaited<ReturnType<typeof snapshot>>, refusal: Response) {
  const text = await refusal.clone().text()
  expect(refusal.status, text).toBe(409)
  expect(text).toMatch(/Route Probe/)
  expect(await admin.get('/api/table/route-probe:meta')).toEqual(before.meta)
  expect(await row(admin, 'Route Probe', 'Stock review')).toEqual(before.stock)
  expect((await admin.get<{ total: number }>('/api/table/route-probe')).total).toBe(2)
}

describe('table-addresses', () => {
  scenario('A spaced Table name remains unchanged', async ({ admin, createUser }, step) => {
    let editor: TestClient
    await step('the user manages a Table named Route Probe with a row called Stock review', async () => {
      editor = await routeProbe(admin, createUser)
    })
    await step('the user opens Route Probe through Table navigation and edits Stock review', async () => {
      const session = await editor.get<{ name: string; roles: string[]; capabilities: { manage: boolean; tables: string[]; creatable: string[] } }>('/api/whoami')
      expect(session.name).not.toBe('Administrator')
      expect(session.roles).not.toContain('System Manager')
      expect(session.capabilities.manage).toBe(false)
      expect(session.capabilities.tables).toContain('Route Probe')
      expect(session.capabilities.creatable).toContain('Route Probe')
      expect(session.capabilities.creatable).not.toContain('route-probe')
      await navigate('Route Probe', editor)
      await expectPath(ROOT)
      // A raw URL slug used to gate canonical capability arrays hides this.
      await waitFor(() => expect(screen.getByTestId('list-new')).toHaveAttribute('href', ROOT + '/new'), WAIT)
      await userEvent.click(await rowLink('Stock review'))
      await expectPath(STOCK)
      await formReady()
      await waitFor(() => expect(byLabel('Review title')).toBeInTheDocument(), WAIT)
      await fill('Review notes', 'Reviewed through readable address')
      const saved = await save()
      expect(saved.row_id).toBe('Stock review')
      expect(saved.subject).toBe('Stock review')
      expect(saved.notes).toBe('Reviewed through readable address')
    })
    await step('its address uses the Table segment route-probe', () => expectPath(STOCK))
    await step('the saved row belongs to Route Probe with its original labels', async () => {
      const stored = await row(admin, 'Route Probe', 'Stock review')
      expect(stored).toMatchObject({ row_id: 'Stock review', subject: 'Stock review', notes: 'Reviewed through readable address' })
      expect(within(screen.getByTestId('breadcrumbs')).getByRole('link', { name: 'Route Probe' })).toHaveAttribute('href', ROOT)
      expect(screen.getByRole('heading', { name: 'Route Probe: Stock review' })).toBeVisible()
      expect(byLabel('Review title')).toBeInTheDocument()
      const meta = await admin.get<{ name: string; columns: { column_name: string; label: string }[] }>('/api/table/route-probe:meta')
      expect(meta.name).toBe('Route Probe')
      expect(meta.columns.find((column) => column.column_name === 'subject')!.label).toBe('Review title')
      await reload()
      await waitFor(() => expect(byLabel('Review notes')).toHaveValue('Reviewed through readable address'), WAIT)
    })
  })

  scenario('A Table name does not open the builder', async ({ admin }, step) => {
    await step('the user manages a Table named New Table', () => arrange(admin, 'New Table'))
    await step('the user opens New Table through Table navigation', () => navigate('New Table', admin))
    await step('its list opens separately from the Table builder', async () => {
      await expectPath('/featherbase/admin/table/new-table')
      expect(await screen.findByTestId('list-view', {}, WAIT)).toBeVisible()
      await inside(onScreen(), 'list-rows', (el) => el.assertText('Stock review'))
      expect(screen.queryByTestId('table-builder')).toBeNull()
      await reload()
      expect(await screen.findByTestId('list-view', {}, WAIT)).toBeVisible()
    })
  })

  scenario('Reserved words remain existing row IDs', async ({ admin }, step) => {
    await step('the user manages a Table named Route Probe with rows identified by columns, merge, new and A / B?x#%', () => arrange(admin, 'Route Probe', IDS))
    await step('the user opens each Route Probe row by its shared address', async () => {
      for (let index = 0; index < IDS.length; index++) {
        await visit(PATHS[index]!, admin)
        await formReady()
        await expectPath(PATHS[index]!)
        await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent(/^Saved$/), WAIT)
        await waitFor(() => expect(byLabel('Review title')).toHaveValue(IDS[index]), WAIT)
        expect(byLabel('Review notes')).toHaveValue(`Existing ${IDS[index]}`)
        await fill('Review notes', `Edited ${IDS[index]}`)
        expect((await save()).row_id).toBe(IDS[index])
      }
    })
    await step('each existing row opens with its exact ID instead of a tool or a new-row form', async () => {
      for (const id of IDS) {
        const stored = await row(admin, 'Route Probe', id)
        expect(stored.row_id).toBe(id)
        expect(stored.notes).toBe(`Edited ${id}`)
      }
    })
  })

  scenario('Shared destinations retain the selected work', async ({ admin, createUser }, step) => {
    const user = userEvent.setup()
    await step('the user manages a Table named Route Probe with a row called Stock review', () => routeProbe(admin, createUser))
    await step('the user follows filtered, new-row, print, portal and map destinations for Route Probe', async () => {
      await visit(ROOT + '?filters=' + enc(JSON.stringify(FILTERS)), admin)
      await inside(onScreen(), 'list-rows', (el) => el.assertText('Stock review'))
      expect(search('filters')).toEqual(FILTERS)
      await waitFor(() => expect(screen.getByTestId('list-rows').querySelectorAll('tr')).toHaveLength(1), WAIT)
      // Generated links, not just successful direct loads.
      await waitFor(() => expect(screen.getByTestId('list-new')).toHaveAttribute('href', ROOT + '/new'), WAIT)
      await onScreen().clickButton('Table administration')
      for (const [control, path] of [
        ['open-columns', ROOT + '/columns'], ['open-merge', ROOT + '/merge'],
        ['open-naming', ROOT + '/naming'], ['open-permissions', ROOT + '/permissions'],
      ] as const) expect(await screen.findByTestId(control)).toHaveAttribute('href', path)
      await onScreen().pressKey('Escape')
      await onScreen().clickButton('View: List')
      expect(await screen.findByTestId('open-report')).toHaveAttribute('href', ROOT + '/view/report')

      await visit(ROOT + '/new?prefill=' + enc(JSON.stringify(PREFILL)), admin)
      await formReady()
      expect(search('prefill')).toEqual(PREFILL)
      await waitFor(() => expect(byLabel('Review title')).toHaveValue(PREFILL.subject), WAIT)
      expect(byLabel('Review notes')).toHaveValue(PREFILL.notes)
      expect(screen.getByTestId('form-status')).toHaveTextContent(/^Not saved$/)
      await save()
      await expectPath('/featherbase/admin/table/route-probe/row/A%20%2F%20B%3Fx%23%25')
      expect((await row(admin, 'Route Probe', PREFILL.subject)).notes).toBe(PREFILL.notes)

      await admin.post('/api/save_row', { table: 'Print Format', row: {
        row_id: 'Route Probe print', ref_table: 'Route Probe', is_default: true, template: '<p>Canonical review: {{ subject }}</p>',
      } })
      await visit(STOCK, admin)
      await formReady()
      await onScreen().clickButton('Record actions')
      const print = await screen.findByTestId('form-print')
      expect(print).toHaveAttribute('href', '/featherbase/print/route-probe/Stock%20review')
      await user.click(print)
      await waitFor(() => expect(screen.getByTestId('print-format-body').textContent).toBe('Canonical review: Stock review'), WAIT)
      await onScreen().within(byTestId('print-docname'), (el) => el.assertText('Stock review'))

      await visit('/featherbase/portal/route-probe', admin)
      await waitFor(() => expect(screen.getByTestId('portal-title').textContent).toBe('My Route Probe'), WAIT)
      const portalLink = await waitFor(() => {
        const links = screen.getAllByTestId('portal-row').flatMap((r) => within(r).queryAllByRole('link', { name: 'Stock review' }))
        expect(links).toHaveLength(1)
        return links[0]!
      }, WAIT)
      expect(portalLink).toHaveAttribute('href', '/featherbase/portal/route-probe/Stock%20review')
      await user.click(portalLink)
      await inside(onScreen(), 'portal-doc', (el) => el.assertText('Stock review'))
      await waitFor(() => expect(screen.getByTestId('portal-field-subject').textContent).toBe('Stock review'), WAIT)

      // #910: the map is the row page's Map tab, at the row's own address.
      await visit(STOCK, admin)
      await formReady()
      await onScreen().clickButton('Map')
      expect(await screen.findByTestId('relation-map', {}, WAIT)).toBeVisible()
      expect(pathname()).toBe(STOCK)
      await visit(ROOT + '/view/report', admin)
      expect(await screen.findByTestId('report-view', {}, WAIT)).toBeVisible()
      expect(screen.getByTestId('report-to-list')).toHaveAttribute('href', ROOT)
      await visit(ROOT + '/permissions', admin)
      await inside(onScreen(), 'permission-manager', (el) => el.assertText('Route Probe'))
      expect(await screen.findByTestId('perm-Route Probe Reader-can_read', {}, WAIT)).toBeChecked()
      expect(screen.getByTestId('perm-Route Probe Reader-can_write')).not.toBeChecked()
    })
    await step('the destinations retain their selected work and unchanged row identity', async () => {
      expect((await row(admin, 'Route Probe', 'Stock review')).subject).toBe('Stock review')
    })
    await step('the settings destination still opens System Settings by its real name', async () => {
      const read: number[] = []
      const bridged = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await bridged(input, init)
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (decodeURIComponent(url.split('?')[0]!) === '/api/table/System Settings/System Settings') read.push(res.status)
        return res
      }) as typeof fetch
      try {
        await visit('/featherbase/admin/table/system-settings', admin)
        await formReady()
        await waitFor(() => expect(read[0]).toBe(200), WAIT)
      } finally { globalThis.fetch = bridged }
      await inside(onScreen(), 'breadcrumbs', (el) => el.assertText('System Settings'))
      await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent(/^Saved$/), WAIT)
      expect(screen.getByRole('heading', { name: /System Settings:/ })).toBeVisible()
    })
  })

  scenario('An ambiguous spelling selects no Table', async ({ admin }, step) => {
    await step('two existing Table definitions have the same normalized spelling', async () => {
      await arrange(admin, 'Legacy Route Probe')
      // Hyphenated plain names are not legal for new Tables: a pre-existing legacy definition.
      await sql`insert into table_def (name, module, custom) values ('Legacy-Route-Probe', 'Route acceptance', true)`
      invalidateMeta()
    })
    await step('the user opens that spelling as a Table address', () => visit('/featherbase/admin/table/legacy-route-probe', admin))
    await step('the ambiguity is reported without opening either Table', async () => {
      const response = await admin.fetch('/api/table/legacy-route-probe:meta')
      const text = await response.text()
      expect(response.status, text).toBe(409)
      expect(text).toMatch(/ambiguous/i)
      for (const name of ['Legacy Route Probe', 'Legacy-Route-Probe'])
        expect((await admin.get<{ name: string }>(`/api/table/${enc(name)}:meta`)).name, 'exact name wins').toBe(name)
      expect((await screen.findAllByText(/ambiguous/i, {}, WAIT))[0]).toBeVisible()
      expect(screen.queryByTestId('list-view')).toBeNull()
      expect(screen.queryByTestId('form-view')).toBeNull()
      await visit('/featherbase/admin/table/Legacy%20Route%20Probe', admin)
      await inside(onScreen(), 'list-rows', (el) => el.assertText('Stock review'))
    })
  })

  scenario("A new Table cannot take an existing Table's address", async ({ admin, createUser }, step) => {
    let editor: TestClient
    let before: Awaited<ReturnType<typeof snapshot>>
    let refusal: Response
    await step('the user manages a Table named Route Probe with a row called Stock review', async () => {
      editor = await routeProbe(admin, createUser)
    })
    await step("the user attempts to create another Table with Route Probe's address", async () => {
      before = await snapshot(admin)
      refusal = await admin.fetch('/api/table_def', { method: 'POST', body: JSON.stringify({ name: 'Route Probe ', columns: [{ column_name: 'subject', column_type: 'Data' }] }) })
    })
    await step('the new Table is refused without changing Route Probe', () => unchanged(admin, before, refusal))
    await step('the original Route Probe remains reachable with its unchanged identity', async () => {
      await navigate('Route Probe', editor)
      await expectPath(ROOT)
      await userEvent.click(await rowLink('Stock review'))
      await expectPath(STOCK)
      await formReady()
      await waitFor(() => expect(byLabel('Review title')).toHaveValue('Stock review'), WAIT)
      expect(byLabel('Review notes')).toHaveValue('Existing Stock review')
      await reload()
      await waitFor(() => expect(byLabel('Review notes')).toHaveValue('Existing Stock review'), WAIT)
    })
  })

  scenario("Importing a new Table cannot take an existing Table's address", async ({ admin, createUser }, step) => {
    let before: Awaited<ReturnType<typeof snapshot>>
    const refusals: { name: unknown; res: Response }[] = []
    await step('the user manages a Table named Route Probe with a row called Stock review', () => routeProbe(admin, createUser))
    await step("the user imports rows into a new Table with Route Probe's address", async () => {
      before = await snapshot(admin)
      await importAsNewTable(admin, 'subject,notes\nIncoming,Must not land\n', 'route-probe.csv', 'Route Probe ')
      const bridged = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await bridged(input, init)
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.split('?')[0] === '/api/table_def' && init?.method === 'POST') refusals.push({ name: JSON.parse(String(init.body)).name, res: res.clone() })
        return res
      }) as typeof fetch
      try {
        await userEvent.click(screen.getByTestId('iw-import'))
        await waitFor(() => expect(refusals).toHaveLength(1), WAIT)
      } finally { globalThis.fetch = bridged }
      expect(refusals[0]!.name).toBe('Route Probe ')
    })
    await step('the imported Table is refused without changing Route Probe', async () => {
      await unchanged(admin, before, refusals[0]!.res)
      await inside(onScreen(), 'iw-failure-0', (el) => el.assertText('Route Probe'))
      expect(screen.queryByTestId('iw-result-0')).toBeNull()
      expect(screen.queryByTestId('list-view')).toBeNull()
    })
    await step('a new Table with a different address can still be imported', async () => {
      await importAsNewTable(admin, 'subject,notes\nIncoming,Allowed import\n', 'route-other.csv', 'Route Import Other')
      await userEvent.click(screen.getByTestId('iw-import'))
      await waitFor(() => expect(screen.queryByTestId('iw-done') ?? screen.getByTestId('list-view')).toBeInTheDocument(), { timeout: 20_000 })
      const done = screen.queryByTestId('iw-done')
      if (done) expect(screen.getByTestId('iw-result-0').textContent).toMatch(/Imported \d+ rows? into/)
      await expectPath('/featherbase/admin/table/route-import-other')
      await inside(onScreen(), 'list-rows', (el) => el.assertText('Incoming'))
      const imported = (await admin.get<{ data: { row_id: string }[] }>('/api/table/route-import-other')).data
      expect(imported).toHaveLength(1)
      expect((await row(admin, 'Route Import Other', imported[0]!.row_id)).notes).toBe('Allowed import')
      clearSession()
    })
  }, 60_000)
})
