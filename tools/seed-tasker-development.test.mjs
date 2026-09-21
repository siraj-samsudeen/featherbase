import assert from 'node:assert/strict'
import test from 'node:test'
import { requireLoopback, seedTasker, TASKER_SCENARIOS } from './seed-tasker-development.mjs'

test('seed URL accepts loopback and refuses remote hosts', () => {
  assert.equal(requireLoopback('http://127.0.0.1:8000/path'), 'http://127.0.0.1:8000')
  assert.equal(requireLoopback('http://localhost:8000'), 'http://localhost:8000')
  assert.equal(requireLoopback('http://[::1]:8000'), 'http://[::1]:8000')
  assert.throws(() => requireLoopback('https://qa.example.com'), /refuses non-loopback/)
})

test('scenario contract covers the owner-approved states without production fixtures', () => {
  assert(TASKER_SCENARIOS.users.every((user) => user.email.endsWith('@example.test')))
  assert(TASKER_SCENARIOS.tasks.some((task) => !task.project && !task.personal_tasks_owner))
  assert(TASKER_SCENARIOS.tasks.some((task) => task.task_state === 'Blocked' && task.explanation))
  assert(TASKER_SCENARIOS.tasks.some((task) => task.task_state === 'On hold' && task.explanation))
  assert(TASKER_SCENARIOS.tasks.some((task) => task.is_done))
  assert(TASKER_SCENARIOS.tasks.some((task) => task.personal_tasks_owner === 'Administrator'))
  assert.equal(TASKER_SCENARIOS.focus.length, 3)
})

function fakeSeedServer({ environment = 'development', databaseServerLocal = true, redirectPing = false } = {}) {
  const rows = new Map([
    ['User', []],
    ['tasker.project', [{ row_id: 'UNRELATED-PROJECT', project_name: 'September stock review' }]],
    ['tasker.task', [{ row_id: 'UNRELATED-TASK-1', task_title: 'Triage supplier invoice mismatch' }, { row_id: 'UNRELATED-TASK-2', task_title: 'Triage supplier invoice mismatch' }]],
    ['Comment', []],
  ])
  let focus = ['user-created-task']
  let next = 1
  const fetchImpl = async (raw, init = {}) => {
    const url = new URL(raw)
    const body = init.body ? JSON.parse(init.body) : undefined
    let result
    if (url.pathname === '/api/ping') result = { message: 'pong', environment, database_server_local: databaseServerLocal }
    else if (url.pathname === '/api/login') result = { token: 'local-token' }
    else if (url.pathname === '/api/app_catalog') result = [{ name: 'tasker' }]
    else if (url.pathname.startsWith('/api/user_settings/')) {
      if (init.method === 'PUT') { focus = body.task_ids; result = { settings: { task_ids: focus } } }
      else result = { settings: { task_ids: focus } }
    } else if (url.pathname === '/api/save_row') {
      const row = { row_id: `ROW-${next++}`, ...body.row }
      rows.get(body.table).push(row); result = row
    } else if (init.method === 'POST' && url.pathname.startsWith('/api/table/')) {
      const table = decodeURIComponent(url.pathname.slice('/api/table/'.length))
      const row = { row_id: `ROW-${next++}`, ...body }
      rows.get(table).push(row); result = row
    } else if (url.pathname.startsWith('/api/table/')) {
      const table = decodeURIComponent(url.pathname.slice('/api/table/'.length))
      const filters = JSON.parse(url.searchParams.get('filters'))
      result = { data: rows.get(table).filter((row) => filters.every(([key, , value]) => row[key] === value)) }
    } else throw new Error(`unexpected ${url.pathname}`)
    return { ok: true, status: 200, redirected: redirectPing && url.pathname === '/api/ping', url: redirectPing && url.pathname === '/api/ping' ? 'http://127.0.0.1:8999/api/ping' : url.href, json: async () => result }
  }
  return { rows, fetchImpl, focus: () => focus }
}

test('seed refuses redirects before sending the administrator credential', async () => {
  const server = fakeSeedServer({ redirectPing: true })
  let calls = 0
  await assert.rejects(seedTasker({ baseUrl: 'http://127.0.0.1:8000', fetchImpl: async (...args) => { calls++; return server.fetchImpl(...args) }, log: () => {} }), /refused a redirect/)
  assert.equal(calls, 1)
})

test('seed refuses the wrong environment and a remote database identity', async () => {
  await assert.rejects(seedTasker({ baseUrl: 'http://127.0.0.1:8000', fetchImpl: fakeSeedServer({ environment: 'test' }).fetchImpl, log: () => {} }), /expected Featherbase environment 'development'/)
  await assert.rejects(seedTasker({ baseUrl: 'http://127.0.0.1:8000', fetchImpl: fakeSeedServer({ databaseServerLocal: false }).fetchImpl, log: () => {} }), /remote PostgreSQL server/)
})

test('direct local development and explicitly expected test proof paths are accepted', async () => {
  await seedTasker({ baseUrl: 'http://127.0.0.1:8000', fetchImpl: fakeSeedServer().fetchImpl, log: () => {} })
  await seedTasker({ baseUrl: 'http://127.0.0.1:8000', expectedEnvironment: 'test', fetchImpl: fakeSeedServer({ environment: 'test' }).fetchImpl, log: () => {} })
})

test('seeding twice adopts deterministic IDs and leaves duplicate-title rows untouched', async () => {
  const server = fakeSeedServer()
  const { rows, fetchImpl } = server
  const options = { baseUrl: 'http://127.0.0.1:8000', fetchImpl, log: () => {} }
  await seedTasker(options)
  const counts = Object.fromEntries([...rows].map(([table, values]) => [table, values.length]))
  await seedTasker(options)
  assert.deepEqual(Object.fromEntries([...rows].map(([table, values]) => [table, values.length])), counts)
  const focus = server.focus()
  assert.equal(focus.at(-1), 'user-created-task')
  assert.equal(new Set(focus).size, focus.length)
  assert(focus.every(id => id === 'user-created-task' || id.startsWith('DEV-TASKER-TASK-')))
  assert.equal(rows.get('tasker.task').filter(row => row.task_title === 'Triage supplier invoice mismatch').length, 3)
  assert.equal(rows.get('Comment').some(row => row.ref_name.startsWith('UNRELATED-')), false)
})
