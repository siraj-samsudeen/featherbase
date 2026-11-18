// #1273 (relational navigation slice 2): a record's Links tab and record panel.
// A relationship the user may change is a tick list (C5): every choice listed,
// ticked first with its area and end date and a source chip (C6), a feed's link
// locked with Correct where its Table names a correction path (C7), ticking
// through an inline form (C8), unticking a hand-given link (C9). An empty group
// stays greyed with + New (C4); Open as grid only for small pairs (C12); long
// lists fold after ten (C13). The page opens on Form; its Links view choice is
// remembered per person and Table (A1, A3, D1–D3).
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, vi } from 'vitest'
import { rowHref, tableHref } from 'shared'
import { sql } from 'server/src/db'
import { tableRelation } from 'server/src/table-engine'
import { createUserWithRole } from 'server/test/fixtures'
import { newRowHref, startingValues } from '../src/components/LinkTickList'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp } from './pg-test'
import { SITE, seedSites, type Admin } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })
const scenario = scenarioFor(test, 'relational-navigation')

const MEMBER = 'Lt Member'
const ROLE = 'Lt Role'
const PLACE = 'Lt Place'
const GIVEN = 'Lt Role Given'
const NOTE = 'Lt Note'
const ROLES = ['Floor Lead', 'Buyer', 'Team Leader', 'Store Lead', 'Category Head', 'Head Office', 'Data Steward']

async function seed(admin: Admin, opts: { roles?: number; correctionPath?: boolean; moreFields?: boolean } = {}) {
  await admin.post('/api/table_def', { name: MEMBER, id_pattern: 'prompt', title_column: 'member_name',
    columns: [{ column_name: 'member_name', column_type: 'Data', label: 'Member name', in_list_view: true }] })
  await admin.post('/api/table_def', { name: ROLE, id_pattern: 'prompt', title_column: 'role_name',
    columns: [{ column_name: 'role_name', column_type: 'Data', label: 'Role name', in_list_view: true }] })
  await admin.post('/api/table_def', { name: PLACE, id_pattern: 'prompt', title_column: 'place_name',
    columns: [{ column_name: 'place_name', column_type: 'Data', label: 'Place name', in_list_view: true }] })
  // Rows that only link: a member, a role, where it applies, until when and why.
  await admin.post('/api/table_def', { name: GIVEN, id_pattern: 'hash',
    ...(opts.correctionPath ? { correction_path: '/fix?member={member}' } : {}),
    columns: [
      { column_name: 'member', column_type: 'Reference', reference_table: MEMBER, label: 'Member', in_list_view: true },
      { column_name: 'role', column_type: 'Reference', reference_table: ROLE, label: 'Role', in_list_view: true },
      { column_name: 'place', column_type: 'Reference', reference_table: PLACE, label: 'Area' },
      { column_name: 'ends_on', column_type: 'Date', label: 'Ends' },
      { column_name: 'reason', column_type: 'Text', label: 'Reason' },
      ...(opts.moreFields ? [
        { column_name: 'confirmed', column_type: 'Check', label: 'Confirmed' },
        { column_name: 'level', column_type: 'Choice', label: 'Level', choices: 'Reader\nManager' },
        { column_name: 'weight', column_type: 'Int', label: 'Weight' },
        { column_name: 'starts_at', column_type: 'Datetime', label: 'Starts at' },
      ] : []),
    ] })
  await admin.post('/api/table_def', { name: NOTE, id_pattern: 'hash', title_column: 'note_text',
    columns: [
      { column_name: 'note_text', column_type: 'Data', label: 'Note', in_list_view: true },
      { column_name: 'member', column_type: 'Reference', reference_table: MEMBER, label: 'Member', in_list_view: true },
    ] })
  for (const [row_id, member_name] of [['M1', 'Mira Member'], ['M2', 'Omar Member']])
    await admin.post('/api/save_row', { table: MEMBER, row: { row_id, member_name } })
  const names = [...ROLES, ...Array.from({ length: Math.max(0, (opts.roles ?? 7) - ROLES.length) }, (_, i) => `Extra Role ${String(i + 1).padStart(2, '0')}`)]
  for (const [i, role_name] of names.slice(0, opts.roles ?? 7).entries())
    await admin.post('/api/save_row', { table: ROLE, row: { row_id: `R${String(i + 1).padStart(2, '0')}`, role_name } })
  for (const [row_id, place_name] of [['P1', 'Lakeside Store · First floor'], ['P2', 'Hill Road Store']])
    await admin.post('/api/save_row', { table: PLACE, row: { row_id, place_name } })
  const feed = await admin.post<{ row_id: string }>('/api/save_row', { table: GIVEN, row: { member: 'M1', role: 'R01', place: 'P1' } })
  await admin.post('/api/save_row', { table: GIVEN, row: { member: 'M1', role: 'R02', place: 'P2', ends_on: '2027-03-31', reason: 'Covers kids wear' } })
  // Floor Lead came from the HR feed: a service account wrote it.
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-lt-people', roles: [] })
  await admin.fetch(`/api/service_accounts/${account.row_id}`, {
    method: 'PATCH', body: JSON.stringify({ display_name: 'HR feed' }), headers: { 'content-type': 'application/json' } })
  await sql`update ${sql(await tableRelation(GIVEN))} set created_by = ${account.row_id} where row_id = ${feed.row_id}`
}

