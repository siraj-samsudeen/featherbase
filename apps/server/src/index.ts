import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { config } from './config'
import { sql } from './db'
import { AppError, errorResponse } from './errors'
import { getMeta } from './meta'
import { createDocType, updateDocType } from './doctype-engine'
import { amendDoc, cancelDoc, deleteDoc, getDoc, renameDoc, saveDoc, submitDoc } from './document'
import { countDocs, getList, groupCount } from './query'
import { loadControllers } from './controllers'
import { generateApiKeys, login, resolveToken, revokeApiKeys, setUserPassword, type SessionUser } from './auth'
import { assertPermission, assertSystemManager, getRoles } from './permissions'
import { readStored, saveUpload, signFileUrl, verifyFileSignature } from './storage'
import { globalSearch } from './search'
import { callMethod, loadMethods, methodAllowsGuest } from './methods'
import { renderPdf, renderPrintHtml } from './print'
import { applyWorkflowAction, availableActions, currentState, getActiveWorkflow } from './workflow'
import { reapplyCustomFields } from './custom-fields'
import { enqueue, loadJobs, startWorker } from './jobs'
import { attachRealtime, publishDocEvent, publishUserEvent } from './realtime'
import { queueEmail, sendTestEmail } from './email'
import { getSystemSettings } from './settings'
import { requestPasswordReset, resetPassword } from './password-reset'
import { renderWebPage } from './website'
import { getWebFormConfig, submitWebForm } from './webform'
import { logAccess } from './audit'
import { runApiScript } from './server-scripts'
import { exportCustomizations, importCustomizations } from './customizations'
import { rateLimit } from './rate-limit'
import { parseFilters, runQueryReport } from './query-report'
import { loadScriptReports, runScriptReport, scriptReportMeta } from './script-report'
import { randomBytes } from 'node:crypto'

await loadControllers()
await loadMethods()
await loadJobs()
await loadScriptReports()
// CUST-001: re-apply custom fields so they survive a core re-seed.
await reapplyCustomFields()

type Env = { Variables: { user: SessionUser } }

export const app = new Hono<Env>()

app.onError((err, c) => errorResponse(c, err))

// API-006: even unknown routes answer with the error envelope.
app.notFound((c) =>
  c.json({ error: { type: 'NotFoundError', message: `Route not found: ${c.req.method} ${c.req.path}` } }, 404),
)

// API-008: CORS restricted to the Desk origin(s) + standard security
// headers. Runs before auth so preflight OPTIONS (which carries no
// Authorization header) is answered here.
app.use('*', secureHeaders())
app.use(
  '/api/*',
  cors({
    origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }),
)

// ---- Public routes (no session required) -----------------------------------

app.get('/api/ping', async (c) => {
  const [row] = await sql`select 1 as ok`
  return c.json({ message: 'pong', db: row.ok === 1 })
})

app.post('/api/login', async (c) => {
  const { usr, pwd } = (await c.req.json()) as { usr?: string; pwd?: string }
  if (!usr || !pwd) throw new AppError('ValidationError', 'Expected { usr, pwd }')
  return c.json(await login(usr, pwd))
})

// SET-002: password reset (public — the caller is logged out). The request
// always returns ok so it can't be used to probe which accounts exist.
app.post('/api/reset_password_request', async (c) => {
  const { usr } = (await c.req.json().catch(() => ({}))) as { usr?: string }
  if (!usr) throw new AppError('ValidationError', 'Expected { usr }')
  await requestPasswordReset(usr)
  return c.json({ ok: true })
})

app.post('/api/reset_password', async (c) => {
  const { key, new_password } = (await c.req.json().catch(() => ({}))) as {
    key?: string
    new_password?: string
  }
  await resetPassword(key ?? '', new_password ?? '')
  return c.json({ ok: true })
})

