import { afterAll, expect, it } from 'vitest'
import { dropScratchDatabases, scratchInstalled } from './scratch-database'

afterAll(dropScratchDatabases)

it('an authorized visit retains its lifetime through a concurrent rename', async () => {
  const scratch = await scratchInstalled()
  const { app } = await import('../src/index')
  const { withTransaction } = await import('../src/db')
  const { provisionApp } = await import('../src/app-lifecycle')
  const { createTable, renameTable } = await import('../src/table-engine')
  const { saveDoc, renameDoc } = await import('../src/document')
  const { issueSession } = await import('../src/auth')
  const { token } = await issueSession('Administrator')
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const request = (path: string, body?: unknown) => app.request(path, {
    headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  })
  try {
    await provisionApp('nav873', async () => {
      await createTable({ name: 'nav873.plant', label: 'Plant', title_column: 'title',
        columns: [{ column_name: 'title', column_type: 'Data' }] }, 'nav873')
      await saveDoc('nav873.plant', { row_id: 'north', title: 'Original depot' }, 'Administrator', 'insert')
      for (const kind of ['table', 'row']) {
        const table = kind === 'table' ? 'nav873.plant' : 'nav873.depot'
        let release!: () => void
        let captured!: (response: Response) => void
        const held = new Promise<void>(resolve => { release = resolve })
        const observed = new Promise<Response>(resolve => { captured = resolve })
        const read = withTransaction(async () => {
          const response = await request(`/api/table/${table}/north`)
          captured(response)
          await held
        })
        const response = await observed
        let claim: string | null = null
        let mutation: Promise<unknown> | undefined
        try {
          expect(response.status).toBe(200)
          claim = response.headers.get('X-Navigation-Claim')
          expect(claim).toBeTruthy()
          mutation = kind === 'table'
            ? renameTable(table, 'nav873.depot', 'nav873')
            : renameDoc(table, 'north', 'central', 'Administrator')
          // Independent observer proves the real lifecycle reached a lock wait,
          // rather than assuming two promises exercised an interleaving.
          const until = Date.now() + 5000
          let waiting = false
          while (Date.now() < until) {
            const [state] = await scratch.db`select exists(select 1 from pg_stat_activity
              where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0) as waiting`
            if (state.waiting) { waiting = true; break }
            await new Promise(resolve => setTimeout(resolve, 20))
          }
          expect(waiting).toBe(true)
        } finally { release() }
        await read
        await mutation
        const row = kind === 'table' ? 'north' : 'central'
        const event = { kind: 'row', key: `row:${table}/north`, label: 'Original depot', sub: table,
          path: `/featherbase/admin/${table}/north`, claim }
        expect((await request('/api/events', { events: [event] })).status).toBe(200)
        const home = await (await request('/api/home_resume', {})).json()
        expect(home.entries[0]).toMatchObject({ path: `/featherbase/admin/nav873.depot/${row}`, label: 'Original depot' })
      }
    })
  } finally {
    await scratch.close()
  }
}, 20000)
