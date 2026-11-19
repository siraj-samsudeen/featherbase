import { Hono } from 'hono'
import { sql } from './db'
import { AppError } from './errors'
import { buildInfo } from './build-info'
import { assertSystemManager } from './permissions'
import { recordAppAccessRefusal } from './app-access'
import { installApp, installAppFromManifest, uninstallApp, listInstalledApps, getAvailableApps, setAppEnabled } from './apps'
import { appCatalog, closedApps, appBar, packageFailures, runPackageAction, runPublicPackageRead, runPackageAnalysis, askPackageQuestion, earlierPackageQuestions, forgetPackageQuestions, declaredPackageActions, previewAppUpgrade, upgradeApp, activateAppUpgrade, availableRuntimeVersions } from './runtime-packages'
import { appLibraryCatalog, prepareAndInstallApp } from './app-library'
import { activeRuntimeVersions, appOperation } from './app-lifecycle'
import { who, type Env } from './route-context'
import { answerHelp } from './help'
import { chatModes, chatRequests, chatSession, chatSessions, closeChatSession, decideChatRequest, sendChat } from './app-chat'
import { usageReport } from './model-usage'
import { activeViewAs } from './view-as'
import { explainRecord, whyOffer } from './why'
import { workedOutFor } from './worked-out'

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
// #1353: questions are asked and answered only as the signed-in person. While a tester views as someone these
// routes would run as the tester (view-as.ts runs only reads as the person viewed), so a chat beside the viewed
// person's report would answer with the tester's own figures and conversations. They are refused until the
// tester exits View As (Codex adversarial round 1).
for (const path of ['/api/app_analyses/*', '/api/app_questions/*', '/api/app_chat/*', '/api/help/ask'])
  appRoutes.use(path, async (c, next) => {
    if (await activeViewAs(c.get('user'), { told: false }))
      throw new AppError('PermissionError', 'Questions are asked only as yourself. Exit View As to ask.')
    return next()
  })
// A plan answered from one of the app's semantic models, as the read the
// model names.
appRoutes.post('/api/app_analyses/:app/:model', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await runPackageAnalysis(c.req.param('app'), c.req.param('model'), await c.req.json(), who(c)))
})
// A question in words, turned into a plan for that model and answered as one.
// The platform keeps the asker's questions, so a follow-up carries on from them.
appRoutes.post('/api/app_questions/:app/:model', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await askPackageQuestion(c.req.param('app'), c.req.param('model'), await c.req.json(), who(c)))
})
appRoutes.post('/api/app_questions/:app/:model/earlier', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await earlierPackageQuestions(c.req.param('app'), c.req.param('model'), who(c)))
})
appRoutes.post('/api/app_questions/:app/:model/start_over', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await forgetPackageQuestions(c.req.param('app'), c.req.param('model'), who(c)))
})
// An app's chat panel: the modes this person holds, their conversations, and
// what they say in a mode, answered by the tool that mode names.
appRoutes.post('/api/app_chat/:app/modes', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await chatModes(c.req.param('app'), who(c)))
})
appRoutes.post('/api/app_chat/:app/sessions', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await chatSessions(c.req.param('app'), who(c)))
})
appRoutes.post('/api/app_chat/:app/sessions/:id', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await chatSession(c.req.param('app'), c.req.param('id'), who(c)))
})
appRoutes.post('/api/app_chat/:app/sessions/:id/close', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await closeChatSession(c.req.param('app'), c.req.param('id'), who(c)))
})
appRoutes.post('/api/app_chat/:app/send', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await sendChat(c.req.param('app'), await c.req.json(), who(c)))
})
// Requests sent through the chat's Action mode: the person's own and, for a
// reviewer, those waiting; and a reviewer's decision on one.
appRoutes.post('/api/app_chat/:app/requests', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await chatRequests(c.req.param('app'), who(c)))
})
appRoutes.post('/api/app_chat/:app/requests/:id/decide', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await decideChatRequest(c.req.param('app'), c.req.param('id'), await c.req.json(), who(c)))
})
// What the language model has used this month against the instance's allowance.
appRoutes.post('/api/analyst/usage', async (c) => {
  c.header('Cache-Control', 'no-store')
  await assertSystemManager(who(c))
  return c.json(await usageReport())
})
// A question about how things work, answered from the help folder with its sources.
appRoutes.post('/api/help/ask', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await answerHelp(await c.req.json()))
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
