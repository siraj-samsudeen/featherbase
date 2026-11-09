// Instance settings as code, group 4 (#465, design D5): a field the instance
// settings file set is read-only in Admin, with one sentence saying where it
// is changed. Fields the file does not name stay editable, and nothing is
// locked before the first apply. Moved from the Playwright managed-settings
// spec (#1080); the file is applied through the real endpoint, inside the
// test's rolled-back transaction. The server's refusals are
// apps/server/test/managed-settings.test.ts.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const HINT = 'Set in the instance settings file (instance-settings.json). Change it there, then apply the file.'
const GOOGLE = '/featherbase/admin/table/sign-in-method/row/google'
const WAIT = { timeout: 8000 }
const field = (name: string) => document.querySelector<HTMLElement>(`[data-field="${name}"]`)!

const applyFile = (admin: Admin, settings: Record<string, unknown>) =>
  admin.post('/api/instance-settings/apply', { file: { settings } })

async function openForm(admin: Admin, path: string, column: string) {
  await renderApp(path, admin)
  await screen.findByTestId('form-view', {}, WAIT)
  await waitFor(() => expect(field(column)).toBeInTheDocument())
}

async function recordActions() {
  await userEvent.click(screen.getByRole('button', { name: 'Record actions' }))
}

test('nothing is locked before the first apply', async ({ admin }) => {
  await applyFile(admin, {})
  await openForm(admin, GOOGLE, 'allowed_email_domains')
  expect(field('allowed_email_domains')).not.toBeDisabled()
  expect(screen.queryByTestId('managed-allowed_email_domains')).not.toBeInTheDocument()
  await recordActions()
  expect(await screen.findByTestId('form-rename')).toBeInTheDocument()
  expect(screen.getByTestId('form-delete')).toBeInTheDocument()
})

test('the Google sign-in method form locks the domains the file sets, and only those', async ({ admin }) => {
  await applyFile(admin, { 'Sign In Method': [{ row_id: 'google', allowed_email_domains: 'example.com,example.org' }] })
  await openForm(admin, GOOGLE, 'allowed_email_domains')
  const domains = field('allowed_email_domains')
  await waitFor(() => expect(domains).toHaveValue('example.com,example.org'))
  expect(domains).toBeDisabled()
  const hint = screen.getByTestId('managed-allowed_email_domains')
  expect(hint.textContent).toBe(HINT)
  expect(domains.getAttribute('aria-describedby')).toBeTruthy()
  expect(within(hint).getByTestId('settings-file-name').textContent).toBe('instance-settings.json')
  expect(field('label')).not.toBeDisabled()
  expect(screen.queryByTestId('managed-label')).not.toBeInTheDocument()
})

test('a row with a locked field offers neither rename nor delete', async ({ admin }) => {
  await applyFile(admin, { 'Sign In Method': [{ row_id: 'google', allowed_email_domains: 'example.com,example.org' }] })
  await openForm(admin, GOOGLE, 'allowed_email_domains')
  await waitFor(() => expect(field('allowed_email_domains')).toBeDisabled())
  await recordActions()
  expect(screen.queryByTestId('form-rename')).not.toBeInTheDocument()
  expect(screen.queryByTestId('form-delete')).not.toBeInTheDocument()
})

test('the System Settings form locks a field the file sets', async ({ admin }) => {
  const { time_zone } = await admin.get<{ time_zone: string | null }>('/api/table/System%20Settings/System%20Settings')
  await applyFile(admin, { 'System Settings': { time_zone } })
  await openForm(admin, '/featherbase/admin/table/system-settings', 'time_zone')
  await waitFor(() => expect(field('time_zone')).toBeDisabled())
  expect(screen.getByTestId('managed-time_zone').textContent).toBe(HINT)
  expect(field('app_name')).not.toBeDisabled()
  await recordActions()
  expect(screen.queryByTestId('form-rename')).not.toBeInTheDocument()
})

test('a field the next file stops naming is editable again', async ({ admin }) => {
  await applyFile(admin, { 'Sign In Method': [{ row_id: 'google', allowed_email_domains: 'example.com' }] })
  const { time_zone } = await admin.get<{ time_zone: string | null }>('/api/table/System%20Settings/System%20Settings')
  await applyFile(admin, { 'System Settings': { time_zone } })
  await openForm(admin, GOOGLE, 'allowed_email_domains')
  expect(field('allowed_email_domains')).not.toBeDisabled()
  expect(screen.queryByTestId('managed-allowed_email_domains')).not.toBeInTheDocument()
})
