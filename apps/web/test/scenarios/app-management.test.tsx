// app-management's scenarios (#1070): the Apps page as a System Manager uses
// it, the real Admin in jsdom against the in-process server and its real app
// library. Each test is one fenced scenario of
// openspec/specs/app-management/spec.md, step by step.
//
// An unbuilt package is a disposable checkout holding copies of Tasker and
// Dash without their built files; preparing it runs Tasker's real build.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, vi } from 'vitest'
import { appLibraryCatalog, discoverAppLibrary } from 'server/src/app-library'
import { loadInstalledApps } from 'server/src/apps'
import { sql } from 'server/src/db'
import { withNamedVariable } from 'server/src/env'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp, onScreen, insideOf, screenSession } from '../pg-test'

type Client = Parameters<typeof renderApp>[1]
type Rendered = Awaited<ReturnType<typeof renderApp>>
type App = { name: string; title: string; version: string; platformVersion: string; installed: boolean
  preparation: { state: string }; secrets: { name: string; optional: boolean; present: boolean }[] }
const scenario = scenarioFor(test, 'app-management')
const REPO = resolve('../..')
const TASKER = join(REPO, 'example-apps/tasker')
const DASH = join(REPO, 'client-apps/jeyarama/dash')
const APPS = '/featherbase/admin/apps'
const LONG = { timeout: 15_000 }
const pathOf = (r: Rendered) => (r.router as unknown as { state: { location: { pathname: string; href: string } } }).state.location

const catalog = async (admin: Client) => (await admin.get<{ catalog: App[] }>('/api/apps')).catalog
async function app(admin: Client, name = 'tasker') {
  const found = (await catalog(admin)).find((a) => a.name === name)
  expect(found, `${name} must be available from a real trusted package`).toBeDefined()
  return found!
}

/** The library as the server boots it, nothing installed in memory beyond this sandbox. */
async function library(paths: string[] = [], repository?: string | null) {
  await (repository === undefined ? discoverAppLibrary(paths) : discoverAppLibrary(paths, repository))
  await loadInstalledApps()
}

let scratch: string | null = null
/** A checkout with Tasker and Dash as source only; `broken` damages Tasker's compiler configuration. */
async function sourceCheckout(broken = false) {
  // Inside the test folder: the server imports the built package from it, and
  // the test runner loads modules only from inside the checkout.
  scratch = await mkdtemp(resolve('test/.app-management-'))
  await mkdir(join(scratch, '.git'))
  for (const [from, to] of [[TASKER, 'example-apps/tasker'], [DASH, 'client-apps/jeyarama/dash']] as const)
    await cp(from, join(scratch, to), { recursive: true, preserveTimestamps: true,
      filter: (f) => !['node_modules', 'dist', 'coverage'].includes(basename(f)) })
  // The workspace packages Tasker reads, beside it as in the checkout (only read).
  await symlink(join(REPO, 'packages'), join(scratch, 'packages'), 'dir')
  // Tasker's installed dependencies, copied: a build that reinstalls them must
  // never reach the checkout's own through a link.
  await cp(join(TASKER, 'node_modules'), join(scratch, 'example-apps/tasker/node_modules'),
    { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
  // A damaged package: its declarations are untouched, but the compiler
  // configuration its build needs is gone. (Removing the file would let the
  // compiler find the web app's own, above this folder.)
  if (broken) await writeFile(join(scratch, 'example-apps/tasker/tsconfig.json'), JSON.stringify({ extends: './missing-tsconfig.json' }))
  await library([], scratch)
}

async function resetLibrary() {
  cleanup()
  await library()
  if (scratch) await rm(scratch, { recursive: true, force: true })
  scratch = null
}

const nav = () => screen.getByRole('navigation', { name: 'Available apps' })
const details = (title = 'Tasker') => screen.getByRole('region', { name: `${title} details` })
/** The app's details read this, waiting as long as an install may take. */
const detailsContain = (text: string, title = 'Tasker', timeout = LONG.timeout) =>
  insideOf(screenSession({ timeout }), `[aria-label="${title} details"]`, (app) => app.assertText(text))

async function openApps(admin: Client) {
  const view = await renderApp(APPS, admin)
  await screen.findByRole('navigation', { name: 'Available apps' }, LONG)
  return view
}

async function inspect(admin: Client, name: 'tasker' | 'dash' = 'tasker') {
  if (!screen.queryByRole('navigation', { name: 'Available apps' })) await openApps(admin)
  await userEvent.click(within(nav()).getByRole('button', { name: name === 'tasker' ? /Tasker/ : /Dash/ }))
}

/** Click the install button and keep the server's answer to it. */
async function chooseInstall(admin: Client) {
  await inspect(admin)
  const real = globalThis.fetch
  const answer = new Promise<Response>((resolve) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const res = await real(input, init)
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (init?.method === 'POST' && ['/api/apps/prepare-install', '/api/install_app'].some((p) => url.endsWith(p))) resolve(res.clone())
      return res
    })
  })
  await userEvent.click(within(details()).getByRole('button', { name: /^(Prepare and install|Install app)$/ }))
  // Wrapped: an async function returning the promise itself would wait for it.
  return { answer }
}

