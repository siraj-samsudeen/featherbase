// #910 checklist 18–19 and 22: the row page's Tree tab and a list's Tree of
// all. Lines unfold in place in both directions, several levels deep; a big
// group shows its first 20; a line opens in the drill pane while the tree
// stays centred; unreadable rows are never named.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { sql } from 'server/src/db'
import { tableName } from 'server/src/platform-schema'
import { createUserWithRole, grantRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'
import { PLANT, PROFIT, REGION, SITE, seedSites, type Admin } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

const tree = () => screen.findByRole('tree')
const line = async (name: string | RegExp) => {
  const t = await tree()
  return (await within(t).findAllByRole('treeitem', { name })).at(-1)!
}
const topLines = (t: HTMLElement) => within(t).getAllByRole('treeitem').filter((i) => i.getAttribute('aria-level') === '1')
const unfold = (item: HTMLElement) => fireEvent.keyDown(item, { key: 'ArrowRight' })

async function openTree(admin: Admin, table: string, row: string) {
  const view = await renderApp(`${tableHref(table)}/row/${row}`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Tree' }))
  await tree()
  return view
}

test('the tree shows what the row links to above it and its groups below, unfolded two levels', async ({ admin }) => {
  await seedSites(admin)
  await openTree(admin, SITE, 'ENK')
  const t = await tree()
  const kerala = await line('Kerala · KL')
  const plants = await line(`${PLANT} 3`)
  const centre = await line('Enchakkal · ENK')
  expect(kerala.compareDocumentPosition(centre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(centre.compareDocumentPosition(plants) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(plants).toHaveAttribute('aria-expanded', 'true')
  await waitFor(() => expect(within(plants).getAllByRole('treeitem')).toHaveLength(3))
  expect(t).toHaveTextContent('Links to')
  expect(t).toHaveTextContent('Linked from')
})

test('lines unfold in place several levels deep', async ({ admin }) => {
  await seedSites(admin)
  await openTree(admin, SITE, 'ENK')
  unfold(await line('Enchakkal Supermarket · 1503'))
  const centres = await line(`${PROFIT} 2`)
  unfold(centres)
  await waitFor(() => expect(within(centres).getAllByRole('treeitem')).toHaveLength(2))
  expect(centres).toHaveTextContent('EKL - Retail 01')
})

test('a group of 40 shows its first 20, with a way to show all 40', async ({ admin }) => {
  await seedSites(admin, { profitCentres: 40 })
  await openTree(admin, PLANT, '1503')
  const centres = await line(`${PROFIT} 40`)
  await waitFor(() => expect(within(centres).getAllByRole('treeitem')).toHaveLength(20))
  fireEvent.click(within(centres).getByRole('button', { name: 'show all 40' }))
  await waitFor(() => expect(within(centres).getAllByRole('treeitem')).toHaveLength(40))
})

test('clicking a line shows it in the drill pane; the tree stays centred', async ({ admin }) => {
  await seedSites(admin)
  await openTree(admin, SITE, 'ENK')
  fireEvent.click(within(await line('Enchakkal Supermarket · 1503')).getByText('Enchakkal Supermarket · 1503'))
  expect(await screen.findByRole('complementary', { name: 'Enchakkal Supermarket · 1503' })).toHaveTextContent(PLANT)
  expect(await line('Enchakkal · ENK')).toBeInTheDocument()
})

test('Focus here centres the tree on the chosen line', async ({ admin }) => {
  await seedSites(admin)
  await openTree(admin, SITE, 'ENK')
  const item = await line('Enchakkal Supermarket · 1503')
  fireEvent.click(within(item).getByText('Enchakkal Supermarket · 1503'))
  await screen.findByRole('complementary', { name: 'Enchakkal Supermarket · 1503' })
  const focus = await within(await tree()).findByRole('button', { name: 'Focus here' })
  fireEvent.click(focus)
  await screen.findByRole('tree', { name: 'Around Enchakkal Supermarket' })
  expect(await line(`${PROFIT} 2`)).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('tab', { name: 'Tree' })).toHaveAttribute('aria-selected', 'true')
})

test('what is unfolded survives a look at the form', async ({ admin }) => {
  await seedSites(admin)
  await openTree(admin, SITE, 'ENK')
  unfold(await line('Enchakkal Supermarket · 1503'))
  await line(`${PROFIT} 2`)
  fireEvent.click(screen.getByRole('tab', { name: 'Form' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Tree' }))
  expect(await line('Enchakkal Supermarket · 1503')).toHaveAttribute('aria-expanded', 'true')
})

test("a viewer who can't read Enchakkal's other plants sees a count of 2 on the tree and their names nowhere", async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Tree Viewer', table: [SITE, REGION], can_read: true })
  await grantRole(admin, { role: 'Nv Tree Viewer', table: PLANT, can_read: true, can_create: true, own_rows_only: true })
  for (const [row_id, plant_name] of [['1701', 'Enchakkal Bakery'], ['1702', 'Enchakkal Pharmacy']])
    await viewer.post('/api/save_row', { table: PLANT, row: { row_id, plant_name, site: 'ENK' } })
  await openTree(viewer, SITE, 'ENK')
  const plants = await line(`${PLANT} 2`)
  await waitFor(() => expect(within(plants).getAllByRole('treeitem')).toHaveLength(2))
  for (const unseen of ['Enchakkal Supermarket', 'Enchakkal Textiles', 'Enchakkal Jewellery', '1503'])
    expect(document.body).not.toHaveTextContent(unseen)
})

test('Tree of all shows every site as a folded line, unfolding into its region and its plants', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Tree of all' }))
  const t = await tree()
  await waitFor(() => expect(topLines(t)).toHaveLength(3))
  for (const item of topLines(t)) expect(item).toHaveAttribute('aria-expanded', 'false')
  const enchakkal = await line('Enchakkal · ENK')
  unfold(enchakkal)
  await waitFor(() => expect(within(enchakkal).getByRole('treeitem', { name: 'Kerala · KL' })).toBeInTheDocument())
  expect(within(enchakkal).getByRole('treeitem', { name: `${PLANT} 3` })).toBeInTheDocument()
})

test('Tree of all shows 20 rows at a time, with Show more', async ({ admin }) => {
  await seedSites(admin, { profitCentres: 25 })
  await renderApp(tableHref(PROFIT), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Tree of all' }))
  const t = await tree()
  await waitFor(() => expect(topLines(t)).toHaveLength(20))
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
  await waitFor(() => expect(topLines(t)).toHaveLength(25))
})

test('Show more reveals rows past one read\'s cap of 500, then goes away', async ({ admin }) => {
  await seedSites(admin, { profitCentres: 0 })
  // 510 centres, written straight into the table's storage inside this test's transaction.
  await sql.unsafe(
    `insert into featherbase.${tableName(PROFIT)} (row_id, centre_name, plant)
     select 'pc-' || lpad(n::text, 3, '0'), 'Centre ' || lpad(n::text, 3, '0'), '1503' from generate_series(1, 510) n`,
  )
  await renderApp(tableHref(PROFIT), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Tree of all' }))
  const t = await tree()
  await waitFor(() => expect(topLines(t)).toHaveLength(20))
  for (let shown = 20; shown < 510; shown += 20) {
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(topLines(t)).toHaveLength(Math.min(shown + 20, 510)))
  }
  expect(new Set(topLines(t).map((item) => item.textContent)).size).toBe(510)
  expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
}, 120_000)

test("a group of code-named rows lists them in code order, so a group's first 20 are its lowest codes", async ({ admin }) => {
  await seedSites(admin)
  await openTree(admin, SITE, 'ENK')
  const plants = await line(`${PLANT} 3`)
  await waitFor(() => expect(within(plants).getAllByRole('treeitem').map((i) => i.getAttribute('aria-level') === '2' && i.textContent))
    .toEqual([expect.stringContaining('1503'), expect.stringContaining('1504'), expect.stringContaining('1505')]))
})

test('a row unfolded under a group leaves out the link back to the row it is listed under', async ({ admin }) => {
  await seedSites(admin)
  await openTree(admin, SITE, 'ENK')
  const supermarket = await line('Enchakkal Supermarket · 1503')
  unfold(supermarket)
  await waitFor(() => expect(within(supermarket).getByRole('treeitem', { name: `${PROFIT} 2` })).toBeInTheDocument())
  expect(within(supermarket).queryByRole('treeitem', { name: 'Enchakkal · ENK' })).not.toBeInTheDocument()
})

test('two links from one table are told apart by their labels on the tree', async ({ admin }) => {
  await seedSites(admin)
  const meta = await admin.get<{ columns: Record<string, unknown>[] }>(`/api/table/${encodeURIComponent(PLANT)}:meta`)
  await admin.put(`/api/table_def/${encodeURIComponent(PLANT)}`, {
    ...meta, columns: [...meta.columns, { column_name: 'backup_site', column_type: 'Reference', reference_table: SITE, label: 'Backup site' }],
  })
  await openTree(admin, SITE, 'ENK')
  expect(await line(`${PLANT} · Backup site 0`)).toBeInTheDocument()
})

// Checklist 12: a step brings back what was unfolded when it was taken.
test('choosing an earlier step brings back what was unfolded at that step', async ({ admin }) => {
  await seedSites(admin)
  await openTree(admin, SITE, 'ENK')
  unfold(await line('Enchakkal Supermarket · 1503'))
  await line(`${PROFIT} 2`)
  fireEvent.click(within(await line('Enchakkal Textiles · 1504')).getByText('Enchakkal Textiles · 1504'))
  await screen.findByRole('complementary', { name: 'Enchakkal Textiles · 1504' })
  fireEvent.keyDown(await line('Enchakkal Supermarket · 1503'), { key: 'ArrowLeft' })
  await waitFor(async () => expect(await line('Enchakkal Supermarket · 1503')).toHaveAttribute('aria-expanded', 'false'))
  fireEvent.click(within(await line('Enchakkal Jewellery · 1505')).getByText('Enchakkal Jewellery · 1505'))
  await screen.findByRole('complementary', { name: 'Enchakkal Jewellery · 1505' })
  const path = screen.getByRole('navigation', { name: 'Path' })
  fireEvent.click(within(path).getByRole('button', { name: 'Enchakkal Textiles · 1504' }))
  await screen.findByRole('complementary', { name: 'Enchakkal Textiles · 1504' })
  await waitFor(async () => expect(await line('Enchakkal Supermarket · 1503')).toHaveAttribute('aria-expanded', 'true'))
})

test("clicking a tree line for a row the viewer can't read opens no pane", async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Tree Site Reader', table: SITE, can_read: true })
  await openTree(viewer, SITE, 'ENK')
  const unseen = await line('A row you cannot see')
  fireEvent.click(within(unseen).getByText('A row you cannot see'))
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByRole('complementary', { name: /cannot see|Kerala/ })).not.toBeInTheDocument()
})

test('unfolding a line whose row was deleted meanwhile shows nothing under it', async ({ admin }) => {
  await seedSites(admin, { profitCentres: 0 })
  await openTree(admin, SITE, 'ENK')
  const plant = await line('Enchakkal Textiles · 1504')
  await admin.delete(`/api/table/${encodeURIComponent(PLANT)}/1504`)
  unfold(plant)
  // Its read fails, so it has nothing to unfold.
  await waitFor(() => expect(plant).not.toHaveAttribute('aria-expanded'))
  expect(within(plant).queryAllByRole('treeitem')).toEqual([])
})
