import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe } from 'vitest'
import postgres, { type Sql } from 'postgres'
import { invalidateMeta } from 'server/src/meta'
import { invalidateSources } from 'server/src/sources/registry'
import { EXTERNAL_DATABASE_URL } from 'server/test/external-database'
import { arrangeFields } from '../src/components/FormArrangement'
import type { ColumnDef, TableMeta } from '../src/lib/meta'
import { test, expect, renderApp } from './pg-test'

// #795: a row's fields arranged by importance, data type, filled first, links
// first or the Table's own order, in one or two columns, remembered for each
// person and Table; a read-only row shows each value by its type.

const labels = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-testid="form-view"] [data-form-field]')).map((e) => e.dataset.label)

const col = (column_name: string, column_type: string, extra: Partial<ColumnDef> = {}) =>
  ({ column_name, column_type, label: column_name, ...extra }) as ColumnDef

describe('arrangeFields', () => {
  const meta = { name: 'Parcel', title_column: 'label' } as TableMeta
  const fields = [
    col('created_on', 'Datetime'), col('weight', 'Float'), col('note', 'Text'), col('label', 'Data'),
    col('sender', 'Data', { reqd: true }), col('rack', 'Reference', { reference_table: 'Rack' }), col('photo', 'Data'),
    col('updated_by', 'Data'),
  ]
  const saved = { created_on: '2026-10-30T10:00:00Z', weight: 2.5, label: 'Blue box', sender: 'Front desk', rack: '3', photo: 'p/blue-box.png', updated_by: 'kiosk' }
  const names = (g: { fields: ColumnDef[] }) => g.fields.map((f) => f.column_name)

  test('by importance: title, links, required, the rest; empty fields fold only on a read-only row', () => {
    const read = arrangeFields(fields, saved, meta, 'importance', true)
    expect(read.groups.map(names)).toEqual([['label', 'rack', 'sender', 'weight', 'photo'], ['note']])
    expect(read.groups[1]).toMatchObject({ foldable: true, folded: true, heading: '1 empty field' })
    expect(read.bookkeeping.map((f) => f.column_name)).toEqual(['created_on', 'updated_by'])
    expect(arrangeFields(fields, saved, meta, 'importance', false).groups[1].folded).toBe(false)
  })

  test('by data type, filled first and links first', () => {
    const type = arrangeFields(fields, saved, meta, 'type', true).groups
    expect(type.map((g) => [g.key, names(g)])).toEqual([
      ['text', ['note', 'label', 'sender']], ['number', ['weight']], ['file', ['photo']], ['link', ['rack']],
    ])
    expect(arrangeFields(fields, saved, meta, 'filled', true).groups.map(names)).toEqual([
      ['weight', 'label', 'sender', 'rack', 'photo'], ['note'],
    ])
    expect(arrangeFields(fields, saved, meta, 'links', true).groups.map(names)).toEqual([
      ['rack'], ['weight', 'note', 'label', 'sender', 'photo'],
    ])
  })

  test('grouping follows the saved row, not values being typed', () => {
    // A field typed into (but not saved) stays where the saved row put it.
    const groups = arrangeFields(fields, { ...saved, note: undefined }, meta, 'filled', false).groups
    expect(names(groups[1])).toEqual(['note'])
  })
})

async function parcelDesk(admin: { post: <T>(p: string, b: unknown) => Promise<T> }, sections = false) {
  await admin.post('/api/table_def', {
    name: 'Arrange Desk',
    id_pattern: 'prompt',
    title_column: 'label',
    columns: [
      { column_name: 'created_on', label: 'Created On', column_type: 'Date' },
      { column_name: 'weight', label: 'Weight', column_type: 'Float' },
      ...(sections ? [{ column_name: 'more', label: 'More', column_type: 'Section Break' }] : []),
      { column_name: 'note', label: 'Note', column_type: 'Text' },
      { column_name: 'label', label: 'Label', column_type: 'Data' },
      { column_name: 'sender', label: 'Sender', column_type: 'Data', reqd: true },
    ],
  })
  await admin.post('/api/table/Arrange%20Desk', { row_id: 'D-1', created_on: '2026-10-30', weight: 2.5, label: 'Blue box', sender: 'Front desk' })
}

