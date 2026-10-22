// person-identities (D6): the signed-in person sees their ways in, can remove
// one, and is stopped before removing the last.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { configureDelegated, linkDelegated } from 'server/test/identity-fixtures'
import { test, expect, renderApp } from './pg-test'

test('lists the password and a linked service; the last one cannot be removed', async ({ admin, createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'tl.methods@example.com' })
  await admin.post('/api/set_password', { user: tl.user, password: 'methods-pw-1' })
  const identity = await linkDelegated(tl.user!, 'tl_methods')

  await renderApp('/featherbase/admin/sign-in-methods', tl)
  const password = await screen.findByTestId('method-password')
  const hr = await screen.findByTestId(`method-${identity}`)
  expect(hr).toHaveTextContent('StyleHR')
  expect(hr).toHaveTextContent('tl_methods')

  await userEvent.click(within(password).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(screen.queryByTestId('method-password')).not.toBeInTheDocument())

  await userEvent.click(within(screen.getByTestId(`method-${identity}`)).getByRole('button', { name: 'Remove' }))
  expect(await screen.findByTestId('method-error')).toHaveTextContent('last way to sign in')
  expect(screen.getByTestId(`method-${identity}`)).toBeInTheDocument()
})

test('says how a Google link went', async ({ createUser }) => {
  const person = await createUser({ email: 'linked.person@example.com' })
  window.history.replaceState(null, '', '/featherbase/admin/sign-in-methods?link=taken')
  await renderApp('/featherbase/admin/sign-in-methods?link=taken', person)
  expect(await screen.findByTestId('link-outcome')).toHaveTextContent('belongs to another account')
})
