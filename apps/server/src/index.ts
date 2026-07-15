import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from './config'
import { sql } from './db'
import { errorResponse } from './errors'
import { getMeta } from './meta'
import { createDocType } from './doctype-engine'
import { getDoc, saveDoc } from './document'
import { getList } from './query'
import { loadControllers } from './controllers'

await loadControllers()
import { AppError } from './errors'

export const app = new Hono()

app.onError((err, c) => errorResponse(c, err))

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
  const saved = await saveDoc(body.doctype, body.doc)
  return c.json(saved, 201)
})

app.get('/api/doc/:doctype/:name', async (c) => {
  return c.json(await getDoc(c.req.param('doctype'), c.req.param('name')))
})

app.get('/api/list/:doctype', async (c) => {
  const q = c.req.query()
  const parse = (key: string) => {
    if (q[key] == null) return undefined
    try {
      return JSON.parse(q[key])
    } catch {
      throw new AppError('ValidationError', `${key} must be valid JSON`)
    }
  }
  return c.json(
    await getList(c.req.param('doctype'), {
      filters: parse('filters'),
      fields: parse('fields'),
      order_by: q.order_by,
      limit_start: q.limit_start ? Number(q.limit_start) : undefined,
      limit_page_length: q.limit_page_length ? Number(q.limit_page_length) : undefined,
    }),
  )
})

app.get('/api/ping', async (c) => {
  const [row] = await sql`select 1 as ok`
  return c.json({ message: 'pong', db: row.ok === 1 })
})

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`server listening on :${info.port}`)
  })
}