test('an editable row opens by importance, with its controls, and the choice is remembered for the person', async ({ admin }) => {
  await parcelDesk(admin)
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/arrange-desk/row/D-1', admin)
  await waitFor(() => expect(labels()).toEqual(['Label', 'Sender', 'Weight', 'Note', 'Created On']), { timeout: 8000 })
  // Editable: the empty note is a control, not folded; bookkeeping stays a control at the foot.
  expect(screen.getByLabelText('Note').tagName).toBe('TEXTAREA')
  expect(screen.getByLabelText('Created On')).toHaveAttribute('type', 'date')
  expect(screen.getByTestId('arrange-importance')).toHaveAttribute('aria-pressed', 'true')

  await user.click(screen.getByTestId('arrange-source'))
  await waitFor(() => expect(screen.getByTestId('form-section-0')).toBeInTheDocument())
  expect(labels()).toEqual(['Created On', 'Weight', 'Note', 'Label', 'Sender'])
  await user.click(screen.getByTestId('arrange-columns-1'))
  await waitFor(async () =>
    expect((await admin.get<{ settings: { form?: unknown } }>('/api/user_settings/Arrange%20Desk')).settings.form).toEqual({ mode: 'source', columns: 1 }),
  )
  expect(screen.getByTestId('form-section-0').className).not.toMatch(/md:grid-cols-2/)
})

test('the remembered arrangement comes back, and does not drop the list’s', async ({ admin }) => {
  await parcelDesk(admin)
  await admin.put('/api/user_settings/Arrange%20Desk', { sort: { field: 'weight', dir: 'desc' }, shownCols: [], hiddenCols: [] })
  await admin.put('/api/user_settings/Arrange%20Desk', { form: { mode: 'filled', columns: 2 } })
  await renderApp('/featherbase/admin/table/arrange-desk/row/D-1', admin)
  await waitFor(() => expect(screen.getByTestId('form-arranged')).toHaveAttribute('data-arrangement', 'filled'), { timeout: 8000 })
  expect(labels()).toEqual(['Weight', 'Label', 'Sender', 'Note', 'Created On'])
  const stored = await admin.get<{ settings: Record<string, unknown> }>('/api/user_settings/Arrange%20Desk')
  expect(stored.settings.sort).toEqual({ field: 'weight', dir: 'desc' })
})

test('a Table laid out in sections opens in its own order until the person picks another', async ({ admin }) => {
  await parcelDesk(admin, true)
  await renderApp('/featherbase/admin/table/arrange-desk/row/D-1', admin)
  const second = await screen.findByTestId('form-section-1', undefined, { timeout: 8000 })
  expect(within(second).getByLabelText('Sender')).toBeInTheDocument()
  expect(screen.getByTestId('arrange-source')).toHaveAttribute('aria-pressed', 'true')
})

test('a new row keeps the sectioned layout and no arrange switch', async ({ admin }) => {
  await parcelDesk(admin)
  await renderApp('/featherbase/admin/table/arrange-desk/new', admin)
  await screen.findByTestId('form-section-0', undefined, { timeout: 8000 })
  expect(screen.queryByTestId('arrange-bar')).not.toBeInTheDocument()
})

// #910: beside the drill pane the form is narrow whatever the window is, so
// its two columns follow the form's own width, not the window's.
test("two columns follow the form's own width, so a form beside the pane falls back to one", async ({ admin }) => {
  await parcelDesk(admin)
  await admin.put('/api/user_settings/Arrange%20Desk', { form: { mode: 'importance', columns: 2 } })
  await renderApp('/featherbase/admin/table/arrange-desk/row/D-1', admin)
  const group = (await screen.findAllByTestId('field-group', undefined, { timeout: 8000 }))[0]
  const grid = group.querySelector('.grid')!
  expect(grid.className).toMatch(/@2xl:grid-cols-2/)
  expect(grid.className).not.toMatch(/(^|\s)md:grid-cols-2/)
  expect(grid.closest('.\\@container')).not.toBeNull()
})

test('a sectioned form in two columns also follows its own width', async ({ admin }) => {
  await parcelDesk(admin, true)
  await renderApp('/featherbase/admin/table/arrange-desk/row/D-1', admin)
  const section = await screen.findByTestId('form-section-1', undefined, { timeout: 8000 })
  expect(section.className).toMatch(/@2xl:grid-cols-2/)
  expect(section.className).not.toMatch(/(^|\s)md:grid-cols-2/)
})

