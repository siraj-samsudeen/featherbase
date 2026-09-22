import { afterEach, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { sql } from 'server/src/db'
import { issuer } from 'server/test/oidc-issuer'
import { login } from 'server/src/auth'
import { clearSession, getToken } from '../src/lib/api'

beforeEach(() => {
  clearSession()
  const bridge = globalThis.fetch
  // jsdom's in-process bridge has no browser networking layer to add Origin.
  vi.spyOn(globalThis, 'fetch').mockImplementation((path, init) =>
    bridge(path, { ...init, headers: { ...init?.headers, origin: 'http://localhost' } }))
})
afterEach(() => vi.restoreAllMocks())

// @spec provider_configuration_is_an_authentication_boundary
test('login discovers configured hosted methods while labeling native credentials separately', async ({ api }) => {
  const upstream = await issuer()
  try {
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled) values
      ('web-google', 'google', 'https://accounts.google.com', 'web-client', true),
      ('web-ms', 'microsoft', 'https://login.microsoftonline.com/common/v2.0', 'web-client', true)`
    await renderApp('/featherbase/login', api)
    expect(await screen.findByRole('link', { name: 'Sign in with Microsoft' })).toHaveAttribute('href', '/api/auth/login/web-ms')
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/api/auth/login/web-google')
    expect(screen.getByLabelText('Featherbase password')).toHaveAttribute('type', 'password')
    expect(screen.queryByLabelText(/StyleHR password/i)).not.toBeInTheDocument()
  } finally { await upstream.close() }
})

// @spec identity_linking_requires_two_bound_proofs
test('account page explains missing freshness and native step-up verifies without losing the old session on a typo', async ({ api }) => {
  const source = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
  await sql`update login_session set authenticated_at = clock_timestamp() - interval '6 minutes' where user_id = 'Administrator'`
  await renderApp('/featherbase/account', { ...api, token: source.token, user: 'Administrator' })
  expect(await screen.findByText(/account selection alone is not reauthentication/i)).toBeInTheDocument()
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Current Featherbase password'), 'wrong-password')
  await user.click(screen.getByRole('button', { name: 'Verify native login' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
  expect(getToken()).toBe(source.token)
  await user.clear(screen.getByLabelText('Current Featherbase password'))
  await user.type(screen.getByLabelText('Current Featherbase password'), process.env.ADMIN_PASSWORD ?? 'admin')
  await user.click(screen.getByRole('button', { name: 'Verify native login' }))
  await waitFor(() => expect(screen.getByText('Recent authentication verified.')).toBeInTheDocument())
  expect(getToken() === source.token).toBe(false)
})
