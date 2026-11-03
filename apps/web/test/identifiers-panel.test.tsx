// person-resolution D3/D12 (Phase 1a-i): the Person form's Identifiers panel
// and the Identifier System form's defaults. A System Manager sees every
// identifier a person has had, with its period and source; a value fed by
// the HR roster cannot be ended here; a person adds their own phone; a
// merged-away record says so; a StyleHR sign-in still keyed by employee code
// says it is awaiting its record number.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { applySeedPack } from 'server/src/seed-packs'
import { addIdentifier } from 'server/src/person-identifiers'
import { configureDelegated, linkDelegated } from 'server/test/identity-fixtures'
import { VIEWER_ROLE } from 'server/src/sales-target'
import { test, expect, renderApp } from './pg-test'

const ROSTER = { internal: { source: 'stylehr-roster-sync', verified: true } }

test('a System Manager sees codes with their periods and the address; a roster value has no End button', async ({ admin, createUser }) => {
  await applySeedPack('jeyarama')
  const tl = await createUser({ email: 'tl.ids@example.com' })
  await addIdentifier(tl.user!, { system: 'stylehr-employee-code', assigner: '7', value: '30654', valid_from: '2024-06-01', valid_to: '2026-03-03' }, 'sync', ROSTER)
  await addIdentifier(tl.user!, { system: 'stylehr-employee-code', assigner: '12', value: 'RR-0102', valid_from: '2026-03-03' }, 'sync', ROSTER)
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('person-identifiers')
  const codes = await within(panel).findByTestId('identifier-group-stylehr-employee-code')
  expect(codes).toHaveTextContent('RR-0102')
  // #415: days read the Indian way, DD-Mon-YYYY, like the rest of the app.
  expect(codes).toHaveTextContent('since 03-Mar-2026')
  expect(codes).toHaveTextContent('01-Jun-2024 – 03-Mar-2026')
  expect(within(codes).queryByRole('button', { name: 'End' })).toBeNull()
  expect(within(panel).getByTestId('identifier-group-email')).toHaveTextContent('tl.ids@example.com')
})

test('a person adds their own phone and sees it is not yet verified', async ({ admin, createUser }) => {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: VIEWER_ROLE } })
  const me = await createUser({ email: 'own.ids@example.com', roles: [VIEWER_ROLE] })
  // Their own page: Sign-in methods (account menu), not the Admin Person form.
  await renderApp('/featherbase/account/sign-in-methods', me)
  const panel = await screen.findByTestId('person-identifiers')
  const form = await within(panel).findByTestId('add-identifier-form')
  await userEvent.selectOptions(within(form).getByLabelText('Identifier'), 'phone')
  await userEvent.type(within(form).getByLabelText('Value'), '98470 12345')
  await userEvent.click(within(form).getByRole('button', { name: 'Add' }))
  const phone = await within(panel).findByTestId('identifier-group-phone')
  expect(phone).toHaveTextContent('+919847012345')
  expect(phone).toHaveTextContent('not verified')
  // Ended on the day it was added: it was never in force, so it goes.
  await userEvent.click(within(phone).getByRole('button', { name: 'End' }))
  await waitFor(() => expect(within(panel).queryByTestId('identifier-group-phone')).toBeNull())
})

test('a merged-away record names its survivor (never its id) and offers no changes', async ({ admin, createUser }) => {
  const survivor = await createUser({ email: 'survivor.ids@example.com', fullName: 'Survivor Sasi' })
  const loser = await createUser({ email: 'loser.ids@example.com' })
  await sql`update person set enabled = false, replaced_by = ${survivor.user!} where row_id = ${loser.user!}`
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(loser.user!)}`, admin)
  const panel = await screen.findByTestId('person-identifiers')
  const banner = await within(panel).findByTestId('replaced-banner')
  await waitFor(() => expect(banner).toHaveTextContent('merged into Survivor Sasi'))
  expect(banner.textContent).not.toContain(survivor.user!)
  expect(within(panel).queryByTestId('add-identifier-form')).toBeNull()
})

test('until the roster sync runs, a System Manager records a joiner’s code by hand with a note', async ({ admin, createUser }) => {
  await applySeedPack('jeyarama')
  await sql`delete from person_identifier where source = 'stylehr-roster-sync'`
  const joiner = await createUser({ email: 'joiner.ids@example.com', fullName: 'Joiner Jaya' })
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(joiner.user!)}`, admin)
  const panel = await screen.findByTestId('person-identifiers')
  const form = await within(panel).findByTestId('add-identifier-form')
  expect(within(form).queryByTestId('identifier-note')).toBeNull()
  await userEvent.selectOptions(within(form).getByLabelText('Identifier'), 'stylehr-employee-code')
  await userEvent.type(within(form).getByLabelText('Value'), 'rr-30001')
  await userEvent.type(await within(form).findByTestId('identifier-note'), 'Joiner, HR mail 23-Oct')
  await userEvent.click(within(form).getByRole('button', { name: 'Add' }))
  const codes = await within(panel).findByTestId('identifier-group-stylehr-employee-code')
  expect(codes).toHaveTextContent('RR-30001')
  expect(codes).toHaveTextContent('recorded by hand')
  expect(codes).toHaveTextContent('not verified')
  // The address mirrors the person's own email: said in words.
  expect(within(panel).getByTestId('identifier-group-email')).toHaveTextContent('the person’s email')
  // #415: the End button keeps its label on one line in the narrow card.
  expect(within(codes).getByRole('button', { name: 'End' })).toHaveClass('shrink-0')
})

