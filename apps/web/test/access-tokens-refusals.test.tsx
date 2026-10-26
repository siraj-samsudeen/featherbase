// Access Tokens page refusals and the service account's role picker. Gaps the
// merged web coverage report (ADR 0012) showed: no test met a refused token or
// a refused account name, or unticked a role it had ticked. The refusals are
// the server's own answers.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { issueSession } from 'server/src/auth'
import { test, expect, renderApp } from './pg-test'

test('a token asked for from a preview sign-in is refused with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  const { token } = await issueSession(admin.user!, { preview: true })
  await renderApp('/featherbase/admin/access-tokens', { ...admin, token })
  await user.click(await screen.findByTestId('issue-token', {}, { timeout: 10_000 }))
  await user.type(screen.getByTestId('token-label'), 'from preview')
  await user.click(screen.getByTestId('issue-confirm'))
  expect(await screen.findByTestId('issue-error')).toHaveTextContent(
    'Not allowed from this sign-in. Sign in again normally to change how this account signs in.',
  )
  expect(screen.queryByTestId('secret-dialog')).not.toBeInTheDocument()
})

test('a service account name that is not a slug is refused; a role ticked then unticked is not given', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Atr Exporter' } })
  await renderApp('/featherbase/admin/access-tokens', admin)
  await user.type(await screen.findByTestId('sa-name', {}, { timeout: 10_000 }), 'Nightly Export')
  await user.click(screen.getByTestId('sa-create'))
  expect(await screen.findByTestId('sa-error')).toHaveTextContent('Service account names are lowercase slugs like "svc-rama-installer"')

  await user.clear(screen.getByTestId('sa-name'))
  await user.type(screen.getByTestId('sa-name'), 'svc-atr-nightly')
  const role = await screen.findByTestId('sa-role-Atr Exporter')
  await user.click(role)
  expect(role).toBeChecked()
  await user.click(role)
  expect(role).not.toBeChecked()
  await user.click(screen.getByTestId('sa-create'))
  await waitFor(async () => {
    const list = await admin.get<{ service_accounts: { label: string; roles?: string[] }[] }>('/api/service_accounts')
    const made = list.service_accounts.find((a) => a.label === 'svc-atr-nightly')
    expect(made).toBeDefined()
    expect(made!.roles).toEqual([])
  })
})
