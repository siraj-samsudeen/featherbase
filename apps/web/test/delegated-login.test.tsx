// Delegated password sign-in on the Login page (OpenSpec change
// `delegated-password-login`). The page is the real route tree; its fetches
// reach the in-process server inside the test's rolled-back transaction, and
// the provider itself is a stub swapped in through `_setDelegatedFetch`.
import { afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { _setDelegatedFetch } from 'server/src/delegated-login'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never

async function setSetting(field: string, value: string) {
  await sql`
    insert into single_value (table_name, field, value)
    values ('System Settings', ${field}, ${value})
    on conflict (table_name, field) do update set value = excluded.value`
}

async function connectStyleHR() {
  await setSetting('delegated_login_label', 'StyleHR')
  await setSetting('delegated_login_url', 'https://hr.example.test/api/login/')
  await setSetting('delegated_login_user_column', 'stylehr_username')
  await sql`alter table "user" add column if not exists stylehr_username varchar(140)`
}

function providerAnswers(answer: () => Response | Promise<Response>) {
  _setDelegatedFetch((async () => answer()) as typeof fetch)
}

async function submitDelegated(id: string, password: string) {
  await userEvent.click(await screen.findByTestId('delegated-login-toggle'))
  await userEvent.type(screen.getByLabelText('StyleHR ID'), id)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByTestId('delegated-login-submit'))
}

afterEach(() => _setDelegatedFetch(null))

test('no connected service, no second way in', async () => {
  await sql`delete from single_value where table_name = 'System Settings' and field like 'delegated_login_%'`
  await renderApp('/featherbase/login', anonymous)
  expect(await screen.findByTestId('google-login')).toBeInTheDocument()
  // /api/brand has answered once the app name is applied; give it the chance.
  await waitFor(() => expect(document.title).not.toBe(''))
  expect(screen.queryByTestId('delegated-login-toggle')).not.toBeInTheDocument()
})

test('a linked Team Leader signs in with their StyleHR ID and lands in the Admin', async ({ createUser }) => {
  await connectStyleHR()
  const tl = await createUser({ email: 'tl.web@example.com' })
  await sql`update "user" set stylehr_username = 'tl_web_1' where row_id = ${tl.user!}`
  providerAnswers(() => Response.json({ ok: true }))

  await renderApp('/featherbase/login', anonymous)
  expect(await screen.findByTestId('delegated-login-toggle')).toHaveTextContent('Sign in with StyleHR')
  await submitDelegated('tl_web_1', 'hr-password')

  await screen.findByTestId('session-user')
  expect(JSON.parse(localStorage.getItem('fc_user')!).row_id).toBe(tl.user)
  expect(localStorage.getItem('fc_token')).toBeTruthy()
})

test('wrong password, an outage and a person who has left each read differently', async ({ createUser }) => {
  await connectStyleHR()
  // Linked: an unlinked ID is refused as a wrong password before StyleHR is ever asked.
  const tl = await createUser({ email: 'tl.web2@example.com' })
  await sql`update "user" set stylehr_username = 'tl_web_2' where row_id = ${tl.user!}`
  await renderApp('/featherbase/login', anonymous)

  providerAnswers(() => Response.json({}, { status: 401 }))
  await submitDelegated('tl_web_2', 'wrong')
  expect(await screen.findByTestId('login-error')).toHaveTextContent('Invalid login credentials')

  providerAnswers(() => new Response('down', { status: 503 }))
  await userEvent.click(screen.getByTestId('delegated-login-submit'))
  await waitFor(() =>
    expect(screen.getByTestId('login-error')).toHaveTextContent('StyleHR is not responding right now'),
  )

  providerAnswers(() => Response.json({ token: 'x', is_active: false }))
  await userEvent.click(screen.getByTestId('delegated-login-submit'))
  await waitFor(() =>
    expect(screen.getByTestId('login-error')).toHaveTextContent('StyleHR shows this account as no longer active'),
  )
  expect(localStorage.getItem('fc_token')).toBeNull()

  // And back to the ordinary form.
  await userEvent.click(screen.getByTestId('password-login-toggle'))
  expect(screen.getByLabelText('Email or username')).toBeInTheDocument()
})
