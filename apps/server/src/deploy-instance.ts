// #703: what a client instance's pre-deploy does after the release (migrations):
// install its apps or upgrade them, apply its settings, and, on a dev instance
// only, re-pin an app whose files changed under the same version. Anything that
// goes wrong throws, which fails the deploy, so the old deployment keeps serving.
// `pnpm dev` is the same path on a developer's machine.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { format } from 'node:util'
import { compareVersions } from './runtime-migrations'
import type { CommandIO } from './command-io'
import { sql } from './db'
import { storedEnvironment } from './db-environment'
import { currentEnvironment, readVariable } from './env'

const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const INSTANCE_NAME = /^[a-z0-9_-]+\/[a-z0-9_-]+$/

/** The settings file's section for a hosted environment. */
const SECTIONS: Record<string, string> = { staging: 'dev', production: 'prod' }

export function settingsSection(environment = currentEnvironment()): string {
  const section = SECTIONS[environment]
  if (!section)
    throw new Error(`FEATHERBASE_INSTANCE is set on a "${environment}" server. An instance deploys as staging (its dev) or production (its prod); on a developer's machine use pnpm dev.`)
  return section
}

/** The folder this image holds for the instance, and its settings file. */
export function instanceFolder(instance: string, root = REPO_ROOT) {
  const folder = INSTANCE_NAME.test(instance) ? join(root, 'client-apps', instance.split('/')[0], 'instances', instance.split('/')[1]) : ''
  const settingsFile = join(folder, 'instance-settings.json')
  if (!folder || !existsSync(settingsFile))
    throw new Error(`This image holds no instance "${instance}". Build it with the build argument FEATHERBASE_INSTANCE=${instance}, naming a folder under client-apps/<client>/instances/.`)
  return { folder, settingsFile }
}

/** A dev instance follows its apps' files; production never does: there a code
 *  change needs a new version. Both the server and the database must say so. */
export function followsAppFiles(environment: string, stamp: string | null): boolean {
  return environment === 'staging' && stamp === 'staging'
}

export function unshippedRefusal(name: string, version: string, reason: 'files' | 'manifest' | 'absent'): string {
  if (reason === 'manifest')
    return `App ${name} version ${version}: its manifest (featherbase.json) changed, but its version did not. Bump the version, with a migration from ${version}, and deploy again.`
  if (reason === 'files')
    return `App ${name} version ${version}: its files changed, but its version did not, and production never re-pins. Bump the version, with a migration from ${version}, and deploy again.`
  return `App ${name} version ${version} is installed and enabled, but this release does not ship it. To upgrade from it, list it under previousVersions in the instance's instance.json so that the image holds both; or disable the app before releasing.`
}

/** Re-pin every installed, enabled app whose files changed under the same
 *  version and manifest. Throws, naming the app, for any other difference. */
export async function repinChangedApps(io: CommandIO): Promise<void> {
  const stamp = await storedEnvironment()
  const environment = currentEnvironment()
  if (environment === 'production' || (stamp !== 'development' && stamp !== 'staging'))
    throw new Error(`This is a "${environment}" server on a database labelled "${stamp ?? 'nothing'}". Re-pinning is for a development or dev (staging) database; production needs a new version.`)
  const { discoverPackages, repinToFolder, whyUnshipped } = await import('./runtime-packages')
  const paths = JSON.parse(readVariable('FEATHERBASE_APP_PATHS') ?? '[]') as string[]
  await discoverPackages(paths)
  const rows = await sql`select name, package_version, artifact_digest, manifest from installed_app
    where runtime_package and enabled and package_version is not null order by name`
  for (const row of rows) {
    const name = String(row.name)
    const outcome = await repinToFolder(name, true)
    if (outcome === 'different') throw new Error(unshippedRefusal(name, String(row.package_version), await whyUnshipped(row, paths)))
    if (outcome === 'repinned') io.out(`${name} ${String(row.package_version)}: its files changed; re-pinned to them`)
  }
}

/** Each app the image ships: installed if missing, upgraded if a newer version
 *  ships. Every step is safe to repeat after a failed deploy. */
async function installOrUpgradeApps(io: CommandIO) {
  const { availableRuntimeVersions, discoverPackages, previewAppUpgrade, upgradeApp, activateAppUpgrade } = await import('./runtime-packages')
  const { installApp } = await import('./apps')
  const failures = await discoverPackages(JSON.parse(readVariable('FEATHERBASE_APP_PATHS') ?? '[]') as string[])
  if (failures.length) throw new Error(failures.map((f) => `The app at ${f.path} was rejected: ${f.error}`).join('\n'))
  const shipped = availableRuntimeVersions()
  if (!shipped.length) throw new Error('This image ships no app. Check FEATHERBASE_APP_PATHS and instance.json.')
  for (const name of [...new Set(shipped.map((app) => app.name))]) {
    const [row] = await sql`select enabled, package_version, activation_pending from installed_app where name = ${name}`
    if (!row) {
      await installApp(name)
      io.out(`installed ${name}`)
      continue
    }
    if (!row.enabled) {
      io.out(`${name} is disabled; left as it is`)
      continue
    }
    const installed = String(row.package_version)
    if (row.activation_pending) {
      await activateAppUpgrade(name, installed)
      io.out(`activated ${name} ${installed}`)
    }
    const newest = shipped.filter((app) => app.name === name && compareVersions(app.version, installed) > 0).at(-1)
    if (!newest) {
      io.out(`${name} ${installed} is already installed`)
      continue
    }
    const plan = await previewAppUpgrade(name, newest.version)
    await upgradeApp(name, newest.version, plan.planId)
    await activateAppUpgrade(name, newest.version)
    io.out(`upgraded ${name} from ${installed} to ${newest.version}`)
  }
}

/** The instance's part of a deploy. Runs after the release, so the platform is
 *  migrated. The re-pin comes last: until then, a failure leaves the database
 *  matching the deployment that is still serving. */
export async function deployInstance(instance: string, io: CommandIO, opts: { root?: string } = {}): Promise<void> {
  const section = settingsSection()
  const { settingsFile } = instanceFolder(instance, opts.root)
  await sql.begin(async (tx) => {
    // Held for the whole step, so two overlapping deploys take turns.
    await tx`select pg_advisory_xact_lock(hashtext('featherbase-instance-deploy'))`
    await installOrUpgradeApps(io)
    const cli = await import('./cli')
    const code = await cli.main(['settings:apply', '--file', settingsFile, '--environment', section], io)
    if (code !== 0) throw new Error(format('the settings file was not applied; see above'))
    if (followsAppFiles(currentEnvironment(), await storedEnvironment())) await repinChangedApps(io)
  })
}
