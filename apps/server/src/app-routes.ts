import { Hono } from 'hono'
import { sql } from './db'
import { AppError } from './errors'
import { buildInfo } from './build-info'
import { assertSystemManager } from './permissions'
import { recordAppAccessRefusal } from './app-access'
import { installApp, installAppFromManifest, uninstallApp, listInstalledApps, getAvailableApps, setAppEnabled } from './apps'
import { appCatalog, closedApps, appBar, packageFailures, runPackageAction, runPublicPackageRead, declaredPackageActions, previewAppUpgrade, upgradeApp, activateAppUpgrade, availableRuntimeVersions } from './runtime-packages'
import { appLibraryCatalog, prepareAndInstallApp } from './app-library'
import { activeRuntimeVersions, appOperation } from './app-lifecycle'
import { who, type Env } from './route-context'
import { explainRecord, whyOffer } from './why'
import { describeRows, previewAction } from './record-facts'
import { workedOutFor } from './worked-out'
import { checkStandInFile, listDatasets, loadStandIn, switchToWarehouse } from './dataset-stand-in'

export const appRoutes = new Hono<Env>()

// PLAT-001: app management (System Manager only). Apps are code-defined; these
// install/uninstall their Tables + doc_events and report installed state.
appRoutes.get('/api/apps', async (c) => {
  await assertSystemManager(who(c))
  c.header('Cache-Control', 'no-store')
  return c.json({ build: buildInfo(), available: getAvailableApps(), installed: await listInstalledApps(), versions: availableRuntimeVersions(), actions: declaredPackageActions(), catalog: await appLibraryCatalog(),
    failures: packageFailures.map(() => ({ error: 'A configured artifact failed validation. Restore a compatible immutable package and inspect the server discovery log' })) })
})
appRoutes.post('/api/apps/prepare-install', async c => {
  await assertSystemManager(who(c))
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || !/^[a-z][a-z0-9_]{0,30}$/.test(body.name) || Object.keys(body).some(key => key !== 'name'))
    throw new AppError('ValidationError', 'Expected { name } naming an app in the catalog; paths and commands are not accepted')
  return c.json(await prepareAndInstallApp(body.name), 201)
})
appRoutes.get('/api/app_catalog', async (c) => c.json(await appCatalog(who(c))))
appRoutes.get('/api/app_catalog/closed', async (c) => {
  await assertSystemManager(who(c))
  return c.json(await closedApps(who(c)))
})

// #642 (E8): the controls an app declared for the shared top bar, filled for
// this person.
appRoutes.get('/api/app_bar/:app', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await appBar(c.req.param('app'), who(c), c.req.query()))
})
// Authenticated bootstrap contains identities only, never manager metadata.
appRoutes.get('/api/runtime_app_versions', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await activeRuntimeVersions())
})
appRoutes.post('/api/app_actions/:app/:action', async (c) =>
  c.json(await runPackageAction(c.req.param('app'), c.req.param('action'), await c.req.json(), who(c))))