// FILE-001: serve stored files. Only files registered as a File doc are
// readable. Public bucket needs no session; the private bucket accepts a
// bearer header or ?token= (so <img src> and download links work).
async function serveFile(c: Context<Env>, fileUrl: string, isPrivate: boolean) {
  const [row] = await sql`
    select name, file_name, mime_type, ref_doctype, ref_name
    from tab_file where file_url = ${fileUrl}`
  if (!row) throw new AppError('NotFoundError', `File not found: ${fileUrl}`)

  // FILE-003: private files require either a valid signed URL (minted after a
  // permission check) or a session that can read the linked document. A user
  // without read on that document gets a 403.
  if (isPrivate) {
    const signed = verifyFileSignature(fileUrl, c.req.query('expires'), c.req.query('signature'))
    if (!signed) {
      const token = c.req.query('token')
      const user = await resolveToken(
        c.req.header('authorization') ?? (token ? `Bearer ${token}` : undefined),
      )
      if (row.ref_doctype && row.ref_name)
        await getDoc(row.ref_doctype as string, row.ref_name as string, user.name)
      else await getDoc('File', row.name as string, user.name)
    }
  }

  const content = await readStored(fileUrl)
  return c.body(new Uint8Array(content), 200, {
    'content-type': (row.mime_type as string) || 'application/octet-stream',
    'content-disposition': `inline; filename="${(row.file_name as string).replace(/"/g, '')}"`,
  })
}

app.get('/files/:stored', (c) => serveFile(c, `/files/${c.req.param('stored')}`, false))
app.get('/private/files/:stored', (c) =>
  serveFile(c, `/private/files/${c.req.param('stored')}`, true),
)

// WEB-002: public web-form config + submit (no session — anonymous forms).
// Registered before the auth middleware. Only whitelisted fields of the
// configured DocType are accepted; server validation still runs.
app.get('/api/web_form/:route', async (c) => {
  return c.json(await getWebFormConfig(c.req.param('route')))
})

app.post('/api/web_form/:route', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { values?: Record<string, unknown> }
  return c.json(await submitWebForm(c.req.param('route'), body.values ?? {}), 201)
})

// WEB-001: public, server-rendered Web Pages. No session required; only
// published pages render (others 404). Path may contain slashes.
app.get('/web/:route{.+}', async (c) => {
  const page = await renderWebPage(c.req.param('route'))
  return c.html(page.html, page.found ? 200 : 404)
})

// API-003: RPC for whitelisted server methods. Registered before the auth
// middleware so guest-allowed methods work without a session; every other
// method resolves the caller's token. Path may contain slashes.
app.on(['GET', 'POST'], '/api/method/:path{.+}', async (c) => {
  const path = c.req.param('path')
  const user = methodAllowsGuest(path)
    ? { name: 'Guest', email: 'guest@example.com', full_name: 'Guest' }
    : await resolveToken(c.req.header('authorization'))
  const args =
    c.req.method === 'POST'
      ? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>)
      : c.req.query()
  return c.json({ message: await callMethod(path, args, user) })
})

// ---- API-004: everything below requires a valid session --------------------

app.use('/api/*', async (c, next) => {
  const user = await resolveToken(c.req.header('authorization'))
  c.set('user', user)
  await next()
})

// API-007: throttle authenticated requests per user (runs after auth so it can
// key by the resolved user and read their budget).
app.use('/api/*', rateLimit)

const who = (c: { get: (k: 'user') => SessionUser }) => c.get('user').name

app.get('/api/whoami', async (c) => {
  const user = c.get('user')
  const [row] = await sql`select theme from tab_user where name = ${user.name}`
  return c.json({
    ...user,
    roles: await getRoles(user.name),
    theme: (row?.theme as string) || 'light',
  })
})

// UI-024: persist the caller's theme preference (light/dark), per user.
app.post('/api/set_theme', async (c) => {
  const { theme } = (await c.req.json().catch(() => ({}))) as { theme?: string }
  if (theme !== 'light' && theme !== 'dark')
    throw new AppError('ValidationError', 'theme must be "light" or "dark"')
  await sql`update tab_user set theme = ${theme} where name = ${who(c)}`
  return c.json({ ok: true, theme })
})

// SET-004: global display/formatting settings, readable by any signed-in
// user (they are not sensitive). The client formats dates and numbers with
// these. Editing them still goes through the guarded System Settings single.
app.get('/api/settings', async (c) => {
  const s = await getSystemSettings()
  return c.json({
    app_name: s.app_name,
    date_format: s.date_format,
    currency: s.currency,
    currency_precision: s.currency_precision,
    float_precision: s.float_precision,
  })
})

// Set a user's password. A user may set their own; a System Manager may set
// anyone's. Passwords never travel through the generic document API.
app.post('/api/set_password', async (c) => {
  const { user, password } = (await c.req.json()) as { user?: string; password?: string }
  const target = user ?? who(c)
  if (!password) throw new AppError('ValidationError', 'Expected { password }')
  if (target !== who(c)) await assertSystemManager(who(c))
  await setUserPassword(target, password)
  return c.json({ ok: true })
})