async function openLinks(as: Admin, table = MEMBER, row = 'M1') {
  const view = await renderApp(rowHref(table, row), as)
  fireEvent.click(await screen.findByRole('tab', { name: 'Links' }))
  await screen.findByTestId('record-links')
  return view
}
// The tick list bears its group's name; until its plan is read the group shows as a list.
const roles = () => screen.findByTestId('tick-list')
const lineOf = async (name: string) => {
  const list = await roles()
  return waitFor(() => within(list).getAllByTestId('tick-line').find((l) => within(l).queryByText(name))
    ?? Promise.reject(new Error(`no line for ${name}`)))
}
const heldBy = async (admin: Admin, member: string) =>
  (await admin.get<{ data: { role: string; reason: string | null }[] }>(
    `/api/table/${encodeURIComponent(GIVEN)}?filters=${encodeURIComponent(JSON.stringify([['member', '=', member]]))}&fields=${encodeURIComponent(JSON.stringify(['role', 'reason']))}`)).data

describe('relational-navigation', () => {
  scenario("A member's roles as ticks", async ({ admin }, step) => {
    await step('a member holds two of seven roles, and the user may add and remove roles', () => seed(admin))
    await step("the user opens the member's Links tab", () => openLinks(admin))
    await step('the roles read "2 of 7", the two held first, each with its area and end date', async () => {
      const list = await roles()
      await waitFor(() => expect(within(list).getByTestId('tick-count')).toHaveTextContent('2 of 7'))
      const lines = await waitFor(() => {
        const found = within(list).getAllByTestId('tick-line')
        expect(found).toHaveLength(7)
        return found
      })
      expect(lines.slice(0, 2).map((l) => l.dataset.ticked)).toEqual(['true', 'true'])
      // The choices read in name order, as the far side's list does.
      expect(lines[0]).toHaveTextContent('Buyer')
      await waitFor(() => expect(within(lines[0]!).getByTestId('tick-meta')).toHaveTextContent(/Hill Road Store · until 31-Mar-2027/))
      expect(lines[1]).toHaveTextContent('Floor Lead')
      await waitFor(() => expect(within(lines[1]!).getByTestId('tick-meta')).toHaveTextContent('Lakeside Store · First floor'))
    })
    await step('the five others follow, greyed', async () => {
      const lines = within(await roles()).getAllByTestId('tick-line')
      expect(lines.slice(2).map((l) => l.dataset.ticked)).toEqual(Array(5).fill('false'))
      expect(within(lines[2]!).getByRole('link')).toHaveClass('!text-ink-muted')
    })
  })

  scenario('Someone who may not change roles reads them as a list', async ({ admin, createUser }, step) => {
    let reader!: Admin
    await step('a member holds two of seven roles, and the user may only read them', async () => {
      await seed(admin)
      reader = await createUserWithRole(admin, createUser, { role: 'Lt Reader', table: [MEMBER, ROLE, PLACE, GIVEN, NOTE], can_read: true })
    })
    await step("the user opens the member's Links tab", () => openLinks(reader))
    await step('the roles held show as a list, with no tick', async () => {
      const group = await screen.findByRole('region', { name: GIVEN })
      await waitFor(() => expect(within(group).getAllByTestId('linked-row')).toHaveLength(2))
      expect(screen.queryByTestId('tick-list')).not.toBeInTheDocument()
      expect(screen.queryAllByTestId('tick-box')).toHaveLength(0)
    })
  })

  scenario('A role from the HR feed is locked', async ({ admin }, step) => {
    await step("the HR feed gave a member the role Floor Lead, and the roles' Table says where to correct them", () => seed(admin, { correctionPath: true }))
    await step("the user opens the member's Links tab", () => openLinks(admin))
    await step('Floor Lead reads "from HR" with a locked tick and Correct beside it', async () => {
      const line = await lineOf('Floor Lead')
      await waitFor(() => expect(within(line).getByTestId('source-chip')).toHaveTextContent('from HR'))
      expect(within(line).getByTestId('tick-locked')).toBeInTheDocument()
      expect(within(line).queryByRole('button', { name: 'Untick Floor Lead' })).not.toBeInTheDocument()
      expect(within(line).getByRole('link', { name: 'Correct' })).toHaveAttribute('href', '/fix?member=M1')
    })
    await step('a role given by hand reads "given by hand" and can be unticked', async () => {
      const line = await lineOf('Buyer')
      expect(within(line).getByTestId('source-chip')).toHaveTextContent('given by hand')
      await waitFor(() => expect(within(line).getByRole('button', { name: 'Untick Buyer' })).toBeEnabled())
      expect(within(line).queryByRole('link', { name: 'Correct' })).not.toBeInTheDocument()
    })
  })

  scenario('Also give Team Leader', async ({ admin }, step) => {
    await step('a member does not hold the role Team Leader', () => seed(admin))
    await step('the user ticks Team Leader', async () => {
      await openLinks(admin)
      fireEvent.click(within(await lineOf('Team Leader')).getByRole('button', { name: 'Tick Team Leader' }))
    })
    await step('a form asks for its area, end date and reason, and nothing is saved yet', async () => {
      const form = await screen.findByTestId('also-give-form')
      expect(form).toHaveTextContent(/^Also give Team Leader/)
      expect(within(form).getByTestId('area-pick')).toHaveTextContent('Pick on the trees ▸')
      expect(within(form).getByRole('textbox', { name: 'Ends' })).toHaveAttribute('placeholder', 'optional')
      expect(within(form).getByRole('textbox', { name: 'Reason' })).toBeInTheDocument()
      expect((await heldBy(admin, 'M1')).map((r) => r.role).sort()).toEqual(['R01', 'R02'])
    })
    await step('the user fills in the reason and adds it', async () => {
      const form = screen.getByTestId('also-give-form')
      await userEvent.type(within(form).getByRole('textbox', { name: 'Reason' }), 'Covers the evening shift')
      fireEvent.click(within(form).getByRole('button', { name: 'Add' }))
    })
    await step('the member holds Team Leader, given by hand', async () => {
      await waitFor(() => expect(within(screen.getByTestId('tick-list')).getByTestId('tick-count')).toHaveTextContent('3 of 7'))
      const line = await lineOf('Team Leader')
      expect(line.dataset.ticked).toBe('true')
      await waitFor(() => expect(within(line).getByTestId('source-chip')).toHaveTextContent('given by hand'))
      expect(screen.queryByTestId('also-give-form')).not.toBeInTheDocument()
      expect(await heldBy(admin, 'M1')).toEqual(expect.arrayContaining([{ role: 'R03', reason: 'Covers the evening shift' }]))
    })
  })

  scenario('Untick a role given by hand', async ({ admin }, step) => {
    await step('a member was given the role Buyer by hand', () => seed(admin))
    await step('the user unticks Buyer', async () => {
      await openLinks(admin)
      const line = await lineOf('Buyer')
      // Enabled once the row itself says it may be deleted.
      const untick = await within(line).findByRole('button', { name: 'Untick Buyer' })
      await waitFor(() => expect(untick).toBeEnabled())
      fireEvent.click(untick)
    })
    await step('the member no longer holds Buyer, and the page says it is saved', async () => {
      await waitFor(() => expect(within(screen.getByTestId('tick-list')).getByTestId('tick-count')).toHaveTextContent('1 of 7'))
      expect((await heldBy(admin, 'M1')).map((r) => r.role)).toEqual(['R01'])
      expect(screen.getByTestId('tick-status')).toHaveTextContent('✓ Saved')
      expect(screen.getByTestId('save-state')).toHaveTextContent('Saved')
    })
  })

  scenario('A first note for a member', async ({ admin }, step) => {
    await step('a member has no notes, and the user may add notes', () => seed(admin))
    await step("the user opens the member's Links tab", () => openLinks(admin))
    await step('the notes group shows greyed with + New', async () => {
      // Empty groups are one compact row of greyed chips; opening one offers + New.
      const empty = await screen.findByRole('region', { name: 'Pointed At By' })
      fireEvent.click(await within(empty).findByRole('button', { name: `${NOTE} 0` }))
      expect(await within(empty).findByRole('link', { name: '+ New' })).toBeInTheDocument()
    })
    await step('+ New opens a new note already linked to the member', async () => {
      const href = within(screen.getByRole('region', { name: 'Pointed At By' })).getByRole('link', { name: '+ New' }).getAttribute('href')!
      const url = new URL(href, 'http://x')
      expect(url.pathname).toBe(`${tableHref(NOTE)}/new`)
      expect(JSON.parse(url.searchParams.get('prefill')!)).toEqual({ member: 'M1' })
    })
  })

  scenario('Roles of a small team', async ({ admin }, step) => {
    await step('a team of members and a set of roles, each 40 or fewer', () => seed(admin))
    await step("the user opens a member's Links tab", () => openLinks(admin))
    await step("the roles' header offers Open as grid", async () => {
      expect(await within(await roles()).findByRole('link', { name: 'Open as grid' })).toHaveAttribute('href', expect.stringContaining(tableHref(GIVEN)))
    })
    await step('the team grows past 40', async () => {
      for (let i = 3; i <= 41; i++) await admin.post('/api/save_row', { table: MEMBER, row: { row_id: `M${i}`, member_name: `Member ${i}` } })
      cleanup()
      await openLinks(admin)
    })
    await step("the roles' header no longer offers it", async () => {
      await waitFor(() => expect(within(screen.getByTestId('tick-list')).getByTestId('tick-count')).toHaveTextContent('2 of 7'))
      expect(within(await roles()).queryByRole('link', { name: 'Open as grid' })).not.toBeInTheDocument()
    })
  })

  scenario("Enchakkal's page opens on its form", async ({ admin }, step) => {
    await step("the user has never opened a site's Links as the tree", () => seedSites(admin))
    await step("the user opens Enchakkal's page", () => renderApp(`${tableHref(SITE)}/row/ENK`, admin))
    await step('its tabs are Form, Links, Map and Activity, and Form is open', async () => {
      const tabs = await screen.findByRole('tablist', { name: 'Record workspace' })
      expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Form', 'Links', 'Map', 'Activity'])
      expect(within(tabs).getByRole('tab', { name: 'Form' })).toHaveAttribute('aria-selected', 'true')
    })
    await step("the user shows Enchakkal's links as the tree and opens another site's Links tab", async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Links' }))
      expect(await screen.findByTestId('record-links')).toBeInTheDocument()
      fireEvent.click(await screen.findByTestId('view-menu-button'))
      fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Tree' }))
      await screen.findByRole('tree')
      await waitFor(async () => expect((await admin.get<{ settings: { links?: { as?: string } } }>(`/api/user_settings/${encodeURIComponent(SITE)}`)).settings.links?.as).toBe('tree'))
      cleanup()
      await renderApp(`${tableHref(SITE)}/row/TCR`, admin)
      fireEvent.click(await screen.findByRole('tab', { name: 'Links' }))
    })
    await step("that site's links show as the tree too", async () => {
      expect(await screen.findByRole('tree')).toBeInTheDocument()
      expect(screen.queryByTestId('record-links')).not.toBeInTheDocument()
    })
  })
})

