// #209 (issue #197): changing a Table's columns after the rows are in it.
//
// "After importing I want to add a certain column but today it is not
// possible", and "in one of the things floor was spelled with a G, Glor".
//
// This is the component layer, not e2e, because everything here is what
// docs/TESTING.md puts on layer 2: rendering from metadata, form-interaction
// logic, and what did or did not reach the server. The browser adds nothing
// to any of it. Arriving from the Table's own list view came down from the
// e2e spec too (#1080); only its phone-width layout checks wait for a layout test.
//
// The server is the real in-process one against the sandboxed database, so
// a rename here performs the real DDL and the assertion that the rows came
// with it is a real one.

import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { ANY_TABLE_LINK } from '../src/pages/ColumnEditor'

const DT = 'Ce Zones'

type Admin = Parameters<typeof renderApp>[1]
interface Meta {
  columns: { column_name: string; label: string }[]
}

async function seed(admin: Admin, extra: Record<string, unknown> = {}) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'glor', label: 'Glor', column_type: 'Data', in_list_view: true },
      { column_name: 'pop', label: 'Pop', column_type: 'Int', in_list_view: true },
    ],
    ...extra,
  })
  for (const [glor, pop] of [
    ['Ground', 12],
    ['Mezzanine', 7],
  ] as [string, number][])
    await admin.post('/api/save_row', { table: DT, row: { glor, pop } })
}

async function openEditor(admin: Admin, table = DT) {
  await renderApp(`/featherbase/admin/table/${tableSlug(table)}/columns`, admin)
  await screen.findByTestId('column-editor')
}

const meta = (admin: Admin) => admin.get<Meta>(`/api/table/${encodeURIComponent(DT)}:meta`) as Promise<Meta>