test('a row with no side panels gives its form the whole width, with no empty side column', async ({ admin }) => {
  await parcelDesk(admin)
  await renderApp('/featherbase/admin/table/arrange-desk/row/D-1', admin)
  const form = await screen.findByTestId('form-view')
  await screen.findByTestId('arrange-bar', undefined, { timeout: 8000 })
  expect(form.querySelectorAll('aside')).toHaveLength(0)
})

// #795 point 2: who made and last changed the row is one quiet line at the
// foot, not fields among the row's own.
test('by importance, when and by whom the row was created and updated is one footer line', async ({ admin }) => {
  await parcelDesk(admin)
  await renderApp('/featherbase/admin/table/arrange-desk/row/D-1', admin)
  const footer = await screen.findByTestId('bookkeeping-line', undefined, { timeout: 8000 })
  const day = '\\d{2}-[A-Z][a-z]{2}-\\d{4}'
  expect(footer.textContent).toMatch(new RegExp(`^Created ${day} by Administrator, updated ${day} by Administrator$`))
})

test('in a narrow form Arrange by and Columns wrap as whole controls, every one in sight', async ({ admin }) => {
  await parcelDesk(admin)
  await renderApp('/featherbase/admin/table/arrange-desk/row/D-1', admin)
  const bar = await screen.findByTestId('arrange-bar', undefined, { timeout: 8000 })
  expect(bar.className).toMatch(/\bflex-wrap\b/)
  expect(bar.className).not.toMatch(/\boverflow-(x-)?(auto|hidden|scroll)\b/)
  for (const control of bar.querySelectorAll('button')) expect(control.className).toMatch(/\bwhitespace-nowrap\b/)
})

// ---- A read-only connected row ----

const ENV = 'WEB_ARRANGE_FIXTURE_URL'
process.env[ENV] = EXTERNAL_DATABASE_URL
let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 1 })
  await cli.unsafe('drop schema if exists web_arrange cascade')
  await cli.unsafe(`create schema web_arrange;
    create table web_arrange.rack (id bigint primary key, label text);
    create table web_arrange.parcel (id bigint primary key, created_on timestamptz not null default now(),
      label varchar(300), weight numeric(6,2), note text, fragile boolean, instructions text, photo text,
      sender varchar(500) not null, rack_id bigint references web_arrange.rack(id), updated_by varchar(60));
    insert into web_arrange.rack values (3, 'Top');
    insert into web_arrange.parcel (id, label, weight, fragile, instructions, photo, sender, rack_id, updated_by)
      values (7, 'Blue box', 2.5, true, 'Keep upright', 'parcels/blue-box.png', 'Front desk', 3, 'kiosk');`)
})
afterAll(async () => {
  invalidateSources()
  await cli.unsafe('drop schema if exists web_arrange cascade')
  await cli.end({ timeout: 2 })
})

test('a read-only row shows each value by its type, folds its empty fields and puts bookkeeping on one line', async ({ admin }) => {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'web-arrange', engine: 'postgres', url_env: ENV, default_schema: 'web_arrange', access: 'read_only' })
  await admin.post('/api/table/Data%20Source/web-arrange:reflect', {
    tables: ['web_arrange.rack', 'web_arrange.parcel'], names: { 'web_arrange.rack': 'Arrange Rack', 'web_arrange.parcel': 'Arrange Parcel' },
  })
  const meta = await admin.get<{ columns: ColumnDef[] }>('/api/table/Arrange%20Parcel:meta')
  // Point 10: a declared length is one-line text, however long the limit.
  expect(meta.columns.find((c) => c.column_name === 'sender')?.column_type).toBe('Data')
  expect(meta.columns.find((c) => c.column_name === 'label')?.column_type).toBe('Data')
  expect(meta.columns.find((c) => c.column_name === 'instructions')?.column_type).toBe('Text')

  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/arrange-parcel/row/7', admin)
  await waitFor(() => expect(labels()).toEqual(['Label', 'Rack', 'Sender', 'Weight', 'Fragile', 'Instructions', 'Photo']), { timeout: 8000 })
  const value = (label: string) => screen.getByLabelText(label)
  expect(value('Weight')).toHaveClass('tabular-nums')
  expect(value('Fragile')).toHaveTextContent('Yes')
  expect(value('Photo')).toHaveTextContent(/^blue-box\.png$/)
  await waitFor(() => expect(within(value('Rack')).getByRole('link')).toHaveTextContent(/^Top$/))
  expect(value('Sender')).toHaveClass('whitespace-nowrap')
  expect(value('Instructions')).toHaveClass('whitespace-pre-wrap')
  expect(document.querySelector('[data-form-field="weight"] [data-type-mark="number"]')).not.toBeNull()

  const fold = screen.getByTestId('empty-fields-toggle')
  expect(fold).toHaveTextContent('1 empty field')
  expect(fold).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByLabelText('Note')).not.toBeInTheDocument()
  await user.click(fold)
  expect(value('Note')).toHaveTextContent('—')

  expect(screen.getByTestId('bookkeeping-line')).toHaveTextContent(/Created On .* · Updated By kiosk/)
})

