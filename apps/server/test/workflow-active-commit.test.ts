import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { expect, test } from 'vitest'
import { config } from '../src/config'
import { app } from '../src/index'
import { issueSession } from '../src/auth'
import { createTable } from '../src/table-engine'
import { registerController, unregisterController, type TableController } from '../src/controllers'

// Independent commits, not sandbox savepoints. Use only a worker-owned local
// disposable DB; vitest.config.ts rejects unsafe destinations before setup.
// FEATHERBASE_ENV=test WORKFLOW_COMMIT_PROOF=1 DATABASE_URL=.../featherbase_<worker>_workflow_commit_e2e \
//   pnpm --filter server exec vitest run test/workflow-active-commit.test.ts
// Unique test records are retained in that disposable DB as durable evidence.
const prove = process.env.WORKFLOW_COMMIT_PROOF === '1' ? test : test.skip

prove.each(['insert', 'activate'] as const)('concurrent %s commits only one active workflow and names it in the refused HTTP save', async mode => {
  const observer = postgres(config.databaseUrl, { max: 1, prepare: false })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let winnerPid = 0
  let loserPid = 0
  let held = false
  let winner: Promise<Response> | undefined
  let loser: Promise<Response> | undefined
  const suffix = randomBytes(6).toString('hex')
  const target = `Race target ${suffix}`
  const winnerName = `Original ${suffix}`
  const loserName = `Alternative ${suffix}`
  const controller: TableController = { table: 'Workflow', hooks: {
    before_save: async ({ row, tx }) => {
      if (row.row_id !== winnerName && row.row_id !== loserName) return
      const [{ pid }] = await tx`select pg_backend_pid() as pid`
      if (row.row_id === winnerName) winnerPid = Number(pid)
      else loserPid = Number(pid)
    },
    after_save: async ({ row }) => {
      if (row.row_id === winnerName) { held = true; await gate }
    },
  } }
  try {
    const [identity] = await observer`select current_database() as name, host(inet_server_addr()) as address,
      (select value from featherbase.internal_metadata where key = 'environment') as environment`
    expect(identity.name).toMatch(/^featherbase_[a-z0-9_]+_workflow_commit_e2e$/)
    expect(identity.environment).toBe('test')
    expect(identity.address).toBe('127.0.0.1')
    await createTable({ name: target, columns: [{ column_name: 'workflow_state', column_type: 'Data' }] })
    const { token } = await issueSession('Administrator')
    const save = async (row: Record<string, unknown>) => app.request('/api/save_row', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'Workflow', row }),
    })
    let first: Record<string, unknown> = { row_id: winnerName, ref_table: target, is_active: true,
      states: [{ state: 'Review', target_status: 'draft' }] }
    let second: Record<string, unknown> = { row_id: loserName, ref_table: target, is_active: true,
      states: [{ state: 'Triage', target_status: 'draft' }] }
    if (mode === 'activate') {
      const firstSaved = await save({ ...first, is_active: false })
      const secondSaved = await save({ ...second, is_active: false })
      expect(firstSaved.status).toBe(201)
      expect(secondSaved.status).toBe(201)
      first = { ...await firstSaved.json() as Record<string, unknown>, is_active: true }
      second = { ...await secondSaved.json() as Record<string, unknown>, is_active: true }
    }
    registerController(controller)
    winner = save(first)
    await expect.poll(() => held).toBe(true)
    loser = save(second)
    await expect.poll(async () => {
      if (!loserPid) return false
      const [waiting] = await observer`select wait_event, pg_blocking_pids(pid) as blockers
        from pg_stat_activity where pid = ${loserPid}`
      return waiting?.wait_event === 'transactionid' && waiting.blockers.includes(winnerPid)
    }).toBe(true)
    expect(winnerPid).not.toBe(loserPid)
    release()
    expect((await winner).status).toBe(201)
    const refused = await loser
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: {
      type: 'ConflictError', message: expect.stringContaining(winnerName),
    } })
    expect(await observer`select row_id from featherbase.workflow where ref_table = ${target} and is_active = true`)
      .toEqual([{ row_id: winnerName }])
    expect(await observer`select row_id, is_active from featherbase.workflow where row_id = ${loserName}`)
      .toEqual(mode === 'activate' ? [{ row_id: loserName, is_active: false }] : [])
  } finally {
    release()
    await Promise.allSettled([winner, loser])
    unregisterController(controller)
    await observer.end()
  }
}, 15_000)
