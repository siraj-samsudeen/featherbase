// Two System Manager pages that load from one server call — Instance health
// and Waiting for access — when that call fails, and their Try again. Gaps the
// merged web coverage report (ADR 0012) showed: neither page's failure state
// was ever drawn. The failure is real: inside the test's transaction a table
// or column the query reads is renamed away (and, where it can be, put back).
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

afterEach(() => vi.restoreAllMocks())

test('Instance health that could not be loaded says so, and Try again loads it once the server answers', async ({ admin }) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // The checks and their history are read in one transaction step, so a
  // failure there leaves the test's own transaction usable.
  await sql.unsafe('alter table featherbase.health_check_event rename to health_check_event_gone')
  await renderApp('/featherbase/admin/instance-health', admin)
  expect(await screen.findByText('The checks could not be loaded.', {}, { timeout: 8000 })).toBeInTheDocument()
  await sql.unsafe('alter table featherbase.health_check_event_gone rename to health_check_event')
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByTestId('instance-health-summary')).toBeInTheDocument()
  expect(screen.queryByText('The checks could not be loaded.')).not.toBeInTheDocument()
})

test('Waiting for access that could not be loaded offers Try again, and asks again when pressed', async ({ admin }) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // This read is not in a step of its own: its failure ends the test's
  // transaction, so the retry fails too — what is under test is that the
  // page asks again and keeps offering the way back.
  await sql.unsafe('alter table featherbase.sign_in_identity rename column linked_by to linked_by_gone')
  const asked: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : (input as Request).url
    if (url.startsWith('/api/people/waiting_for_access?') || url === '/api/people/waiting_for_access') asked.push(url)
    return real(input, init)
  })
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  await userEvent.click(await screen.findByRole('button', { name: /try again/i }, { timeout: 8000 }))
  await waitFor(() => expect(asked).toHaveLength(2))
  expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
})
