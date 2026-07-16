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
import { getList } from './query'
import { loadControllers } from './controllers'
import { generateApiKeys, login, resolveToken, revokeApiKeys, type SessionUser } from './auth'
import { assertPermission, assertSystemManager, getRoles } from './permissions'
import { readStored, saveUpload } from './storage'
import { globalSearch } from './search'
import { callMethod, loadMethods, methodAllowsGuest } from './methods'
import { renderPdf, renderPrintHtml } from './print'
import { applyWorkflowAction, availableActions, currentState, getActiveWorkflow } from './workflow'
import { reapplyCustomFields } from './custom-fields'

await loadControllers()
await loadMethods()
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

// FILE-001: serve stored files. Only files registered as a File doc are
// readable. Public bucket needs no session; the private bucket accepts a
// bearer header or ?token= (so <img src> and download links work).
async function serveFile(c: Context<Env>, fileUrl: string, requireAuth: boolean) {
  if (requireAuth) {
    const token = c.req.query('token')
    await resolveToken(c.req.header('authorization') ?? (token ? `Bearer ${token}` : undefined))
  }
  const [row] = await sql`
    select file_name, mime_type from tab_file where file_url = ${fileUrl}`
  if (!row) throw new AppError('NotFoundError', `File not found: ${fileUrl}`)
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

const who = (c: { get: (k: 'user') => SessionUser }) => c.get('user').name

app.get('/api/whoami', async (c) => {
  const user = c.get('user')
  return c.json({ ...user, roles: await getRoles(user.name) })
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
  const saved = await saveDoc(body.doctype, body.doc, who(c))
  return c.json(saved, 201)
})

app.get('/api/doc/:doctype/:name', async (c) => {
  return c.json(await getDoc(c.req.param('doctype'), c.req.param('name'), who(c)))
})

// PRN-003: server-side PDF of any document / print format.
app.get('/api/print/:doctype/:name', async (c) => {
  const format = c.req.query('format')
  const html = await renderPrintHtml(c.req.param('doctype'), c.req.param('name'), who(c), format)
  const pdf = await renderPdf(html)
  return c.body(new Uint8Array(pdf), 200, {
    'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${c.req.param('name').replace(/[^\w.-]/g, '_')}.pdf"`,
  })
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

// API-001/API-002: Frappe-style REST resource — one generic handler set
// serves CRUD for every DocType, driven entirely by metadata.
app.get('/api/resource/:doctype', async (c) => {
  return c.json(await getList(c.req.param('doctype'), listArgsFromQuery(c.req.query()), who(c)))
})

// POST is create-only: a client-sent name is honored for prompt-named
// DocTypes but an existing name conflicts instead of silently updating.
app.post('/api/resource/:doctype', async (c) => {
  const doc = (await c.req.json()) as Record<string, unknown>
  return c.json(await saveDoc(c.req.param('doctype'), doc, who(c), 'insert'), 201)
})

app.get('/api/resource/:doctype/:name', async (c) => {
  return c.json(await getDoc(c.req.param('doctype'), c.req.param('name'), who(c)))
})

app.put('/api/resource/:doctype/:name', async (c) => {
  const doc = (await c.req.json()) as Record<string, unknown>
  doc.name = c.req.param('name')
  return c.json(await saveDoc(c.req.param('doctype'), doc, who(c)))
})

app.delete('/api/resource/:doctype/:name', async (c) => {
  await deleteDoc(c.req.param('doctype'), c.req.param('name'), who(c))
  return c.json({ ok: true })
})

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`server listening on :${info.port}`)
  })
}
