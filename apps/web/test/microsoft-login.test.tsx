// Sign in with Microsoft on the sign-in page (microsoft-sign-in): the button
// sits beside Google's once the method is set up, and a refusal from
// Microsoft names Microsoft and offers to try another Microsoft account.
import { screen } from '@testing-library/react'
import { configureGoogle } from 'server/test/identity-fixtures'
import { configureMicrosoft } from 'server/test/microsoft-mock'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never

test('the Microsoft button follows Google\'s once Microsoft is set up', async () => {
  await configureGoogle({ enabled: true, client_id: 'google-client' })
  await configureMicrosoft({ enabled: false })
  const before = await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('google-login')
  expect(screen.queryByTestId('microsoft-login')).not.toBeInTheDocument()
  before.unmount()

  await configureMicrosoft({ client_id: 'b1e2c3d4-0000-4000-8000-00000000c1d0' })
  await renderApp('/featherbase/login', anonymous)
  const microsoft = await screen.findByTestId('microsoft-login')
  expect(microsoft).toHaveTextContent('Sign in with Microsoft')
  expect(microsoft).toHaveAttribute('href', '/api/oauth/microsoft/login')
  // The same kind of button as Google's, directly after it.
  const google = screen.getByTestId('google-login')
  expect(google.compareDocumentPosition(microsoft) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(microsoft.className.replace('mt-3 ', '')).toBe(google.className)
})

test('a Microsoft refusal names Microsoft and offers another Microsoft account', async () => {
  await configureMicrosoft({ client_id: 'b1e2c3d4-0000-4000-8000-00000000c1d0' })
  await renderApp('/featherbase/login?error=not_provisioned&via=microsoft', anonymous)
  expect(await screen.findByTestId('sign-in-refused')).toHaveTextContent("This Microsoft account isn't set up for")
  expect(await screen.findByTestId('refused-microsoft-retry')).toHaveTextContent('Try another Microsoft account')
  expect(screen.queryByTestId('refused-google-retry')).not.toBeInTheDocument()
})

test('Microsoft failing to answer reads as Microsoft\'s, not Google\'s', async () => {
  await configureMicrosoft({ client_id: 'b1e2c3d4-0000-4000-8000-00000000c1d0' })
  await renderApp('/featherbase/login?error=microsoft_failed&via=microsoft', anonymous)
  expect(await screen.findByTestId('sign-in-refused')).toHaveTextContent("Microsoft sign-in didn't finish")
})