test('the Identifier System form shows each setting’s default, offers a revert, and says why an option is refused', async ({ admin }) => {
  await admin.post('/api/save_row', { table: 'Identifier System', row: { row_id: 'badge-code', label: 'Badge code', kind: 'employee-record', normalise: 'trim' } })
  await renderApp('/featherbase/admin/Identifier%20System/phone', admin)
  const phone = await screen.findByTestId('identifier-system-defaults')
  expect(within(phone).getByTestId('default-one_holder_at_a_time')).toHaveTextContent(/second holder must be accepted/)
  expect(within(phone).queryByRole('button', { name: 'Revert to default' })).toBeNull()
})

test('revert to default puts back the kind’s setting', async ({ admin }) => {
  await admin.post('/api/save_row', { table: 'Identifier System', row: { row_id: 'badge-code', label: 'Badge code', kind: 'employee-record', normalise: 'trim' } })
  await renderApp('/featherbase/admin/Identifier%20System/badge-code', admin)
  const panel = await screen.findByTestId('identifier-system-defaults')
  const normalise = within(panel).getByTestId('default-normalise')
  expect(normalise).toHaveTextContent('default upper')
  await userEvent.click(within(normalise).getByRole('button', { name: 'Revert to default' }))
  await waitFor(async () => expect((await sql`select normalise from identifier_system where row_id = 'badge-code'`)[0].normalise).toBe('upper'))
})

// Prod 24-Oct-2026: the list endpoint returns only row_id unless asked for
// fields, so every option rendered blank. Assert the visible labels.
test('Find a person lists each identifier system by name for a System Manager; no match explains the exact-value rule', async ({ createUser }) => {
  await applySeedPack('jeyarama')
  const manager = await createUser({ email: 'sm.find@example.com', roles: ['System Manager'] })
  await renderApp('/featherbase/admin/find-person', manager)
  const page = await screen.findByTestId('find-person')
  const select = within(page).getByLabelText('Identifier')
  await waitFor(() => expect(within(select).getByRole('option', { name: 'StyleHR employee code' })).toBeInTheDocument())
  expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['Email address', 'Mobile phone', 'StyleHR employee code']))
  expect(within(select).getAllByRole('option').every((o) => (o.textContent ?? '').trim() !== '')).toBe(true)
  expect(select).toHaveValue('stylehr-employee-code')
  await userEvent.type(within(page).getByLabelText('Value'), '   ')
  await userEvent.click(within(page).getByRole('button', { name: 'Find' }))
  expect(within(page).queryByTestId('find-person-none')).not.toBeInTheDocument()
  expect(within(page).queryByTestId('find-person-error')).not.toBeInTheDocument()
  await userEvent.clear(within(page).getByLabelText('Value'))
  await userEvent.type(within(page).getByLabelText('Value'), 'rbchandran')
  await userEvent.click(within(page).getByRole('button', { name: 'Find' }))
  const none = await within(page).findByTestId('find-person-none')
  expect(none).toHaveTextContent(/No exact match/)
  expect(within(none).getByRole('link', { name: 'Person list' })).toHaveAttribute('href', '/featherbase/admin/Person')
})

test('the Person list links to Find by code; an old code finds the person, shown by name', async ({ admin, createUser }) => {
  await applySeedPack('jeyarama')
  const leaver = await createUser({ email: 'leaver.find@example.com', fullName: 'Leaving Latha' })
  await addIdentifier(leaver.user!, { system: 'stylehr-employee-code', value: 'RR-777', valid_from: '2024-01-01', valid_to: '2025-01-01' }, 'sync', ROSTER)
  await renderApp('/featherbase/admin/Person', admin)
  expect(await screen.findByTestId('open-find-person')).toHaveAttribute('href', '/featherbase/admin/find-person')
  await renderApp('/featherbase/admin/find-person', admin)
  const page = await screen.findByTestId('find-person')
  await waitFor(() => expect(within(page).getByLabelText('Identifier')).toHaveValue('stylehr-employee-code'))
  await userEvent.type(within(page).getByLabelText('Value'), 'rr-777')
  await userEvent.click(within(page).getByRole('button', { name: 'Find' }))
  const results = await within(page).findByTestId('find-person-results')
  await waitFor(() => expect(results).toHaveTextContent('Leaving Latha'))
  expect(results).toHaveTextContent('held it before')
  expect(results.textContent).not.toContain(leaver.user!)
})