// API-005: generate/revoke integration keys. Users manage their own;
// System Managers can target any user via {user}.
app.post('/api/generate_api_key', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { user?: string }
  const target = body.user ?? who(c)
  if (target !== who(c)) await assertSystemManager(who(c))
  return c.json(await generateApiKeys(target), 201)
})

app.post('/api/revoke_api_key', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { user?: string }
  const target = body.user ?? who(c)
  if (target !== who(c)) await assertSystemManager(who(c))
  await revokeApiKeys(target)
  return c.json({ ok: true })
})

app.get('/api/meta/:doctype', async (c) => {
  const meta = await getMeta(c.req.param('doctype'))
  await assertPermission(who(c), meta.name, 'read')
  return c.json(meta)
})

app.post('/api/doctype', async (c) => {
  await assertSystemManager(who(c))
  const meta = await createDocType(await c.req.json())
  return c.json(meta, 201)
})

app.put('/api/doctype/:name', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as Record<string, unknown> & { drop_columns?: boolean }
  const { drop_columns, ...def } = body
  return c.json(await updateDocType(c.req.param('name'), def, { drop_columns }))
})

app.post('/api/save_doc', async (c) => {
  const body = (await c.req.json()) as { doctype?: string; doc?: Record<string, unknown> }
  if (!body.doctype || typeof body.doc !== 'object' || body.doc === null)
    throw new AppError('ValidationError', 'Expected { doctype, doc }')
  const hadName = Boolean(body.doc.name)
  const saved = await saveDoc(body.doctype, body.doc, who(c))
  publishDocEvent(body.doctype, String(saved.name), hadName ? 'updated' : 'created')
  return c.json(saved, 201)
})

app.get('/api/doc/:doctype/:name', async (c) => {
  return c.json(await getDoc(c.req.param('doctype'), c.req.param('name'), who(c)))
})

// PRN-003: server-side PDF of any document / print format.
app.get('/api/print/:doctype/:name', async (c) => {
  const format = c.req.query('format')
  const doctype = c.req.param('doctype')
  const name = c.req.param('name')
  const html = await renderPrintHtml(doctype, name, who(c), format)
  const pdf = await renderPdf(html)
  // PLAT-007: record the print/access.
  await logAccess(who(c), 'print', { doctype, name, method: 'pdf' })
  return c.body(new Uint8Array(pdf), 200, {
    'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${name.replace(/[^\w.-]/g, '_')}.pdf"`,
  })
})

// PLAT-007: the client records a data export here (CSV/XLSX are built in the
// browser, so the log is client-notified). Read permission is required on the
// exported DocType — you can only log an export of data you could read.
app.post('/api/access_log', async (c) => {
  const { doctype, method } = (await c.req.json().catch(() => ({}))) as {
    doctype?: string
    method?: string
  }
  if (!doctype) throw new AppError('ValidationError', 'Expected { doctype }')
  await assertPermission(who(c), doctype, 'read')
  await logAccess(who(c), 'export', { doctype, method: method ?? 'csv' })
  return c.json({ ok: true })
})

// FILE-001: multipart upload — writes the storage object, then creates the
// File doc through the normal save lifecycle (permissions included).
app.post('/api/upload_file', async (c) => {
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File))
    throw new AppError('ValidationError', 'Expected multipart form data with a "file" part')
  const isPrivate = body.is_private === '1' || body.is_private === 'true'
  const stored = await saveUpload(Buffer.from(await file.arrayBuffer()), file.name, isPrivate)
  const doc = await saveDoc(
    'File',
    {
      file_name: file.name,
      file_url: stored.file_url,
      mime_type: file.type || 'application/octet-stream',
      file_size: file.size,
      is_private: isPrivate,
      ...(typeof body.ref_doctype === 'string' && body.ref_doctype
        ? { ref_doctype: body.ref_doctype }
        : {}),
      ...(typeof body.ref_name === 'string' && body.ref_name ? { ref_name: body.ref_name } : {}),
    },
    who(c),
  )
  return c.json(doc, 201)
})