test('the record panel puts a tick list beside the fields, and the other groups under Pointed At By', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(MEMBER), admin)
  const link = await screen.findByRole('link', { name: 'Mira Member' })
  fireEvent.click(within(link.closest('tr')!).getAllByRole('cell').at(-1)!)
  const panel = await screen.findByRole('complementary', { name: 'Mira Member · M1' })
  const ticks = await within(panel).findByTestId('tick-list')
  expect(ticks).toHaveAttribute('aria-label', GIVEN)
  await waitFor(() => expect(within(ticks).getByTestId('tick-count')).toHaveTextContent('2 of 7'))
  const pointed = within(panel).getByRole('heading', { name: 'Pointed At By' }).parentElement!
  expect(await within(pointed).findByRole('button', { name: `${NOTE} 0` })).toBeInTheDocument()
  expect(within(pointed).queryByRole('button', { name: new RegExp(`^${GIVEN}`) })).not.toBeInTheDocument()
  // C1: the header reads the record's name, then its Table and its code.
  expect(within(panel).getByTestId('record-panel-kind')).toHaveTextContent(`${MEMBER} · M1`)
})

test('a long tick list folds after ten, with Show all', async ({ admin }) => {
  await seed(admin, { roles: 12 })
  await openLinks(admin)
  const list = await roles()
  await waitFor(() => expect(within(list).getAllByTestId('tick-line')).toHaveLength(10))
  fireEvent.click(within(list).getByRole('button', { name: 'Show all 12' }))
  expect(within(list).getAllByTestId('tick-line')).toHaveLength(12)
  fireEvent.click(within(list).getByRole('button', { name: 'Show fewer' }))
  expect(within(list).getAllByTestId('tick-line')).toHaveLength(10)
})

