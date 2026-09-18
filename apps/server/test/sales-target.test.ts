// #3755 personalised sales-target report host (src/sales-target.ts). Every
// test seeds the Table, role, four accounts and assignments inside its own
// sandbox transaction through the public API — the same seedSalesTarget()
// the script runs over HTTP — so nothing here depends on the shared
// .env.local. The upstream MotherDuck call is injected: no network, and the
// stub records exactly what the server would have sent.
import { afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import {
  ASSIGNMENT_TABLE,
  VIEWER_ROLE,
  _setEmbedFetch,
  seedSalesTarget,
  type AssignmentRecord,
} from '../src/sales-target'

const PASSWORDS: Record<string, string> = {
  test_employee_1: 'sandbox-pw-1',
  test_employee_2: 'sandbox-pw-2',
  test_employee_3: 'sandbox-pw-3',
  test_employee_4: 'sandbox-pw-4',
}
// The four assignments from issue #3755 (shared/assignments.json).
const ASSIGNMENTS: AssignmentRecord[] = [
  { username: 'test_employee_1', display_name: 'Employee 1', plant_code: '1501', store_label: 'ATK', material_groups: ['010101001', '010101003'] },
  { username: 'test_employee_2', display_name: 'Employee 2', plant_code: '1501', store_label: 'ATK', material_groups: ['010102001', '010102002'] },
  { username: 'test_employee_3', display_name: 'Employee 3', plant_code: '1515', store_label: 'Kattakada', material_groups: ['010101001', '010101003'] },
  { username: 'test_employee_4', display_name: 'Employee 4', plant_code: '1515', store_label: 'Kattakada', material_groups: ['010102001', '010102002'] },
]
const TABLE_URL = `/api/table/${encodeURIComponent(ASSIGNMENT_TABLE)}`
const SENTINEL_TOKEN = 'sandbox-creation-token-never-served'

interface Recorded {
  url: string
  authorization: string | null
  body: { username: string; version: number; initial_state: unknown }
}

// An injected upstream: records each request, answers a canned session (or a
// canned failure), never touches the network.
function stubUpstream(answer: { status: number; body: unknown } = { status: 200, body: { session: 'stub-session-1' } }) {
  const calls: Recorded[] = []
  _setEmbedFetch(async (input, init) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)) as Recorded['body'],
    })
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
  })
  return calls
}

const savedToken = process.env.MOTHERDUCK_TOKEN
afterEach(() => {
  _setEmbedFetch(null)
  if (savedToken === undefined) delete process.env.MOTHERDUCK_TOKEN
  else process.env.MOTHERDUCK_TOKEN = savedToken
})

async function seed(admin: TestClient) {
  process.env.MOTHERDUCK_TOKEN = SENTINEL_TOKEN
  process.env.DIVE_ID = 'dive-under-test'
  process.env.DIVE_VERSION = '1'
  process.env.SERVICE_ACCOUNT = 'motherduck_dive_service_account'
  return seedSalesTarget((path, init) => admin.fetch(path, init), PASSWORDS, ASSIGNMENTS)
}

async function loginAs(api: TestClient, usr: string, pwd: string) {
  const res = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr, pwd }) })
  const body = (await res.json()) as { token?: string; landing?: string; user?: { row_id: string } }
  return { status: res.status, body, headers: { authorization: `Bearer ${body.token ?? ''}` } }
}

