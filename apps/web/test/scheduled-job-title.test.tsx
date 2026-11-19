// #1330: a Scheduled Job reads by its title, never its code ("check_sla"): on its page and in Recently Opened.
import { screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

test("a Scheduled Job's page and its Recently Opened entry read by its title, not its code", async ({ admin }) => {
  localStorage.clear()
  await renderApp('/featherbase/admin/table/scheduled-job/row/check_sla', admin)
  const form = await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(within(form).getByRole('heading', { level: 1 })).toHaveTextContent('Scheduled Job: Escalate SLA Breaches'))
  const recent = await screen.findAllByTestId('sidebar-recent')
  const row = recent.find((r) => r.getAttribute('title')?.startsWith('Scheduled Job'))!
  await waitFor(() => expect(row).toHaveTextContent('Escalate SLA Breaches'))
  expect(row.textContent).not.toContain('check_sla')
})