appRoutes.post('/api/app_reads/:app/:read', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await runPublicPackageRead(c.req.param('app'), c.req.param('read'), await c.req.json(), who(c)))
})
// #1282 C10–C11: the record panel's worked-out sections, an installed app's answer about one record.
appRoutes.get('/api/worked-out/:table/:row', async (c) => c.json(await workedOutFor(c.req.param('table'), c.req.param('row'), who(c))))
// #1282 Why mode: whether the Map offers Why for a record, and the app's checked explanation.
appRoutes.get('/api/why/:table/:row', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await whyOffer(c.req.param('table'), c.req.param('row'), who(c)))
})
appRoutes.get('/api/why/:table/:row/explain', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await explainRecord(c.req.param('table'), c.req.param('row'), who(c)))
})
// #1340: an app's facts about rows of its Table (the list's columns and Record actions, the record page's
// header and Links groups), and the preview of one of its actions before it runs.
appRoutes.post('/api/records/:table/describe', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await describeRows(c.req.param('table'), await c.req.json().catch(() => null), who(c)))
})
appRoutes.get('/api/records/:table/preview/:action', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await previewAction(c.req.param('table'), c.req.param('action'), who(c)))
})
appRoutes.get('/api/app_reads/:app/:read/access', async (c) => {
  c.header('Cache-Control', 'no-store')
  if (new URL(c.req.url).search || (await c.req.text()).length)
    return recordAppAccessRefusal(who(c), c.req.param('app'), c.req.param('read'), 'override')
  return c.json(await runPublicPackageRead(c.req.param('app'), c.req.param('read'), undefined, who(c), true))
})
for (const operation of ['preview_app_upgrade', 'upgrade_app', 'activate_app_upgrade'] as const) {
  appRoutes.post(`/api/${operation}`, async c => {
    await assertSystemManager(who(c))
    const body = await c.req.json().catch(() => ({}))
    if (typeof body.name !== 'string' || typeof body.version !== 'string' ||
        (operation === 'upgrade_app' && typeof body.planId !== 'string'))
      throw new AppError('ValidationError', 'Expected application name, target version and reviewed planId for upgrade')
    if (operation === 'preview_app_upgrade') return c.json(await previewAppUpgrade(body.name, body.version))
    if (operation === 'upgrade_app') return c.json(await upgradeApp(body.name, body.version, body.planId, who(c)))
    return c.json(await activateAppUpgrade(body.name, body.version))
  })
}
appRoutes.post('/api/set_app_enabled', async (c) => {
  await assertSystemManager(who(c))
  const body = await c.req.json()
  if (typeof body.name !== 'string' || typeof body.enabled !== 'boolean')
    throw new AppError('ValidationError', 'Expected { name, enabled: boolean }')
  return c.json(await setAppEnabled(body.name, body.enabled))
})
// Accepts { name } for a code-registered app, or { manifest } — a declarative
// manifest of Tables, roles and permissions installed as pure data (#55).
// System Manager only, and deliberately so: { manifest } lets the caller
// define schema, so this endpoint is a create-arbitrary-tables surface.
appRoutes.post('/api/install_app', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; manifest?: unknown }
  if (body.manifest !== undefined) return c.json(await installAppFromManifest(body.manifest), 201)
  if (!body.name) throw new AppError('ValidationError', 'Expected { name } or { manifest }')
  return c.json(await installApp(body.name), 201)
})
appRoutes.post('/api/uninstall_app', async (c) => {
  await assertSystemManager(who(c))
  const { name } = (await c.req.json().catch(() => ({}))) as { name?: string }
  if (!name) throw new AppError('ValidationError', 'Expected { name }')
  return appOperation(async () => {
    const [installed] = await sql`select runtime_package from installed_app where name = ${name}`
    if (installed?.runtime_package)
      throw new AppError('ValidationError', 'Use disable. Removing applications and deleting their data are separate, unsupported operations')
    return c.json(await uninstallApp(name))
  }, true)
})

// #1409: stand-in datasets (System Manager only). Every installed app's
// datasets and where each is served from; checking and loading a CSV as a
// dataset's stand-in; and switching a dataset to the warehouse.
appRoutes.get('/api/datasets', async (c) => {
  await assertSystemManager(who(c))
  c.header('Cache-Control', 'no-store')
  return c.json(await listDatasets())
})
const DELIMITERS = [',', '\t', ';']
const optionalText = (value: unknown) => value === undefined || value === null || typeof value === 'string'
/** A stand-in file from a request body: the CSV text, and how its cells are separated. */
async function standInFile(request: { json(): Promise<unknown> }) {
  const body = (await request.json().catch(() => null)) as { csv?: unknown; delimiter?: unknown; note?: unknown; expected_by?: unknown } | null
  if (!body || typeof body.csv !== 'string' || (body.delimiter !== undefined && !DELIMITERS.includes(body.delimiter as string)) || !optionalText(body.note) || !optionalText(body.expected_by))
    throw new AppError('ValidationError', 'Expected { csv } holding the file as CSV text, with an optional delimiter (",", a tab or ";"), note and expected_by (YYYY-MM-DD)')
  return body as { csv: string; delimiter?: ',' | '\t' | ';'; note?: string | null; expected_by?: string | null }
}
appRoutes.post('/api/datasets/:app/:dataset/check_stand_in', async (c) => {
  await assertSystemManager(who(c))
  return c.json(await checkStandInFile(c.req.param('app'), c.req.param('dataset'), await standInFile(c.req)))
})
appRoutes.post('/api/datasets/:app/:dataset/load_stand_in', async (c) => {
  await assertSystemManager(who(c))
  return c.json(await loadStandIn(c.req.param('app'), c.req.param('dataset'), await standInFile(c.req), who(c)), 201)
})
appRoutes.post('/api/datasets/:app/:dataset/switch_to_warehouse', async (c) => {
  await assertSystemManager(who(c))
  return c.json(await switchToWarehouse(c.req.param('app'), c.req.param('dataset'), who(c)))
})
