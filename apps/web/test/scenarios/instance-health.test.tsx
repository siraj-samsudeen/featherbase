// instance-health's scenarios (#1070): the health page, the banner and
// first-run setup as a person meets them, the real Admin in jsdom against the
// in-process server. Each test is one fenced scenario of
// openspec/specs/instance-health/spec.md, step by step.
//
// "Local" and "hosted" are the server's environment (development, test), as
// FEATHERBASE_ENV sets it on a real instance; the emergency change to a
// managed setting is the server's own settings:set command, run in process.
import { resolve } from 'node:path'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, vi } from 'vitest'
import { discoverAppLibrary } from 'server/src/app-library'
import { loadInstalledApps } from 'server/src/apps'
import { setUserPassword } from 'server/src/auth'
import { main } from 'server/src/cli'
import { config } from 'server/src/config'
import { sql } from 'server/src/db'
import { overrideVariable } from 'server/src/env'
import { drainJobs, loadJobs } from 'server/src/jobs'
import { runMain } from 'server/test/command-io'
import { scenarioFor } from 'server/test/scenario'
import { admitTasker } from 'server/test/tasker-client'
import { OFFER_SETUP_KEY } from '../../src/pages/FirstRunSetup'
import { test, expect, renderApp, onScreen, screenSession, inside } from '../pg-test'

type Client = Parameters<typeof renderApp>[1]
type Rendered = Awaited<ReturnType<typeof renderApp>>
type Check = { key: string; state: string; fix: string | null; missing?: string[] }
type Report = { failing: number; setup_needed: number; checks: Check[]; setup: { installed_apps: number } }
const scenario = scenarioFor(test, 'instance-health')

const REPO = resolve('../..')
const ADMIN = '/featherbase/admin'
const SETUP = `${ADMIN}/setup`
const HEALTH = `${ADMIN}/instance-health`
const PASSWORD = 'instance-health-admin-pw'
const LONG = { timeout: 15_000 }
const anonymous = { user: null, token: null } as never
const pathOf = (r: Rendered) => (r.router as unknown as { state: { location: { pathname: string } } }).state.location.pathname

const environment = config.environment
afterEach(async () => {
  config.environment = environment
  overrideVariable('FEATHERBASE_INSTANCE', undefined)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  vi.restoreAllMocks()
  try { sessionStorage.clear() } catch { /* storage blocked */ }
})

/** A new instance on built-in defaults: no settings file chosen or applied,
 *  no System Manager with an address, its scheduled jobs not yet due. */
async function fresh(env: 'development' | 'test' = 'development', instance = '') {
  config.environment = env
  overrideVariable('FEATHERBASE_INSTANCE', instance)
  await sql`delete from instance_settings_apply`
  await sql`update person set email = null where row_id in (select parent from has_role where role = 'System Manager')`
  await sql`update scheduled_job set updated_at = now(), last_run_at = null, last_outcome = null, last_result = null`
  await setUserPassword('Administrator', PASSWORD)
  await discoverAppLibrary([])
  await loadInstalledApps()
}

const report = (admin: Client) => admin.get<Report>('/api/instance-health')
function check(r: Report, key: string) {
  const found = r.checks.find((c) => c.key === key)
  expect(found, `health report must include ${key}`).toBeDefined()
  return found!
}
const textContains = async (text: string) => expect((await screen.findAllByText(new RegExp(text), {}, LONG)).length).toBeGreaterThan(0)

async function health(admin: Client) {
  const r = await report(admin)
  cleanup()
  await renderApp(HEALTH, admin)
  await screen.findByTestId('instance-health-summary', {}, LONG)
  return r
}

async function install(admin: Client, name: 'tasker' | 'dash') {
  await discoverAppLibrary([resolve(REPO, name === 'tasker' ? 'example-apps/tasker' : 'client-apps/jeyarama/dash')])
  await admin.post('/api/install_app', { name })
  // Installing grants nobody access to private work: the scenario's System Manager is admitted.
  if (name === 'tasker') await admitTasker(admin)
}

