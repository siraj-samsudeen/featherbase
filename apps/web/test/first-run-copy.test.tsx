// First-run setup: copying an invitation (and a browser that refuses the
// clipboard), and a browser that blocks site data when the setup offer is
// read. Gaps the merged web coverage report (ADR 0012) showed. The clipboard
// and sessionStorage are browser APIs; the spies stand in for the browser's
// answer, the invitation itself comes from the real server.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { sql } from 'server/src/db'
import { OFFER_SETUP_KEY } from '../src/pages/FirstRunSetup'
import { test, expect, renderApp } from './pg-test'

afterEach(() => {
  vi.restoreAllMocks()
  try { sessionStorage.clear() } catch { /* storage blocked */ }
})

async function noManagerEmails() {
  await sql`update person set email = null where row_id in (select parent from has_role where role = 'System Manager')`
  await sql`update sign_in_method set enabled = true, allowed_email_domains = 'example.com' where kind = 'google'`
}

async function invite() {
  await userEvent.type(await screen.findByLabelText('Full name', {}, { timeout: 8000 }), 'Asha Keeper')
  await userEvent.type(screen.getByLabelText('Email'), 'asha@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
  const [result] = await screen.findAllByTestId('setup-result')
  return within(result).getByTestId('setup-invitation')
}

test('Copy puts the invitation on the clipboard and says so', async ({ admin }) => {
  const user = userEvent.setup()
  await noManagerEmails()
  await renderApp('/featherbase/admin/setup', admin)
  const invitation = await invite()
  await user.click(within(invitation).getByRole('button', { name: 'Copy' }))
  expect(await within(invitation).findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  expect(await navigator.clipboard.readText()).toBe(invitation.querySelector('pre')!.textContent)
})

test('a clipboard the browser refuses leaves the button saying Copy', async ({ admin }) => {
  const user = userEvent.setup()
  await noManagerEmails()
  await renderApp('/featherbase/admin/setup', admin)
  const invitation = await invite()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
  await user.click(within(invitation).getByRole('button', { name: 'Copy' }))
  await vi.waitFor(() => expect(write).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 50))
  expect(within(invitation).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
})

test('a browser that blocks site data is not offered the setup on sign-in', async ({ admin }) => {
  await noManagerEmails()
  sessionStorage.setItem(OFFER_SETUP_KEY, '1')
  // Session storage refuses to be read; the signed-in session (local storage) is untouched.
  const read = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (this === sessionStorage) throw new DOMException('blocked', 'SecurityError')
    return read.call(this, key)
  })
  await renderApp('/featherbase/admin', admin)
  expect(await screen.findByTestId('health-banner', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.queryByTestId('first-run-setup')).not.toBeInTheDocument()
})
