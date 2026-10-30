// #703: a client instance's deploy step. The cases change an app's folder on
// disk and rerun the step, as a new image would.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { uninstallApp } from '../src/apps'
import { sql } from '../src/db'
import { deployInstance, followsAppFiles, instanceFolder, repinChangedApps, settingsSection } from '../src/deploy-instance'
import { assertInstalledAppsShipped } from '../src/release-preflight'
import { discoverPackages } from '../src/runtime-packages'
import { captureIO } from './command-io'
import '../src/index'

const test = it

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

  it('only a staging server on a staging database follows files', () => {
    expect(followsAppFiles('staging', 'staging')).toBe(true)
    expect(followsAppFiles('production', 'production')).toBe(false)
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
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
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
  test('never re-pins: a code change needs a version bump', async () => {
    await pretendTo('production')
    await deploy()
    const before = await digest()
    writeFileSync(join(app, 'NOTES.md'), 'a file changed\n')
    await expect(assertInstalledAppsShipped({ followFiles: followsAppFiles('production', 'production') }))
      .rejects.toThrow(new RegExp(`App ${name} version ${version}: its files changed.*production never re-pins.*Bump the version`))
    const out = captureIO()
    await expect(repinChangedApps(out.io)).rejects.toThrow(/production needs a new version/)
    // Past the preflight, the step still leaves the install alone.
    await deploy()
    expect(await digest()).toBe(before)
  })

  test('applies the prod section', async () => {
    await pretendTo('production')
    expect(await deploy()).toContain('Board on prod')
  })
})

describe('a newer version in the image', () => {
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
    await expect(assertInstalledAppsShipped({ followFiles: true })).rejects.toThrow(/does not ship it.*previousVersions/)
  })
})
