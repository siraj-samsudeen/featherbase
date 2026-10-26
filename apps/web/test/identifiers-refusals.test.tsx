// person-resolution D3: ending a hand-recorded code asks why (the note is kept
// with the record), and a value the server refuses says why. Gaps the merged
// web coverage report (ADR 0012) showed. window.prompt is the browser's own
// question box, answered here through a spy; the refusal is the server's.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { sql } from 'server/src/db'
import { applySeedPack } from 'server/src/seed-packs'
import type { CreateUserFn } from 'feather-testing-postgres'
import { test, expect, renderApp } from './pg-test'

afterEach(() => vi.restoreAllMocks())

async function joinerWithHandCode(admin: Parameters<typeof renderApp>[1], createUser: CreateUserFn) {
  await applySeedPack('jeyarama')
  await sql`delete from person_identifier where source = 'stylehr-roster-sync'`
  const joiner = await createUser({ email: 'joiner.end@example.com', fullName: 'Joiner Jaya' })
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(joiner.user!)}`, admin)
  const panel = await screen.findByTestId('person-identifiers', {}, { timeout: 8000 })
  const form = await within(panel).findByTestId('add-identifier-form')
  await userEvent.selectOptions(within(form).getByLabelText('Identifier'), 'stylehr-employee-code')
  await userEvent.type(within(form).getByLabelText('Value'), 'rr-30002')
  await userEvent.type(await within(form).findByTestId('identifier-note'), 'Joiner, HR mail 24-Oct')
  await userEvent.click(within(form).getByRole('button', { name: 'Add' }))
  const codes = await within(panel).findByTestId('identifier-group-stylehr-employee-code')
  return { joiner, panel, codes }
}

test('ending a hand-recorded code asks why; no answer leaves it, an answer ends it', async ({ admin, createUser }) => {
  const { joiner, codes } = await joinerWithHandCode(admin, createUser)
  const ask = vi.spyOn(window, 'prompt').mockReturnValueOnce('').mockReturnValueOnce('  Typo, re-entered  ')
  await userEvent.click(within(codes).getByRole('button', { name: 'End' }))
  expect(ask).toHaveBeenCalledWith('Why are you ending this by hand? (kept with the record)')
  const current = async () =>
    (await sql`select count(*)::int as n from person_identifier
      where person_id = ${joiner.user!} and value = 'RR-30002' and upper_inf(valid)`)[0].n
  expect(await current()).toBe(1)

  await userEvent.click(within(codes).getByRole('button', { name: 'End' }))
  await waitFor(async () => expect(await current()).toBe(0))
})

test('a value the server refuses says why and adds nothing', async ({ admin, createUser }) => {
  const { panel } = await joinerWithHandCode(admin, createUser)
  const form = within(panel).getByTestId('add-identifier-form')
  // Not a phone number: refused.
  await userEvent.selectOptions(within(form).getByLabelText('Identifier'), 'phone')
  await userEvent.type(within(form).getByLabelText('Value'), 'call me maybe')
  await userEvent.click(within(form).getByRole('button', { name: 'Add' }))
  expect(await within(panel).findByTestId('identifier-error')).toHaveTextContent('An Indian mobile number has 10 digits starting 6–9')
  expect(within(panel).queryByTestId('identifier-group-phone')).toBeNull()
})
