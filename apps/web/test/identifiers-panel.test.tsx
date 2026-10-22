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
import { test, expect, renderApp } from './pg-test'

const ROSTER = { internal: { source: 'stylehr-roster-sync', verified: true } }

test('a System Manager sees codes with their periods and the address; a roster value has no End button', async ({ admin, createUser }) => {
  await applySeedPack('jeyarama')
  const tl = await createUser({ email: 'tl.ids@example.com' })
  await addIdentifier(tl.user!, { system: 'stylehr-employee-code', assigner: '7', value: '21654', valid_from: '2024-06-01', valid_to: '2026-03-03' }, 'sync', ROSTER)
  await addIdentifier(tl.user!, { system: 'stylehr-employee-code', assigner: '12', value: 'RR-10353', valid_from: '2026-03-03' }, 'sync', ROSTER)
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('person-identifiers')
  const codes = await within(panel).findByTestId('identifier-group-stylehr-employee-code')
  expect(codes).toHaveTextContent('RR-10353')
  expect(codes).toHaveTextContent('since 2026-03-03')
  expect(codes).toHaveTextContent('2024-06-01 – 2026-03-03')
  expect(within(codes).queryByRole('button', { name: 'End' })).toBeNull()
  expect(within(panel).getByTestId('identifier-group-email')).toHaveTextContent('tl.ids@example.com')
})

test('a person adds their own phone and sees it is not yet verified', async ({ createUser }) => {
  const me = await createUser({ email: 'own.ids@example.com' })
  // Their own page: Sign-in methods (account menu), not the Admin Person form.
  await renderApp('/featherbase/admin/sign-in-methods', me)
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

test('a merged-away record says so and offers no changes', async ({ admin, createUser }) => {
  const survivor = await createUser({ email: 'survivor.ids@example.com' })
  const loser = await createUser({ email: 'loser.ids@example.com' })
  await sql`update person set enabled = false, replaced_by = ${survivor.user!} where row_id = ${loser.user!}`
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(loser.user!)}`, admin)
  const panel = await screen.findByTestId('person-identifiers')
  expect(await within(panel).findByTestId('replaced-banner')).toHaveTextContent(survivor.user!)
  expect(within(panel).queryByTestId('add-identifier-form')).toBeNull()
})

test('a StyleHR sign-in still keyed by employee code says it is awaiting its record number', async ({ admin, createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'tl.awaiting@example.com' })
  const id = await linkDelegated(tl.user!, 'tl_awaiting', { subject: 'RR-5150' })
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(tl.user!)}`, admin)
  const methods = await screen.findByTestId('user-sign-in-methods')
  expect(await within(methods).findByTestId(`unresolved-${id}`)).toHaveTextContent('Awaiting its record number')
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
