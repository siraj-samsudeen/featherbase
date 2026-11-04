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