async function zoneRows(admin: Admin, fields: string[]) {
  const list = (await admin.get(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
      JSON.stringify(fields),
    )}&limit_page_length=50`,
  )) as { data: Record<string, unknown>[] }
  return list.data
}

test('the editor lists the Table it is for, column by column', async ({ admin }) => {
  await seed(admin)
  await openEditor(admin)

  await screen.findByTestId('ce-row-glor')
  expect(screen.getByTestId('ce-row-pop')).toBeInTheDocument()
  // The label is editable; the machine name is stated beside it, not guessed at.
  expect(screen.getByTestId('ce-label-glor')).toHaveValue('Glor')
  expect(within(screen.getByTestId('ce-row-glor')).getByText('glor')).toBeInTheDocument()
})

test('a misspelled column is renamed and its rows come with it', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  await user.click(await screen.findByTestId('ce-rename-glor'))
  const field = screen.getByTestId('ce-rename-input-glor')
  await user.clear(field)
  await user.type(field, 'floor')
  await user.click(screen.getByTestId('ce-rename-go-glor'))

  await waitFor(() => expect(screen.getByTestId('ce-row-floor')).toBeInTheDocument())
  expect(screen.queryByTestId('ce-row-glor')).not.toBeInTheDocument()

  // The point of a rename rather than a new column: the data was already right.
  const rows = await zoneRows(admin, ['floor', 'pop'])
  expect(rows.map((r) => r.floor).sort()).toEqual(['Ground', 'Mezzanine'])
})

test('a rename that collides is refused in place, with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  await user.click(await screen.findByTestId('ce-rename-glor'))
  const field = screen.getByTestId('ce-rename-input-glor')
  await user.clear(field)
  await user.type(field, 'pop')
  await user.click(screen.getByTestId('ce-rename-go-glor'))

  await waitFor(() =>
    expect(screen.getByTestId('ce-rename-error-glor')).toHaveTextContent(/already has/),
  )
  // And nothing moved.
  expect(screen.getByTestId('ce-row-glor')).toBeInTheDocument()
  expect(screen.getByTestId('ce-row-pop')).toBeInTheDocument()
})

test('a column is added, empty on the rows that already exist', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  // The machine name follows the label until the user claims it.
  await user.type(await screen.findByTestId('ce-add-label'), 'Aisle Code')
  expect(screen.getByTestId('ce-add-name')).toHaveValue('aisle_code')
  await user.click(screen.getByTestId('ce-add-go'))

  await waitFor(() => expect(screen.getByTestId('ce-saved')).toHaveTextContent('Added aisle_code'))
  expect(screen.getByTestId('ce-row-aisle_code')).toBeInTheDocument()

  const rows = await zoneRows(admin, ['glor', 'aisle_code'])
  expect(rows).toHaveLength(2)
  expect(rows.every((r) => r.aisle_code === null || r.aisle_code === undefined)).toBe(true)
  expect(rows.map((r) => r.glor).sort()).toEqual(['Ground', 'Mezzanine'])
})

test('a name the server would reject is caught before the round trip', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  const name = await screen.findByTestId('ce-add-name')
  await user.type(screen.getByTestId('ce-add-label'), 'Glor')
  await waitFor(() =>
    expect(screen.getByTestId('ce-add-problem')).toHaveTextContent('already has glor'),
  )
  expect(screen.getByTestId('ce-add-go')).toBeDisabled()

  await user.clear(name)
  await user.type(name, 'created_at')
  await waitFor(() =>
    expect(screen.getByTestId('ce-add-problem')).toHaveTextContent('standard column'),
  )

  await user.clear(name)
  await user.type(name, 'Not Snake')
  await waitFor(() => expect(screen.getByTestId('ce-add-problem')).toHaveTextContent('snake_case'))

  await user.clear(name)
  await user.type(name, 'aisle')
  await waitFor(() => expect(screen.getByTestId('ce-add-go')).toBeEnabled())
  // Nothing was sent while it was refused.
  expect((await meta(admin)).columns.map((c) => c.column_name)).toEqual(['glor', 'pop'])
})

test('a Choice column must carry its choices before it can be added', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  await user.type(await screen.findByTestId('ce-add-label'), 'Stage')
  await user.selectOptions(screen.getByTestId('ce-add-type'), 'Choice')
  await waitFor(() =>
    expect(screen.getByTestId('ce-add-problem')).toHaveTextContent('needs its choices'),
  )
  await user.type(screen.getByTestId('ce-add-target'), 'New\nDone')
  await user.click(screen.getByTestId('ce-add-go'))

  await waitFor(() => expect(screen.getByTestId('ce-row-stage')).toBeInTheDocument())
})

test('a label is changed without touching the column or its data', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  const label = await screen.findByTestId('ce-label-glor')
  const originalLabel = (await meta(admin)).columns.find((c) => c.column_name === 'glor')?.label
  await user.clear(label)
  await user.type(label, '   ')
  await user.click(screen.getByTestId('ce-label-save-glor'))
  expect((await meta(admin)).columns.find((c) => c.column_name === 'glor')?.label).toBe(originalLabel)
  await user.clear(label)
  await user.type(label, 'Floor')
  await user.click(screen.getByTestId('ce-label-save-glor'))

  await waitFor(() => expect(screen.getByTestId('ce-saved')).toHaveTextContent('glor'))
  const def = await meta(admin)
  expect(def.columns.find((c) => c.column_name === 'glor')?.label).toBe('Floor')
  // The machine name — and therefore every row — is untouched.
  expect((await zoneRows(admin, ['glor'])).map((r) => r.glor).sort()).toEqual([
    'Ground',
    'Mezzanine',
  ])
})

test('a system Table refuses the whole editor', async ({ admin }) => {
  await openEditor(admin, 'Import Log')
  await waitFor(() =>
    expect(screen.getByTestId('ce-system')).toHaveTextContent(/system Table/),
  )
  expect(screen.queryByTestId('ce-add')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ce-rename-file_name')).not.toBeInTheDocument()
})

// #738 (list-columns-from-the-table, point 9): each column's "In list" tick
// is the Table's list for everyone, saved the moment it is ticked.
const inListTick = (column: string) =>
  within(screen.getByTestId(`ce-row-${column}`)).getByRole('checkbox', { name: /in list/i })

test('each column has an "In list" tick showing whether it is in the list', async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/table_def/${encodeURIComponent(DT)}`, {
    ...(await meta(admin)),
    columns: (await meta(admin)).columns.map((c) => ({ ...c, in_list_view: c.column_name === 'glor' })),
  })
  await openEditor(admin)
  await screen.findByTestId('ce-row-glor')
  expect(inListTick('glor')).toBeChecked()
  expect(inListTick('pop')).not.toBeChecked()
})

test('unticking "In list" takes the column out of the list at once', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)
  await screen.findByTestId('ce-row-pop')
  await user.click(inListTick('pop'))
  await waitFor(() => expect(screen.getByTestId('ce-saved')).toHaveTextContent('Took pop out of the list'))
  const pop = (await meta(admin)).columns.find((c) => c.column_name === 'pop') as { in_list_view?: boolean }
  expect(pop.in_list_view).toBe(false)
})