// FILE-003: mint a short-lived signed URL for a private file, but only after
// confirming the caller can read the document it is attached to. The returned
// URL then serves without a session (usable in an <img>/<a>). Public files
// need no signature and are returned as-is.
app.get('/api/signed_url', async (c) => {
  const fileUrl = c.req.query('file_url')
  if (!fileUrl) throw new AppError('ValidationError', 'Expected file_url')
  const [row] = await sql`
    select name, ref_doctype, ref_name from tab_file where file_url = ${fileUrl}`
  if (!row) throw new AppError('NotFoundError', `File not found: ${fileUrl}`)
  const user = who(c)
  if (fileUrl.startsWith('/private/files/')) {
    if (row.ref_doctype && row.ref_name)
      await getDoc(row.ref_doctype as string, row.ref_name as string, user)
    else await getDoc('File', row.name as string, user)
    return c.json({ signed_url: signFileUrl(fileUrl) })
  }
  return c.json({ signed_url: fileUrl })
})

// UI-026: dashboard widgets. A number card is a permission-scoped count; a
// chart is permission-scoped grouped counts. Both reuse the list query's
// scoping so a dashboard can never show data the user couldn't list.
app.post('/api/dashboard/count', async (c) => {
  const { doctype, filters } = (await c.req.json().catch(() => ({}))) as {
    doctype?: string
    filters?: [string, string, unknown][]
  }
  if (!doctype) throw new AppError('ValidationError', 'Expected { doctype }')
  return c.json({ count: await countDocs(doctype, filters ?? [], who(c)) })
})

app.post('/api/dashboard/chart', async (c) => {
  const { doctype, group_by, filters } = (await c.req.json().catch(() => ({}))) as {
    doctype?: string
    group_by?: string
    filters?: [string, string, unknown][]
  }
  if (!doctype || !group_by) throw new AppError('ValidationError', 'Expected { doctype, group_by }')
  return c.json({ data: await groupCount(doctype, group_by, filters ?? [], who(c)) })
})

// SET-003: role & permission manager. Reads/writes the DocPerm matrix for a
// DocType at permlevel 0. Editing permissions is System-Manager-only. Writes
// go through the normal save lifecycle, and permissionScope reads DocPerm live,
// so a change takes effect on the very next request.
const PERM_FLAGS = ['can_read', 'can_write', 'can_create', 'can_delete', 'can_submit', 'can_cancel', 'can_amend'] as const

app.get('/api/permissions/:doctype', async (c) => {
  await assertSystemManager(who(c))
  const doctype = c.req.param('doctype')
  const roles = (await sql`select name from tab_role order by name`).map((r) => r.name as string)
  const perms = await sql`
    select name, role, ${sql(PERM_FLAGS as unknown as string[])}
    from tab_docperm where ref_doctype = ${doctype} and permlevel = 0 order by role`
  return c.json({ doctype, roles, perms })
})

app.post('/api/permissions/:doctype', async (c) => {
  const user = who(c)
  await assertSystemManager(user)
  const doctype = c.req.param('doctype')
  const body = (await c.req.json().catch(() => ({}))) as { role?: string } & Record<string, unknown>
  if (!body.role) throw new AppError('ValidationError', 'Expected { role }')
  const flags = Object.fromEntries(PERM_FLAGS.map((f) => [f, Boolean(body[f])]))
  const [existing] = await sql`
    select name, modified from tab_docperm
    where ref_doctype = ${doctype} and role = ${body.role} and permlevel = 0`
  if (existing)
    await saveDoc(
      'DocPerm',
      { name: existing.name as string, modified: (existing.modified as Date).toISOString(), ...flags },
      user,
    )
  else await saveDoc('DocPerm', { ref_doctype: doctype, role: body.role, permlevel: 0, ...flags }, user)
  return c.json({ ok: true })
})

// RPT-004: Query Report metadata (filter names parsed from its SQL) — the raw
// query is intentionally NOT returned here, so running a report never exposes
// its SQL to the client. Read permission on the Report is enforced by getDoc.
app.get('/api/query_report/:name', async (c) => {
  const report = await getDoc('Report', c.req.param('name'), who(c))
  if (report.report_type !== 'Query Report')
    throw new AppError('ValidationError', `${report.name} is not a Query Report`)
  return c.json({
    name: report.name,
    ref_doctype: report.ref_doctype ?? null,
    filters: parseFilters(typeof report.query === 'string' ? report.query : ''),
  })
})