test('roles past 40 are no tick list: the group lists the roles held', async ({ admin }) => {
  await seed(admin, { roles: 41 })
  await openLinks(admin)
  const group = await screen.findByRole('region', { name: GIVEN })
  await waitFor(() => expect(within(group).getAllByTestId('linked-row')).toHaveLength(2))
  expect(screen.queryByTestId('tick-list')).not.toBeInTheDocument()
})

test('Cancel closes the inline form and saves nothing; a refused Add says why and keeps it open', async ({ admin }) => {
  await seed(admin)
  await openLinks(admin)
  fireEvent.click(within(await lineOf('Store Lead')).getByRole('button', { name: 'Tick Store Lead' }))
  fireEvent.click(within(await screen.findByTestId('also-give-form')).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByTestId('also-give-form')).not.toBeInTheDocument()
  // A column the Table now requires makes the server refuse the Add.
  await admin.put(`/api/table_def/${encodeURIComponent(GIVEN)}`, { columns: [
    { column_name: 'member', column_type: 'Reference', reference_table: MEMBER },
    { column_name: 'role', column_type: 'Reference', reference_table: ROLE },
    { column_name: 'place', column_type: 'Reference', reference_table: PLACE, label: 'Area' },
    { column_name: 'ends_on', column_type: 'Date', label: 'Ends' },
    { column_name: 'reason', column_type: 'Text', label: 'Reason', reqd: true },
  ] })
  fireEvent.click(within(await lineOf('Store Lead')).getByRole('button', { name: 'Tick Store Lead' }))
  fireEvent.click(within(await screen.findByTestId('also-give-form')).getByRole('button', { name: 'Add' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.getByTestId('also-give-form')).toBeInTheDocument()
  expect((await heldBy(admin, 'M1')).map((r) => r.role).sort()).toEqual(['R01', 'R02'])
})

test('the area is picked from the link Table\'s other link, and saved with the role', async ({ admin }) => {
  await seed(admin)
  await openLinks(admin)
  fireEvent.click(within(await lineOf('Head Office')).getByRole('button', { name: 'Tick Head Office' }))
  const form = await screen.findByTestId('also-give-form')
  fireEvent.click(within(form).getByTestId('area-pick'))
  const box = within(form).getByRole('combobox', { name: 'Area' })
  fireEvent.focus(box)
  fireEvent.change(box, { target: { value: 'Hill' } })
  const options = await screen.findByTestId('link-options-place')
  // Pick-only: no new Place is offered from here.
  expect(within(options).queryByTestId('link-create-new')).not.toBeInTheDocument()
  fireEvent.mouseDown(await within(options).findByText(/Hill Road Store/))
  fireEvent.click(within(form).getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(within(form).getByTestId('area-pick')).toHaveTextContent('Hill Road Store ▸'))
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }))
  await waitFor(async () => expect((await admin.get<{ data: { role: string; place: string }[] }>(
    `/api/table/${encodeURIComponent(GIVEN)}?filters=${encodeURIComponent(JSON.stringify([['role', '=', 'R06']]))}&fields=${encodeURIComponent(JSON.stringify(['role', 'place']))}`)).data)
    .toEqual([{ role: 'R06', place: 'P2' }]))
})