test('a system Table\'s "In list" ticks cannot be changed', async ({ admin }) => {
  await openEditor(admin, 'Import Log')
  await screen.findByTestId('ce-row-file_name')
  expect(inListTick('file_name')).toBeDisabled()
})

test('an "In list" tick moves the moment it is clicked, before the save returns', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)
  await screen.findByTestId('ce-row-pop')
  await user.click(inListTick('pop'))
  expect(inListTick('pop')).not.toBeChecked()
  await waitFor(() => expect(screen.getByTestId('ce-saved')).toHaveTextContent('Took pop out of the list'))
})

// #1024: the name people see for a Table's rows, chosen on this page.
const titleRadio = (column: string) => within(screen.getByTestId(`ce-row-${column}`)).queryByRole('radio')

test('a radio per column that can be a title, with the current one selected', async ({ admin }) => {
  await seed(admin, {
    title_column: 'glor',
    columns: [
      { column_name: 'glor', label: 'Glor', column_type: 'Data' },
      { column_name: 'pop', label: 'Pop', column_type: 'Int' },
      { column_name: 'open', label: 'Open', column_type: 'Check' },
      { column_name: 'opened_on', label: 'Opened on', column_type: 'Date' },
      { column_name: 'secret', label: 'Secret', column_type: 'Data', hidden: true },
      { column_name: 'zone', label: 'Zone', column_type: 'Reference', reference_table: 'Person' },
    ],
  })
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}/columns`, admin)
  await screen.findByTestId('ce-row-glor', undefined, { timeout: 8000 })
  expect(titleRadio('glor')).toBeChecked()
  expect(titleRadio('pop')).not.toBeChecked()
  for (const none of ['open', 'opened_on', 'secret', 'zone']) expect(titleRadio(none)).toBeNull()
})

test('a title already stored shows its radio, even on a column that could not be chosen now', async ({ admin }) => {
  await seed(admin, {
    title_column: 'secret',
    columns: [
      { column_name: 'glor', label: 'Glor', column_type: 'Data' },
      { column_name: 'pop', label: 'Pop', column_type: 'Int' },
      { column_name: 'secret', label: 'Secret', column_type: 'Data', hidden: true },
    ],
  })
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}/columns`, admin)
  await screen.findByTestId('ce-row-glor', undefined, { timeout: 8000 })
  expect(titleRadio('secret')).toBeChecked()
})

test('choosing a title saves at once, naming only the title, and links read it', async ({ admin }) => {
  await admin.post('/api/table_def', { name: DT, description: 'Kept', columns: [
    { column_name: 'glor', label: 'Glor', column_type: 'Data', in_list_view: true },
    { column_name: 'zone_name', label: 'Zone name', column_type: 'Data', in_list_view: true },
  ] })
  const user = userEvent.setup()
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}/columns`, admin)
  await screen.findByTestId('ce-row-glor', undefined, { timeout: 8000 })
  expect(screen.queryByTestId('ce-title-clear')).not.toBeInTheDocument()

  await user.click(titleRadio('zone_name')!)
  expect(await screen.findByTestId('ce-saved')).toHaveTextContent('Zone name is now the title')
  await waitFor(() => expect(titleRadio('zone_name')).toBeChecked())
  const meta = await admin.get<{ title_column: string; description: string; columns: unknown[] }>(`/api/table/${encodeURIComponent(DT)}:meta`)
  expect(meta).toMatchObject({ title_column: 'zone_name', description: 'Kept' })

  await user.click(screen.getByTestId('ce-title-clear'))
  await waitFor(() => expect(titleRadio('zone_name')).not.toBeChecked())
  expect((await admin.get<{ title_column: string | null }>(`/api/table/${encodeURIComponent(DT)}:meta`)).title_column).toBeNull()
})

test('a refused title shows why, and the stored choice stays selected', async ({ admin }) => {
  await seed(admin, { title_column: 'glor' })
  const bridged = globalThis.fetch
  const user = userEvent.setup()
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}/columns`, admin)
  await screen.findByTestId('ce-row-glor', undefined, { timeout: 8000 })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === 'PUT' && String(input).includes('table_def')
      ? Response.json({ error: { type: 'ValidationError', message: 'Not today' } }, { status: 417 })
      : bridged(input, init)) as typeof fetch
  try {
    await user.click(titleRadio('pop')!)
    expect(await screen.findByTestId('ce-title-error')).toHaveTextContent('Not today')
    expect(titleRadio('glor')).toBeChecked()
    expect(screen.queryByTestId('ce-saved')).not.toBeInTheDocument()
  } finally {
    globalThis.fetch = bridged
  }
})