describe('#3755 sales-target host: accounts and login', () => {
  test('seed creates the four viewer accounts, the Table and the initial rows; a second run adopts them', async ({ admin }) => {
    const first = await seed(admin)
    expect(first.users).toEqual(['test_employee_1', 'test_employee_2', 'test_employee_3', 'test_employee_4'])
    expect(first.assignments).toEqual([
      '1501/010101001', '1501/010101003', '1501/010102001', '1501/010102002',
      '1515/010101001', '1515/010101003', '1515/010102001', '1515/010102002',
    ])
    const again = await seed(admin)
    expect(again).toEqual({ users: [], assignments: [] })
    const rows = await admin.get<{ data: { employee: string; store_subcategory: string }[] }>(
      `${TABLE_URL}?fields=${encodeURIComponent('["employee","store_subcategory"]')}&limit_page_length=50`,
    )
    expect(rows.data).toHaveLength(8)
    expect(new Set(rows.data.map((r) => r.store_subcategory)).size).toBe(8)
  })

  test('each account logs in with its password and is told to land on /sales-target; not a System Manager', async ({ admin, api }) => {
    await seed(admin)
    for (const [usr, pwd] of Object.entries(PASSWORDS)) {
      const r = await loginAs(api, usr, pwd)
      expect(r.status).toBe(200)
      expect(r.body.user?.row_id).toBe(usr)
      expect(r.body.landing).toBe('/sales-target')
      const me = await (await api.fetch('/api/whoami', { headers: r.headers })).json() as { roles: string[] }
      expect(me.roles).toEqual(['All', VIEWER_ROLE])
    }
    // Administrator keeps the plain shape: no landing key at all.
    const a = await loginAs(api, 'Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
    expect(a.body.landing).toBeUndefined()
  })

  test('wrong password is 401 and the upstream is never called', async ({ admin, api }) => {
    await seed(admin)
    const calls = stubUpstream()
    const r = await loginAs(api, 'test_employee_2', 'definitely-wrong')
    expect(r.status).toBe(401)
    expect(r.body.token).toBeUndefined()
    expect(calls).toEqual([])
  })

  test('the embed-session and identity routes require a session (401, no upstream call)', async ({ admin, api }) => {
    await seed(admin)
    const calls = stubUpstream()
    expect((await api.fetch('/api/sales_target/embed_session', { method: 'POST' })).status).toBe(401)
    expect((await api.fetch('/api/sales_target/me')).status).toBe(401)
    expect(calls).toEqual([])
  })

  test('a viewer has no Table permissions: the assignment Table is 403 to them', async ({ admin, api }) => {
    await seed(admin)
    const r = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
    expect((await api.fetch(TABLE_URL, { headers: r.headers })).status).toBe(403)
    expect((await api.fetch('/api/table/User', { headers: r.headers })).status).toBe(403)
  })
})

describe('#3755 sales-target host: embed session from the current assignment', () => {
  test('Employee 1 and Employee 3: exact initial_state, service account, version, Dive ID, Bearer token; browser gets only {session}', async ({ admin, api }) => {
    await seed(admin)
    const calls = stubUpstream()
    const expected: Record<string, unknown> = {
      test_employee_1: { plant_code: '1501', material_groups: ['010101001', '010101003'], period_start: '2026-09-01', period_end: '2026-09-17' },
      test_employee_3: { plant_code: '1515', material_groups: ['010101001', '010101003'], period_start: '2026-09-01', period_end: '2026-09-17' },
    }
    for (const usr of ['test_employee_1', 'test_employee_3']) {
      const r = await loginAs(api, usr, PASSWORDS[usr])
      const res = await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ session: 'stub-session-1' })
      const call = calls.at(-1)!
      expect(call.url).toBe('https://api.motherduck.com/v1/dives/dive-under-test/embed-session')
      expect(call.authorization).toBe(`Bearer ${SENTINEL_TOKEN}`)
      expect(call.body).toEqual({ username: 'motherduck_dive_service_account', version: 1, initial_state: expected[usr] })
    }
    expect(calls).toHaveLength(2)
  })

  test('MOTHERDUCK_API_BASE redirects the upstream call (stub runs)', async ({ admin, api }) => {
    await seed(admin)
    process.env.MOTHERDUCK_API_BASE = 'http://127.0.0.1:1/'
    try {
      const calls = stubUpstream()
      const r = await loginAs(api, 'test_employee_4', PASSWORDS.test_employee_4)
      await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })
      expect(calls[0].url).toBe('http://127.0.0.1:1/v1/dives/dive-under-test/embed-session')
    } finally {
      delete process.env.MOTHERDUCK_API_BASE
    }
  })

  test('an account with no assignment rows gets the explicit no-assignment marker and no upstream call', async ({ admin, api, createUser }) => {
    await seed(admin)
    const calls = stubUpstream()
    const nobody = await createUser({ email: 'test_employee_none@example.invalid', roles: [VIEWER_ROLE] })
    const res = await nobody.fetch('/api/sales_target/embed_session', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ no_assignment: true })
    const me = await nobody.get<{ assignment: unknown }>('/api/sales_target/me')
    expect(me.assignment).toBeNull()
    expect(calls).toEqual([])
  })

  test('the identity route carries the display chrome and never an amount or credential', async ({ admin, api }) => {
    await seed(admin)
    const r = await loginAs(api, 'test_employee_2', PASSWORDS.test_employee_2)
    const me = await (await api.fetch('/api/sales_target/me', { headers: r.headers })).json()
    expect(me).toEqual({
      username: 'test_employee_2',
      display_name: 'Employee 2',
      assignment: { plant_code: '1501', store_label: 'ATK', material_groups: ['010102001', '010102002'] },
      period_start: '2026-09-01',
      period_end: '2026-09-17',
      embed_origin: 'https://embed-motherduck.com',
    })
  })

  test('a deployment with no Dive configured says so quietly, and is not an error', async ({ admin, api }) => {
    await seed(admin)
    // featherbase-dev on 18-Sep-2026: MOTHERDUCK_TOKEN set, no DIVE_* at all. The
    // page showed a red "Report unavailable" under a perfectly good snapshot table,
    // telling the reader something was broken when nothing was. Missing
    // configuration is not a failure; a live refusal (the test below) still is.
    const saved = [process.env.DIVE_ID, process.env.DIVE_VERSION, process.env.SERVICE_ACCOUNT]
    const savedShared = process.env.SALES_TARGET_SHARED_ENV
    delete process.env.DIVE_ID
    delete process.env.DIVE_VERSION
    delete process.env.SERVICE_ACCOUNT
    // embedConfig() falls back to the shared .env.local, which a developer
    // checkout has and a deployment does not — so clearing the process env alone
    // does not reproduce featherbase-dev. Point the fallback at nothing.
    process.env.SALES_TARGET_SHARED_ENV = '/nonexistent/sales-target.env'
    try {
      const r = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
      const res = await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { not_configured?: boolean; session?: string; error?: unknown }
      expect(body.not_configured).toBe(true)
      expect(body.session).toBeUndefined()
      expect(body.error).toBeUndefined()
    } finally {
      ;[process.env.DIVE_ID, process.env.DIVE_VERSION, process.env.SERVICE_ACCOUNT] = saved as string[]
      if (savedShared === undefined) delete process.env.SALES_TARGET_SHARED_ENV
      else process.env.SALES_TARGET_SHARED_ENV = savedShared
    }
  })

  test('an upstream refusal is reported with its status and message, never with the token; no session is invented', async ({ admin, api }) => {
    await seed(admin)
    stubUpstream({
      status: 403,
      body: { message: 'Client lacks platform authorization required for dashboards.createEmbedSession', code: 'FORBIDDEN' },
    })
    const r = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
    const res = await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({
      error: {
        type: 'EmbedSessionError',
        message: 'embed API answered HTTP 403: Client lacks platform authorization required for dashboards.createEmbedSession',
        upstream_status: 403,
      },
    })
    expect(text).not.toContain(SENTINEL_TOKEN)
    expect(text).not.toContain('session')
  })

  test('the token appears in no response the browser can receive', async ({ admin, api }) => {
    await seed(admin)
    stubUpstream()
    const r = await loginAs(api, 'test_employee_3', PASSWORDS.test_employee_3)
    for (const [path, init] of [
      ['/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_3', pwd: PASSWORDS.test_employee_3 }) }],
      ['/api/sales_target/embed_session', { method: 'POST', headers: r.headers }],
      ['/api/sales_target/me', { headers: r.headers }],
      ['/api/whoami', { headers: r.headers }],
    ] as const) {
      const res = await api.fetch(path, init)
      expect(await res.text()).not.toContain(SENTINEL_TOKEN)
      expect([...res.headers.values()].join(' ')).not.toContain(SENTINEL_TOKEN)
    }
  })

  test('frame policy: MotherDuck embed origin allowed in frame-src; the other security headers stay', async ({ api }) => {
    const res = await api.fetch('/api/ping')
    expect(res.headers.get('content-security-policy')).toBe("frame-src 'self' https://embed-motherduck.com")
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('#3755 sales-target host: report opens are Access Log rows', () => {
  test('opening the report records who, which dataset, and whether it came from a snapshot or live', async ({ admin, api }) => {
    await seed(admin)
    // No snapshot has built in this sandbox, so the read is live; the source
    // itself is injected so nothing here reaches MotherDuck.
    const { _setSourceReader } = await import('../src/datasets/sales-target-mtd')
    _setSourceReader(async () => [])
    try {
      const r = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
      const res = await api.fetch('/api/sales_target/report', { headers: r.headers })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { source: string }).source).toBe('live')
      const rows = await sql`
        select "user", operation, ref_table, reference_name, method from access_log
        where "user" = 'test_employee_1' and operation = 'view_report'`
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ ref_table: 'sales_target_mtd', method: 'live', reference_name: null })
      // The viewer cannot read the log of their own reads.
      expect((await api.fetch('/api/table/Access%20Log', { headers: r.headers })).status).toBe(403)
      // Nor the snapshot registry — that is a System Manager's view.
      expect((await api.fetch('/api/table/Dataset%20Snapshot', { headers: r.headers })).status).toBe(403)
    } finally {
      _setSourceReader(null)
    }
  })
})

