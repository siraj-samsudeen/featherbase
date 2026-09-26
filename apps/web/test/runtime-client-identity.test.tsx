import { resolve } from 'node:path'
import { beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { discoverPackages } from 'server/src/runtime-packages'
import { loadInstalledApps } from 'server/src/apps'
import { saveDoc } from 'server/src/document'
import { mintHandoffCode } from 'server/src/oauth'
import { requestPasswordReset } from 'server/src/password-reset'
import { api, clearSession, setSession } from '../src/lib/api'

// Each component test represents a fresh page; the module stays loaded in jsdom.
beforeEach(clearSession)
afterEach(() => vi.restoreAllMocks())

test('public credential exchanges and logout do not bootstrap with an expired saved bearer', async ({ admin, createUser }) => {
  const member = await createUser({ email: 'fresh-reset@example.com' })
  const key = await requestPasswordReset(member.user!)
  const session = { token: admin.token!, user: { row_id: 'Administrator', email: '', full_name: null } }
  const code = mintHandoffCode(session)
  const bridge = globalThis.fetch
  // Browser cookie transport for the real one-time redemption endpoint; all
  // responses and token/password validation still come from the real server.
  const requests = vi.spyOn(globalThis, 'fetch').mockImplementation((path, init) =>
    bridge(path, { ...init, headers: { ...init?.headers, cookie: `sid=${admin.token}` } }))
  localStorage.setItem('fc_token', 'expired-bearer')
  expect(await api.post('/api/oauth/session', { code })).toEqual(session)
  expect(await api.post('/api/reset_password_request', { usr: 'unknown-account@example.com' })).toEqual({ ok: true })
  expect(await api.post('/api/reset_password', { key, new_password: 'new-local-proof-password' })).toEqual({ ok: true })
  expect(await api.post('/api/logout')).toEqual({ ok: true })
  await expect(api.get('/api/web_form/missing-public-form')).rejects.toMatchObject({ status: 404 })
  expect(requests.mock.calls.some(([path]) => path === '/api/runtime_app_versions')).toBe(false)
})

test('generic core form can read and save a versioned runtime row', async ({ admin }) => {
  await discoverPackages([resolve('../..', 'runtime-apps/tasker')])
  await admin.post('/api/install_app', { name: 'tasker' })
  const row = await saveDoc('tasker.project', { project_name: 'Southern 37 cartons', description: '**Keep** this text' }, 'Administrator', 'insert')
  await renderApp(`/featherbase/admin/tasker.project/${row.row_id}`, admin)
  expect(await screen.findByDisplayValue('Southern 37 cartons')).toBeInTheDocument()
  const user = userEvent.setup()
  const name = screen.getByDisplayValue('Southern 37 cartons')
  await user.clear(name)
  await user.type(name, 'Northern 83 crates')
  await user.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  expect(await api.get(`/api/table/tasker.project/${row.row_id}`)).toMatchObject({ project_name: 'Northern 83 crates', description: '**Keep** this text' })
})

test('generic client pins v1 across real upgrade and re-resolves only on a new session', async ({ admin }) => {
  const requests = vi.spyOn(globalThis, 'fetch') // Observe the real in-process bridge, not a stub response.
  const bootstraps = () => requests.mock.calls.filter(([path]) => path === '/api/runtime_app_versions').length
  const prior = resolve('../..', 'runtime-apps/fixtures/tasker-v1')
  const target = resolve('../..', 'runtime-apps/fixtures/tasker-v2')
  await discoverPackages([prior])
  await admin.post('/api/install_app', { name: 'tasker' })
  const row = await saveDoc('tasker.project', { project_name: 'Do not relabel old editor' }, 'Administrator', 'insert')
  await renderApp(`/featherbase/admin/tasker.project/${row.row_id}`, admin)
  expect(await screen.findByDisplayValue('Do not relabel old editor')).toBeInTheDocument()
  await Promise.all([api.get('/api/table/tasker.project'), api.get(`/api/table/tasker.project/${row.row_id}`)])
  expect(bootstraps()).toBe(1)
  await discoverPackages([prior, target])
  await loadInstalledApps()
  const { planId } = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'tasker', version: '2.0.0' })
  await admin.post('/api/upgrade_app', { name: 'tasker', version: '2.0.0', planId })
  await expect(api.get(`/api/table/tasker.project/${row.row_id}`)).rejects.toMatchObject({ status: 403 })
  await admin.post('/api/activate_app_upgrade', { name: 'tasker', version: '2.0.0' })
  await expect(api.get(`/api/table/tasker.project/${row.row_id}`)).rejects.toMatchObject({ status: 409 })
  await expect(api.post('/api/save_row', { table: 'tasker.project', row: { ...row, project_name: 'Must not save' } })).rejects.toMatchObject({ status: 409 })
  expect(bootstraps()).toBe(1)
  setSession(admin.token!, { row_id: 'Administrator', email: '', full_name: null })
  expect(await api.get(`/api/table/tasker.project/${row.row_id}`)).toMatchObject({ project_name: 'Do not relabel old editor', description: null })
  expect(bootstraps()).toBe(2)
})