// Moved from e2e/column-editor.spec.ts (#1080): the editor is reached from
// the Table's own list.
test("the Table's list opens its column editor from Table administration", async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  const { router } = await renderApp(`/featherbase/admin/table/${tableSlug(DT)}`, admin)
  await user.click(await screen.findByRole('button', { name: 'Table administration' }, { timeout: 8000 }))
  await user.click(await screen.findByRole('link', { name: 'Edit columns' }))
  expect(await screen.findByTestId('column-editor')).toBeInTheDocument()
  expect(await screen.findByTestId('ce-row-glor')).toBeInTheDocument()
  expect((router.state as { location: { pathname: string } }).location.pathname).toBe(`/featherbase/admin/table/${tableSlug(DT)}/columns`)
})

// Moved from e2e/column-editor.spec.ts (#1080): a list of another Table, read
// once with the raw ids, shows the new title after moving within the app.
test("a title chosen here replaces the id in another Table's list already read", async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Ce Title Zone', id_pattern: 'field:zone_code', columns: [
    { column_name: 'zone_code', label: 'Zone code', column_type: 'Data', in_list_view: true },
    { column_name: 'zone_name', label: 'Zone name', column_type: 'Data', in_list_view: true },
  ] })
  await admin.post('/api/save_row', { table: 'Ce Title Zone', row: { zone_code: 'VLM', zone_name: 'Vellayambalam' } })
  await admin.post('/api/table_def', { name: 'Ce Title Store', columns: [
    { column_name: 'store_name', column_type: 'Data', in_list_view: true },
    { column_name: 'zone', column_type: 'Reference', reference_table: 'Ce Title Zone', in_list_view: true },
  ] })
  await admin.post('/api/save_row', { table: 'Ce Title Store', row: { store_name: 'East', zone: 'VLM' } })
  const user = userEvent.setup()
  const { router } = await renderApp(`/featherbase/admin/table/${tableSlug('Ce Title Store')}`, admin)
  await waitFor(() => expect(screen.getByTestId('cell-zone')).toHaveTextContent('VLM'), { timeout: 8000 })

  await router.navigate({ to: `/featherbase/admin/table/${tableSlug('Ce Title Zone')}/columns` })
  await user.click(await screen.findByTestId('ce-title-zone_name', undefined, { timeout: 8000 }))
  expect(await screen.findByTestId('ce-saved')).toHaveTextContent('Zone name is now the title')

  await router.navigate({ to: `/featherbase/admin/table/${tableSlug('Ce Title Store')}` })
  await waitFor(() => expect(screen.getByTestId('cell-zone')).toHaveTextContent('Vellayambalam'), { timeout: 8000 })
})

/** The network drops every request this says it should. */
function dropNetwork(lost: (url: string, init?: RequestInit) => boolean) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return lost(url, init) ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)
  })
}
const isPut = (url: string, init?: RequestInit) => init?.method === 'PUT' && url.includes('/api/table_def/')