/** The last run of the platform's own health job failed. */
async function failedJob() {
  const rows = await sql`update scheduled_job set enabled = true, last_run_at = now(), last_outcome = 'error',
    last_result = 'Acceptance operational failure' where method = 'check_instance_health' returning method`
  expect(rows, 'the platform health job must exist').toHaveLength(1)
}

async function open(as: Client, route = ADMIN) {
  cleanup()
  return renderApp(route, as)
}

async function banner(admin: Client, visible = true) {
  if (visible) {
    const shown = await screen.findByTestId('health-banner', {}, LONG)
    expect(within(shown).getByRole('link', { name: 'Open instance health' })).toBeInTheDocument()
    const r = await report(admin)
    expect(r.checks.some((c) => c.key === 'scheduled-job:check_instance_health' && c.state === 'fault')).toBe(true)
    expect(r.failing, 'unfinished setup must not inflate the operational fault count').toBe(1)
  } else {
    await screen.findByTestId('top-bar-name', {}, LONG)
    expect(screen.queryByTestId('health-banner')).toBeNull()
  }
}

async function welcome(admin: Client) {
  const view = await open(admin, SETUP)
  await screen.findByRole('heading', { name: 'Welcome to Featherbase' }, LONG)
  return view
}

/** Welcome, then "Explore Featherbase". */
async function skip(admin: Client) {
  const view = await welcome(admin)
  await onScreen().clickLink('Explore Featherbase')
  return view
}

async function signIn(next?: string) {
  cleanup()
  const view = await renderApp(next ? `/featherbase/login?next=${encodeURIComponent(next)}` : '/featherbase/login', anonymous)
  await screenSession(LONG).fillIn('Email or username', 'Administrator').fillIn('Password', PASSWORD).clickButton('Sign in')
  return view
}

async function noInstalledApps(admin: Client) {
  expect((await admin.get<{ installed: unknown[] }>('/api/apps')).installed).toEqual([])
  expect(await sql`select table_name from information_schema.tables where table_schema = 'featherbase'
    and (table_name like 'tasker.%' or table_name like 'dash.%')`).toHaveLength(0)
}

async function configurationFinding(r: Report, key: string) {
  const found = check(r, key)
  expect(['fault', 'setup-needed']).toContain(found.state)
  expect(found.fix).toBeTruthy()
  const card = await screen.findByTestId(`health-check-${key}`, {}, LONG)
  expect(within(card).getByTestId('health-fix')).toBeInTheDocument()
  expect(card.textContent).toMatch(key === 'settings-applied' ? /apply/i : /app_name/)
}