async function finishInstall(admin: Client, { answer }: { answer: Promise<Response> }) {
  const res = await answer
  expect(res.status, await res.clone().text()).toBe(201)
  await detailsContain('Installed on this instance', 'Tasker', 120_000)
  expect((await app(admin)).installed).toBe(true)
}

/** Follow the details' "Configure settings" link: the App Setting list, filtered to the app. A plain
 *  link leaves the page in a browser, so jsdom opens its address afresh. */
async function openSettings(admin: Client, title: string) {
  const href = within(details(title)).getByRole('link', { name: 'Configure settings' }).getAttribute('href')!
  const url = new URL(href, 'http://localhost')
  expect(decodeURIComponent(url.pathname)).toBe('/featherbase/admin/table/app-setting')
  expect(url.search).not.toBe('')
  cleanup()
  const view = await renderApp(url.pathname + url.search, admin)
  await screen.findByTestId('list-view', {}, LONG)
  expect(pathOf(view).pathname).toBe('/featherbase/admin/table/app-setting')
}

async function noInstalledApps(admin: Client) {
  expect((await admin.get<{ installed: unknown[] }>('/api/apps')).installed).toEqual([])
  const tables = await sql`select table_name from information_schema.tables
    where table_schema = 'featherbase' and (table_name like 'tasker.%' or table_name like 'dash.%')`
  expect(tables).toHaveLength(0)
}

async function installDash(admin: Client) {
  await library([DASH])
  if (!(await app(admin, 'dash')).installed) await admin.post('/api/install_app', { name: 'dash' })
}

