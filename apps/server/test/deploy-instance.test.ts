// #703: a client instance's deploy step. The cases change an app's folder on
// disk and rerun the step, as a new image would.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { uninstallApp } from '../src/apps'
import { config } from '../src/config'
import { sql } from '../src/db'
import { appOperation, DEPLOY_LOCK_WAIT, instanceDeployOperation } from '../src/app-lifecycle'
import { deployInstance, followsAppFiles, instanceFolder, repinChangedApps, settingsSection } from '../src/deploy-instance'
import { assertInstalledAppsShipped } from '../src/release-preflight'
import { discoverPackages } from '../src/runtime-packages'
import { captureIO } from './command-io'
import { scenarioFor } from './scenario'
import '../src/index'

const test = it
const scenario = scenarioFor(test, 'running-an-instance')

// Under test/ (gitignored scratch), since the loader's import resolves there.
const root = mkdtempSync(join(import.meta.dirname, '.deploy-instance-'))
const apps = join(root, 'instance-apps')
const instanceDir = join(root, 'client-apps/acme/instances/board')
const app = join(apps, 'other-current')
const packageFile = join(app, 'package.json')
const manifestFile = join(app, 'featherbase.json')
let name: string
let version: string

function readJson(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

async function deploy() {
  const out = captureIO()
  await deployInstance('acme/board', out.io, { root })
  return out.stdout()
}

async function digest() {
  const [row] = await sql`select artifact_digest from installed_app where name = ${name}`
  return row.artifact_digest
}

function pretendTo(environment: string) {
  vi.stubEnv('FEATHERBASE_ENV', environment)
  return sql`update featherbase.internal_metadata set value = ${environment} where key = 'environment'`
}

let originalAppName: Record<string, unknown> | undefined

beforeAll(async () => {
  ;[originalAppName] = await sql`select * from single_value where table_name = 'System Settings' and field = 'app_name'`
  mkdirSync(instanceDir, { recursive: true })
  writeFileSync(join(instanceDir, 'instance-settings.json'), JSON.stringify({
    settings: {},
    environments: {
      dev: { settings: { 'System Settings': { app_name: 'Board on dev' } } },
      prod: { settings: { 'System Settings': { app_name: 'Board on prod' } } },
    },
  }))
})

beforeEach(() => {
  rmSync(apps, { recursive: true, force: true })
  mkdirSync(apps, { recursive: true })
  cpSync(resolve(import.meta.dirname, '../../../test-apps/other'), app, { recursive: true })
  name = readJson(manifestFile).name
  version = readJson(packageFile).version
  vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([`${apps}/*`]))
})

