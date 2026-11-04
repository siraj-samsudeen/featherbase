// Run against a disposable, admitted local Tasker instance. This creates
// private proof tasks; it never changes work that existed before the run.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

if (!process.env.SERVER_URL) throw new Error('Set SERVER_URL to a disposable local instance')
const base = new URL(process.env.SERVER_URL)
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('This proof runs only on a local instance')
const { version } = JSON.parse(await readFile(new URL('../example-apps/tasker/package.json', import.meta.url), 'utf8'))
const login = await fetch(new URL('/api/login', base), {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ usr: process.env.TASKER_PROOF_USER ?? 'Administrator', pwd: process.env.TASKER_PROOF_PASSWORD ?? 'admin' }),
})
assert.equal(login.status, 200, 'The local proof account must be able to sign in')
const { token } = await login.json()
async function request(path, row) {
  const response = await fetch(new URL(path, base), {
    method: row ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Featherbase-App-Version': `tasker@${version}` },
    ...(row ? { body: JSON.stringify({ table: 'tasker.task', row }) } : {}),
  })
  return { status: response.status, row: await response.json() }
}
async function save(row) {
  const result = await request('/api/save_row', row)
  assert.ok([200, 201].includes(result.status), 'An admitted Tasker member must be able to prepare the proof')
  return result.row
}
let parentWon = 0
let childWon = 0
for (let trial = 1; trial <= 20; trial++) {
  const parent = await save({ task_title: `Parent lock proof ${trial}` })
  const child = await save({ task_title: `Child lock proof ${trial}`, parent_task: parent.row_id, is_done: true })
  const complete = () => request('/api/save_row', { row_id: parent.row_id, updated_at: parent.updated_at, is_done: true })
  const reopen = () => request('/api/save_row', { row_id: child.row_id, updated_at: child.updated_at, is_done: false })
  const outcomes = trial % 2
    ? await Promise.all([complete(), reopen()])
    : (await Promise.all([reopen(), complete()])).reverse()
  assert.equal(outcomes.filter(outcome => [200, 201].includes(outcome.status)).length, 1, 'Exactly one competing transition may succeed')
  assert.equal(outcomes.filter(outcome => outcome.status === 417).length, 1, 'The other transition must be refused by validation')
  const [afterParent, afterChild] = await Promise.all([
    request(`/api/table/tasker.task/${encodeURIComponent(parent.row_id)}`),
    request(`/api/table/tasker.task/${encodeURIComponent(child.row_id)}`),
  ])
  assert.ok(afterParent.row.task_state !== 'Done' || ['Done', 'Cancelled'].includes(afterChild.row.task_state), 'A completed parent must never contain reopened work')
  if ([200, 201].includes(outcomes[0].status)) parentWon++
  else childWon++
}
console.log(`PASS 20 independent HTTP transaction races; parent completed first ${parentWon}, child reopened first ${childWon}`)
