// Real committing HTTP requests: sandbox savepoints cannot prove uniqueness
// across independent transactions. Only this disposable Table is removed.
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { app } from '../src/index'
import { issueSession } from '../src/auth'
import { sql } from '../src/db'
import { expectStatus } from './fixtures'

it('concurrent creates for one setting admit one adjustment', async () => {
  const table = `Override Race ${randomUUID().slice(0, 8)}`
  const session = await issueSession('Administrator')
  const { token } = session
  const send = (path: string, body?: unknown, method = 'POST') => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  try {
    await expectStatus(await send('/api/table_def', { name: table, columns: [{ column_name: 'title', column_type: 'Data' }] }), 201)
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => send('/api/table/Metadata%20Override', {
      table_name: table, column_name: 'title', property: 'label', value: `Headline ${i}`,
    })))
    expect(results.map(r => r.status).sort()).toEqual([201, 417, 417, 417, 417, 417, 417, 417])
    for (const refused of results.filter(r => r.status === 417))
      expect(await refused.json()).toMatchObject({ error: { type: 'ValidationError', message: expect.stringContaining('Edit the existing adjustment') } })
    const listing = await send(`/api/table/Metadata%20Override?filters=${encodeURIComponent(JSON.stringify([['table_name', '=', table]]))}&fields=${encodeURIComponent(JSON.stringify(['table_name']))}`, undefined, 'GET')
    expect(await listing.json()).toMatchObject({ data: [expect.objectContaining({ table_name: table })] })
  } finally {
    await expectStatus(await send(`/api/table_def/${encodeURIComponent(table)}`, undefined, 'DELETE'), 200)
    await send('/api/logout', {})
    await sql`delete from featherbase.revoked_session where jti = ${session.user.sign_in!.session_id}`
  }
}, 30_000)
