import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from './config'
import { sql } from './db'
import { errorResponse } from './errors'
import { getMeta } from './meta'

export const app = new Hono()

app.onError((err, c) => errorResponse(c, err))

app.get('/api/meta/:doctype', async (c) => {
  return c.json(await getMeta(c.req.param('doctype')))
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
