import { resolve } from 'node:path'
import { describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { discoverPackages, installedPackageDifference, notRunningMessage, notRunningReason } from '../src/runtime-packages'
import { activateInstalledApp, installApp, listInstalledApps, registerApp, setAppEnabled, suspendRuntimeApp, uninstallApp, whyAppNotRunning } from '../src/apps'
import { ownDisplayName } from '../src/people-directory'
import { installedAppsAtStart } from '../src/release-preflight'

// #912: an install made elsewhere starts here, and an app that cannot run
// says why. Synthetic rows; Tickets is only the package that is at hand.
const tickets = resolve('../..', 'example-apps/tickets')

describe('an installed app that is not running here (#912)', () => {
  test('each difference has its own reason and fix', () => {
    expect(notRunningMessage('demo', '1.0.0', 'files')).toMatch(/files changed.*same version.*install-app demo/)
    expect(notRunningMessage('demo', '1.0.0', 'manifest')).toMatch(/featherbase\.json changed.*new version/)
    expect(notRunningMessage('demo', '1.0.0', 'version', '2.0.0')).toMatch(/this server has demo 2\.0\.0/)
    expect(notRunningMessage('demo', '1.0.0', 'absent')).toMatch(/does not have its files.*FEATHERBASE_APP_PATHS/)
    expect(notRunningMessage('demo', '1.0.0', null)).toMatch(/starts working after the server restarts/)
  })

  test('the installed row is compared with the package this server loaded', async ({ admin }) => {
    await discoverPackages([tickets])
    expect(installedPackageDifference({ name: 'nothing_here', package_version: '1.0.0' })).toBe('absent')
    expect(installedPackageDifference({ name: 'tickets', package_version: '9.9.9' })).toBe('version')
    expect(notRunningReason({ name: 'tickets' })).toMatch(/this server has tickets 0\.2\.6/)
    await admin.post('/api/install_app', { name: 'tickets' })
    const [row] = await sql`select * from installed_app where name = 'tickets'`
    expect(installedPackageDifference(row)).toBeNull()
    expect(installedPackageDifference({ ...row, artifact_digest: 'other', manifest: { name: 'tickets' } })).toBe('manifest')
    expect(await whyAppNotRunning('nothing_here')).toMatch(/nothing_here/)
  })

  test('activation answers false for what it must not start, true for what runs', async ({ admin }) => {
    await discoverPackages([tickets])
    expect(await activateInstalledApp('nothing_here')).toBe(false)
    await admin.post('/api/install_app', { name: 'tickets' })
    expect(await activateInstalledApp('tickets')).toBe(true)
    await setAppEnabled('tickets', false)
    expect(await activateInstalledApp('tickets')).toBe(false)
    expect((await listInstalledApps()).find(app => app.name === 'tickets')).toMatchObject({ enabled: false, active: false })
    await sql`update installed_app set enabled = true where name = 'tickets'`
    await discoverPackages([])
    expect(await activateInstalledApp('tickets')).toBe(false)
  })

  // An app registered in code, not from a package: its jobs are its own,
  // with no package claim to check.
  test.for([
    ['with no jobs', {}],
    ['with a job', { scheduler_events: [{ method: 'code_app_sweep', cadence: 'hourly', handler: async () => {} }] }],
  ] as const)('an installed code app %s that this process has not wired is started by the app list', async ([, extra], { admin: _a }) => {
    const name = `codeapp-${Date.now()}`
    registerApp({ name, ...extra })
    try {
      await installApp(name)
      suspendRuntimeApp(name)
      expect((await listInstalledApps()).find(app => app.name === name)).toMatchObject({ active: true, recovery: null })
    } finally {
      await uninstallApp(name).catch(() => {})
    }
  })

  test('a development server warns with the reason when an installed app changed under its version', async ({ admin }) => {
    await discoverPackages([tickets])
    await admin.post('/api/install_app', { name: 'tickets' })
    await sql`update installed_app set artifact_digest = 'an-earlier-build' where name = 'tickets'`
    vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([tickets]))
    try {
      expect(await installedAppsAtStart('development')).toEqual([expect.stringMatching(/^WARNING: App tickets 0\.2\.6 is installed, but its files changed/)])
    } finally { vi.unstubAllEnvs() }
  })

  test("an app's context names its own caller: a person, a service account, or nobody", async ({ admin }) => {
    expect(await ownDisplayName(String(admin.user))).toEqual(expect.any(String))
    await sql`insert into service_account (row_id, label) values ('svc_bbbbbbbbbbbbbbbbbbbb', 'Nightly loader')`
    expect(await ownDisplayName('svc_bbbbbbbbbbbbbbbbbbbb')).toBe('Nightly loader')
    expect(await ownDisplayName('psn_nobody')).toBe('Unnamed person')
  })
})
