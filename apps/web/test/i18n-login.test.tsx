// I18N-002: a person's stored language is applied on a fresh sign-in, with no
// switch, and dates render through the one display format (DD-Mon-YYYY,
// #380), never as raw ISO. Moved down from e2e/i18n-login.spec.ts (#1080):
// the real login form in jsdom, signing in against the in-process server;
// the Translation rows are seeded inside the sandbox and roll back.
import { tableSlug } from 'shared'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setUserPassword } from 'server/src/auth'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never
const DT = 'I18n Login Doc'
const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

test('I18N-002: a stored language is applied on sign-in, and a date renders in the display format', async ({ admin, createUser }) => {
  const user = userEvent.setup()
  for (const [source, translated] of [['Log out', 'Déconnexion'], ['Save', 'Enregistrer']])
    await admin.post('/api/save_row', {
      table: 'Translation',
      row: { row_id: `fr-login-${source}`, language: 'fr', source_text: source, translated_text: translated },
    })
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'due', column_type: 'Date', in_list_view: true }],
  })
  await admin.post('/api/save_row', { table: DT, row: { due: '2026-03-09' } })
  const person = await createUser({ email: 'i18n-login-fr@example.com', roles: ['System Manager'] })
  await person.post('/api/set_language', { language: 'fr' })
  await setUserPassword(person.user!, 'i18n-login-pw-1')

  const app = await renderApp('/featherbase/login', anonymous)
  await user.type(await screen.findByLabelText('Email or username', {}, { timeout: 8000 }), 'i18n-login-fr@example.com')
  await user.type(screen.getByLabelText('Password'), 'i18n-login-pw-1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(here(app)).toMatch(/^\/featherbase\/admin/), { timeout: 8000 })

  // Log out lives in the account menu (#72); there is no language picker (#380).
  await user.click(await screen.findByTestId('session-user', {}, { timeout: 8000 }))
  await waitFor(() => expect(screen.getByTestId('logout')).toHaveTextContent('Déconnexion'))

  cleanup()
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`, person)
  await waitFor(() => expect(screen.getAllByTestId('cell-due')[0].textContent?.trim()).toBe('09-Mar-2026'), { timeout: 8000 })
})
