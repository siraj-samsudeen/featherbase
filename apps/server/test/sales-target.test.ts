// #3755 personalised sales-target report host (src/sales-target.ts). Every
// test seeds the Table, role, four accounts and assignments inside its own
// sandbox transaction through the public API — the same seedSalesTarget()
// the script runs over HTTP — so nothing here depends on the shared
// .env.local. The upstream MotherDuck call is injected: no network, and the
// stub records exactly what the server would have sent.
import { afterAll, afterEach, beforeAll, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { applySeedPack } from '../src/seed-packs'
import { EMPLOYEE_CODE_SYSTEM, newIdentifierId } from '../src/person-identifiers'
import {
  ASSIGNMENT_TABLE,
  VIEWER_ROLE,
  _setEmbedFetch,
  seedSalesTarget,
  type AssignmentRecord,
} from '../src/sales-target'

// The report is month to date in IST; these fixtures were cut on 17-Sep-2026,
// so "today" is pinned there and every expected period below still means what it meant.
const savedToday = process.env.SALES_TARGET_TODAY
beforeAll(() => { process.env.SALES_TARGET_TODAY = '2026-09-17' })
afterAll(() => {
  if (savedToday === undefined) delete process.env.SALES_TARGET_TODAY
  else process.env.SALES_TARGET_TODAY = savedToday
})

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

// person-rename: the seeded viewers have minted ids (`psn_…`); tests know
// them by username.
async function idOf(username: string): Promise<string> {
  const [row] = await sql`select row_id from person where username = ${username}`
  if (!row) throw new Error(`no person with username ${username}`)
  return String(row.row_id)
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
    // person-identities: the seeded viewers carry no invented email.
    const emails = await sql`select email from person where username like 'test_employee_%'`
    expect(emails.map((r) => r.email)).toEqual([null, null, null, null])
  })

  test('each account logs in with its password and is told to land on /featherbase/sales-target; not a System Manager', async ({ admin, api }) => {
    await seed(admin)
    for (const [usr, pwd] of Object.entries(PASSWORDS)) {
      const r = await loginAs(api, usr, pwd)
      expect(r.status).toBe(200)
      expect(r.body.user?.row_id).toBe(await idOf(usr))
      expect(r.body.landing).toBe('/featherbase/sales-target')
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
    expect((await api.fetch('/api/table/Person', { headers: r.headers })).status).toBe(403)
  })

  // #279: a session token alone is not authorization — the role can be
  // revoked after the token was issued, and every route must check fresh.
  test('a signed-in account with no Viewer role is 403 on every sales_target route; no upstream call', async ({ admin, api, createUser }) => {
    await seed(admin)
    const calls = stubUpstream()
    const outsider = await createUser({ roles: [] })
    expect((await outsider.fetch('/api/sales_target/me')).status).toBe(403)
    expect((await outsider.fetch('/api/sales_target/embed_session', { method: 'POST' })).status).toBe(403)
    expect((await outsider.fetch('/api/sales_target/report')).status).toBe(403)
    expect(calls).toEqual([])
  })

  test('revoking the Viewer role mid-session denies the very next call on the same token; no upstream call, no row read', async ({ admin, api }) => {
    await seed(admin)
    const calls = stubUpstream()
    const r = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
    // Sanity: the token works before revocation.
    expect((await api.fetch('/api/sales_target/me', { headers: r.headers })).status).toBe(200)
    await sql`delete from has_role where parent = ${await idOf('test_employee_1')} and role = ${VIEWER_ROLE}`
    expect((await api.fetch('/api/sales_target/me', { headers: r.headers })).status).toBe(403)
    expect((await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })).status).toBe(403)
    expect((await api.fetch('/api/sales_target/report', { headers: r.headers })).status).toBe(403)
    expect(calls).toEqual([])
  })
})

