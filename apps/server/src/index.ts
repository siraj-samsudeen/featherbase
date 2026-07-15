import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from './config'
import { sql } from './db'
import { AppError, errorResponse } from './errors'
import { getMeta } from './meta'
import { createDocType } from './doctype-engine'
import { cancelDoc, deleteDoc, getDoc, saveDoc, submitDoc } from './document'
import { getList } from './query'
import { loadControllers } from './controllers'
import { login, resolveToken, type SessionUser } from './auth'

await loadControllers()

type Env = { Variables: { user: SessionUser } }

export const app = new Hono<Env>()

app.onError((err, c) => errorResponse(c, err))

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

// ---- API-004: everything below requires a valid session --------------------

app.use('/api/*', async (c, next) => {
  const user = await resolveToken(c.req.header('authorization'))
  c.set('user', user)
  await next()
})

const who = (c: { get: (k: 'user') => SessionUser }) => c.get('user').name

app.get('/api/whoami', async (c) => c.json(c.get('user')))

app.get('/api/meta/:doctype', async (c) => {
  return c.json(await getMeta(c.req.param('doctype')))
})

app.post('/api/doctype', async (c) => {
  const meta = await createDocType(await c.req.json())
  return c.json(meta, 201)
})

app.post('/api/save_doc', async (c) => {
  const body = (await c.req.json()) as { doctype?: string; doc?: Record<string, unknown> }
  if (!body.doctype || typeof body.doc !== 'object' || body.doc === null)
    throw new AppError('ValidationError', 'Expected { doctype, doc }')
  const saved = await saveDoc(body.doctype, body.doc, who(c))
  return c.json(saved, 201)
})

app.get('/api/doc/:doctype/:name', async (c) => {
  return c.json(await getDoc(c.req.param('doctype'), c.req.param('name')))
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

app.delete('/api/doc/:doctype/:name', async (c) => {
  await deleteDoc(c.req.param('doctype'), c.req.param('name'), who(c))
  return c.json({ ok: true })
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
  return {
    filters: parse('filters'),
    fields: parse('fields'),
    order_by: q.order_by,
    limit_start: q.limit_start ? Number(q.limit_start) : undefined,
    limit_page_length: q.limit_page_length ? Number(q.limit_page_length) : undefined,
  }
}

app.get('/api/list/:doctype', async (c) => {
  return c.json(await getList(c.req.param('doctype'), listArgsFromQuery(c.req.query())))
})

// API-001/API-002: Frappe-style REST resource — one generic handler set
// serves CRUD for every DocType, driven entirely by metadata.
app.get('/api/resource/:doctype', async (c) => {
  return c.json(await getList(c.req.param('doctype'), listArgsFromQuery(c.req.query())))
})

app.post('/api/resource/:doctype', async (c) => {
  const doc = (await c.req.json()) as Record<string, unknown>
  delete doc.name
  return c.json(await saveDoc(c.req.param('doctype'), doc, who(c)), 201)
})

app.get('/api/resource/:doctype/:name', async (c) => {
  return c.json(await getDoc(c.req.param('doctype'), c.req.param('name')))
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
