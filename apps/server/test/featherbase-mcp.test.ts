// #1377 (ADR 0028): an app's outbound read that declares featherbaseMcp is handed Featherbase's
// read-only MCP tools, and every tool call carries the caller's own credential, so it reads
// exactly what they may read and stops the moment the front door would refuse them.
// Fixture: test-apps/action-proof, reads `tools` (declares the flag) and `untooled` (does not).
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { committedTest } from './pg-test-shared'
import { makePerson } from './fixtures'
import { sql } from '../src/db'
import { issueAccessToken, issueSession } from '../src/auth'
import { discoverPackages, runPackageRead } from '../src/runtime-packages'
import pkg from '../../../test-apps/action-proof/package.json'

const FIXTURE = resolve('../..', 'test-apps/action-proof')
const READ_ONLY = ['list_tables', 'describe_table', 'query_rows', 'get_row', 'suggest_table', 'check_import', 'list_imports']
type Api = { fetch: (path: string, init?: RequestInit) => Promise<Response> }

/** Install the fixture; Selvi has one work row, Ravi none. Each gets a real session. */
async function setup(admin: TestClient) {
  expect(await discoverPackages([FIXTURE])).toEqual([])
  await admin.fetch('/api/install_app', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'actionproof' }) })
  const person = async (name: string) => {
    const id = await makePerson({ email: `${name}@mcp.example.test`, full_name: name })
    return { id, token: (await issueSession(id)).token }
  }
  return { selvi: await person('selvi'), ravi: await person('ravi') }
}

const headers = (token: string) => ({
  authorization: `Bearer ${token}`, 'content-type': 'application/json', 'X-Featherbase-App-Version': `actionproof@${pkg.version}`,
})
/** Run one of the fixture's reads over HTTP with this credential; the raw body comes back too. */
async function read(api: Api, token: string, payload: unknown, name = 'tools') {
  const res = await api.fetch(`/api/app_reads/actionproof/${name}`, { method: 'POST', headers: headers(token), body: JSON.stringify({ payload }) })
  const body = await res.text()
  return { status: res.status, body, result: res.ok ? (JSON.parse(body) as { result: any }).result : undefined }
}
const saveWork = (api: Api, token: string, title: string) =>
  api.fetch('/api/save_row', { method: 'POST', headers: headers(token), body: JSON.stringify({ table: 'actionproof.work', row: { row_id: title, title } }) })
const QUERY = { call: 'query_rows', args: { table: 'actionproof.work', columns: ['title'] } }

/** Hold the fixture's read open between two tool calls (it reads this global). */
function pauser() {
  const paused = { reached: () => {}, release: Promise.resolve() }
  let release!: () => void
  const reached = new Promise<void>(done => { paused.reached = done })
  paused.release = new Promise<void>(done => { release = done })
  ;(globalThis as Record<symbol, unknown>)[Symbol.for('actionproof.pause')] = paused
  return { reached, release }
}

describe('Featherbase MCP tools for an app read (#1377)', () => {
  test('the read is offered only the read-only tools', async ({ admin, api }) => {
    const { selvi } = await setup(admin)
    expect((await read(api, selvi.token, {})).result).toEqual(READ_ONLY)
  })

  test('the app cannot add a row through the tools', async ({ admin, api }) => {
    const { selvi } = await setup(admin)
    expect((await read(api, selvi.token, { call: 'create_row', args: { table: 'actionproof.work', values: { row_id: 'Sneaked', title: 'Sneaked' } } })).result)
      .toEqual({ ok: false, reason: 'There is no tool called create_row' })
    expect((await read(api, selvi.token, QUERY)).result).toMatchObject({ ok: true, result: { total: 0 } })
  })

  test('the app\'s lookup sees only Selvi\'s rows', async ({ admin, api }) => {
    const { selvi, ravi } = await setup(admin)
    expect((await saveWork(api, selvi.token, 'Selvi work')).ok).toBe(true)
    expect((await read(api, selvi.token, QUERY)).result).toMatchObject({ ok: true, result: { rows: [{ title: 'Selvi work' }], total: 1 } })
    expect((await read(api, ravi.token, QUERY)).result).toMatchObject({ ok: true, result: { rows: [], total: 0 } })
  })

  test('a read that does not declare the flag gets no tools', async ({ admin, api }) => {
    const { selvi } = await setup(admin)
    expect((await read(api, selvi.token, {}, 'untooled')).result).toEqual({ given: false })
  })

  test('a read the server starts itself, with no caller credential, gets no tools', async ({ admin }) => {
    const { selvi } = await setup(admin)
    expect((await runPackageRead('actionproof', 'tools', { payload: {} }, selvi.id) as { result: unknown }).result).toEqual({ given: false })
  })

  test('no access token is made', async ({ admin, api }) => {
    const { selvi } = await setup(admin)
    const [{ n: before }] = await sql`select count(*)::int as n from access_token`
    expect((await read(api, selvi.token, QUERY)).result).toMatchObject({ ok: true })
    expect((await sql`select count(*)::int as n from access_token`)[0].n).toBe(before)
  })

  test('a read opened with an access token works, as its owner', async ({ admin, api }) => {
    const { selvi } = await setup(admin)
    await saveWork(api, selvi.token, 'Selvi work')
    const { token } = await issueAccessToken(selvi.id, 'script')
    expect((await read(api, token, QUERY)).result).toMatchObject({ ok: true, result: { total: 1 } })
  })

  // Each way the front door stops a credential stops the tools too, between two calls of one read.
  const cutOffs: [string, (api: Api, person: { id: string; token: string }) => Promise<unknown>][] = [
    ['signing out of that session', (api, { token }) => api.fetch('/api/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } })],
    ['signing out everywhere', async (_api, { id, token }) => {
      // Sessions issued before the cut-off end, to the whole second (#391).
      const issued = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).iat as number
      await sql`update person set sessions_ended_at = to_timestamp(${issued + 1}) where row_id = ${id}`
    }],
    ['being turned off', (_api, { id }) => sql`update person set enabled = false where row_id = ${id}`],
  ]
  // Committed: the cut-off must land while the read is still open, which one sandbox connection can't do.
  for (const [cutOff, apply] of cutOffs) {
    committedTest(`${cutOff} stops the lookups of a read already under way`, async ({ admin, api }) => {
      const { selvi } = await setup(admin)
      const gate = pauser()
      const running = read(api, selvi.token, { ...QUERY, pause: true })
      try {
        await gate.reached
        await apply(api, selvi)
      } finally { gate.release() }
      const { result } = await running
      expect(result.before).toMatchObject({ ok: true })
      expect(result.after).toMatchObject({ ok: false, reason: expect.stringMatching(/\S/) })
    })
  }

  test('a made-up credential is refused at the door', async ({ admin, api }) => {
    await setup(admin)
    expect((await read(api, 'not-a-real-session', QUERY)).status).toBe(401)
  })

  test('the credential appears in no result, refusal or the read\'s context', async ({ admin, api }) => {
    const { selvi } = await setup(admin)
    const answers = [
      await read(api, selvi.token, QUERY),
      await read(api, selvi.token, { call: 'describe_table', args: { table: 'no.such' } }),
      await read(api, selvi.token, { call: 'create_row', args: {} }),
      await read(api, selvi.token, { context: true }),
    ]
    expect(answers[1].result).toMatchObject({ ok: false })
    expect(answers[3].result).toContain('"featherbaseMcp"')
    for (const { body } of answers) expect(body).not.toContain(selvi.token)
  })
})
