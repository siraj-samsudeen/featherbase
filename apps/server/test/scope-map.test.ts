// person-rename R2: getScopeMap(principal) is the ONE reader of data_scope,
// and it reads whichever principal column is set. A service account limited
// to one store's rows sees only those rows on every read path — list, count,
// get, search, report, realtime and a source-bound Table — exactly as a
// scoped person does. Export is built client-side from the list read.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import postgres from 'postgres'
import type { TestClient } from 'feather-testing-postgres'
import { makeClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { app } from '../src/index'
import { config } from '../src/config'
import { issueAccessToken, type SessionUser } from '../src/auth'
import { runReportChart } from '../src/report-chart'
import { canSubscribe } from '../src/realtime'
import { getScopeMap } from '../src/permissions'
import { invalidateSources } from '../src/sources/registry'

const STORE = 'Scope Store'
const ROLE = 'Scope Reader'
const EXT_URL_ENV = 'SCOPE_FIXTURE_URL'
process.env[EXT_URL_ENV] = config.databaseUrl
let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(config.databaseUrl, { max: 2 })
  await cli.unsafe(`drop schema if exists scope_fixture cascade`)
  await cli.unsafe(`create schema scope_fixture`)
  await cli.unsafe(`create table scope_fixture.till (id text primary key, label text, updated_at timestamptz not null default now())`)
  await cli.unsafe(`insert into scope_fixture.till (id, label) values ('T-ATK', 'scopeprobe atk till'), ('T-KNP', 'scopeprobe knp till')`)
})
afterAll(async () => {
  invalidateSources()
  await cli.unsafe(`drop schema if exists scope_fixture cascade`)
  await cli.end({ timeout: 2 })
})

async function world(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: STORE,
    id_pattern: 'prompt',
    title_column: 'label',
    columns: [{ column_name: 'label', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  for (const table of [STORE])
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: table, role: ROLE, can_read: true } })
  for (const code of ['ATK', 'KNP'])
    await admin.post(`/api/table/${encodeURIComponent(STORE)}`, { row_id: code, label: `scopeprobe ${code} store` })
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-scope', roles: [ROLE] })
  await admin.post('/api/save_row', {
    table: 'Data Scope',
    row: { service_account: account.row_id, allow_table: STORE, for_value: 'ATK' },
  })
  const { token } = await issueAccessToken(account.row_id, 'scope probe')
  return { svc: makeClient(app, token, account.row_id), id: account.row_id }
}

describe('getScopeMap: a scoped service account is narrowed everywhere', () => {
  test('the scope map reads the service_account column', async ({ admin }) => {
    const { id } = await world(admin)
    expect([...((await getScopeMap(id)).get(STORE) ?? [])]).toEqual(['ATK'])
  })

  test('list, count and get', async ({ admin }) => {
    const { svc } = await world(admin)
    const list = await svc.get<{ data: { row_id: string }[]; total: number }>(`/api/table/${encodeURIComponent(STORE)}`)
    expect(list.data.map((r) => r.row_id)).toEqual(['ATK'])
    expect(list.total).toBe(1)
    expect((await svc.get<{ count: number }>(`/api/table/${encodeURIComponent(STORE)}:count`)).count).toBe(1)
    await expect(svc.get(`/api/table/${encodeURIComponent(STORE)}/KNP`)).rejects.toMatchObject({ status: 403 })
    expect((await svc.get<{ row_id: string }>(`/api/table/${encodeURIComponent(STORE)}/ATK`)).row_id).toBe('ATK')
  })

  test('search', async ({ admin }) => {
    const { svc } = await world(admin)
    const { results } = await svc.get<{ results: { table: string; row_id: string }[] }>('/api/search?q=scopeprobe')
    expect(results.filter((h) => h.table === STORE).map((h) => h.row_id)).toEqual(['ATK'])
  })

  test('query report', async ({ admin }) => {
    const { id } = await world(admin)
    await admin.post('/api/save_row', {
      table: 'Report',
      row: { row_id: 'Scope Report', ref_table: STORE, report_type: 'Report Builder', config: { columns: ['label'], filters: [] } },
    })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Report', role: ROLE, can_read: true } })
    const { data } = await runReportChart({ report: 'Scope Report', label_field: 'label' }, id)
    expect(data.map((d) => d.label)).toEqual(['scopeprobe ATK store'])
  })

  test('realtime: a row outside the scope cannot be watched', async ({ admin }) => {
    const { id } = await world(admin)
    const user: SessionUser = { row_id: id, kind: 'service_account', email: null, full_name: 'svc-scope' }
    expect(await canSubscribe(user, `row:${STORE}:ATK`)).toBe(true)
    expect(await canSubscribe(user, `row:${STORE}:KNP`)).toBe(false)
  })

  test('a source-bound Table', async ({ admin }) => {
    const { svc, id } = await world(admin)
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      row_id: 'scope-fixture', engine: 'postgres', url_env: EXT_URL_ENV, default_schema: 'scope_fixture', access: 'read_only',
    })
    const reflected = await admin.post<{ created: { name: string }[] }>('/api/table/Data%20Source/scope-fixture:reflect', {
      schema: 'scope_fixture', tables: ['till'], prefix: 'Scope',
    })
    const bound = reflected.created[0].name
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: bound, role: ROLE, can_read: true } })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { service_account: id, allow_table: bound, for_value: 'T-ATK' } })
    const list = await svc.get<{ data: { row_id: string }[] }>(`/api/table/${encodeURIComponent(bound)}`)
    expect(list.data.map((r) => r.row_id)).toEqual(['T-ATK'])
    await expect(svc.get(`/api/table/${encodeURIComponent(bound)}/T-KNP`)).rejects.toMatchObject({ status: 403 })
  })
})