describe('instance-health', () => {
  // ---- Instance health page ----

  scenario('A new instance being set up', async ({ admin }, step) => {
    let r!: Report
    await step('the user has a new local instance using built-in defaults', () => fresh())
    await step('the user checks its health', async () => { r = await health(admin) })
    await step('the user is told the instance is ready to explore', async () => {
      expect(r.failing).toBe(0)
      expect(r.setup_needed).toBe(0)
      await textContains('Ready to explore')
    })
    await step('choosing a managed settings file is offered as an optional next step, not a fault', async () => {
      expect(check(r, 'settings-applied').state).toBe('optional')
      expect(within(await screen.findByTestId('health-check-settings-applied')).getByText('Optional', { exact: true })).toBeInTheDocument()
    })
  })

  scenario("A developer's own machine", async ({ admin }, step) => {
    let r!: Report
    await step('the user has a local development instance without email or a warehouse', async () => {
      await fresh()
      overrideVariable('MOTHERDUCK_TOKEN', '')
      await install(admin, 'dash')
    })
    await step('the user checks its health', async () => { r = await health(admin) })
    await step('absent optional services are explained without being counted as operational faults', async () => {
      expect(r.failing).toBe(0)
      await textContains('development')
    })
    await step('any installed app still identifies the setup it needs', async () => {
      expect(check(r, 'app-setup:dash').missing).toContain('secret MOTHERDUCK_TOKEN')
      await textContains('MOTHERDUCK_TOKEN')
    })
  }, 30_000)

  scenario('A hosted instance lacking the same things', async ({ admin }, step) => {
    let r!: Report
    await step('the user has a hosted instance missing required notice recipients', () => fresh('test'))
    await step('the user checks its health', async () => { r = await health(admin) })
    await step('the user sees that shared use is not ready and how to complete that setup', async () => {
      const email = check(r, 'system-manager-email')
      expect(email.state).toBe('setup-needed')
      expect(email.fix).toBeTruthy()
      expect(r.setup_needed).toBeGreaterThan(0)
      await textContains('Complete the required setup before shared use')
    })
  })

  scenario('Chosen managed configuration is not applied', async ({ admin }, step) => {
    let r!: Report
    await step('the user has chosen file-managed configuration for an instance', () => fresh('development', 'acceptance/local'))
    await step('its settings file has never been successfully applied', async () =>
      expect(await sql`select * from instance_settings_apply`).toHaveLength(0))
    await step('the user checks its health', async () => { r = await health(admin) })
    await step('the unapplied configuration is reported with the action needed to apply it', () => configurationFinding(r, 'settings-applied'))
  })

  scenario('Managed settings have drifted', async ({ admin }, step) => {
    let r!: Report
    await step('the user has applied file-managed configuration to an instance', async () => {
      await fresh()
      await admin.post('/api/instance-settings/apply', { file: { settings: { 'System Settings': { app_name: 'Acceptance Featherbase' } } } })
    })
    await step('a managed setting was changed through an emergency operation', async () => {
      const result = await runMain(main, ['settings:set', 'app_name', '--stdin'], 'Emergency Featherbase')
      expect(result.code, result.stderr).toBe(0)
    })
    await step('the user checks its health', async () => { r = await health(admin) })
    await step('the differing setting is reported with the action needed to reconcile it', () => configurationFinding(r, 'settings-match-file'))
  })

  // ---- Health banner ----

  scenario('A failed job', async ({ admin }, step) => {
    await step('the user is a System Manager who has not finished first-time setup', () => fresh())
    await step('the last run of an enabled scheduled job failed', failedJob)
    await step('the user opens Featherbase', () => open(admin))
    await step('the job failure is visibly reported separately from setup guidance', async () => {
      await banner(admin)
      await welcome(admin)
      await banner(admin)
    })
    await step('the notice remains until a later run succeeds', async () => {
      await welcome(admin)
      await banner(admin)
      const { name } = await admin.post<{ name: string }>('/api/enqueue_job', { method: 'check_instance_health' })
      // The worker's next pass: the queued run, done in this process.
      await loadJobs()
      await sql`update background_job set run_at = now() where job_status = 'queued' and run_at > now()`
      await drainJobs()
      const [execution] = await sql`select outcome from job_execution where job = ${name}`
      expect(execution?.outcome, 'a later run of the job must succeed').toBe('success')
      await welcome(admin)
      await screen.findByTestId('welcome-setup')
      await waitFor(() => expect(screen.queryByTestId('health-banner')).toBeNull(), LONG)
    })
  }, 30_000)

  scenario('Other people', async ({ admin, createUser }, step) => {
    let colleague!: Client
    await step('the user does not have the System Manager role', async () => {
      await fresh()
      colleague = await createUser({ roles: [] })
    })
    await step('an enabled scheduled job has failed', failedJob)
    await step('the user opens Featherbase', () => open(colleague))
    await step('the user does not see instance administration notices', () => banner(admin, false))
  })

  // ---- First-run System Manager setup ----

  scenario('A fresh instance', async ({ admin }, step) => {
    let view!: Rendered
    await step('the user is the first administrator on a fresh local instance', () => fresh())
    await step('the user signs in', async () => {
      view = await signIn()
      await waitFor(() => expect(pathOf(view)).toBe(SETUP), LONG)
    })
    await step('the user sees a welcome guide with clear next steps', async () => {
      await screen.findByRole('heading', { name: 'Welcome to Featherbase' }, LONG)
      for (const name of ['1. Set up your administrators', '2. Choose your apps', '3. Prepare for shared use'])
        expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    })
    await step('the user can explore Featherbase without installing an app', async () => {
      await onScreen().clickLink('Explore Featherbase')
      await waitFor(() => expect(pathOf(view)).toBe(`${ADMIN}/all-tables`), LONG)
      await noInstalledApps(admin)
    })
    await step('the greeting does not present ordinary unfinished setup as health problems', () => banner(admin, false))
  })

  scenario('Setup can be resumed', async ({ admin }, step) => {
    await step('the user has deferred optional first-time setup', async () => {
      await fresh()
      await install(admin, 'tasker')
      await skip(admin)
    })
    await step('the user returns to the setup guide', () => welcome(admin))
    await step('completed configuration is reflected and remaining steps can be continued', async () => {
      expect(await screen.findByRole('link', { name: 'Manage people' }, LONG)).toBeInTheDocument()
      expect((await report(admin)).setup.installed_apps).toBe(1)
      await textContains('1 installed')
      expect(screen.getByRole('link', { name: 'Set up administrators' })).toBeInTheDocument()
    })
  }, 30_000)

  scenario('Skipped in an emergency', async ({ admin }, step) => {
    let view!: Rendered
    await step('the user is the first administrator with setup unfinished', () => fresh())
    await step('an enabled scheduled job has failed', failedJob)
    await step('the user skips first-time setup', async () => { view = await skip(admin) })
    await step('the user reaches Featherbase immediately', async () => {
      await waitFor(() => expect(pathOf(view)).toBe(`${ADMIN}/all-tables`), LONG)
      await screen.findByTestId('top-bar-name')
    })
    await step('the operational failure remains visibly reported', () => banner(admin))
  })

  scenario('Email not working yet', async ({ admin }, step) => {
    await step('the user is the first administrator on an instance that cannot send email', async () => {
      await fresh()
      // Invitations are sign-in through Google; without email they are handed over by hand.
      const enabled = await sql`update sign_in_method set enabled = true, allowed_email_domains = 'example.com'
        where kind = 'google' returning row_id`
      expect(enabled, 'the platform must provide the Google sign-in method for invitations').not.toHaveLength(0)
    })
    await step('the user invites another System Manager during setup', async () => {
      await open(admin, `${SETUP}/people`)
      await inside(screenSession(LONG), 'first-run-setup', (setup) => setup
        .fillIn('Full name', 'Acceptance administrator')
        .fillIn('Email', 'base-install-admin@example.com')
        .clickButton('Invite'))
    })
    await step('the invitation link is shown to copy and deliver separately', async () => {
      const invitation = await screen.findByTestId('setup-invitation', {}, LONG)
      expect(invitation.textContent).toMatch(/https?:\/\//)
      expect(within(invitation).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    })
  })

  scenario('A deep link is not taken over', async ({ admin }, step) => {
    const destination = '/tasker/'
    let view!: Rendered
    let navigations: string[] = []
    await step('the user is the first administrator with setup unfinished', () => fresh())
    await step('the user signs in to follow a saved app link', async () => {
      await install(admin, 'tasker')
      // jsdom reports a full page load it cannot make; the browser makes it.
      navigations = []
      const error = console.error
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const text = args.map(String).join(' ')
        if (text.includes('navigation to another Document')) navigations.push(text)
        else error(...args)
      })
      view = await signIn(destination)
      await waitFor(() => expect(navigations).toHaveLength(1), LONG)
    })
    await step('the saved destination is preserved', async () => {
      // Signed in, and not taken to setup: the page left for the app's own address.
      expect(pathOf(view)).toBe('/featherbase/login')
      expect(new URLSearchParams(window.location.search).get('next') ?? new URLSearchParams(
        (view.router as unknown as { state: { location: { searchStr: string } } }).state.location.searchStr).get('next')).toBe(destination)
      expect(sessionStorage.getItem(OFFER_SETUP_KEY)).toBeNull()
      expect(screen.queryByTestId('welcome-setup')).toBeNull()
      expect(localStorage.getItem('fc_token')).toBeTruthy()
    })
    await step('the user can open the setup guide separately', () => welcome(admin))
  }, 30_000)
})