test("a connected row whose source keeps its last change as words, not a time, shows no Updated day", async ({ admin }) => {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'web-arrange-words', engine: 'postgres', url_env: ENV, default_schema: 'web_arrange', access: 'read_only' })
  // A binding written by hand, whose "last changed" column holds words.
  await admin.post('/api/table_def', {
    name: 'Arrange Worded Parcel', data_source: 'web-arrange-words', external_schema: 'web_arrange', external_table: 'parcel',
    external_pk: 'id', external_modified: 'instructions', columns: [{ column_name: 'label', column_type: 'Data', label: 'Label' }],
  })
  expect(await admin.get('/api/table/Arrange%20Worded%20Parcel/7')).toMatchObject({ updated_at: 'Keep upright' })
  await renderApp('/featherbase/admin/table/arrange-worded-parcel/row/7', admin)
  await waitFor(() => expect(labels()).toEqual(['Label']), { timeout: 8000 })
  expect(screen.queryByText(/^Updated/)).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('Keep upright')
})

// A binding written by hand may store a column with no label, name a
// bookkeeping column after a link, or read text as JSON.
async function handBoundParcel(admin: { post: <T>(p: string, b: unknown) => Promise<T> }, columns: Record<string, unknown>[], before?: () => Promise<void>) {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'web-arrange-hand', engine: 'postgres', url_env: ENV, default_schema: 'web_arrange', access: 'read_only' })
  await admin.post('/api/table/Data%20Source/web-arrange-hand:reflect', { tables: ['web_arrange.rack'], names: { 'web_arrange.rack': 'Arrange Hand Rack' } })
  await admin.post('/api/table_def', {
    name: 'Arrange Hand Parcel', data_source: 'web-arrange-hand', external_schema: 'web_arrange', external_table: 'parcel',
    external_pk: 'id', columns: [{ column_name: 'label', column_type: 'Data', label: 'Label' }, ...columns],
  })
  await before?.()
  await renderApp('/featherbase/admin/table/arrange-hand-parcel/row/7', admin)
}

test('a connected column stored with no label is named by its column name, in the form and on the bookkeeping line', async ({ admin, db }) => {
  await handBoundParcel(admin, [
    { column_name: 'sender', label: 'Sender', column_type: 'Data' },
    { column_name: 'modified_by', label: 'Modified By', source_column: 'updated_by', column_type: 'Data' },
  ], async () => {
    await (db as Sql)`update column_def set label = null where parent = 'Arrange Hand Parcel' and column_name in ('sender', 'modified_by')`
    invalidateMeta()
  })
  await waitFor(() => expect(labels()).toEqual(['Label', 'sender']), { timeout: 8000 })
  expect(screen.getByLabelText('sender')).toHaveTextContent('Front desk')
  expect(screen.getByTestId('bookkeeping-line')).toHaveTextContent(/^modified_by kiosk$/)
})

test('a bookkeeping column that links to another Table shows the linked row by its title', async ({ admin }) => {
  await handBoundParcel(admin, [{ column_name: 'modified_by', label: 'Modified By', source_column: 'rack_id', column_type: 'Reference', reference_table: 'Arrange Hand Rack' }])
  await waitFor(() => expect(screen.getByTestId('bookkeeping-line')).toHaveTextContent(/^Modified By Top$/), { timeout: 8000 })
})

test('a JSON column holding text shows that text as it is', async ({ admin }) => {
  await handBoundParcel(admin, [{ column_name: 'steps', label: 'Steps', source_column: 'instructions', column_type: 'JSON' }])
  await waitFor(() => expect(screen.getByLabelText('Steps')).toHaveTextContent(/^Keep upright$/), { timeout: 8000 })
})
