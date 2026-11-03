import { tableSlug } from 'shared'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { discoverAppLibrary } from 'server/src/app-library'
import { loadInstalledApps } from 'server/src/apps'
import { withNamedVariable } from 'server/src/env'
import { setSession } from '../src/lib/api'
import { Apps } from '../src/pages/Apps'
import { test, expect, renderApp } from './pg-test'

function renderApps(admin: { token?: string | null; user?: string | null }) {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><Apps /></QueryClientProvider>)
  return client
}

test('the real catalog offers example and client apps, keeps the list alongside selected declarations, and excludes fixtures', async ({ admin }) => {
  await discoverAppLibrary([])
  renderApps(admin)
  const list = await screen.findByRole('navigation', { name: 'Available apps' })
  expect(within(list).getAllByRole('button')).toHaveLength(2)
  const tasker = within(list).getByRole('button', { name: /Tasker/ })
  expect(tasker).toHaveTextContent('Not installed · Needs preparation')
  await userEvent.click(tasker)
  const details = screen.getByRole('region', { name: 'Tasker details' })
  expect(details).toHaveTextContent(/Version .+Requires platform 2026-10/)
  expect(within(details).getByRole('region', { name: 'What it adds' })).toHaveTextContent('Project')
  expect(within(details).getByRole('region', { name: 'Permissions' })).toHaveTextContent('read, edit, create, delete')
  expect(within(details).getByRole('region', { name: 'Permissions' })).toHaveTextContent('Tasker Member')
  expect(details).not.toHaveTextContent('This app grants access to the All role.')
  expect(within(details).getByRole('button', { name: 'Prepare and install' })).toBeEnabled()
  expect(within(details).queryByRole('textbox')).not.toBeInTheDocument()
  expect(within(details).queryByRole('link', { name: 'Configure settings' })).not.toBeInTheDocument()
  await userEvent.click(within(list).getByRole('button', { name: /Feather Dash/ }))
  expect(screen.getByRole('region', { name: 'Feather Dash details' })).toHaveTextContent('dive_version')
  expect(list).toBeInTheDocument()
  expect(await admin.get('/api/apps')).toMatchObject({ installed: [] })
})

test('secret requirements show names and presence, never the host value', async ({ admin }) => {
  await discoverAppLibrary([])
  await withNamedVariable('MOTHERDUCK_TOKEN', undefined, async () => {
    const client = renderApps(admin)
    await userEvent.click(await screen.findByRole('button', { name: /Feather Dash/ }))
    const secret = () => screen.getByText('MOTHERDUCK_TOKEN').closest('li')!
    expect(secret()).toHaveTextContent('Required · Missing')
    expect(screen.getByRole('region', { name: 'Feather Dash details' })).toHaveTextContent('host environment')
    await withNamedVariable('MOTHERDUCK_TOKEN', 'apps-page-private-test-value', async () => {
      await client.invalidateQueries({ queryKey: ['apps'] })
      await waitFor(() => expect(secret()).toHaveTextContent('Required · Present'))
      expect(document.body).not.toHaveTextContent('apps-page-private-test-value')
      expect(JSON.stringify(await admin.get('/api/apps'))).not.toContain('apps-page-private-test-value')
    })
  })
})

test('an empty server catalog tells the operator how to make a trusted package available', async ({ admin }) => {
  await discoverAppLibrary([], null)
  try {
    renderApps(admin)
    expect(await screen.findByRole('heading', { name: 'No apps available' })).toBeInTheDocument()
    expect(screen.getByText(/Ask the operator to supply a trusted app package/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare and install' })).not.toBeInTheDocument()
  } finally {
    cleanup()
    await discoverAppLibrary([])
  }
})

// Exercise the real trusted-source build and install endpoint, with a tiny
// disposable package instead of building Tasker's client in every test run.
async function withSource(build: string, run: () => Promise<void>) {
  const root = await mkdtemp(resolve('test/.apps-page-'))
  try {
    await mkdir(resolve(root, '.git'))
    const source = resolve(root, 'example-apps/other')
    await cp(resolve('../..', 'test-apps/other'), source, { recursive: true })
    const file = resolve(source, 'featherbase.json')
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...manifest, server: 'built.mjs' }))
    await writeFile(resolve(source, 'package.json'), JSON.stringify({ name: 'apps-page-source', version: '0.0.1', type: 'module', scripts: { build } }))
    await discoverAppLibrary([], root)
    await run()
  } finally {
    cleanup()
    await discoverAppLibrary([])
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
}

test('explicit preparation shows progress, installs only after building, and offers generic instance configuration', async ({ admin }) => {
  await withSource(`node -e "setTimeout(() => require('fs').copyFileSync('server.mjs', 'built.mjs'), 100)"`, async () => {
    await renderApp('/featherbase/admin/apps', admin)
    const switcher = await screen.findByRole('combobox', { name: 'Switch application' })
    expect(within(switcher).queryByRole('option', { name: 'Other tasks' })).not.toBeInTheDocument()
    const prepare = await screen.findByRole('button', { name: 'Prepare and install' })
    expect(screen.getByRole('region', { name: 'Other tasks details' })).toHaveTextContent('This app grants access to the All role.')
    await userEvent.click(prepare)
    expect(await screen.findByRole('button', { name: 'Preparing and installing…' })).toBeDisabled()
    expect(screen.getByText(/Preparing the package, then installing/)).toBeInTheDocument()
    const settings = await screen.findByRole('link', { name: 'Configure settings' }, { timeout: 15000 })
    const roles = screen.getByRole('link', { name: 'Configure role mappings' })
    for (const [link, table] of [[settings, 'App Setting'], [roles, 'App Role Binding']] as const) {
      const url = new URL(link.getAttribute('href')!, 'http://test')
      expect(decodeURIComponent(url.pathname)).toBe(`/featherbase/admin/table/${tableSlug(table)}`)
      expect(JSON.parse(url.searchParams.get('filters')!)).toEqual([['app', '=', 'other']])
    }
    expect(screen.getByRole('region', { name: 'Other tasks details' })).toHaveTextContent('Installed on this instance.')
    expect(screen.queryByRole('button', { name: 'Prepare and install' })).not.toBeInTheDocument()
    expect(await admin.get('/api/apps')).toMatchObject({ catalog: [expect.objectContaining({ name: 'other', installed: true })] })
    expect(await within(switcher).findByRole('option', { name: 'Other tasks' })).toBeInTheDocument()
  })
}, 30000)

test('a real failed build remains uninstalled, explains recovery and allows retry', async ({ admin }) => {
  await withSource(`node -e "process.exit(1)"`, async () => {
    renderApps(admin)
    await userEvent.click(await screen.findByRole('button', { name: 'Prepare and install' }))
    const error = await screen.findByRole('alert', undefined, { timeout: 15000 })
    expect(error).toHaveTextContent('Could not prepare and install other')
    expect(error).toHaveTextContent('Ask the operator')
    expect(await screen.findByRole('button', { name: 'Prepare and install' })).toBeEnabled()
    expect(screen.queryByRole('link', { name: 'Configure settings' })).not.toBeInTheDocument()
    expect(await admin.get('/api/apps')).toMatchObject({ catalog: [expect.objectContaining({ name: 'other', installed: false, preparation: expect.objectContaining({ state: 'failed' }) })] })
  })
}, 30000)
