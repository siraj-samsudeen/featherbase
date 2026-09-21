import assert from 'node:assert/strict'
import test from 'node:test'
import { requireLoopback, seedTasker, TASKER_SCENARIOS } from './seed-tasker-development.mjs'

test('seed URL accepts loopback and refuses remote hosts', () => {
  assert.equal(requireLoopback('http://127.0.0.1:8000/path'), 'http://127.0.0.1:8000')
  assert.equal(requireLoopback('http://localhost:8000'), 'http://localhost:8000')
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

test('seeding twice adopts deterministic rows and preserves unrelated focus', async () => {
  const rows = new Map([['User', []], ['tasker.project', []], ['tasker.task', []], ['Comment', []]])
  let focus = ['user-created-task']
  let next = 1
  const fetchImpl = async (raw, init = {}) => {
    const url = new URL(raw)
    const body = init.body ? JSON.parse(init.body) : undefined
    let result
    if (url.pathname === '/api/login') result = { token: 'local-token' }
    else if (url.pathname === '/api/app_catalog') result = [{ name: 'tasker' }]
    else if (url.pathname.startsWith('/api/user_settings/')) {
      if (init.method === 'PUT') { focus = body.task_ids; result = { settings: { task_ids: focus } } }
      else result = { settings: { task_ids: focus } }
    } else if (url.pathname === '/api/save_row') {
      const row = { row_id: `ROW-${next++}`, ...body.row }
      rows.get(body.table).push(row); result = row
    } else if (url.pathname.startsWith('/api/table/')) {
      const table = decodeURIComponent(url.pathname.slice('/api/table/'.length))
      const filters = JSON.parse(url.searchParams.get('filters'))
      result = { data: rows.get(table).filter((row) => filters.every(([key, , value]) => row[key] === value)) }
    } else throw new Error(`unexpected ${url.pathname}`)
    return { ok: true, status: 200, json: async () => result }
  }
  const options = { baseUrl: 'http://127.0.0.1:8000', fetchImpl, log: () => {} }
  await seedTasker(options)
  const counts = Object.fromEntries([...rows].map(([table, values]) => [table, values.length]))
  await seedTasker(options)
  assert.deepEqual(Object.fromEntries([...rows].map(([table, values]) => [table, values.length])), counts)
  assert.equal(focus.at(-1), 'user-created-task')
  assert.equal(new Set(focus).size, focus.length)
})