describe('app-management', () => {
  scenario('Tasker is available but not installed', async ({ admin }, step) => {
    try {
      await step('the user is a System Manager on an instance with no installed apps', async () => {
        await library()
        await noInstalledApps(admin)
      })
      await step('Tasker is available on the server', () => app(admin))
      await step('the user inspects Tasker', () => inspect(admin))
      await step('the user sees its version, required platform version, additions, permissions and setup requirements', async () => {
        const tasker = await app(admin)
        for (const text of [tasker.version, tasker.platformVersion, 'What it adds', 'Permissions', 'Instance setup']) await detailsContain(text)
      })
      await step('Tasker is identified as not installed', async () => {
        expect((await app(admin)).installed).toBe(false)
        await detailsContain('Not installed')
      })
    } finally { await resetLibrary() }
  })

  scenario('A client app can be inspected without being installed', async ({ admin }, step) => {
    try {
      await step('the user is a System Manager on an instance with no installed apps', async () => {
        await library()
        await noInstalledApps(admin)
      })
      await step('the checkout includes unbuilt Tasker and client app Dash packages', () => sourceCheckout())
      await step('the user inspects the available apps', () => openApps(admin))
      await step('both Tasker and Dash can be inspected', async () => {
        await inspect(admin)
        await detailsContain('Tasker')
        await inspect(admin, 'dash')
        await detailsContain('Dash', 'Dash')
      })
      await step('the user can tell that each package needs preparation before installation', async () => {
        for (const name of [/Tasker/, /Dash/]) expect(within(nav()).getByRole('button', { name })).toHaveTextContent(/Needs preparation/)
        for (const a of await catalog(admin)) if (['tasker', 'dash'].includes(a.name)) expect(a.preparation.state).toBe('needed')
      })
      await step('neither app is installed automatically', () => noInstalledApps(admin))
      await step('test fixtures are not offered as user apps', async () => {
        const names = (await catalog(admin)).map((a) => a.name)
        const fixtures = readdirSync(join(REPO, 'test-apps'), { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => {
          const manifest = join(REPO, 'test-apps', e.name, 'featherbase.json')
          return existsSync(manifest) ? [JSON.parse(readFileSync(manifest, 'utf8')).name as string] : []
        })
        expect(fixtures.length).toBeGreaterThan(0)
        for (const fixture of fixtures) expect(names, `test fixture ${fixture} must not be offered`).not.toContain(fixture)
      })
    } finally { await resetLibrary() }
  })

  scenario('Choosing an app reveals its details', async ({ admin }, step) => {
    try {
      await step('the user is a System Manager viewing the available app list', async () => {
        await library()
        await openApps(admin)
      })
      await step('the user chooses Tasker from the list', () => inspect(admin))
      await step("Tasker's declarations and installation state are shown alongside the list", async () => {
        expect(nav()).toBeInTheDocument()
        await detailsContain('What it adds')
        await detailsContain((await app(admin)).installed ? 'Installed' : 'Not installed')
      })
      await step('the applicable preparation or installation action is clear', () =>
        expect(within(details()).getByRole('button', { name: /^(Prepare and install|Install app)$/ })).toBeInTheDocument())
    } finally { await resetLibrary() }
  })

  scenario('No additional app packages are available', async ({ admin }, step) => {
    try {
      await step('the user is a System Manager on an instance with no available apps', () => library([], null))
      await step('the user inspects the available apps', () => renderApp(APPS, admin))
      await step('the user is told how an operator makes a trusted app available', async () => {
        expect(await screen.findByText(/No apps available/, {}, LONG)).toBeInTheDocument()
        expect(screen.getByText(/operator to supply a trusted app package/)).toBeInTheDocument()
      })
    } finally { await resetLibrary() }
  })

  scenario('Tasker is installed by choice', async ({ admin }, step) => {
    let answer!: { answer: Promise<Response> }
    try {
      await step('the user is a System Manager on an instance with no installed apps', async () => {
        await library([TASKER])
        await noInstalledApps(admin)
      })
      await step('Tasker is available on the server', () => app(admin))
      await step('the user chooses to install Tasker', async () => {
        await openApps(admin)
        answer = await chooseInstall(admin)
      })
      await step('Tasker is identified as installed', () => finishInstall(admin, answer))
      await step('the user can reach its instance configuration', async () => {
        expect(within(details()).getByRole('link', { name: 'Configure role mappings' })).toBeInTheDocument()
        await openSettings(admin, 'Tasker')
      })
    } finally { await resetLibrary() }
  }, 60_000)

  scenario('A source-only app is prepared by explicit choice', async ({ admin }, step) => {
    let answer!: { answer: Promise<Response> }
    try {
      await step('the user is a System Manager viewing an unbuilt Tasker package', async () => {
        await sourceCheckout()
        await openApps(admin)
        await inspect(admin)
      })
      await step('the user explicitly chooses to prepare and install Tasker', async () => {
        answer = await chooseInstall(admin)
      })
      await step('preparation progress is shown and Tasker is installed only after preparation succeeds', async () => {
        expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('Preparing the package'))).toBe(true)
        // Read in this process: the test's requests to the server run one at a time.
        const building = await waitFor(async () => {
          const tasker = (await appLibraryCatalog()).find((a) => a.name === 'tasker')!
          expect(tasker.preparation.state).toBe('preparing')
          return tasker
        }, LONG)
        expect(building.installed, 'the package must not be installed while its build is running').toBe(false)
        await finishInstall(admin, answer)
        expect((await app(admin)).preparation.state).toBe('ready')
      })
    } finally { await resetLibrary() }
  }, 180_000)

  scenario('Failed preparation leaves an app uninstalled', async ({ admin }, step) => {
    let answer!: { answer: Promise<Response> }
    try {
      await step('the user is a System Manager viewing a Tasker package that cannot be built', async () => {
        await sourceCheckout(true)
        await openApps(admin)
        await inspect(admin)
      })
      await step('the user explicitly chooses to prepare and install Tasker', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        answer = await chooseInstall(admin)
      })
      await step('Tasker remains uninstalled and the failure explains what to do next', async () => {
        expect((await answer.answer).status).toBeGreaterThanOrEqual(400)
        const tasker = await app(admin)
        expect(tasker.installed).toBe(false)
        expect(tasker.preparation.state).toBe('failed')
        await detailsContain('Ask the operator')
        await detailsContain('Not installed')
      })
    } finally { await resetLibrary() }
  }, 180_000)

  scenario('A colleague cannot install Tasker', async ({ admin, createUser }, step) => {
    let colleague!: Client
    let refused = 0
    try {
      await step('the user is a colleague without System Manager access', async () => {
        await library([TASKER])
        colleague = await createUser({ roles: [] })
      })
      await step('Tasker is available on the server', () => app(admin))
      await step('the user tries to install Tasker', async () => {
        refused = (await colleague.fetch('/api/install_app', { method: 'POST', body: JSON.stringify({ name: 'tasker' }) })).status
      })
      await step('the user is refused', () => expect(refused).toBe(403))
      await step('Tasker remains uninstalled', async () => expect((await app(admin)).installed).toBe(false))
    } finally { await resetLibrary() }
  })

  scenario('A setting managed by the instance file remains locked', async ({ admin }, step) => {
    try {
      await step('the user is a System Manager with Dash installed', () => installDash(admin))
      await step('its linked tables setting is file-managed while its report account is editable', async () => {
        await admin.post('/api/instance-settings/apply', { file: { settings: { 'App Setting': [{ row_id: 'dash.linked_tables', value: '[]' }] } } })
        await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'dash.embed_service_account', value: 'initial-account' } })
      })
      await step('the user configures Dash', async () => {
        await openApps(admin)
        await inspect(admin, 'dash')
        await openSettings(admin, 'Dash')
      })
      await step('the user can change the report account', async () => {
        cleanup()
        await renderApp('/featherbase/admin/table/app-setting/row/dash.embed_service_account', admin)
        await screenSession(LONG).assertValue('Value', 'initial-account')
        // Editable: the DSL has no verb for a field being enabled.
        expect(screen.getByLabelText('Value')).toBeEnabled()
        await onScreen().fillIn('Value', 'acceptance-account').clickButton('Save')
        await waitFor(async () =>
          expect((await admin.get<{ value: string }>('/api/table/App Setting/dash.embed_service_account')).value).toBe('acceptance-account'), LONG)
      })
      await step('the linked tables setting is locked with an explanation', async () => {
        cleanup()
        await renderApp('/featherbase/admin/table/app-setting/row/dash.linked_tables', admin)
        const value = await screen.findByLabelText('Value', {}, LONG) as HTMLInputElement
        await waitFor(() => expect(value.disabled || value.readOnly).toBe(true))
        expect(await screen.findAllByText(/settings file/)).not.toHaveLength(0)
      })
      await step("the app's packaged declaration is not editable", async () => {
        cleanup()
        await openApps(admin)
        await inspect(admin, 'dash')
        await detailsContain('packaged declarations are read-only', 'Dash')
        expect(details('Dash').querySelectorAll('input,textarea')).toHaveLength(0)
      })
    } finally { await resetLibrary() }
  }, 60_000)

  scenario('A required secret has not been supplied', async ({ admin }, step) => {
    try {
      await withNamedVariable('MOTHERDUCK_TOKEN', undefined, async () => {
        await step('the user is a System Manager with Dash installed', () => installDash(admin))
        await step('its required warehouse secret has not been supplied by the operator', async () => {
          expect((await app(admin, 'dash')).secrets.find((s) => s.name === 'MOTHERDUCK_TOKEN')?.present).toBe(false)
        })
        await step("the user inspects Dash's setup", () => inspect(admin, 'dash'))
        await step("the user sees the secret's name and that it is missing", async () => {
          expect((await app(admin, 'dash')).secrets.find((s) => s.name === 'MOTHERDUCK_TOKEN'))
            .toEqual({ name: 'MOTHERDUCK_TOKEN', optional: false, present: false })
          await detailsContain('MOTHERDUCK_TOKEN', 'Dash')
          await detailsContain('Missing', 'Dash')
        })
        await step('the user is directed to supply it through the host environment', () => detailsContain('host environment', 'Dash'))
        await step('no secret value is returned to the browser', async () => {
          for (const a of await catalog(admin))
            for (const secret of a.secrets) expect(Object.keys(secret).sort()).toEqual(['name', 'optional', 'present'])
        })
      })
    } finally { await resetLibrary() }
  }, 60_000)
})
