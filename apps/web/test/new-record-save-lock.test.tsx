// #1267 follow-up: a new record's fields are locked while its first save is on the way, so
// nothing typed in that moment is lost when the page becomes the record. A failed save
// unlocks them with what was typed.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'
import { holdResponses } from './held-requests'

test("while a new record's save is on the way its fields are locked, and nothing typed is lost", async ({ admin }) => {
  await renderApp('/featherbase/admin/table/person/new', admin)
  await userEvent.type(await screen.findByLabelText('Email'), 'locked.new@example.com')
  await userEvent.type(screen.getByLabelText('Full Name'), 'Locked New')
  const save = holdResponses('/api/save_row')
  try {
    await userEvent.click(screen.getByTestId('form-save'))
    await save.asked
    expect(screen.getByTestId('form-save')).toHaveTextContent('Saving…')
    expect(screen.getByTestId('new-record-fields')).toBeDisabled()
    const name = screen.getByLabelText('Full Name')
    expect(name).toBeDisabled()
    // An edit can't be made in this moment.
    await userEvent.type(name, ' Changed')
    expect(name).toHaveValue('Locked New')
    save.release()
    await screen.findByTestId('person-standing', {}, { timeout: 10_000 })
  } finally {
    vi.restoreAllMocks()
  }
  const [row] = await sql`select full_name from person where email = 'locked.new@example.com'`
  expect(row.full_name).toBe('Locked New')
})

test('a failed first save unlocks the fields with what was typed, and says why', async ({ admin }) => {
  await renderApp('/featherbase/admin/table/person/new', admin)
  await userEvent.type(await screen.findByLabelText('Email'), 'failed.new@example.com')
  await userEvent.type(screen.getByLabelText('Full Name'), 'Failed New')
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) =>
    String(url).includes('/api/save_row')
      ? Response.json({ error: { type: 'ValidationError', message: 'The server said no' } }, { status: 417 })
      : real(url, init))
  try {
    await userEvent.click(screen.getByTestId('form-save'))
    await waitFor(() => expect(screen.getByTestId('form-save')).toHaveTextContent('Save'))
    expect(screen.getByTestId('new-record-fields')).not.toBeDisabled()
    expect(screen.getByLabelText('Full Name')).toHaveValue('Failed New')
    expect(screen.getByLabelText('Email')).toHaveValue('failed.new@example.com')
    expect(await screen.findByText(/The server said no/)).toBeInTheDocument()
  } finally {
    vi.restoreAllMocks()
  }
  expect(await sql`select 1 from person where email = 'failed.new@example.com'`).toHaveLength(0)
})
