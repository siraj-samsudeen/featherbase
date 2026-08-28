// #208 (issue #197): two Tables that turned out to be one.
//
// "In one of the things floor was spelled with a G, Glor... select one table
// and say merge into other table."
//
// Component layer (docs/TESTING.md layer 2): the folding proposal, the
// mapping form, the tally, and what actually reached the server are all
// React-side. `e2e/table-merge.spec.ts` keeps what the browser adds — the
// route, and arriving from the source Table's list view.
//
// The server is the real in-process one, so "every row lands under the
// target's spelling" is checked against the database the merge wrote to.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const SRC = 'Tm Source Zones'
const DST = 'Tm Target Zones'

type Admin = Parameters<typeof renderApp>[1]

// The source spells it Glor; the target spells it Floor. `zone_name` and
// `pop` fold to the same name on both sides, so those pair themselves and
// the store column does not — which is the whole subject.
async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: SRC,
    columns: [
      { column_name: 'glor', label: 'Glor', column_type: 'Data' },
      { column_name: 'zone_name', label: 'Zone Name', column_type: 'Data' },
      { column_name: 'pop', label: 'Pop', column_type: 'Int' },
    ],
  })
  await admin.post('/api/table_def', {
    name: DST,
    columns: [
      { column_name: 'floor', label: 'Floor', column_type: 'Data' },
      { column_name: 'zone_name', label: 'Zone', column_type: 'Data' },
      { column_name: 'pop', label: 'Population', column_type: 'Int' },
    ],
  })
  for (const [glor, zone, pop] of [
    ['Ground', 'Fresh', 12],
    ['Mezzanine', 'Dairy', 7],
  ] as [string, string, number][])
    await admin.post('/api/save_row', { table: SRC, row: { glor, zone_name: zone, pop } })
  await admin.post('/api/save_row', {
    table: DST,
    row: { floor: 'Basement', zone_name: 'Frozen', pop: 3 },
  })
}

async function openMerge(admin: Admin) {
  await renderApp(`/admin/${encodeURIComponent(SRC)}/merge`, admin)
  await screen.findByTestId('table-merge')
}

// The candidate list is a query; the option only exists once it resolves.
async function chooseTarget(user: ReturnType<typeof userEvent.setup>) {
  const picker = screen.getByTestId('tm-target')
  await waitFor(() =>
    expect(within(picker).getByRole('option', { name: DST })).toBeInTheDocument(),
  )
  await user.selectOptions(picker, DST)
  await screen.findByTestId('tm-mapping')
}

async function targetRows(admin: Admin, fields: string[]) {
  const list = (await admin.get(
    `/api/table/${encodeURIComponent(DST)}?fields=${encodeURIComponent(
      JSON.stringify(fields),
    )}&limit_page_length=50`,
  )) as { data: Record<string, unknown>[] }
  return list.data
}

test('folding pairs what it can, and refuses to guess the rest', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openMerge(admin)
  await chooseTarget(user)

  // Same folded name on both sides: paired without being asked.
  await waitFor(() => expect(screen.getByTestId('tm-map-zone_name')).toHaveValue('zone_name'))
  expect(screen.getByTestId('tm-map-pop')).toHaveValue('pop')
  // Glor and Floor do not fold together, and nothing pretends otherwise (Q5).
  expect(screen.getByTestId('tm-map-glor')).toHaveValue('')
  expect(screen.getByTestId('tm-tally')).toHaveTextContent('2 of 3 columns mapped')
  expect(screen.getByTestId('tm-tally')).toHaveTextContent('glor will be left behind')
})

test('sample values are shown, so "the same thing?" is answerable from the data', async ({
  admin,
}) => {
  const user = userEvent.setup()
  await seed(admin)
  await openMerge(admin)
  await chooseTarget(user)

  await waitFor(() => expect(screen.getByTestId('tm-sample-glor')).toHaveTextContent('Ground'))
  expect(screen.getByTestId('tm-sample-zone_name')).toHaveTextContent('Fresh')
})

test('the user pairs Glor with Floor, and every row lands', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openMerge(admin)
  await chooseTarget(user)

  await user.selectOptions(screen.getByTestId('tm-map-glor'), 'floor')
  await waitFor(() => expect(screen.getByTestId('tm-tally')).toHaveTextContent('3 of 3 columns'))
  await user.click(screen.getByTestId('tm-go'))

  await waitFor(() =>
    expect(screen.getByTestId('tm-outcome')).toHaveTextContent(`Merged 2 rows into ${DST}`),
  )

  const rows = await targetRows(admin, ['floor', 'zone_name', 'pop'])
  // The target's own row, plus both of the source's — under the target's
  // spelling.
  expect(rows).toHaveLength(3)
  expect(rows.map((r) => r.floor).sort()).toEqual(['Basement', 'Ground', 'Mezzanine'])
  expect(rows.map((r) => Number(r.pop)).sort((a, b) => a - b)).toEqual([3, 7, 12])
})

test('the source is copied, never emptied — and the screen says so', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openMerge(admin)
  await chooseTarget(user)
  await user.selectOptions(screen.getByTestId('tm-map-glor'), 'floor')
  await user.click(screen.getByTestId('tm-go'))

  await waitFor(() =>
    expect(screen.getByTestId('tm-outcome')).toHaveTextContent('still has its own rows'),
  )
  const src = (await admin.get(`/api/table/${encodeURIComponent(SRC)}:count`)) as { count: number }
  expect(src.count).toBe(2)
})

test('a column left behind is left behind, and nothing else moves', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openMerge(admin)
  await chooseTarget(user)

  await user.selectOptions(screen.getByTestId('tm-map-pop'), '')
  await waitFor(() => expect(screen.getByTestId('tm-tally')).toHaveTextContent('pop will be left'))
  await user.click(screen.getByTestId('tm-go'))

  await waitFor(() => expect(screen.getByTestId('tm-outcome')).toHaveTextContent('Merged 2 rows'))
  const merged = (await targetRows(admin, ['zone_name', 'pop'])).filter(
    (r) => r.zone_name !== 'Frozen',
  )
  expect(merged).toHaveLength(2)
  expect(merged.every((r) => r.pop === null || r.pop === undefined)).toBe(true)
})

test('nothing can be merged until a target and a column are chosen', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openMerge(admin)

  expect(await screen.findByTestId('tm-go')).toBeDisabled()
  await chooseTarget(user)
  await waitFor(() => expect(screen.getByTestId('tm-go')).toBeEnabled())

  for (const column of ['zone_name', 'pop'])
    await user.selectOptions(screen.getByTestId(`tm-map-${column}`), '')
  await waitFor(() => expect(screen.getByTestId('tm-go')).toHaveTextContent('Map at least one'))
  expect(screen.getByTestId('tm-go')).toBeDisabled()
})

test('changing the target throws away a mapping made against the old one', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openMerge(admin)
  await chooseTarget(user)
  await user.selectOptions(screen.getByTestId('tm-map-glor'), 'floor')
  await waitFor(() => expect(screen.getByTestId('tm-map-glor')).toHaveValue('floor'))

  // A different target is a different set of columns; the old pairing means
  // nothing against it and must not be carried over silently.
  await user.selectOptions(screen.getByTestId('tm-target'), '')
  expect(screen.queryByTestId('tm-mapping')).not.toBeInTheDocument()
  await user.selectOptions(screen.getByTestId('tm-target'), DST)
  await screen.findByTestId('tm-mapping')
  await waitFor(() => expect(screen.getByTestId('tm-map-glor')).toHaveValue(''))
})