// RPT-004: run a query report with bound filter params (read-only execution).
app.post('/api/run_query_report', async (c) => {
  const { report, filters } = (await c.req.json().catch(() => ({}))) as {
    report?: string
    filters?: Record<string, unknown>
  }
  if (!report) throw new AppError('ValidationError', 'Expected { report }')
  return c.json(await runQueryReport(report, filters ?? {}, who(c)))
})

// RPT-005: script report metadata (declared filter controls) + run.
app.get('/api/script_report/:name', async (c) => {
  return c.json(await scriptReportMeta(c.req.param('name'), who(c)))
})

app.post('/api/run_script_report', async (c) => {
  const { report, filters } = (await c.req.json().catch(() => ({}))) as {
    report?: string
    filters?: Record<string, unknown>
  }
  if (!report) throw new AppError('ValidationError', 'Expected { report }')
  return c.json(await runScriptReport(report, filters ?? {}, who(c)))
})

// CUST-005: export/import a DocType's customizations (Custom Fields +
// Property Setters) as JSON. System-Manager-only.
app.get('/api/export_customizations/:doctype', async (c) => {
  await assertSystemManager(who(c))
  return c.json(await exportCustomizations(c.req.param('doctype')))
})

app.post('/api/import_customizations', async (c) => {
  await assertSystemManager(who(c))
  const bundle = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  return c.json(await importCustomizations(bundle, who(c)))
})

// CUST-004: invoke an API-type Server Script by its method name.
app.post('/api/server_script/:method', async (c) => {
  const args = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  return c.json({ result: await runApiScript(c.req.param('method'), args) })
})

app.post('/api/submit_doc', async (c) => {
  const { doctype, name } = (await c.req.json()) as { doctype?: string; name?: string }
  if (!doctype || !name) throw new AppError('ValidationError', 'Expected { doctype, name }')
  return c.json(await submitDoc(doctype, name, who(c)))
})

app.post('/api/cancel_doc', async (c) => {
  const { doctype, name } = (await c.req.json()) as { doctype?: string; name?: string }
  if (!doctype || !name) throw new AppError('ValidationError', 'Expected { doctype, name }')
  return c.json(await cancelDoc(doctype, name, who(c)))
})

app.post('/api/amend_doc', async (c) => {
  const { doctype, name } = (await c.req.json()) as { doctype?: string; name?: string }
  if (!doctype || !name) throw new AppError('ValidationError', 'Expected { doctype, name }')
  return c.json(await amendDoc(doctype, name, who(c)), 201)
})

app.delete('/api/doc/:doctype/:name', async (c) => {
  await deleteDoc(c.req.param('doctype'), c.req.param('name'), who(c))
  return c.json({ ok: true })
})

// WF-002: the transitions available to the current user for a document,
// plus its current state — drives the form's action buttons.
app.get('/api/workflow/:doctype/:name', async (c) => {
  const doctype = c.req.param('doctype')
  const wf = await getActiveWorkflow(doctype)
  if (!wf) return c.json({ workflow: null })
  const doc = await getDoc(doctype, c.req.param('name'), who(c))
  const state = currentState(wf, doc)
  const roles = await getRoles(who(c))
  return c.json({
    workflow: wf.name,
    state,
    actions: availableActions(wf, state, roles).map((t) => ({ action: t.action, next_state: t.next_state })),
  })
})

// WF-002/003: apply a workflow action. Role enforcement is server-side, so
// a forbidden transition is rejected regardless of the UI.
app.post('/api/apply_workflow_action', async (c) => {
  const { doctype, name, action } = (await c.req.json()) as {
    doctype?: string
    name?: string
    action?: string
  }
  if (!doctype || !name || !action)
    throw new AppError('ValidationError', 'Expected { doctype, name, action }')
  return c.json(await applyWorkflowAction(doctype, name, action, who(c)))
})

// UI-013: per-user list/view settings. Stored per (user, doctype) and only
// ever readable/writable by that user.
app.get('/api/user_settings/:doctype', async (c) => {
  const [row] = await sql`
    select settings from user_settings
    where "user" = ${who(c)} and doctype = ${c.req.param('doctype')}`
  return c.json({ settings: row?.settings ?? null })
})

app.put('/api/user_settings/:doctype', async (c) => {
  const settings = (await c.req.json()) as Record<string, unknown>
  await sql`
    insert into user_settings ("user", doctype, settings, modified)
    values (${who(c)}, ${c.req.param('doctype')}, ${settings as unknown as string}, now())
    on conflict ("user", doctype) do update set settings = excluded.settings, modified = now()`
  return c.json({ ok: true })
})