describe('adding a column, at its edges', () => {
  test('a column named with no label is labelled by its name', async ({ admin }) => {
    const user = userEvent.setup()
    await seed(admin)
    await openEditor(admin)
    await user.type(await screen.findByTestId('ce-add-name'), 'bay')
    await user.click(screen.getByTestId('ce-add-go'))
    await waitFor(() => expect(screen.getByTestId('ce-saved')).toHaveTextContent('Added bay'))
    expect((await meta(admin)).columns.find((c) => c.column_name === 'bay')?.label).toBe('bay')
  })

  test('a name typed first stays when the label is typed after it', async ({ admin }) => {
    const user = userEvent.setup()
    await seed(admin)
    await openEditor(admin)
    await user.type(await screen.findByTestId('ce-add-name'), 'bay_no')
    await user.type(screen.getByTestId('ce-add-label'), 'Bay number')
    expect(screen.getByTestId('ce-add-name')).toHaveValue('bay_no')
  })

  test('a link column asks for its target Table, then links to it', async ({ admin }) => {
    const user = userEvent.setup()
    await seed(admin)
    await admin.post('/api/table_def', { name: 'Ce Aisle', columns: [{ column_name: 'code', column_type: 'Data' }] })
    await openEditor(admin)
    await user.type(await screen.findByTestId('ce-add-label'), 'Aisle')
    await user.selectOptions(screen.getByTestId('ce-add-type'), 'Reference')
    expect(screen.getByText('Target Table')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('ce-add-problem')).toHaveTextContent('A Reference column needs its target Table'))
    await user.type(screen.getByTestId('ce-add-target'), 'Ce Aisle')
    await user.click(screen.getByTestId('ce-add-go'))
    await waitFor(() => expect(screen.getByTestId('ce-saved')).toHaveTextContent('Added aisle'))
    const def = await admin.get<{ columns: { column_name: string; reference_table: string | null }[] }>(`/api/table/${encodeURIComponent(DT)}:meta`)
    expect(def.columns.find((c) => c.column_name === 'aisle')?.reference_table).toBe('Ce Aisle')
  })

  test('a Sub-table column holds the rows of its target Table', async ({ admin }) => {
    const user = userEvent.setup()
    await seed(admin)
    await admin.post('/api/table_def', { name: 'Ce Zone Line', kind: 'sub_table', columns: [{ column_name: 'item', column_type: 'Data' }] })
    await openEditor(admin)
    await user.type(await screen.findByTestId('ce-add-label'), 'Lines')
    await user.selectOptions(screen.getByTestId('ce-add-type'), 'Sub-table')
    await user.type(screen.getByTestId('ce-add-target'), 'Ce Zone Line')
    await user.click(screen.getByTestId('ce-add-go'))
    await waitFor(() => expect(screen.getByTestId('ce-saved')).toHaveTextContent('Added lines'))
    const def = await admin.get<{ columns: { column_name: string; row_table: string | null }[] }>(`/api/table/${encodeURIComponent(DT)}:meta`)
    expect(def.columns.find((c) => c.column_name === 'lines')?.row_table).toBe('Ce Zone Line')
  })

  test('a link to a row of any Table with no Tables named allows any Table', async ({ admin }) => {
    const user = userEvent.setup()
    await seed(admin)
    await openEditor(admin)
    await user.type(await screen.findByTestId('ce-add-label'), 'Subject')
    await user.selectOptions(screen.getByTestId('ce-add-type'), ANY_TABLE_LINK)
    await user.click(screen.getByTestId('ce-add-go'))
    await waitFor(() => expect(screen.getByTestId('ce-saved')).toHaveTextContent('subject'))
    const def = await admin.get<{ columns: { column_name: string; table_column?: string | null; choices: string | null }[] }>(`/api/table/${encodeURIComponent(DT)}:meta`)
    expect(def.columns.find((c) => c.column_name === 'subject')).toMatchObject({ table_column: 'subject_table', choices: null })
  })
})

describe('when the network drops', () => {
  test("the Table's details say the Table could not be loaded", async ({ admin }) => {
    await seed(admin)
    dropNetwork((url) => url.includes(`/api/table/${encodeURIComponent(DT)}:meta`))
    await renderApp(`/featherbase/admin/table/${tableSlug(DT)}/columns`, admin)
    expect(await screen.findByText('Could not load this Table', {}, { timeout: 8000 })).toBeInTheDocument()
  })

  test('a rename says it could not rename', async ({ admin }) => {
    const user = userEvent.setup()
    await seed(admin)
    await openEditor(admin)
    await user.click(await screen.findByTestId('ce-rename-glor'))
    await user.clear(screen.getByTestId('ce-rename-input-glor'))
    await user.type(screen.getByTestId('ce-rename-input-glor'), 'floor')
    dropNetwork((url) => url.includes('rename'))
    await user.click(screen.getByTestId('ce-rename-go-glor'))
    expect(await screen.findByTestId('ce-rename-error-glor')).toHaveTextContent('Could not rename')
  })

  test('a label change says it could not save', async ({ admin }) => {
    const user = userEvent.setup()
    await seed(admin)
    await openEditor(admin)
    const label = await screen.findByTestId('ce-label-glor')
    await user.clear(label)
    await user.type(label, 'Floor')
    dropNetwork(isPut)
    await user.click(screen.getByTestId('ce-label-save-glor'))
    expect(await screen.findByTestId('ce-put-error')).toHaveTextContent('Could not save')
  })

  test('a title choice says it could not save the title', async ({ admin }) => {
    await seed(admin, { title_column: 'glor' })
    const user = userEvent.setup()
    await openEditor(admin)
    await screen.findByTestId('ce-row-glor', undefined, { timeout: 8000 })
    dropNetwork(isPut)
    await user.click(titleRadio('pop')!)
    expect(await screen.findByTestId('ce-title-error')).toHaveTextContent('Could not save the title')
  })
})