// Codex review: a delete grant on one's own rows only leaves others' links ticked but not removable.
test("someone who may delete only their own rows cannot untick another person's link", async ({ admin, createUser }) => {
  await seed(admin)
  const clerk = await createUserWithRole(admin, createUser, { role: 'Lt Own Rows', table: [MEMBER, ROLE, PLACE, NOTE], can_read: true })
  await createUserWithRole(admin, createUser, { role: 'Lt Own Rows', table: GIVEN, can_read: true, can_create: true })
  const { grantRole } = await import('server/test/fixtures')
  await grantRole(admin, { role: 'Lt Own Rows', table: GIVEN, can_delete: true, own_rows_only: true })
  await openLinks(clerk)
  const line = await lineOf('Buyer')
  await waitFor(() => expect(within(line).getByRole('button', { name: 'Untick Buyer' })).toBeDisabled())
  // Locked and grey, with why on hover: not a faded blue tick.
  const box = within(line).getByRole('button', { name: 'Untick Buyer' })
  await waitFor(() => expect(box).toHaveAttribute('title', 'You may not remove this one'))
  expect(box).toHaveClass('bg-subtle')
  expect(box).not.toHaveClass('bg-action')
})

test('a feed row on a Table with no correction path says where it changes, and offers no Correct', async ({ admin }) => {
  await seed(admin)
  await openLinks(admin)
  const line = await lineOf('Floor Lead')
  await waitFor(() => expect(within(line).getByTestId('tick-locked')).toHaveAttribute('title', 'Comes from HR: change it there'))
  expect(within(line).queryByRole('link', { name: 'Correct' })).not.toBeInTheDocument()
})