// EML-006 / UI-017: assign a document to a user. Creates a ToDo in their
// task list and notifies them (Notification Log + realtime user event).
app.post('/api/assign', async (c) => {
  const { doctype, name, assign_to, description } = (await c.req.json()) as {
    doctype?: string
    name?: string
    assign_to?: string
    description?: string
  }
  if (!doctype || !name || !assign_to)
    throw new AppError('ValidationError', 'Expected { doctype, name, assign_to }')
  // The assigner must be able to read the document.
  await getDoc(doctype, name, who(c))
  const [target] = await sql`select name from tab_user where name = ${assign_to}`
  if (!target) throw new AppError('NotFoundError', `User ${assign_to} not found`)

  const todo = await saveDoc(
    'ToDo',
    {
      allocated_to: assign_to,
      reference_doctype: doctype,
      reference_name: name,
      description: description ?? `Assigned ${doctype} ${name}`,
      status: 'Open',
    },
    who(c),
  )
  const subject = `${who(c)} assigned you ${doctype} ${name}`
  await sql`
    insert into tab_notification_log ${sql({
      name: randomBytes(5).toString('hex'),
      owner: who(c),
      modified_by: who(c),
      for_user: assign_to,
      subject,
      ref_doctype: doctype,
      ref_name: name,
      read: false,
    })}`
  publishUserEvent(assign_to, 'notification', { subject })
  return c.json({ todo: todo.name }, 201)
})

// UI-017: free-form document tags. Readable/writable by anyone who can read
// the document.
app.get('/api/tags/:doctype/:name', async (c) => {
  await getDoc(c.req.param('doctype'), c.req.param('name'), who(c))
  const rows = await sql`
    select tag from tag_link
    where ref_doctype = ${c.req.param('doctype')} and ref_name = ${c.req.param('name')}
    order by tag`
  return c.json({ tags: rows.map((r) => r.tag as string) })
})

app.post('/api/tags', async (c) => {
  const { doctype, name, tag } = (await c.req.json()) as {
    doctype?: string
    name?: string
    tag?: string
  }
  if (!doctype || !name || !tag?.trim())
    throw new AppError('ValidationError', 'Expected { doctype, name, tag }')
  await getDoc(doctype, name, who(c))
  await sql`
    insert into tag_link ${sql({ ref_doctype: doctype, ref_name: name, tag: tag.trim(), owner: who(c) })}
    on conflict do nothing`
  return c.json({ ok: true }, 201)
})

app.delete('/api/tags/:doctype/:name/:tag', async (c) => {
  await getDoc(c.req.param('doctype'), c.req.param('name'), who(c))
  await sql`
    delete from tag_link where ref_doctype = ${c.req.param('doctype')}
      and ref_name = ${c.req.param('name')} and tag = ${c.req.param('tag')}`
  return c.json({ ok: true })
})

// EML-001: send a test email from the configured account (delivered to the
// dev sink). EML-002: queue an email for background delivery.
app.post('/api/send_test_email', async (c) => {
  await assertSystemManager(who(c))
  const { to } = (await c.req.json()) as { to?: string }
  if (!to) throw new AppError('ValidationError', 'Expected { to }')
  await sendTestEmail(to)
  return c.json({ ok: true })
})

app.post('/api/queue_email', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as {
    to?: string
    subject?: string
    body?: string
    reference_doctype?: string
    reference_name?: string
    render?: boolean
    attach_pdf?: boolean
    print_format?: string
  }
  if (!body.to) throw new AppError('ValidationError', 'Expected { to }')
  const name = await queueEmail({
    to: body.to,
    subject: body.subject ?? '',
    body: body.body ?? '',
    reference_doctype: body.reference_doctype,
    reference_name: body.reference_name,
    render: body.render,
    attach_pdf: body.attach_pdf,
    print_format: body.print_format,
  })
  return c.json({ name }, 201)
})

// JOB-001: enqueue a background job. System Manager only (jobs run server
// code). Returns the job id so callers can poll its Background Job doc.
app.post('/api/enqueue_job', async (c) => {
  await assertSystemManager(who(c))
  const { method, payload, max_attempts, repeat_every } = (await c.req.json()) as {
    method?: string
    payload?: Record<string, unknown>
    max_attempts?: number
    repeat_every?: number
  }
  if (!method) throw new AppError('ValidationError', 'Expected { method }')
  const name = await enqueue(method, payload ?? {}, {
    maxAttempts: max_attempts,
    repeatEvery: repeat_every,
  })
  return c.json({ name }, 201)
})

