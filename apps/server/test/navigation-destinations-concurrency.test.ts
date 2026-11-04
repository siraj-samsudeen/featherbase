import { afterAll, expect, it } from 'vitest'
import { dropScratchDatabases, scratchInstalled } from './scratch-database'

afterAll(dropScratchDatabases)

it('an authorized visit retains its lifetime through concurrent native lifecycle changes', async () => {
  const scratch = await scratchInstalled()
  const { app } = await import('../src/index')
  const { sql, withTransaction } = await import('../src/db')
  const { provisionApp } = await import('../src/app-lifecycle')
  const { createTable, renameTable, renameColumn } = await import('../src/table-engine')
  const { saveDoc, renameDoc, deleteDoc } = await import('../src/document')
  const { issueSession } = await import('../src/auth')
  const { token } = await issueSession('Administrator')
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'X-Navigation-Visit': '1' }
  const request = (path: string, body?: unknown) => app.request(path, {
    headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  })
  try {
    await provisionApp('nav873', async () => {
      await createTable({ name: 'nav873.plant', label: 'Plant', title_column: 'title',
        columns: [{ column_name: 'title', column_type: 'Data' }] }, 'nav873')
      await saveDoc('nav873.plant', { row_id: 'north', title: 'Original depot' }, 'Administrator', 'insert')
      for (const kind of ['table', 'row', 'column', 'delete']) {
        const table = kind === 'table' ? 'nav873.plant' : 'nav873.depot'
        const visitedId = ['column', 'delete'].includes(kind) ? 'central' : 'north'
        let release!: () => void
        let captured!: (response: Response) => void
        const held = new Promise<void>(resolve => { release = resolve })
        const observed = new Promise<Response>(resolve => { captured = resolve })
        let readPid = 0
        let mutationPid = 0
        const read = withTransaction(async () => {
          readPid = (await sql`select pg_backend_pid() as pid`)[0].pid as number
          const response = await request(`/api/table/${table}/${visitedId}`)
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
          const doc = await response.json()
          mutation = withTransaction(async () => {
            mutationPid = (await sql`select pg_backend_pid() as pid`)[0].pid as number
            if (kind === 'table') return renameTable(table, 'nav873.depot', 'nav873')
            if (kind === 'row') return renameDoc(table, 'north', 'central', 'Administrator')
            if (kind === 'column') return renameColumn(table, 'title', 'depot_title')
            return deleteDoc(table, visitedId, 'Administrator', { expectUpdatedAt: doc.updated_at })
          })
          // Independent observer proves the real lifecycle reached a lock wait,
          // specifically blocked by this authorized read, not an unrelated PID.
          const until = Date.now() + 5000
          let waiting = false
          while (Date.now() < until) {
            const [state] = await scratch.db`select ${readPid} = any(pg_blocking_pids(${mutationPid})) as waiting`
            if (state.waiting) { waiting = true; break }
            await new Promise(resolve => setTimeout(resolve, 20))
          }
          expect(waiting).toBe(true)
        } finally { release() }
        await read
        await mutation
        const row = kind === 'table' ? 'north' : 'central'
        const event = { kind: 'row', key: `row:${table}/${visitedId}`, label: 'Original depot', sub: table,
          path: `/featherbase/admin/${table}/${visitedId}`, claim }
        expect((await request('/api/events', { events: [event] })).status).toBe(200)
        const home = await (await request('/api/home_resume', {})).json()
        if (kind === 'delete') expect(home.entries).toEqual([])
        else expect(home.entries[0]).toMatchObject({ path: `/featherbase/admin/table/nav873.depot/row/${row}`, label: 'Original depot' })
      }
    })
  } finally {
    await scratch.close()
  }
}, 20000)

it.each(['rename', 'delete', 'table deletion'])('a visit waiting behind %s cannot capture the old destination', async (kind) => {
  const scratch = await scratchInstalled()
  const { app } = await import('../src/index')
  const { sql, withTransaction } = await import('../src/db')
  const { createTable, deleteTable } = await import('../src/table-engine')
  const { saveDoc, renameDoc, deleteDoc } = await import('../src/document')
  const { issueSession } = await import('../src/auth')
  try {
    await createTable({ name: 'Waiting Visit', columns: [{ column_name: 'title', column_type: 'Data' }] })
    await saveDoc('Waiting Visit', { row_id: 'north', title: 'Original depot' }, 'Administrator', 'insert')
    const { token } = await issueSession('Administrator')
    let release!: () => void
    let locked!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { locked = resolve })
    let mutationPid = 0
    let readPid = 0
    const mutation = withTransaction(async () => {
      mutationPid = (await sql`select pg_backend_pid() as pid`)[0].pid as number
      if (kind === 'rename') await renameDoc('Waiting Visit', 'north', 'central', 'Administrator')
      else if (kind === 'delete') await deleteDoc('Waiting Visit', 'north', 'Administrator')
      else await deleteTable('Waiting Visit')
      locked()
      await held
    })
    await ready
    const read = withTransaction(async () => {
      readPid = (await sql`select pg_backend_pid() as pid`)[0].pid as number
      return app.request(`/api/table/Waiting%20Visit${kind === 'table deletion' ? ':meta' : '/north'}`, {
        headers: { authorization: `Bearer ${token}`, 'X-Navigation-Visit': '1' },
      })
    })
    try {
      await expect.poll(async () => {
        const [state] = await scratch.db`select ${mutationPid} = any(pg_blocking_pids(${readPid})) as waiting`
        return state.waiting
      }).toBe(true)
    } finally { release() }
    await mutation
    const response = await read
    expect(response.status).toBe(404)
    expect(response.headers.get('X-Navigation-Claim')).toBeNull()
    expect(await sql`select id from navigation_row_target`).toEqual([])
  } finally { await scratch.close() }
}, 20000)