test('Correct fills its address from a read-only column of the row', async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/table_def/${encodeURIComponent(GIVEN)}`, { correction_path: '/fix/{source_key}', columns: [
    { column_name: 'member', column_type: 'Reference', reference_table: MEMBER },
    { column_name: 'role', column_type: 'Reference', reference_table: ROLE },
    { column_name: 'place', column_type: 'Reference', reference_table: PLACE, label: 'Area' },
    { column_name: 'ends_on', column_type: 'Date', label: 'Ends' },
    { column_name: 'reason', column_type: 'Text', label: 'Reason' },
    { column_name: 'source_key', column_type: 'Data', label: 'Source key', read_only: true },
  ] })
  await sql`update ${sql(await tableRelation(GIVEN))} set source_key = 'HR-77' where role = 'R01'`
  await openLinks(admin)
  const line = await lineOf('Floor Lead')
  expect(await within(line).findByRole('link', { name: 'Correct' })).toHaveAttribute('href', '/fix/HR-77')
})

test('the inline form asks for each kind of field, and Escape closes it', async ({ admin }) => {
  await seed(admin, { moreFields: true })
  await openLinks(admin)
  fireEvent.click(within(await lineOf('Data Steward')).getByRole('button', { name: 'Tick Data Steward' }))
  const form = await screen.findByTestId('also-give-form')
  const ends = within(form).getByRole('textbox', { name: 'Ends' })
  fireEvent.focus(ends)
  const date = within(form).getByLabelText('Ends')
  expect(date).toHaveAttribute('type', 'date')
  fireEvent.change(date, { target: { value: '2027-01-31' } })
  fireEvent.blur(date)
  expect(within(form).getByLabelText('Ends')).toHaveAttribute('type', 'date')
  fireEvent.click(within(form).getByRole('checkbox', { name: 'Confirmed' }))
  fireEvent.change(within(form).getByRole('combobox', { name: 'Level' }), { target: { value: 'Manager' } })
  fireEvent.change(within(form).getByRole('spinbutton', { name: 'Weight' }), { target: { value: '3' } })
  fireEvent.focus(within(form).getByRole('textbox', { name: 'Starts at' }))
  fireEvent.change(within(form).getByLabelText('Starts at'), { target: { value: '2027-01-31T12:00' } })
  fireEvent.change(within(form).getByLabelText('Starts at'), { target: { value: '' } })
  fireEvent.change(within(form).getByLabelText('Starts at'), { target: { value: '2027-01-31T12:00' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }))
  await waitFor(async () => expect((await admin.get<{ data: Record<string, unknown>[] }>(
    `/api/table/${encodeURIComponent(GIVEN)}?filters=${encodeURIComponent(JSON.stringify([['role', '=', 'R07']]))}&fields=${encodeURIComponent(JSON.stringify(['ends_on', 'confirmed', 'level', 'weight', 'starts_at']))}`)).data)
    .toEqual([expect.objectContaining({ ends_on: expect.stringMatching(/^2027-01-31/), confirmed: true, level: 'Manager', weight: 3,
      // The wall time typed is the viewer's own: saved as that instant, whatever the database's zone.
      starts_at: new Date('2027-01-31T12:00').toISOString() })]))
  fireEvent.click(within(await lineOf('Store Lead')).getByRole('button', { name: 'Tick Store Lead' }))
  fireEvent.keyDown(within(await screen.findByTestId('also-give-form')).getByRole('textbox', { name: 'Reason' }), { key: 'Escape' })
  expect(screen.queryByTestId('also-give-form')).not.toBeInTheDocument()
})

test("a ticked name opens its record in the panel; View ▾ hides the fields beside the links", async ({ admin }) => {
  await seed(admin)
  await openLinks(admin)
  expect(screen.getByTestId('links-fields')).toBeInTheDocument()
  fireEvent.click(await within(await lineOf('Buyer')).findByRole('link', { name: 'Buyer' }))
  expect(await screen.findByRole('complementary', { name: /^Buyer/ })).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('view-menu-button'))
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Hide' }))
  await waitFor(() => expect(screen.queryByTestId('links-fields')).not.toBeInTheDocument())
})


test('a group through a sub-table offers no + New: there is no column of its own to link back', () => {
  const group = { key: 'k', label: 'Lines', count: 0, connection: { table: 'Lt Line', column: 'item', via: 'Lt Order Line', count: 0, filters: [] } }
  expect(newRowHref(group, 'X1')).toBeUndefined()
})

test('+ New on a link to a row of any Table names its Table too', () => {
  const group = { key: 'k', label: 'Decisions', count: 0, connection: { table: 'Lt Decision', column: 'shapes', via: null, count: 0,
    filters: [['shapes_table', '=', 'Lt Member'], ['shapes', '=', 'M1']] as [string, string, unknown][] } }
  const href = newRowHref(group, 'M1')!
  expect(JSON.parse(new URL(href, 'http://x').searchParams.get('prefill')!)).toEqual({ shapes_table: 'Lt Member', shapes: 'M1' })
  const bare = { ...group, connection: { ...group.connection, filters: [] } }
  expect(JSON.parse(new URL(newRowHref(bare, 'M1')!, 'http://x').searchParams.get('prefill')!)).toEqual({ shapes: 'M1' })
})

test("a Links view choice that cannot be saved still holds for this visit", async ({ admin }) => {
  await seed(admin)
  const bridged = globalThis.fetch
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('/api/user_settings/') && init?.method === 'PUT'
      ? Response.json({ error: { type: 'InternalError', message: 'down' } }, { status: 500 })
      : bridged(input, init)) as typeof fetch)
  await openLinks(admin)
  fireEvent.click(screen.getByTestId('view-menu-button'))
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Tree' }))
  expect(await screen.findByRole('tree')).toBeInTheDocument()
  vi.unstubAllGlobals()
})

test('a new link starts with each field as it would be saved: defaults typed, a yes/no always said', () => {
  const col = (column_name: string, column_type: string, default_value: string | null) => ({ column_name, column_type, default_value }) as never
  expect(startingValues([col('confirmed', 'Check', '1'), col('flag', 'Check', null), col('level', 'Choice', 'Reader'),
    col('weight', 'Int', '2'), col('ends_on', 'Date', 'Today'), col('note', 'Data', '')])).toEqual({ confirmed: true, flag: false, level: 'Reader', weight: 2 })
})

test("a Person's page shows its link chips under its header, and a chip jumps to its section", async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', { name: 'Lt Person Note', id_pattern: 'hash', title_column: 'note_text',
    columns: [{ column_name: 'note_text', column_type: 'Data', label: 'Note' }, { column_name: 'person', column_type: 'Reference', reference_table: 'Person', label: 'Person' }] })
  await renderApp(rowHref('Person', admin.user!), admin)
  const chips = await screen.findByRole('region', { name: 'Connections' })
  fireEvent.click(await within(chips).findByTestId('connections-show-empty'))
  fireEvent.click(await within(chips).findByRole('button', { name: /^Lt Person Note\s*0$/ }))
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Links' })).toHaveAttribute('aria-selected', 'true'))
  const empty = await screen.findByRole('region', { name: 'Pointed At By' })
  expect(await within(empty).findByRole('link', { name: '+ New' })).toBeInTheDocument()
  // The page's right column (on the Form tab) lists an empty group as one greyed line, + New beside it.
  fireEvent.click(screen.getByRole('tab', { name: 'Form' }))
  const right = screen.getByTestId('connections-list')
  fireEvent.click(within(right).getByTestId('connections-show-empty'))
  const note = () => within(right).getAllByTestId('linked-rows-group').find((g) => g.textContent?.includes('Lt Person Note'))!
  await waitFor(() => expect(note().querySelector('h4')).toHaveAttribute('data-empty', 'true'))
  // Once its rows are read: the one line, no "No rows" beneath.
  await waitFor(() => expect(note()).not.toHaveTextContent('No rows'))
  await waitFor(() => expect(within(note()).getByRole('link', { name: '+ New' })).toBeInTheDocument())
})