afterEach(async () => {
  await sql`update featherbase.internal_metadata set value = 'test' where key = 'environment'`
  vi.unstubAllEnvs()
  await uninstallApp(name).catch(() => {})
  await discoverPackages([])
  // An uninstall keeps the app's schema; a later file's first-install test wants none.
  await sql`drop schema if exists other cascade`
  // The settings file's lock and the one value it set, as they were.
  await sql`delete from instance_settings_apply`
  await sql`delete from single_value where table_name = 'System Settings' and field = 'app_name'`
  if (originalAppName) await sql`insert into single_value (table_name, field, value) values ('System Settings', 'app_name', ${String(originalAppName.value)})`
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('which instance and which section', () => {
  it('staging applies dev, production applies prod, and nothing else is hosted', () => {
    expect(settingsSection('staging')).toBe('dev')
    expect(settingsSection('production')).toBe('prod')
    expect(() => settingsSection('development')).toThrow(/pnpm dev/)
  })

  it('refuses an instance this image was not built for, or a name that is not one', () => {
    expect(instanceFolder('acme/board', root).settingsFile).toBe(join(instanceDir, 'instance-settings.json'))
    expect(() => instanceFolder('acme/other', root)).toThrow(/holds no instance "acme\/other"/)
    expect(() => instanceFolder('../../etc', root)).toThrow(/holds no instance/)
  })

  it('a staging or production server on its own database follows files', () => {
    expect(followsAppFiles('staging', 'staging')).toBe(true)
    expect(followsAppFiles('production', 'production')).toBe(true)
    expect(followsAppFiles('production', 'staging')).toBe(false)
    expect(followsAppFiles('staging', 'production')).toBe(false)
    expect(followsAppFiles('development', 'development')).toBe(false)
  })
})

describe('a fresh deploy', () => {
  test('installs the apps, applies the section, and a second run changes nothing', async () => {
    await pretendTo('staging')
    const first = await deploy()
    expect(first).toContain(`installed ${name}`)
    expect(first).toContain('app_name')
    const second = await deploy()
    expect(second).toContain(`${name} ${version} is already installed`)
    expect(second).toContain('nothing changed')
  })

  test('a problem with the settings fails the step', async () => {
    await pretendTo('staging')
    const out = captureIO()
    const bad = mkdtempSync(join(import.meta.dirname, '.deploy-instance-'))
    try {
      mkdirSync(join(bad, 'client-apps/acme/instances/board'), { recursive: true })
      writeFileSync(join(bad, 'client-apps/acme/instances/board/instance-settings.json'), JSON.stringify({
        settings: {}, environments: { dev: { settings: { 'System Settings': { app_name: { env: 'NOT_SET_ANYWHERE' } } } } },
      }))
      await expect(deployInstance('acme/board', out.io, { root: bad })).rejects.toThrow(/settings file was not applied/)
      expect(out.stderr()).toContain('NOT_SET_ANYWHERE')
      // The install rolled back with it: the old deployment knows nothing of this app.
      expect(await sql`select 1 from installed_app where name = ${name}`).toHaveLength(0)
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
  })
})

describe('what the step leaves alone or finishes', () => {
  test('a disabled app is left as it is', async () => {
    await pretendTo('staging')
    await deploy()
    await sql`update installed_app set enabled = false where name = ${name}`
    expect(await deploy()).toContain(`${name} is disabled; left as it is`)
  })

  test('an install with no recorded fingerprint still matches on its manifest', async () => {
    await pretendTo('staging')
    await deploy()
    await sql`update installed_app set artifact_digest = null where name = ${name}`
    expect(await deploy()).toContain(`${name} ${version} is already installed`)
  })

  test('an upgrade waiting for activation is activated', async () => {
    await pretendTo('staging')
    await deploy()
    await sql`update installed_app set activation_pending = true where name = ${name}`
    expect(await deploy()).toContain(`activated ${name} ${version}`)
    const [row] = await sql`select activation_pending from installed_app where name = ${name}`
    expect(row.activation_pending).toBe(false)
  })

  test('an app folder that is missing, or a version the image lost, fails the step', async () => {
    await pretendTo('staging')
    vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([`${root}/no_such_folder/*`]))
    await expect(deploy()).rejects.toThrow(/no_such_folder.*was rejected/)
  })

  it('cli repin-apps refuses a database not stamped for it, and says why', async () => {
    const { main } = await import('../src/cli')
    const out = captureIO()
    expect(await main(['repin-apps'], out.io)).toBe(1)
    expect(out.stderr()).toContain('production needs a new version')
  })

  test('cli repin-apps re-pins on a dev database', async () => {
    await pretendTo('staging')
    await deploy()
    writeFileSync(join(app, 'NOTES.md'), 'a file changed\n')
    const { main } = await import('../src/cli')
    const out = captureIO()
    expect(await main(['repin-apps'], out.io)).toBe(0)
    expect(out.stdout()).toContain('re-pinned to them')
  })
})

describe('on a dev instance (staging)', () => {
  test('changed files under the same version and manifest: the release passes and the step re-pins', async () => {
    await pretendTo('staging')
    await deploy()
    const before = await digest()
    writeFileSync(join(app, 'NOTES.md'), 'a file changed\n')
    await expect(assertInstalledAppsShipped({ followFiles: true })).resolves.toContain(`the deploy step re-pins ${name}`)
    expect(await deploy()).toContain(`${name} ${version}: its files changed; re-pinned to them`)
    expect(await digest()).not.toBe(before)
    await expect(assertInstalledAppsShipped({ followFiles: true })).resolves.toContain('every installed, enabled app ships')
  })

  test('a changed manifest with the same version fails, naming the app and saying to bump the version', async () => {
    await pretendTo('staging')
    await deploy()
    const before = await digest()
    writeFileSync(manifestFile, JSON.stringify({ ...readJson(manifestFile), title: 'Changed title' }))
    await expect(assertInstalledAppsShipped({ followFiles: true })).rejects.toThrow(new RegExp(`App ${name} version ${version}: its manifest.*changed.*Bump the version`))
    await expect(deploy()).rejects.toThrow(/Bump the version/)
    expect(await digest()).toBe(before)
  })
})

describe('on production', () => {
  // #1178 (D3): production takes a code-only fix under the same version.
  scenario('Production takes a fixed screen under the same version', async (_ctx, step) => {
    await step('production runs version 1 of an app', async () => {
      await pretendTo('production')
      await deploy()
    })
    const before = await digest()
    let said = ''
    await step('a deploy ships version 1 with one of its files changed', async () => {
      writeFileSync(join(app, 'NOTES.md'), 'a file changed\n')
      said = await deploy()
    })
    await step('production runs the changed files, still as version 1', async () => {
      expect(said).toContain(`${name} ${version}: its files changed; re-pinned to them`)
      expect(await digest()).not.toBe(before)
      const [row] = await sql`select package_version from installed_app where name = ${name}`
      expect(row.package_version).toBe(version)
    })
  })

  scenario('Production still refuses a changed declaration under the same version', async (_ctx, step) => {
    await step('production runs version 1 of an app', async () => {
      await pretendTo('production')
      await deploy()
    })
    const before = await digest()
    await step('a deploy ships version 1 with a changed declaration', () => {
      writeFileSync(manifestFile, JSON.stringify({ ...readJson(manifestFile), title: 'Changed title' }))
    })
    await step('the deploy is refused and asks for a new version', async () => {
      await expect(deploy()).rejects.toThrow(/Bump the version/)
      expect(await digest()).toBe(before)
    })
  })

  test('applies the prod section', async () => {
    await pretendTo('production')
    expect(await deploy()).toContain('Board on prod')
  })
})

describe('a newer version in the image', () => {
  test('a settings failure after the upgrade leaves the installed version as it was', async () => {
    await pretendTo('staging')
    await deploy()
    const next = join(apps, 'other-next')
    cpSync(app, next, { recursive: true })
    writeFileSync(join(next, 'package.json'), JSON.stringify({ ...readJson(packageFile), version: '99.0.0' }))
    const manifest = readJson(manifestFile)
    writeFileSync(join(next, 'featherbase.json'), JSON.stringify({
      ...manifest, migrations: [...(manifest.migrations ?? []), { id: 'to_next', fromVersion: version, toVersion: '99.0.0', operations: [] }],
    }))
    const before = await digest()
    const bad = mkdtempSync(join(import.meta.dirname, '.deploy-instance-'))
    try {
      mkdirSync(join(bad, 'client-apps/acme/instances/board'), { recursive: true })
      writeFileSync(join(bad, 'client-apps/acme/instances/board/instance-settings.json'), JSON.stringify({
        settings: {}, environments: { dev: { settings: { 'System Settings': { app_name: { env: 'NOT_SET_ANYWHERE' } } } } },
      }))
      await expect(deployInstance('acme/board', captureIO().io, { root: bad })).rejects.toThrow(/settings file was not applied/)
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
    const [row] = await sql`select package_version, activation_pending from installed_app where name = ${name}`
    expect(row).toMatchObject({ package_version: version, activation_pending: false })
    expect(await digest()).toBe(before)
  })

  test('upgrades and activates it; a version the image lost is refused with what to do', async () => {
    await pretendTo('staging')
    await deploy()
    const next = join(apps, 'other-next')
    cpSync(app, next, { recursive: true })
    const nextVersion = '99.0.0'
    writeFileSync(join(next, 'package.json'), JSON.stringify({ ...readJson(packageFile), version: nextVersion }))
    const manifest = readJson(manifestFile)
    writeFileSync(join(next, 'featherbase.json'), JSON.stringify({
      ...manifest,
      migrations: [...(manifest.migrations ?? []), { id: 'to_next', fromVersion: version, toVersion: nextVersion, operations: [] }],
    }))
    expect(await deploy()).toContain(`upgraded ${name} from ${version} to ${nextVersion}`)
    const [row] = await sql`select package_version, activation_pending from installed_app where name = ${name}`
    expect(row).toMatchObject({ package_version: nextVersion, activation_pending: false })

    rmSync(next, { recursive: true })
    await expect(assertInstalledAppsShipped({ followFiles: true })).rejects.toThrow(/does not ship it/)
  })

  // #1178 (D4): the image ships only the new version; the upgrade moves from
  // the installed record, so the old version's files are not needed.
  test('an image holding only the newer version upgrades to it on production', async () => {
    await pretendTo('production')
    await deploy()
    const next = join(apps, 'other-next')
    cpSync(app, next, { recursive: true })
    rmSync(app, { recursive: true })
    const nextVersion = '99.0.0'
    writeFileSync(join(next, 'package.json'), JSON.stringify({ ...readJson(join(next, 'package.json')), version: nextVersion }))
    const manifest = readJson(join(next, 'featherbase.json'))
    writeFileSync(join(next, 'featherbase.json'), JSON.stringify({
      ...manifest,
      migrations: [...(manifest.migrations ?? []), { id: 'to_next', fromVersion: version, toVersion: nextVersion, operations: [] }],
    }))
    expect(await assertInstalledAppsShipped({ followFiles: false })).toContain(`${name} ${version} is upgraded by this release`)
    expect(await deploy()).toContain(`upgraded ${name} from ${version} to ${nextVersion}`)
    const [row] = await sql`select package_version, activation_pending from installed_app where name = ${name}`
    expect(row).toMatchObject({ package_version: nextVersion, activation_pending: false })
  })

  // Dev ran Tasker 3.0.2 built from main; #1047 then shipped 3.0.2 as the
  // release built it, beside 3.0.3. Upgrading first checked the installed 3.0.2
  // against files it was not pinned to, and every dev deploy failed.
  test('on dev, an installed version whose files changed is re-pinned before it is upgraded', async () => {
    await pretendTo('staging')
    await deploy()
    writeFileSync(join(app, 'NOTES.md'), 'a file changed\n')
    const next = join(apps, 'other-next')
    cpSync(app, next, { recursive: true })
    const nextVersion = '99.0.0'
    writeFileSync(join(next, 'package.json'), JSON.stringify({ ...readJson(packageFile), version: nextVersion }))
    const manifest = readJson(manifestFile)
    writeFileSync(join(next, 'featherbase.json'), JSON.stringify({
      ...manifest,
      migrations: [...(manifest.migrations ?? []), { id: 'to_next', fromVersion: version, toVersion: nextVersion, operations: [] }],
    }))
    const said = await deploy()
    expect(said).toContain(`${name} ${version}: its files changed; re-pinned to them`)
    expect(said).toContain(`upgraded ${name} from ${version} to ${nextVersion}`)
    const [row] = await sql`select package_version from installed_app where name = ${name}`
    expect(row.package_version).toBe(nextVersion)
  })
})

// #943: the staging switch hung for 17 minutes. The deploy's transaction had
// saved a Scheduled Job row; the live server's job runner, holding the shared
// app lifecycle lock, waited on that row; then the deploy asked for the
// exclusive lifecycle lock (discoverPackages, in the re-pin) and waited on the
// runner. Postgres sees no cycle (the deploy waits in Node, not in SQL), and
// every live /api request queued behind the exclusive request.
/** A live request: holds the shared lifecycle lock until `end()`. */
async function sharedHolder() {
  const conn = postgres(config.databaseUrl, { max: 1, prepare: false, onnotice: () => {} })
  let release!: () => void
  let held!: () => void
  const holding = new Promise<void>((done) => { held = done })
  const done = conn.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock_shared(296, 1)`
    held()
    await new Promise<void>((r) => { release = r })
  })
  await holding
  return { end: async () => { release(); await done; await conn.end() } }
}

/** How long, in ms, a new request waits for the shared lifecycle lock. */
async function timeSharedLock() {
  const conn = postgres(config.databaseUrl, { max: 1, prepare: false, onnotice: () => {} })
  const started = performance.now()
  await conn.begin((tx) => tx`select pg_advisory_xact_lock_shared(296, 1)`)
  const waited = performance.now() - started
  await conn.end()
  return waited
}

async function waitingForExclusive() {
  for (let i = 0; i < 100; i++) {
    const [row] = await sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = 296 and objid = 1 and mode = 'ExclusiveLock' and not granted
      and database = (select oid from pg_database where datname = current_database())`
    if (row.n > 0) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('no deploy is waiting for the lock')
}

describe('a live server working while the deploy runs (#943)', () => {
  test('a live job waiting on a row the deploy saves does not hang it', async () => {
    await pretendTo('staging')
    const [before] = await sql`select enabled, now() as at from scheduled_job where row_id = 'check_sla'`
    await sql`update scheduled_job set enabled = false where row_id = 'check_sla'`
    const live = mkdtempSync(join(import.meta.dirname, '.deploy-instance-'))
    mkdirSync(join(live, 'client-apps/acme/instances/board'), { recursive: true })
    writeFileSync(join(live, 'client-apps/acme/instances/board/instance-settings.json'), JSON.stringify({
      settings: {}, environments: { dev: { settings: { 'Scheduled Job': [{ row_id: 'check_sla', enabled: true }] } } },
    }))
    // The live server's job runner: the shared lifecycle lock (296, 1, as in
    // app-lifecycle.ts), then its run recorded on the job's row.
    const runner = postgres(config.databaseUrl, { max: 1, prepare: false, onnotice: () => {},
      connection: { search_path: 'featherbase', application_name: 'live-job-runner-943' } })
    let stop = false
    const running = (async () => {
      while (!stop) await runner.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock_shared(296, 1)`
        await tx`update scheduled_job set last_run_at = now() where row_id = 'check_sla'`
      })
    })()
    let timer: NodeJS.Timeout | undefined
    try {
      const out = captureIO()
      const hung = new Promise<'hung'>((done) => { timer = setTimeout(() => done('hung'), 15_000) })
      const outcome = await Promise.race([deployInstance('acme/board', out.io, { root: live }).then(() => 'deployed'), hung])
      expect(outcome).toBe('deployed')
      expect(out.stdout()).toContain('Scheduled Job check_sla enabled')
      expect((await sql`select enabled from scheduled_job where row_id = 'check_sla'`)[0].enabled).toBe(true)
    } finally {
      clearTimeout(timer)
      stop = true
      // A hung run leaves the runner waiting forever; end it so the file finishes.
      await sql`select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'live-job-runner-943'`
      await running.catch(() => {})
      await runner.end({ timeout: 1 })
      await sql`update scheduled_job set enabled = ${before.enabled} where row_id = 'check_sla'`
      // Switching the job on queued a run; left queued, a later file drains it.
      await sql`delete from background_job where method = 'check_sla' and created_at >= ${before.at}`
      rmSync(live, { recursive: true, force: true })
    }
  }, 30_000)

  test('a live request that keeps the apps busy fails the deploy after its tries, changing nothing', async () => {
    await pretendTo('staging')
    const busy = await sharedHolder()
    const alsoBusy = await sharedHolder()
    const out = captureIO()
    try {
      await expect(deployInstance('acme/board', out.io, { root, lockWait: { attemptSeconds: 0.2, pauseSeconds: 0.1, attempts: 2 } }))
        .rejects.toThrow(/kept the apps busy for 1 seconds, so the deploy did not start; nothing changed\. Deploy again\./)
      expect(await sql`select 1 from installed_app where name = ${name}`).toHaveLength(0)
      expect(out.stdout()).toMatch(/try 1 of 2.*still busy.*trying again in 0\.1 seconds/)
      expect(out.stdout()).toMatch(/try 2 of 2.*still busy \(2 live requests or jobs/)
    } finally { await busy.end(); await alsoBusy.end() }
  })

  test('a deploy tries again by itself and goes ahead once the live request ends', async () => {
    await pretendTo('staging')
    const busy = await sharedHolder()
    const out = captureIO()
    const lines: string[] = []
    const io = { ...out.io, out: (line: string) => {
      lines.push(line)
      out.io.out(line)
      // The live request ends during the first pause.
      if (/try 1 of/.test(line)) void busy.end()
    } }
    await deployInstance('acme/board', io, { root, lockWait: { attemptSeconds: 0.2, pauseSeconds: 0.2, attempts: 5 } })
    expect(lines.join('\n')).toMatch(/try 1 of 5.*still busy \(1 live request or job/)
    expect(lines.join('\n')).toMatch(/lock taken on try 2/)
    expect(await sql`select 1 from installed_app where name = ${name}`).toHaveLength(1)
  })

  test('between tries a new request runs at once; during a try it waits behind the deploy', async () => {
    const busy = await sharedHolder()
    let paused!: () => void
    const pausing = new Promise<void>((done) => { paused = done })
    const deploy = instanceDeployOperation(async () => 'ran', { attemptSeconds: 0.5, pauseSeconds: 2, attempts: 2 }, () => paused())
    try {
      // A try is waiting: Postgres queues a new shared request behind it, so
      // the request stalls until the try gives up (the stall #971 asked about).
      await waitingForExclusive()
      const during = await timeSharedLock()
      expect(during).toBeGreaterThan(150)
      // The try gave up and the deploy is pausing: nothing queues.
      await pausing
      expect(await timeSharedLock()).toBeLessThan(150)
    } finally { await busy.end() }
    await expect(deploy).resolves.toBe('ran')
  })

  test('a lock wait inside the deploy is not mistaken for the lifecycle lock being busy', async () => {
    let runs = 0
    const wait = { attemptSeconds: 1, pauseSeconds: 0, attempts: 3 }
    await expect(instanceDeployOperation(async () => {
      runs++
      throw Object.assign(new Error('a row lock timed out'), { code: '55P03' })
    }, wait)).rejects.toThrow('a row lock timed out')
    expect(runs).toBe(1)
  })

  test('the standing wait is about ten minutes', () => {
    const { attemptSeconds, pauseSeconds, attempts } = DEPLOY_LOCK_WAIT
    const total = attempts * attemptSeconds + (attempts - 1) * pauseSeconds
    expect(total).toBeGreaterThan(9 * 60)
    expect(total).toBeLessThanOrEqual(10 * 60)
    expect(attemptSeconds).toBeLessThanOrEqual(15)
  })

  test('the deploy lock is taken outside any other app operation, with a wait Postgres accepts', async () => {
    const wait = { attemptSeconds: 1, pauseSeconds: 0, attempts: 1 }
    await expect(appOperation(() => instanceDeployOperation(async () => 1, wait))).rejects.toThrow(/cannot run inside another app operation/)
    await expect(instanceDeployOperation(async () => 1, { ...wait, attemptSeconds: -1 })).rejects.toThrow(/lock_timeout/)
    // Inside a deploy, an install may nest; inside a data operation it may not.
    await expect(instanceDeployOperation(() => appOperation(async () => 'nested', true), wait)).resolves.toBe('nested')
    await expect(appOperation(() => appOperation(async () => 1, true))).rejects.toThrow(/cannot run inside a data operation/)
    await expect(instanceDeployOperation(async () => 'ran', wait)).resolves.toBe('ran')
  })
})