// CUST-001: re-apply all custom fields (used after a core fixture re-seed).
app.post('/api/reapply_custom_fields', async (c) => {
  await assertSystemManager(who(c))
  const count = await reapplyCustomFields()
  return c.json({ ok: true, count })
})

// DOC-012: rename a document and cascade the new name to all Link references.
app.post('/api/rename_doc', async (c) => {
  const { doctype, name, new_name } = (await c.req.json()) as {
    doctype?: string
    name?: string
    new_name?: string
  }
  if (!doctype || !name || !new_name)
    throw new AppError('ValidationError', 'Expected { doctype, name, new_name }')
  return c.json(await renameDoc(doctype, name, new_name, who(c)))
})

function listArgsFromQuery(q: Record<string, string>) {
  const parse = (key: string) => {
    if (q[key] == null) return undefined
    try {
      return JSON.parse(q[key])
    } catch {
      throw new AppError('ValidationError', `${key} must be valid JSON`)
    }
  }
  // API-006: malformed pagination is a client error, not a 500 — NaN must
  // never reach the SQL layer.
  const num = (key: string) => {
    if (q[key] == null || q[key] === '') return undefined
    const n = Number(q[key])
    if (!Number.isFinite(n))
      throw new AppError('BadRequestError', `${key} must be a number`)
    return n
  }
  return {
    filters: parse('filters'),
    fields: parse('fields'),
    order_by: q.order_by,
    limit_start: num('limit_start'),
    limit_page_length: num('limit_page_length'),
  }
}

app.get('/api/list/:doctype', async (c) => {
  return c.json(await getList(c.req.param('doctype'), listArgsFromQuery(c.req.query()), who(c)))
})

// UI-014: awesomebar global search across readable DocTypes.
app.get('/api/search', async (c) => {
  const q = c.req.query('q') ?? ''
  return c.json({ results: await globalSearch(q, who(c)) })
})

// RT-003: the caller's unread notification count.
app.get('/api/unread_count', async (c) => {
  const [row] = await sql`
    select count(*)::int as c from tab_notification_log
    where for_user = ${who(c)} and read = false`
  return c.json({ count: (row?.c as number) ?? 0 })
})

// API-001/API-002: Frappe-style REST resource — one generic handler set
// serves CRUD for every DocType, driven entirely by metadata.
app.get('/api/resource/:doctype', async (c) => {
  return c.json(await getList(c.req.param('doctype'), listArgsFromQuery(c.req.query()), who(c)))
})

// POST is create-only: a client-sent name is honored for prompt-named
// DocTypes but an existing name conflicts instead of silently updating.
app.post('/api/resource/:doctype', async (c) => {
  const doc = (await c.req.json()) as Record<string, unknown>
  const saved = await saveDoc(c.req.param('doctype'), doc, who(c), 'insert')
  publishDocEvent(c.req.param('doctype'), String(saved.name), 'created')
  return c.json(saved, 201)
})

app.get('/api/resource/:doctype/:name', async (c) => {
  return c.json(await getDoc(c.req.param('doctype'), c.req.param('name'), who(c)))
})

app.put('/api/resource/:doctype/:name', async (c) => {
  const doc = (await c.req.json()) as Record<string, unknown>
  doc.name = c.req.param('name')
  const saved = await saveDoc(c.req.param('doctype'), doc, who(c))
  publishDocEvent(c.req.param('doctype'), String(saved.name), 'updated')
  return c.json(saved)
})

app.delete('/api/resource/:doctype/:name', async (c) => {
  await deleteDoc(c.req.param('doctype'), c.req.param('name'), who(c))
  publishDocEvent(c.req.param('doctype'), c.req.param('name'), 'deleted')
  return c.json({ ok: true })
})

if (process.env.NODE_ENV !== 'test') {
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`server listening on :${info.port}`)
  })
  // RT-001/002/003: attach the realtime WebSocket server to the HTTP server.
  attachRealtime(server as unknown as import('node:http').Server)
  // JOB-001: run the background worker in-process (tests drive the queue
  // directly via runOneJob/drainJobs, so the worker stays off under test).
  startWorker()
}