describe('#3755 sales-target host: assignment integrity and transfer', () => {
  test('one employee per store–subcategory pair: a second owner of 1501/010101003 is refused (417 on store_subcategory)', async ({ admin }) => {
    await seed(admin)
    await expect(
      admin.post('/api/save_row', {
        table: ASSIGNMENT_TABLE,
        row: { employee: 'test_employee_2', plant_code: '1501', material_group: '010101003' },
      }),
    ).rejects.toMatchObject({ status: 417, fields: { store_subcategory: expect.stringMatching(/unique/) } })
    // The same subcategory in the OTHER store is a different pair and fine.
    const other = await admin.post<{ store_subcategory: string }>('/api/save_row', {
      table: ASSIGNMENT_TABLE,
      row: { employee: 'test_employee_2', plant_code: '1599', material_group: '010101003' },
    })
    expect(other.store_subcategory).toBe('1599/010101003')
  })

  test('codes are exact strings: a three-digit store or an eight-digit subcategory is refused', async ({ admin }) => {
    await seed(admin)
    await expect(
      admin.post('/api/save_row', { table: ASSIGNMENT_TABLE, row: { employee: 'test_employee_1', plant_code: '150', material_group: '010101009' } }),
    ).rejects.toMatchObject({ status: 417, fields: { plant_code: expect.stringMatching(/four digits/) } })
    await expect(
      admin.post('/api/save_row', { table: ASSIGNMENT_TABLE, row: { employee: 'test_employee_1', plant_code: '1501', material_group: '10101009' } }),
    ).rejects.toMatchObject({ status: 417, fields: { material_group: expect.stringMatching(/nine digits/) } })
  })

  test('transfer: moving 1501/010101003 to Employee 2 through save_row changes the next opening for 1 and 2 only; restore works', async ({ admin, api }) => {
    await seed(admin)
    const calls = stubUpstream()
    const open = async (n: number) => {
      const r = await loginAs(api, `test_employee_${n}`, PASSWORDS[`test_employee_${n}`])
      const res = await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })
      expect(res.status).toBe(200)
      return (calls.at(-1)!.body.initial_state as { plant_code: string; material_groups: string[] })
    }
    const filters = encodeURIComponent(JSON.stringify([['store_subcategory', '=', '1501/010101003']]))
    const list = await admin.get<{ data: { row_id: string; updated_at: string }[] }>(
      `${TABLE_URL}?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`,
    )
    const row = list.data[0]
    const move = async (to: string) => {
      const current = await admin.get<{ updated_at: string }>(`${TABLE_URL}/${row.row_id}`)
      await admin.post('/api/save_row', {
        table: ASSIGNMENT_TABLE,
        row: { row_id: row.row_id, updated_at: current.updated_at, employee: to },
      })
    }

    await move('test_employee_2')
    expect(await open(1)).toEqual({ plant_code: '1501', material_groups: ['010101001'] , period_start: '2026-09-01', period_end: '2026-09-17' })
    expect(await open(2)).toEqual({ plant_code: '1501', material_groups: ['010101003', '010102001', '010102002'], period_start: '2026-09-01', period_end: '2026-09-17' })
    expect((await open(3)).material_groups).toEqual(['010101001', '010101003'])
    expect((await open(4)).material_groups).toEqual(['010102001', '010102002'])

    await move('test_employee_1')
    expect((await open(1)).material_groups).toEqual(['010101001', '010101003'])
    expect((await open(2)).material_groups).toEqual(['010102001', '010102002'])
    // Every opening minted a fresh session: one upstream call per opening, none cached.
    expect(calls).toHaveLength(6)
  })
})