describe('#3755 sales-target host: embed session from the current assignment', () => {
  test('Employee 1 and Employee 3: exact initial_state, service account, version, Dive ID, Bearer token; browser gets only {session}', async ({ admin, api }) => {
    await seed(admin)
    const calls = stubUpstream()
    const expected: Record<string, unknown> = {
      test_employee_1: { plant_code: '1501', material_groups: ['010101001', '010101003'], section_by_material_group: {}, period_start: '2026-09-01', period_end: '2026-09-17' },
      test_employee_3: { plant_code: '1515', material_groups: ['010101001', '010101003'], section_by_material_group: {}, period_start: '2026-09-01', period_end: '2026-09-17' },
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
    const nobody = await createUser({ email: 'test_employee_none@example.com', roles: [VIEWER_ROLE] })
    const res = await nobody.fetch('/api/sales_target/embed_session', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ no_assignment: true })
    const me = await nobody.get<{ assignment: unknown; stores: unknown; default_store: unknown }>('/api/sales_target/me')
    expect(me.assignment).toBeNull()
    expect(me.stores).toEqual([])
    expect(me.default_store).toBeNull()
    expect(calls).toEqual([])
  })

  test('the identity route carries the display chrome and never an amount or credential', async ({ admin, api }) => {
    await seed(admin)
    const r = await loginAs(api, 'test_employee_2', PASSWORDS.test_employee_2)
    const me = await (await api.fetch('/api/sales_target/me', { headers: r.headers })).json()
    expect(me).toEqual({
      username: 'test_employee_2',
      display_name: 'Employee 2',
      assignment: {
        plant_code: '1501', store_label: 'ATK', material_groups: ['010102001', '010102002'],
        sections: [], section_by_material_group: {}, scope_basis: ['assignment'],
      },
      stores: [{ plant_code: '1501', store_name: 'ATK', sections: [], scope_basis: ['assignment'] }],
      default_store: '1501',
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

  // #284: a configured-but-unreachable Dive must not be reported the same
  // way as a deliberately unconfigured one — the reader needs to know the
  // difference between "nothing to see here" and "something is broken".
  test('a configured but unreachable embed API is a 502, never the not_configured marker', async ({ admin, api }) => {
    await seed(admin)
    _setEmbedFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const r = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
    const res = await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { not_configured?: boolean; error?: { message?: string } }
    expect(body.not_configured).toBeUndefined()
    expect(body.error?.message).toContain('embed API unreachable')
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
        select "user", operation, ref_table, reference_name, method, scope from access_log
        where "user" = ${await idOf('test_employee_1')} and operation = 'view_report'`
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ ref_table: 'sales_target_mtd', method: 'live', reference_name: null, scope: 'store=1501' })
      // The viewer cannot read the log of their own reads.
      expect((await api.fetch('/api/table/Access%20Log', { headers: r.headers })).status).toBe(403)
      // Nor the snapshot registry — that is a System Manager's view.
      expect((await api.fetch('/api/table/Dataset%20Snapshot', { headers: r.headers })).status).toBe(403)
    } finally {
      _setSourceReader(null)
    }
  })
})

describe('The Access Log records the store opened', () => {
  test('a report served from the cache names the cached copy it came from', async ({ admin, api }) => {
    await seed(admin)
    const { _setSourceReader, SALES_TARGET_DATASET } = await import('../src/datasets/sales-target-mtd')
    const { buildSnapshot } = await import('../src/dataset-snapshot')
    const dayRows = [['1501', 'Attakulangara', 'ATK', '010101001', '2026-09-01', 100, 60], ['1501', 'Attakulangara', 'ATK', '010101003', '2026-09-01', 50, 20]]
    _setSourceReader(async (text: string) => {
      if (/merchandise_hierarchy/.test(text) && !/with cutoff/.test(text)) return [['010101001', 'Shirts'], ['010101003', 'Belts']]
      return /max\(actuals_as_of_date\)/.test(text) && !/with cutoff/.test(text) ? [['2026-09-17', 2]] : dayRows
    })
    try {
      const built = await buildSnapshot(SALES_TARGET_DATASET)
      expect(built.status).toBe('activated')
      const r = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
      const res = await api.fetch('/api/sales_target/report', { headers: r.headers })
      expect(((await res.json()) as { source: string }).source).toBe('snapshot')
      const rows = await sql`
        select method, reference_name, scope from access_log
        where "user" = ${await idOf('test_employee_1')} and operation = 'view_report'`
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ method: 'snapshot', reference_name: built.snapshotId, scope: 'store=1501' })
    } finally {
      _setSourceReader(null)
    }
  })
})

describe('#3783 sales-target host: the assignment is derived from the Store Sections maps', () => {
  // The two Tables the store maintains in Featherbase (featherbase/apps/store-sections in the
  // data-warehouse repo). Created here through the same public API the app manifest uses, with
  // the columns the derivation joins on; the real Tables carry more.
  async function seedSectionMaps(admin: TestClient) {
    for (const [name, columns] of [
      ['Section Merchandise Map', ['store_code', 'material_group', 'mch_subcategory', 'section_name']],
      ['Employee Section Map', ['store_code', 'employee_code', 'subcategory', 'section_name']],
    ] as const) {
      const meta = await admin.fetch(`/api/table/${encodeURIComponent(name)}:meta`)
      if (meta.status === 404)
        await admin.post('/api/table_def', {
          name, module: 'Store Sections',
          columns: columns.map((c) => ({ column_name: c, column_type: 'Data' })),
        })
    }
    // Kurti section at ATK holds two material groups; RR-0103 owns the Kurti subcategory.
    for (const row of [
      { store_code: '1501', material_group: '010505001', mch_subcategory: 'Kurti', section_name: 'Kurti' },
      { store_code: '1501', material_group: '010505002', mch_subcategory: 'Kurti Set', section_name: 'Kurti' },
      { store_code: '1515', material_group: '010505001', mch_subcategory: 'Kurti', section_name: 'Kurti' },
    ])
      await admin.post('/api/save_row', { table: 'Section Merchandise Map', row })
    for (const row of [
      { store_code: '1501', employee_code: 'RR-0103', subcategory: 'Kurti', section_name: 'Kurti' },
      { store_code: '1501', employee_code: 'RR-0103', subcategory: 'Kurti Set', section_name: 'Kurti' },
      { store_code: '1515', employee_code: 'RR-90001', subcategory: 'Kurti', section_name: 'Kurti' },
    ])
      await admin.post('/api/save_row', { table: 'Employee Section Map', row })
  }

  // #408: a person's employee code is a current `stylehr-employee-code` identifier row, recorded
  // the way the joiner procedure records it (by hand, with a note, while the roster sync is frozen).
  async function setEmployeeCode(admin: TestClient, username: string, code: string) {
    await applySeedPack('jeyarama')
    const res = await admin.fetch(`/api/people/${await idOf(username)}/identifiers`, {
      method: 'POST', body: JSON.stringify({ system: EMPLOYEE_CODE_SYSTEM, value: code, note: 'Joiner, HR mail' }),
    })
    expect(res.status).toBe(201)
  }

  test('an employee code on the user widens the assignment to the material groups their Sections hold', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await setEmployeeCode(admin, 'test_employee_2', 'RR-0103')
    const r = await loginAs(api, 'test_employee_2', PASSWORDS.test_employee_2)
    const me = (await (await api.fetch('/api/sales_target/me', { headers: r.headers })).json()) as { assignment: unknown }
    expect(me.assignment).toEqual({
      plant_code: '1501',
      store_label: 'ATK',
      // the two explicit rows plus the two Kurti material groups, once each, sorted
      material_groups: ['010102001', '010102002', '010505001', '010505002'],
      sections: ['Kurti'],
      section_by_material_group: { '010505001': 'Kurti', '010505002': 'Kurti' },
      scope_basis: ['assignment', 'section_staff'],
    })
  })

  test('an employee with mapped Sections and no assignment row is served from the maps alone', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await admin.post('/api/save_row', {
      table: 'Person',
      row: { username: 'test_employee_5', full_name: 'Employee 5', enabled: true, roles: [{ role: VIEWER_ROLE }] },
    })
    await setEmployeeCode(admin, 'test_employee_5', 'RR-0103')
    await admin.post('/api/set_password', { user: await idOf('test_employee_5'), password: 'sandbox-pw-5' })
    const r = await loginAs(api, 'test_employee_5', 'sandbox-pw-5')
    const me = (await (await api.fetch('/api/sales_target/me', { headers: r.headers })).json()) as { assignment: unknown }
    expect(me.assignment).toEqual({
      plant_code: '1501', store_label: null, material_groups: ['010505001', '010505002'], sections: ['Kurti'],
      section_by_material_group: { '010505001': 'Kurti', '010505002': 'Kurti' }, scope_basis: ['section_staff'],
    })
  })

  // #409: a person whose scope spans two stores reads one store at a time and switches between them.
  // test_employee_3 is assigned at 1515 (no Section map there); RR-0103's Kurti Sections are at 1501.
  test('a two-store person is served both stores; the default is the store with the most Sections', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await setEmployeeCode(admin, 'test_employee_3', 'RR-0103')
    const r = await loginAs(api, 'test_employee_3', PASSWORDS.test_employee_3)
    const res = await api.fetch('/api/sales_target/me', { headers: r.headers })
    expect(res.status).toBe(200)
    const me = (await res.json()) as { stores: unknown; default_store: string; assignment: { plant_code: string; material_groups: string[] } }
    expect(me.stores).toEqual([
      { plant_code: '1501', store_name: null, sections: ['Kurti'], scope_basis: ['section_staff'] },
      { plant_code: '1515', store_name: 'Kattakada', sections: [], scope_basis: ['assignment'] },
    ])
    // 1501 holds one Section, 1515 none: the default is 1501, and /me's assignment is that store's alone — never mixed.
    expect(me.default_store).toBe('1501')
    expect(me.assignment.plant_code).toBe('1501')
    expect(me.assignment.material_groups).toEqual(['010505001', '010505002'])
  })

  test('a store that comes only from the Section maps is named by the cached figures', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await setEmployeeCode(admin, 'test_employee_3', 'RR-0103')
    const { _setSourceReader, SALES_TARGET_DATASET } = await import('../src/datasets/sales-target-mtd')
    const { buildSnapshot } = await import('../src/dataset-snapshot')
    const dayRows = [['1501', 'Attakulangara', 'ATK', '010505001', '2026-09-01', 100, 60]]
    _setSourceReader(async (text: string) => {
      if (/merchandise_hierarchy/.test(text) && !/with cutoff/.test(text)) return [['010505001', 'Kurti']]
      return /max\(actuals_as_of_date\)/.test(text) && !/with cutoff/.test(text) ? [['2026-09-17', 1]] : dayRows
    })
    try {
      expect((await buildSnapshot(SALES_TARGET_DATASET)).status).toBe('activated')
      const r = await loginAs(api, 'test_employee_3', PASSWORDS.test_employee_3)
      const me = (await (await api.fetch('/api/sales_target/me', { headers: r.headers })).json()) as { stores: unknown }
      // 1501 has no assignment label (maps only): its name comes from the cache; 1515 keeps its label.
      expect(me.stores).toEqual([
        { plant_code: '1501', store_name: 'Attakulangara', sections: ['Kurti'], scope_basis: ['section_staff'] },
        { plant_code: '1515', store_name: 'Kattakada', sections: [], scope_basis: ['assignment'] },
      ])
    } finally {
      _setSourceReader(null)
    }
  })

  test('more Sections outrank a lower store code; an equal count falls to the lowest store code', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    // test_employee_1 is assigned at 1501 (unmapped groups, no Section); RR-90001 works Kurti at 1515.
    await setEmployeeCode(admin, 'test_employee_1', 'RR-90001')
    let r = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
    let me = (await (await api.fetch('/api/sales_target/me', { headers: r.headers })).json()) as { default_store: string; stores: { plant_code: string }[] }
    expect(me.stores.map((s) => s.plant_code)).toEqual(['1501', '1515'])
    expect(me.default_store).toBe('1515')

    // An administrator assigns test_employee_4 a second store by an explicit row: a second store, not a broken report.
    await admin.post('/api/save_row', { table: ASSIGNMENT_TABLE, row: { employee: await idOf('test_employee_4'), plant_code: '1501', store_label: 'ATK', material_group: '010909001' } })
    r = await loginAs(api, 'test_employee_4', PASSWORDS.test_employee_4)
    const res = await api.fetch('/api/sales_target/me', { headers: r.headers })
    expect(res.status).toBe(200)
    me = (await res.json()) as typeof me
    expect(me.stores.map((s) => s.plant_code)).toEqual(['1501', '1515'])
    expect(me.default_store).toBe('1501')
  })

  test('the store parameter picks one of the person\'s own stores on /report and /embed_session; /me always lists all and names the default', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await setEmployeeCode(admin, 'test_employee_3', 'RR-0103')
    const calls = stubUpstream()
    const { _setSourceReader } = await import('../src/datasets/sales-target-mtd')
    const reads: string[] = []
    _setSourceReader(async (text) => { reads.push(text); return [] })
    try {
      const r = await loginAs(api, 'test_employee_3', PASSWORDS.test_employee_3)
      // /me takes no store: it is the default store's assignment plus every store, whatever the URL says.
      const me = (await (await api.fetch('/api/sales_target/me?store=1515', { headers: r.headers })).json()) as { assignment: { plant_code: string }; default_store: string; stores: unknown[] }
      expect(me.assignment.plant_code).toBe('1501')
      expect(me.default_store).toBe('1501')
      expect(me.stores).toHaveLength(2)

      expect((await api.fetch('/api/sales_target/embed_session?store=1515', { method: 'POST', headers: r.headers })).status).toBe(200)
      expect((calls[0].body.initial_state as { plant_code: string; material_groups: string[] })).toMatchObject({ plant_code: '1515', material_groups: ['010101001', '010101003'] })
      // Without the parameter, or with it empty, the default store.
      await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })
      expect((calls[1].body.initial_state as { plant_code: string }).plant_code).toBe('1501')
      expect((await api.fetch('/api/sales_target/embed_session?store=', { method: 'POST', headers: r.headers })).status).toBe(200)
      expect((calls[2].body.initial_state as { plant_code: string }).plant_code).toBe('1501')

      expect((await api.fetch('/api/sales_target/report?store=1515', { headers: r.headers })).status).toBe(200)
      const scoped = reads.find((t) => t.includes('hierarchy_code in'))!
      expect(scoped).toContain("b.plant_code = '1515'")
      expect(scoped).not.toContain("'1501'")
      // The Access Log says which store was opened, so "who viewed which store" stays answerable.
      const logged = await sql`select scope from access_log where "user" = ${await idOf('test_employee_3')} and operation = 'view_report'`
      expect(logged.map((l) => l.scope)).toEqual(['store=1515'])
      expect((await api.fetch('/api/sales_target/report?store=', { headers: r.headers })).status).toBe(200)
      const both = await sql`select scope from access_log where "user" = ${await idOf('test_employee_3')} and operation = 'view_report' order by created_at`
      expect(both.map((l) => l.scope).sort()).toEqual(['store=1501', 'store=1515'])
    } finally {
      _setSourceReader(null)
    }
  })

  test('a store that is not the person\'s own is refused with 403, and nothing is minted or read', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await setEmployeeCode(admin, 'test_employee_3', 'RR-0103')
    const calls = stubUpstream()
    const { _setSourceReader } = await import('../src/datasets/sales-target-mtd')
    const reads: string[] = []
    _setSourceReader(async (text) => { reads.push(text); return [] })
    try {
      const r = await loginAs(api, 'test_employee_3', PASSWORDS.test_employee_3)
      // 1999 is nobody's; 'abc' is not a store code; a repeated parameter names no one store.
      for (const query of ['store=1999', 'store=abc', 'store=1501&store=1515', 'store=1501&store=1501']) {
        expect((await api.fetch(`/api/sales_target/report?${query}`, { headers: r.headers })).status).toBe(403)
        expect((await api.fetch(`/api/sales_target/embed_session?${query}`, { method: 'POST', headers: r.headers })).status).toBe(403)
      }
      // A single-store person cannot reach the other store either.
      const one = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
      expect((await api.fetch('/api/sales_target/embed_session?store=1515', { method: 'POST', headers: one.headers })).status).toBe(403)
      expect((await api.fetch('/api/sales_target/report?store=1515', { headers: one.headers })).status).toBe(403)
      expect(calls).toHaveLength(0)
      expect(reads).toHaveLength(0)
      expect(await sql`select 1 from access_log where operation = 'view_report'`).toHaveLength(0)
    } finally {
      _setSourceReader(null)
    }
  })

  test('a single-store person is served exactly as before: one store, and it is the default', async ({ admin, api }) => {
    await seed(admin)
    const r = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
    const me = (await (await api.fetch('/api/sales_target/me', { headers: r.headers })).json()) as Record<string, unknown>
    expect(me.stores).toEqual([{ plant_code: '1501', store_name: 'ATK', sections: [], scope_basis: ['assignment'] }])
    expect(me.default_store).toBe('1501')
    expect((me.assignment as { plant_code: string }).plant_code).toBe('1501')
    // Naming their own store is the same as naming none.
    stubUpstream()
    expect((await api.fetch('/api/sales_target/embed_session?store=1501', { method: 'POST', headers: r.headers })).status).toBe(200)
  })

  test('a store code that is not four digits is refused in plain words, with no id', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await admin.post('/api/save_row', { table: 'Section Merchandise Map', row: { store_code: '15O1', material_group: '010505009', mch_subcategory: 'Kurti Z', section_name: 'Kurti' } })
    await admin.post('/api/save_row', { table: 'Employee Section Map', row: { store_code: '15O1', employee_code: 'RR-11093', subcategory: 'Kurti Z', section_name: 'Kurti' } })
    await admin.post('/api/save_row', { table: 'Person', row: { username: 'bad_store_person', full_name: 'Bad Store', enabled: true, roles: [{ role: VIEWER_ROLE }] } })
    await setEmployeeCode(admin, 'bad_store_person', 'RR-11093')
    await admin.post('/api/set_password', { user: await idOf('bad_store_person'), password: 'pw-bad_store_person' })
    const b = await loginAs(api, 'bad_store_person', 'pw-bad_store_person')
    const res = await api.fetch('/api/sales_target/me', { headers: b.headers })
    expect(res.status).toBe(417)
    const body = (await res.json()) as { error: { message: string; fields?: unknown } }
    expect(body.error.message).toContain('not four digits')
    expect(body.error.message).not.toMatch(/psn_/)
    expect(body.error.message).toMatch(/administrator/i)
    expect(body.error.fields).toBeUndefined()
  })

  test('display_name never falls back to the opaque id: full name, then username, then email', async ({ admin, createUser }) => {
    await seed(admin)
    const nobody = await createUser({ email: 'no.fullname.me@example.com', roles: [VIEWER_ROLE] })
    await sql`update person set full_name = null where row_id = ${nobody.user!}`
    const me = await nobody.get<{ display_name: string }>('/api/sales_target/me')
    expect(me.display_name).toBe('no.fullname.me@example.com')
    expect(me.display_name).not.toMatch(/psn_/)
  })

  // #405: a person with no username (every StyleHR person) is not shown as their opaque id.
  test('the identity route reports no username for a person who has none, never the opaque id', async ({ admin, createUser }) => {
    await seed(admin)
    const nobody = await createUser({ email: 'no.username.me@example.com', fullName: 'Asha Nair', roles: [VIEWER_ROLE] })
    const me = await nobody.get<{ username: string | null; display_name: string }>('/api/sales_target/me')
    expect(me.username).toBeNull()
    expect(me.display_name).toBe('Asha Nair')
  })

  // The roster: who leads and who manages each Section. The merchandise map speaks merch Section
  // names, the roster its own; Section Name Alias joins the two.
  async function seedRoster(admin: TestClient, opts: { dmColumn: boolean; effectiveType?: 'Date' | 'Data' }) {
    const tables: [string, [string, string][]][] = [
      ['Section Ownership', [
        ['store_code', 'Data'], ['section_name', 'Data'], ['tl_employee_code', 'Data'],
        ['dm_name', 'Data'], ...(opts.dmColumn ? [['dm_employee_code', 'Data'] as [string, string]] : []), ['effective_from', opts.effectiveType ?? 'Date'],
      ]],
      ['Section Name Alias', [['store_code', 'Data'], ['merch_section_name', 'Data'], ['roster_section_name', 'Data']]],
    ]
    for (const [name, columns] of tables) {
      const meta = await admin.fetch(`/api/table/${encodeURIComponent(name)}:meta`)
      if (meta.status === 404)
        await admin.post('/api/table_def', {
          name, module: 'Store Sections',
          columns: columns.map(([c, t]) => ({ column_name: c, column_type: t })),
        })
    }
    // Boys Tops (merch) is "Boys Top" on the roster; Kurti is spelled the same in both.
    for (const row of [
      { store_code: '1501', material_group: '010101001', mch_subcategory: 'Boys Casual Shirt', section_name: 'Boys Tops' },
      { store_code: '1501', material_group: '010101002', mch_subcategory: 'Boys Formal Shirt', section_name: 'Boys Tops' },
      { store_code: '1501', material_group: '010102003', mch_subcategory: 'Boys Jeans', section_name: 'Boys Bottoms' },
    ])
      await admin.post('/api/save_row', { table: 'Section Merchandise Map', row })
    // Boys Top on the roster is TWO merchandise Sections: Boys Tops and Boys Bottoms.
    for (const merch of ['Boys Tops', 'Boys Bottoms'])
      await admin.post('/api/save_row', {
        table: 'Section Name Alias', row: { store_code: '1501', merch_section_name: merch, roster_section_name: 'Boys Top' },
      })
    const dm = (code: string) => (opts.dmColumn ? { dm_employee_code: code } : {})
    for (const row of [
      // The current roster (Sep 2026): TL-1 leads Kurti, TL-2 leads Boys Top; DM-1 manages both.
      { store_code: '1501', section_name: 'Kurti', tl_employee_code: 'RR-70001', dm_name: 'Dee', ...dm('RR-80001'), effective_from: '2026-09-01' },
      { store_code: '1501', section_name: 'Boys Top', tl_employee_code: 'RR-70002', dm_name: 'Dee', ...dm('RR-80001'), effective_from: '2026-09-01' },
      // A superseded roster names TL-9 on Kurti; a future one names TL-8. Neither is today's.
      { store_code: '1501', section_name: 'Kurti', tl_employee_code: 'RR-70009', dm_name: 'Old', ...dm('RR-80009'), effective_from: '2026-07-01' },
      { store_code: '1501', section_name: 'Kurti', tl_employee_code: 'RR-70008', dm_name: 'Next', ...dm('RR-80008'), effective_from: '2026-10-01' },
    ])
      await admin.post('/api/save_row', { table: 'Section Ownership', row })
  }

  async function viewer(admin: TestClient, user: string, code: string) {
    await admin.post('/api/save_row', {
      table: 'Person',
      row: { username: user, full_name: user, enabled: true, roles: [{ role: VIEWER_ROLE }] },
    })
    await setEmployeeCode(admin, user, code)
    await admin.post('/api/set_password', { user: await idOf(user), password: `pw-${user}` })
  }

  async function assignmentOf(api: TestClient, user: string) {
    const r = await loginAs(api, user, `pw-${user}`)
    const res = await api.fetch('/api/sales_target/me', { headers: r.headers })
    expect(res.status).toBe(200)
    return ((await res.json()) as { assignment: Record<string, unknown> | null }).assignment
  }

  test('a Team Leader sees every material group of the Section they lead, not only their own subcategories', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await seedRoster(admin, { dmColumn: true })
    await viewer(admin, 'tl_kurti', 'RR-70001')
    expect(await assignmentOf(api, 'tl_kurti')).toEqual({
      plant_code: '1501', store_label: null,
      material_groups: ['010505001', '010505002'],
      sections: ['Kurti'],
      section_by_material_group: { '010505001': 'Kurti', '010505002': 'Kurti' },
      scope_basis: ['team_leader'],
    })
  })

  test('a roster Section reaches every merchandise Section Section Name Alias maps it to', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await seedRoster(admin, { dmColumn: true })
    await viewer(admin, 'tl_boys', 'RR-70002')
    const a = await assignmentOf(api, 'tl_boys')
    expect(a?.material_groups).toEqual(['010101001', '010101002', '010102003'])
    expect(a?.sections).toEqual(['Boys Bottoms', 'Boys Tops'])
  })

  test("only each Section's current roster row counts: a superseded TL and a future-dated TL derive nothing", async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await seedRoster(admin, { dmColumn: true })
    await viewer(admin, 'tl_old', 'RR-70009')
    await viewer(admin, 'tl_next', 'RR-70008')
    await viewer(admin, 'tl_kurti', 'RR-70001')
    await viewer(admin, 'tl_boys', 'RR-70002')
    expect(await assignmentOf(api, 'tl_old')).toBeNull()
    expect(await assignmentOf(api, 'tl_next')).toBeNull()
    // Read on 01-Oct-2026 the October row is Kurti's current one, so September's Kurti TL drops
    // out and October's comes in — while Boys Top, which nobody re-rostered, keeps its TL.
    process.env.SALES_TARGET_TODAY = '2026-10-01'
    try {
      expect((await assignmentOf(api, 'tl_next'))?.sections).toEqual(['Kurti'])
      expect(await assignmentOf(api, 'tl_kurti')).toBeNull()
      expect((await assignmentOf(api, 'tl_boys'))?.sections).toEqual(['Boys Bottoms', 'Boys Tops'])
    } finally {
      process.env.SALES_TARGET_TODAY = '2026-09-17'
    }
  })

  test('a Department Manager sees every Section they manage, grouped by Section', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await seedRoster(admin, { dmColumn: true })
    await viewer(admin, 'dm_dee', 'RR-80001')
    expect(await assignmentOf(api, 'dm_dee')).toEqual({
      plant_code: '1501', store_label: null,
      material_groups: ['010101001', '010101002', '010102003', '010505001', '010505002'],
      sections: ['Boys Bottoms', 'Boys Tops', 'Kurti'],
      section_by_material_group: {
        '010101001': 'Boys Tops', '010101002': 'Boys Tops', '010102003': 'Boys Bottoms', '010505001': 'Kurti', '010505002': 'Kurti',
      },
      scope_basis: ['department_manager'],
    })
  })

  // A Store Manager runs the whole store: one Store Manager row per store names them, and their
  // scope is every material group the store's merchandise map holds, grouped by Section.
  async function seedStoreManagers(admin: TestClient) {
    const meta = await admin.fetch(`/api/table/${encodeURIComponent('Store Manager')}:meta`)
    if (meta.status === 404)
      await admin.post('/api/table_def', {
        name: 'Store Manager', module: 'Store Sections',
        columns: ['store_code', 'employee_code', 'full_name', 'email'].map((c) => ({ column_name: c, column_type: 'Data' })),
      })
    for (const row of [
      { store_code: '1501', employee_code: 'RR-0104', full_name: 'A. Kumar', email: 'sm.atk@jeyarama.com' },
      { store_code: '1515', employee_code: 'RR-0105', full_name: 'B. Raman', email: 'sm.kat@jeyarama.com' },
    ])
      await admin.post('/api/save_row', { table: 'Store Manager', row })
  }

  test('a Store Manager sees every material group of their store, grouped by Section', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await seedRoster(admin, { dmColumn: true })
    await seedStoreManagers(admin)
    await viewer(admin, 'sm_atk', 'RR-0104')
    expect(await assignmentOf(api, 'sm_atk')).toEqual({
      plant_code: '1501', store_label: null,
      material_groups: ['010101001', '010101002', '010102003', '010505001', '010505002'],
      sections: ['Boys Bottoms', 'Boys Tops', 'Kurti'],
      section_by_material_group: {
        '010101001': 'Boys Tops', '010101002': 'Boys Tops', '010102003': 'Boys Bottoms', '010505001': 'Kurti', '010505002': 'Kurti',
      },
      scope_basis: ['store_manager'],
    })
  })

  test("a Store Manager's scope stops at their own store; without the Table nobody is a Store Manager", async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await viewer(admin, 'sm_kat', 'RR-0105')
    expect(await assignmentOf(api, 'sm_kat')).toBeNull()
    await seedStoreManagers(admin)
    const a = await assignmentOf(api, 'sm_kat')
    expect(a?.plant_code).toBe('1515')
    expect(a?.material_groups).toEqual(['010505001'])
    expect(a?.scope_basis).toEqual(['store_manager'])
  })

  test('the embed session carries the Section of every group, so the Dive can group by it', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await seedRoster(admin, { dmColumn: true })
    await viewer(admin, 'dm_dee', 'RR-80001')
    const calls = stubUpstream()
    const r = await loginAs(api, 'dm_dee', 'pw-dm_dee')
    expect((await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })).status).toBe(200)
    expect(calls[0].body.initial_state).toEqual({
      plant_code: '1501',
      material_groups: ['010101001', '010101002', '010102003', '010505001', '010505002'],
      section_by_material_group: {
        '010101001': 'Boys Tops', '010101002': 'Boys Tops', '010102003': 'Boys Bottoms', '010505001': 'Kurti', '010505002': 'Kurti',
      },
      period_start: '2026-09-01',
      period_end: '2026-09-17',
    })
  })

  test('a Team Leader who is also rostered on subcategories gets both, once each, and is told both', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await seedRoster(admin, { dmColumn: true })
    // RR-70001 leads Kurti AND is personally rostered on Kurti Set (inside the Section) and on a
    // subcategory of another Section.
    for (const row of [
      { store_code: '1501', employee_code: 'RR-70001', subcategory: 'Kurti Set', section_name: 'Kurti' },
      { store_code: '1501', employee_code: 'RR-70001', subcategory: 'Boys Jeans', section_name: 'Boys Bottoms' },
    ])
      await admin.post('/api/save_row', { table: 'Employee Section Map', row })
    await viewer(admin, 'tl_kurti', 'RR-70001')
    const a = await assignmentOf(api, 'tl_kurti')
    expect(a?.material_groups).toEqual(['010102003', '010505001', '010505002'])
    expect(a?.scope_basis).toEqual(['section_staff', 'team_leader'])
  })

  test('two Team Leaders on one Section from the same day both see it; an undated row is in force', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await seedRoster(admin, { dmColumn: true })
    for (const row of [
      { store_code: '1501', section_name: 'Kurti', tl_employee_code: 'RR-70003', dm_name: 'Dee', effective_from: '2026-09-01' },
      { store_code: '1501', section_name: 'Silk Saree', tl_employee_code: 'RR-70004', dm_name: 'Dee', effective_from: null },
    ])
      await admin.post('/api/save_row', { table: 'Section Ownership', row })
    await admin.post('/api/save_row', {
      table: 'Section Merchandise Map', row: { store_code: '1501', material_group: '010303001', mch_subcategory: 'Silk Saree', section_name: 'Silk Saree' },
    })
    await viewer(admin, 'tl_kurti', 'RR-70001')
    await viewer(admin, 'tl_kurti_2', 'RR-70003')
    await viewer(admin, 'tl_silk', 'RR-70004')
    expect((await assignmentOf(api, 'tl_kurti'))?.sections).toEqual(['Kurti'])
    expect((await assignmentOf(api, 'tl_kurti_2'))?.sections).toEqual(['Kurti'])
    expect((await assignmentOf(api, 'tl_silk'))?.material_groups).toEqual(['010303001'])
  })

  test('a malformed roster date loses only its own row; a slash date is never read month-first', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    // A roster Table that declared effective_from as text, holding one bad and one slash cell.
    await seedRoster(admin, { dmColumn: true, effectiveType: 'Data' })
    for (const row of [
      { store_code: '1501', section_name: 'Kurti', tl_employee_code: 'RR-70005', dm_name: 'Dee', effective_from: 'next month' },
      { store_code: '1501', section_name: 'Kurti', tl_employee_code: 'RR-70006', dm_name: 'Dee', effective_from: '06/08/2026' },
    ])
      await admin.post('/api/save_row', { table: 'Section Ownership', row })
    await viewer(admin, 'tl_kurti', 'RR-70001')
    await viewer(admin, 'tl_bad', 'RR-70005')
    await viewer(admin, 'tl_slash', 'RR-70006')
    expect((await assignmentOf(api, 'tl_kurti'))?.sections).toEqual(['Kurti'])
    expect(await assignmentOf(api, 'tl_bad')).toBeNull()
    expect(await assignmentOf(api, 'tl_slash')).toBeNull()
  })

  test('Section names match whatever their spacing and case; a code that is not nine digits never reaches a query', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await seedRoster(admin, { dmColumn: true })
    await admin.post('/api/save_row', {
      table: 'Section Ownership',
      row: { store_code: '1501', section_name: '  kurti ', tl_employee_code: 'RR-70007', dm_name: 'Dee', effective_from: '2026-09-02' },
    })
    await admin.post('/api/save_row', {
      table: 'Section Merchandise Map',
      row: { store_code: '1501', material_group: "0105'; drop", mch_subcategory: 'Kurti Misc', section_name: 'Kurti' },
    })
    await viewer(admin, 'tl_spaced', 'RR-70007')
    const calls = stubUpstream()
    const a = await assignmentOf(api, 'tl_spaced')
    expect(a?.material_groups).toEqual(['010505001', '010505002'])
    const r = await loginAs(api, 'tl_spaced', 'pw-tl_spaced')
    expect((await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })).status).toBe(200)
    expect(JSON.stringify(calls[0].body.initial_state)).not.toContain('drop')
  })

  test('without a dm_employee_code column on Section Ownership, a manager derives nothing from the roster', async ({ admin, api }) => {
    await seed(admin)
    await seedSectionMaps(admin)
    await seedRoster(admin, { dmColumn: false })
    await viewer(admin, 'dm_dee', 'RR-80001')
    expect(await assignmentOf(api, 'dm_dee')).toBeNull()
  })

  test('without the Store Sections Tables, or without an employee code, nothing changes', async ({ admin, api }) => {
    await seed(admin)
    const r = await loginAs(api, 'test_employee_1', PASSWORDS.test_employee_1)
    const me = (await (await api.fetch('/api/sales_target/me', { headers: r.headers })).json()) as { assignment: { material_groups: string[]; sections: string[] } }
    expect(me.assignment.material_groups).toEqual(['010101001', '010101003'])
    expect(me.assignment.sections).toEqual([])
  })
})

describe('#408 the scope follows the person\'s current employee-code identifier rows', () => {
  /** A code row written as a feed or the migration writes it: any period, any firm. */
  async function codeRow(username: string, value: string, opts: { from?: string; to?: string; assigner?: string } = {}) {
    await applySeedPack('jeyarama')
    await sql`
      insert into person_identifier (id, person_id, system, assigner, value, valid, verified, one_holder, source, recorded_by)
      values (${newIdentifierId()}, ${await idOf(username)}, ${EMPLOYEE_CODE_SYSTEM}, ${opts.assigner ?? ''}, ${value},
        daterange(${opts.from ?? '2024-01-01'}::date, ${opts.to ?? null}::date, '[)'), true, true, 'test', 'test')`
  }

  async function maps(admin: TestClient) {
    for (const [name, columns] of [
      ['Section Merchandise Map', ['store_code', 'material_group', 'mch_subcategory', 'section_name']],
      ['Employee Section Map', ['store_code', 'employee_code', 'subcategory', 'section_name']],
      ['Section Ownership', ['store_code', 'section_name', 'tl_employee_code', 'effective_from']],
    ] as const)
      if ((await admin.fetch(`/api/table/${encodeURIComponent(name)}:meta`)).status === 404)
        await admin.post('/api/table_def', { name, module: 'Store Sections', columns: columns.map((c) => ({ column_name: c, column_type: 'Data' })) })
    for (const row of [
      { store_code: '1501', material_group: '010505001', mch_subcategory: 'Kurti', section_name: 'Kurti' },
      { store_code: '1501', material_group: '010505002', mch_subcategory: 'Kurti Set', section_name: 'Kurti' },
      { store_code: '1501', material_group: '010101002', mch_subcategory: 'Boys Formal Shirt', section_name: 'Boys Tops' },
    ])
      await admin.post('/api/save_row', { table: 'Section Merchandise Map', row })
    // RR-0101 works the Kurti subcategory; RR-0202 leads Boys Tops.
    await admin.post('/api/save_row', { table: 'Employee Section Map', row: { store_code: '1501', employee_code: 'RR-0101', subcategory: 'Kurti', section_name: 'Kurti' } })
    await admin.post('/api/save_row', { table: 'Section Ownership', row: { store_code: '1501', section_name: 'Boys Tops', tl_employee_code: 'RR-0202', effective_from: '2026-09-01' } })
  }

  async function reader(admin: TestClient, username: string) {
    await admin.post('/api/save_row', { table: 'Person', row: { username, full_name: username, enabled: true, roles: [{ role: VIEWER_ROLE }] } })
    await admin.post('/api/set_password', { user: await idOf(username), password: `pw-${username}` })
  }

  async function scopeOf(api: TestClient, username: string) {
    const r = await loginAs(api, username, `pw-${username}`)
    const res = await api.fetch('/api/sales_target/me', { headers: r.headers })
    expect(res.status).toBe(200)
    return ((await res.json()) as { assignment: { material_groups: string[]; scope_basis: string[] } | null }).assignment
  }

  async function embed(api: TestClient, username: string) {
    const r = await loginAs(api, username, `pw-${username}`)
    return (await api.fetch('/api/sales_target/embed_session', { method: 'POST', headers: r.headers })).json()
  }

  test('one current code gives that code\'s sections', async ({ admin, api }) => {
    await seed(admin); await maps(admin); await reader(admin, 'staff_a')
    await codeRow('staff_a', 'RR-0101')
    expect((await scopeOf(api, 'staff_a'))?.material_groups).toEqual(['010505001'])
  })

  test('several current codes give the union of their sections, each basis once', async ({ admin, api }) => {
    await seed(admin); await maps(admin); await reader(admin, 'two_posts')
    await codeRow('two_posts', 'RR-0101', { assigner: '12' })
    await codeRow('two_posts', 'RR-0202', { assigner: '7' })
    const a = await scopeOf(api, 'two_posts')
    expect(a?.material_groups).toEqual(['010101002', '010505001'])
    expect(a?.scope_basis).toEqual(['section_staff', 'team_leader'])
  })

  test('an ended code gives nothing; the person\'s current code still counts', async ({ admin, api }) => {
    await seed(admin); await maps(admin); await reader(admin, 'moved_on')
    await codeRow('moved_on', 'RR-0202', { from: '2024-01-01', to: '2026-01-01' })
    expect(await scopeOf(api, 'moved_on')).toBeNull()
    await codeRow('moved_on', 'RR-0101', { from: '2026-01-01' })
    expect((await scopeOf(api, 'moved_on'))?.material_groups).toEqual(['010505001'])
  })

  test('a code current on two people (two firms) scopes neither person at all: no_assignment, and a structured alert', async ({ admin, api }) => {
    await seed(admin); await maps(admin); await reader(admin, 'firm_a'); await reader(admin, 'firm_b')
    await codeRow('firm_a', 'RR-0101', { assigner: '12' })
    await codeRow('firm_b', 'RR-0101', { assigner: '7' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await scopeOf(api, 'firm_a')).toBeNull()
      expect(await embed(api, 'firm_b')).toEqual({ no_assignment: true })
      // #409: blocked means no store at all — naming one is refused, not a way back in.
      const fa = await loginAs(api, 'firm_a', 'pw-firm_a')
      expect((await api.fetch('/api/sales_target/embed_session?store=1501', { method: 'POST', headers: fa.headers })).status).toBe(403)
      const alerts = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('sales_target_ambiguous_employee_code'))
      expect(alerts.length).toBeGreaterThan(0)
      const alert = JSON.parse(alerts[0]) as Record<string, unknown>
      expect(alert).toMatchObject({ event: 'sales_target_ambiguous_employee_code', person: await idOf('firm_a'), holders: 2 })
      // The alert names rows, never the code itself.
      expect(alerts.join('\n')).not.toContain('RR-0101')
    } finally {
      warn.mockRestore()
    }
    // D10: ANY ambiguous current code blocks the whole person — an unshared second code does not
    // reopen a partial scope, and neither does an explicit assignment row.
    await codeRow('firm_a', 'RR-0202', { assigner: '12' })
    await admin.post('/api/save_row', { table: ASSIGNMENT_TABLE, row: { employee: await idOf('firm_a'), plant_code: '1501', store_label: 'ATK', material_group: '010909001' } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await scopeOf(api, 'firm_a')).toBeNull()
    expect(await embed(api, 'firm_a')).toEqual({ no_assignment: true })
    vi.restoreAllMocks()
    // Ending the other holder's code (the leaver procedure) unblocks both of firm_a's codes.
    await sql`update person_identifier set valid = daterange(lower(valid), '2026-01-01', '[)') where person_id = ${await idOf('firm_b')}`
    expect((await scopeOf(api, 'firm_a'))?.material_groups).toEqual(['010101002', '010505001', '010909001'])
  })

  test('#408 repro: editing the Person cannot move a scope — there is no employee_code field to type over', async ({ admin, api }) => {
    await seed(admin); await maps(admin); await reader(admin, 'staff_b')
    await codeRow('staff_b', 'RR-0101')
    const id = await idOf('staff_b')
    const meta = await admin.get<{ columns: { column_name: string }[] }>('/api/table/Person:meta')
    expect(meta.columns.map((c) => c.column_name)).not.toContain('employee_code')
    expect(meta.columns.map((c) => c.column_name)).not.toContain('stylehr_username')
    const doc = await admin.get<Record<string, unknown>>(`/api/table/Person/${id}`)
    expect(doc).not.toHaveProperty('employee_code')
    // The issue's step 1: save the Person with another person's (a Team Leader's) code.
    await admin.fetch('/api/save_row', {
      method: 'POST', body: JSON.stringify({ table: 'Person', row: { row_id: id, employee_code: 'RR-0202', updated_at: doc.updated_at } }),
    })
    const a = await scopeOf(api, 'staff_b')
    expect(a?.material_groups).toEqual(['010505001'])
    expect(a?.scope_basis).toEqual(['section_staff'])
  })
})

describe('#3755 sales-target host: assignment integrity and transfer', () => {
  test('one employee per store–subcategory pair: a second owner of 1501/010101003 is refused (417 on store_subcategory)', async ({ admin }) => {
    await seed(admin)
    await expect(
      admin.post('/api/save_row', {
        table: ASSIGNMENT_TABLE,
        row: { employee: await idOf('test_employee_2'), plant_code: '1501', material_group: '010101003' },
      }),
    ).rejects.toMatchObject({ status: 417, fields: { store_subcategory: expect.stringMatching(/unique/) } })
    // The same subcategory in the OTHER store is a different pair and fine.
    const other = await admin.post<{ store_subcategory: string }>('/api/save_row', {
      table: ASSIGNMENT_TABLE,
      row: { employee: await idOf('test_employee_2'), plant_code: '1599', material_group: '010101003' },
    })
    expect(other.store_subcategory).toBe('1599/010101003')
  })

  test('codes are exact strings: a three-digit store or an eight-digit subcategory is refused', async ({ admin }) => {
    await seed(admin)
    await expect(
      admin.post('/api/save_row', { table: ASSIGNMENT_TABLE, row: { employee: await idOf('test_employee_1'), plant_code: '150', material_group: '010101009' } }),
    ).rejects.toMatchObject({ status: 417, fields: { plant_code: expect.stringMatching(/four digits/) } })
    await expect(
      admin.post('/api/save_row', { table: ASSIGNMENT_TABLE, row: { employee: await idOf('test_employee_1'), plant_code: '1501', material_group: '10101009' } }),
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
        row: { row_id: row.row_id, updated_at: current.updated_at, employee: await idOf(to) },
      })
    }

    await move('test_employee_2')
    expect(await open(1)).toEqual({ plant_code: '1501', material_groups: ['010101001'], section_by_material_group: {}, period_start: '2026-09-01', period_end: '2026-09-17' })
    expect(await open(2)).toEqual({ plant_code: '1501', material_groups: ['010101003', '010102001', '010102002'], section_by_material_group: {}, period_start: '2026-09-01', period_end: '2026-09-17' })
    expect((await open(3)).material_groups).toEqual(['010101001', '010101003'])
    expect((await open(4)).material_groups).toEqual(['010102001', '010102002'])

    await move('test_employee_1')
    expect((await open(1)).material_groups).toEqual(['010101001', '010101003'])
    expect((await open(2)).material_groups).toEqual(['010102001', '010102002'])
    // Every opening minted a fresh session: one upstream call per opening, none cached.
    expect(calls).toHaveLength(6)
  })
})

describe('the report period is month to date in India Standard Time', () => {
  test('the first of the IST month through today; IST midnight, not UTC, rolls the month', async () => {
    const { currentPeriod } = await import('../src/sales-target')
    const saved = process.env.SALES_TARGET_TODAY
    delete process.env.SALES_TARGET_TODAY
    try {
      // 30-Sep-2026 19:00 UTC is 01-Oct-2026 00:30 IST.
      expect(currentPeriod(new Date('2026-09-30T19:00:00Z'))).toEqual({ period_start: '2026-10-01', period_end: '2026-10-01' })
      expect(currentPeriod(new Date('2026-09-30T18:00:00Z'))).toEqual({ period_start: '2026-09-01', period_end: '2026-09-30' })
      process.env.SALES_TARGET_TODAY = '2026-02-14'
      expect(currentPeriod(new Date('2026-09-30T19:00:00Z'))).toEqual({ period_start: '2026-02-01', period_end: '2026-02-14' })
      process.env.SALES_TARGET_TODAY = '14-Feb-2026'
      expect(() => currentPeriod()).toThrow(/ISO day/)
      process.env.SALES_TARGET_TODAY = '2026-02-30' // the right shape, not a day
      expect(() => currentPeriod()).toThrow(/ISO day/)
    } finally {
      if (saved === undefined) delete process.env.SALES_TARGET_TODAY
      else process.env.SALES_TARGET_TODAY = saved
    }
  })
})

describe('the shared experiment inputs the seed script reads', () => {
  test('KEY=VALUE lines are read, comments and quotes handled, and a missing file reads as empty', async () => {
    const { readSharedEnv, sharedEnvPath, DEFAULT_SHARED_ENV } = await import('../src/sales-target')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'st-env-'))
    const file = join(dir, '.env.local')
    writeFileSync(file, '# a comment\nTEST_EMPLOYEE_1_PASSWORD="pw one"\nDIVE_ID=abc\n  SERVICE_ACCOUNT = svc \nnot a line\n')
    expect(readSharedEnv(file)).toEqual({ TEST_EMPLOYEE_1_PASSWORD: 'pw one', DIVE_ID: 'abc', SERVICE_ACCOUNT: 'svc' })
    expect(readSharedEnv(join(dir, 'absent'))).toEqual({})

    const saved = process.env.SALES_TARGET_SHARED_ENV
    try {
      delete process.env.SALES_TARGET_SHARED_ENV
      expect(sharedEnvPath()).toBe(DEFAULT_SHARED_ENV)
      process.env.SALES_TARGET_SHARED_ENV = file
      expect(sharedEnvPath()).toBe(file)
    } finally {
      if (saved === undefined) delete process.env.SALES_TARGET_SHARED_ENV
      else process.env.SALES_TARGET_SHARED_ENV = saved
    }
  })

  test('embed settings fall back to the shared file when the process sets none', async () => {
    const { embedConfig } = await import('../src/sales-target')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const file = join(mkdtempSync(join(tmpdir(), 'st-env-')), '.env.local')
    writeFileSync(file, 'DIVE_ID=from-file\nDIVE_VERSION=7\nSERVICE_ACCOUNT=svc-file\n')
    const keys = ['DIVE_ID', 'DIVE_VERSION', 'SERVICE_ACCOUNT', 'SALES_TARGET_SHARED_ENV'] as const
    const saved = keys.map((k) => process.env[k])
    for (const k of keys) delete process.env[k]
    process.env.SALES_TARGET_SHARED_ENV = file
    try {
      expect(embedConfig()).toMatchObject({ diveId: 'from-file', version: 7, serviceAccount: 'svc-file' })
    } finally {
      keys.forEach((k, i) => {
        if (saved[i] === undefined) delete process.env[k]
        else process.env[k] = saved[i]
      })
    }
  })

  test('the four test-employee passwords are picked from TEST_EMPLOYEE_N_PASSWORD, skipping any left unset', async () => {
    const { testPasswords } = await import('../src/sales-target')
    expect(testPasswords({ TEST_EMPLOYEE_1_PASSWORD: 'a', TEST_EMPLOYEE_3_PASSWORD: 'c', OTHER: 'x' })).toEqual({
      test_employee_1: 'a',
      test_employee_3: 'c',
    })
  })
})

describe('the embed session request over a real connection', () => {
  test('the default fetch posts to the configured API base, and a non-JSON refusal is reported by its text', async () => {
    const { createServer } = await import('node:http')
    const { createEmbedSession } = await import('../src/sales-target')
    const seen: { url?: string; auth?: string }[] = []
    let answer: { status: number; body: string } = { status: 200, body: JSON.stringify({ session: 'live-session' }) }
    const server = createServer((req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization })
      res.writeHead(answer.status, { 'content-type': 'text/plain' })
      res.end(answer.body)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as { port: number }
    process.env.MOTHERDUCK_TOKEN = 'tok'
    const cfg = { apiBase: `http://127.0.0.1:${port}`, diveId: 'd 1', version: 2, serviceAccount: 'svc' }
    try {
      expect(await createEmbedSession({} as never, cfg)).toEqual({ ok: true, session: 'live-session', status: 200 })
      expect(seen[0]).toEqual({ url: '/v1/dives/d%201/embed-session', auth: 'Bearer tok' })
      answer = { status: 502, body: '<html>Bad gateway</html>' }
      expect(await createEmbedSession({} as never, cfg)).toEqual({
        ok: false,
        status: 502,
        error: 'embed API answered HTTP 502: <html>Bad gateway</html>',
        kind: 'unreachable',
      })
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})

describe('assignments for people the seed did not create', () => {
  test('an assignment naming an existing person by username reaches that person', async ({ admin }) => {
    const { makePerson } = await import('./fixtures')
    await seedSalesTarget((path, init) => admin.fetch(path, init), PASSWORDS, [])
    const outsider = await makePerson({ username: 'outside_employee', full_name: 'Outside Employee', roles: [{ role: VIEWER_ROLE }] })
    const result = await seedSalesTarget((path, init) => admin.fetch(path, init), PASSWORDS, [
      { username: 'outside_employee', display_name: 'Outside Employee', plant_code: '1501', store_label: 'ATK', material_groups: ['010101009'] },
    ])
    expect(result.assignments).toEqual(['1501/010101009'])
    const listed = await admin.get<{ data: { employee: string }[] }>(`${TABLE_URL}?filters=${encodeURIComponent(JSON.stringify([['store_subcategory', '=', '1501/010101009']]))}&fields=${encodeURIComponent('["employee"]')}`)
    expect(listed.data.map((r) => r.employee)).toEqual([outsider])
  })
})
