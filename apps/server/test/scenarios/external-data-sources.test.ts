// external-data-sources' fenced scenarios that the server alone proves
// (#1070): table restrictions, exploring a connected source through the API,
// and a warehouse that stays read-only. Each test is one scenario of
// openspec/specs/external-data-sources/spec.md, step by step; the scenarios a
// person reads on screen are in apps/web/test/scenarios/.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import postgres from 'postgres'
import type { TestClient } from 'feather-testing-postgres'
import { config } from '../../src/config'
import { sql } from '../../src/db'
import { overrideVariable } from '../../src/env'
import { invalidateSources } from '../../src/sources/registry'
import { test } from '../pg-test'
import { expectRefused, expectStatus } from '../fixtures'
import { buildStandin, STANDIN_TOKENS } from '../motherduck-standin'
import { EXPLORE_FLOOR, EXPLORE_STORE, dropExploreSource, exploreSource, manyStores } from '../explore-source'
import { scenarioFor, type Example } from '../scenario'

const scenario = scenarioFor(test, 'external-data-sources')
type Body = { error?: { type?: string; message?: string; fields?: Record<string, string> }; created?: { name: string; table: string }[]; skipped?: unknown[] }

// ---- Table restrictions (#780). Saving and connecting use the public API;
// only a Given installs legacy text directly, since today's save validation
// must not admit yesterday's rows.

const cleanups: (() => Promise<void>)[] = []
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {})
  invalidateSources()
})

class Restrictions {
  source: Record<string, unknown>
  requested = ''
  response!: Response
  body: Body = {}
  constructor(private admin: TestClient, engine: string, namespace: string) {
    this.source = {
      row_id: `allowlist-${randomUUID()}`, engine, default_schema: namespace, access: 'read_only',
      // Unique and unset: a successful SQL save therefore proves registration needs no connection.
      url_env: `SCENARIO_UNSET_${randomUUID().replaceAll('-', '_')}`,
    }
  }

  async prepare() {
    if (this.source.engine !== 'csv-folder') return
    const folder = await mkdtemp(path.join(tmpdir(), 'featherbase-allowlist-'))
    cleanups.push(() => rm(folder, { recursive: true, force: true }))
    this.source.root_path = folder
    delete this.source.url_env
  }

  async save(entry: string) {
    this.requested = entry
    this.response = await this.admin.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Data Source', row: { ...this.source, table_allowlist: entry } }) })
    this.body = (await this.response.clone().json()) as Body
  }

  async register(entry: string) {
    await this.save(entry)
    await this.expectRegistered(entry)
    this.source = await this.admin.get(`/api/table/Data%20Source/${encodeURIComponent(String(this.source.row_id))}`)
  }

  async expectRefused(format: string) {
    await expectStatus(this.response, 417)
    expect(this.body.error?.type).toBe('ValidationError')
    const guidance = this.body.error?.fields?.table_allowlist
    expect(typeof guidance, 'the correction belongs to the table restriction field').toBe('string')
    expect(guidance).toContain(format)
  }

  async expectNotRegistered() {
    const res = await this.admin.fetch(`/api/table/Data%20Source/${encodeURIComponent(String(this.source.row_id))}`)
    await expectStatus(res, 404)
  }

  async expectRegistered(entry = this.requested) {
    await expectStatus(this.response, 201)
    await this.expectStored(entry)
  }

  async expectStored(entry: string) {
    const stored = await this.admin.get<{ table_allowlist: string }>(`/api/table/Data%20Source/${encodeURIComponent(String(this.source.row_id))}`)
    expect(stored.table_allowlist, 'the stored restriction stays exact').toBe(entry)
  }

  /** A source on a database of its own with a public stores table, its stored restriction set past today's validation. */
  async legacy(entry: string) {
    const name = `scenario_allowlist_${randomUUID().replaceAll('-', '')}`
    const control = new URL(config.databaseUrl)
    const maintenance = postgres(control.toString(), { max: 1, onnotice: () => {} })
    await maintenance.unsafe(`create database "${name}"`)
    cleanups.push(async () => {
      invalidateSources()
      try { await maintenance.unsafe(`drop database "${name}" with (force)`) } finally { await maintenance.end({ timeout: 5 }) }
    })
    const url = new URL(control)
    url.pathname = `/${name}`
    const outside = postgres(url.toString(), { max: 1, onnotice: () => {} })
    try {
      await outside`create table public.stores (id integer primary key, note text)`
      await outside`insert into public.stores (id, note) values (1, 'legacy allowlist fixture')`
    } finally { await outside.end({ timeout: 5 }) }
    await this.save('')
    await expectStatus(this.response, 201)
    const updated = await sql`update data_source set table_allowlist = ${entry} where row_id = ${String(this.source.row_id)} returning row_id`
    expect(updated, 'exactly this source gets legacy text').toHaveLength(1)
    process.env[String(this.source.url_env)] = url.toString()
    cleanups.push(async () => { delete process.env[String(this.source.url_env)] })
    invalidateSources()
    await this.expectStored(entry)
  }

  async connectStores() {
    this.response = await this.admin.fetch(`/api/table/Data%20Source/${encodeURIComponent(String(this.source.row_id))}:reflect`, {
      method: 'POST', body: JSON.stringify({ schema: 'public', tables: ['stores'], prefix: `Allowlist ${randomUUID().replaceAll('-', '')}` }),
    })
    this.body = (await this.response.clone().json()) as Body
  }
}

// ---- A MotherDuck stand-in warehouse (#772).
let standin: string
beforeAll(async () => {
  standin = await buildStandin()
  overrideVariable('MOTHERDUCK_STANDIN', standin)
})
afterAll(() => {
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  rmSync(standin, { recursive: true, force: true })
})

const EXPLORE = 'scenario_explore_server'
afterAll(() => dropExploreSource(EXPLORE))
const floors = (admin: TestClient, params: Record<string, string>) =>
  admin.get<{ data: Record<string, unknown>[]; total: number }>(`/api/table/${encodeURIComponent(EXPLORE_FLOOR)}?${new URLSearchParams(params)}`)

describe('external-data-sources', () => {
  scenario('An incomplete restriction is refused before it is saved', async ({ admin }, step, example: Example) => {
    let source: Restrictions
    await step('the user manages a "<engine>" source with default namespace "<default>"', async () => {
      source = new Restrictions(admin, example.engine!, example.default!)
      await source.prepare()
    })
    await step('the user saves its table restriction as "<entry>"', () => source.save(example.entry!))
    await step('saving is refused with restriction-field guidance to use "<format>"', () => source.expectRefused(example.format!))
    await step('the source is not registered', () => source.expectNotRegistered())
  })

  scenario('An explicit restriction saves without contacting its source', async ({ admin }, step, example: Example) => {
    let source: Restrictions
    await step('the user manages a "<engine>" source with default namespace ""', async () => {
      source = new Restrictions(admin, example.engine!, '')
      await source.prepare()
    })
    await step('the user saves its table restriction as "<entry>"', () => source.save(example.entry!))
    await step('the source is registered with exactly that restriction', () => source.expectRegistered())
  })

  scenario('A refused edit preserves the saved restriction', async ({ admin }, step) => {
    const source = new Restrictions(admin, 'postgres', 'public')
    await step('a Postgres source is registered with restriction "public.stores"', () => source.register('public.stores'))
    await step('the user changes its restriction to "public.stores,stores"', () => source.save('public.stores,stores'))
    await step('saving is refused with restriction-field guidance to use "schema.table"', () => source.expectRefused('schema.table'))
    await step('its stored restriction is still "public.stores"', () => source.expectStored('public.stores'))
  })

  scenario('A stored bare name remains refused with correction guidance', async ({ admin }, step) => {
    const source = new Restrictions(admin, 'postgres', 'public')
    await step('a Postgres source already stores the restriction "stores" for its public stores table', () => source.legacy('stores'))
    await step('the user tries to connect the public stores table', () => source.connectStores())
    await step('connection is refused with guidance to use "schema.table"', async () => {
      const err = await expectRefused(source.response, 403, 'schema.table')
      expect(err.type).toBe('PermissionError')
    })
    await step('its stored restriction is still "stores"', () => source.expectStored('stores'))
  })

  scenario('A qualified entry still works beside an old incomplete entry', async ({ admin }, step) => {
    const source = new Restrictions(admin, 'postgres', 'public')
    await step('a Postgres source already stores the restriction "stores,public.stores" for its public stores table', () => source.legacy('stores,public.stores'))
    await step('the user tries to connect the public stores table', () => source.connectStores())
    await step('the public stores table connects', async () => {
      await expectStatus(source.response, 200)
      expect(source.body.created, 'exactly one source table connects').toHaveLength(1)
      expect(source.body.created![0]!.table).toBe('stores')
      expect(source.body.skipped).toEqual([])
      const meta = await admin.get<Record<string, unknown>>(`/api/table/${encodeURIComponent(source.body.created![0]!.name)}:meta`)
      expect(meta).toMatchObject({ data_source: source.source.row_id, external_schema: 'public', external_table: 'stores' })
    })
    await step('its stored restriction is still "stores,public.stores"', () => source.expectStored('stores,public.stores'))
  })

  scenario('An empty upstream search shows no floors', async ({ admin }, step) => {
    let result: Awaited<ReturnType<typeof floors>>
    await step('a connected Postgres source has North with two floors, South with one floor and Empty with none', () => exploreSource(admin, EXPLORE))
    await step('the user explores floors for stores matching "Missing" without selecting a store', async () => {
      result = await floors(admin, { filters: JSON.stringify([['store', 'related', { table: EXPLORE_STORE, filters: [['label', '=', 'Missing']] }]]) })
    })
    await step('the connected result has no floors with a total of zero', () => {
      expect(result.data).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  scenario('A store beyond the displayed page still contributes its floors', async ({ admin }, step) => {
    let result: Awaited<ReturnType<typeof floors>>
    await step('a connected Postgres source has more than five hundred stores', async () => {
      await exploreSource(admin, EXPLORE)
      await manyStores(EXPLORE)
    })
    await step('the user explores floors without selecting a store from that source', async () => {
      result = await floors(admin, { fields: '["row_id"]', filters: JSON.stringify([['store', 'related', { table: EXPLORE_STORE, filters: [] }]]), order_by: 'row_id asc' })
    })
    await step('floors linked to stores beyond the displayed page contribute to the exact result', () => {
      expect(result.data).toEqual([{ row_id: '101' }, { row_id: '103' }, { row_id: '211' }, { row_id: '601' }])
      expect(result.total).toBe(4)
    })
  })

  scenario('A token with write rights still cannot change the warehouse', async ({ admin }, step) => {
    const source = `acc-wh-${randomUUID().slice(0, 8)}`
    let connected = ''
    await step("the instance's token can also write to the warehouse", () => { overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.writer) })
    await step('a table connected from its database "sales"', async () => {
      invalidateSources()
      await admin.post('/api/table/Data%20Source:motherduck_connect', { name: source, databases: ['sales'] })
      await admin.post(`/api/table/Data%20Source/${source}:reflect`, { schema: 'sales.main', tables: ['stores'] })
      const [bound] = await sql`select name from table_def where data_source = ${source}`
      connected = String(bound!.name)
    })
    let res!: Response
    await step('the user tries to change a row of that table', async () => {
      res = await admin.fetch(`/api/table/${encodeURIComponent(connected)}/S001`, { method: 'PATCH', body: JSON.stringify({ name: 'Changed' }) })
    })
    await step('the change is refused', () => expectRefused(res, 403))
    await step('the row in the warehouse is unchanged', async () => {
      const preview = await admin.get<{ data?: { first_rows: Record<string, unknown>[] }; first_rows?: Record<string, unknown>[] }>(
        `/api/table/Data%20Source/${source}:preview?database=sales&schema=main&table=stores`)
      expect((preview.data ?? preview).first_rows!.find((row) => row.code === 'S001')!.name).toBe('Harbour Road')
    })
  })

  scenario('A MySQL source saved before support ended', async ({ admin }, step) => {
    let answer!: Response
    await step('a data source "legacy-shop" was saved with the engine "mysql"', async () => {
      // Only a row written before MySQL support ended can hold this engine.
      await sql`insert into data_source (row_id, engine, url_env) values ('legacy-shop', 'mysql', 'LEGACY_SHOP_URL')`
      invalidateSources('legacy-shop')
    })
    await step('the user tests "legacy-shop"', async () => {
      answer = await admin.fetch('/api/table/Data%20Source/legacy-shop:test_connection', { method: 'POST', body: '{}' })
    })
    await step('the test is refused, saying MySQL is no longer a supported data source and to delete "legacy-shop"', async () => {
      const refused = await expectRefused(answer, 417, 'MySQL is no longer a supported data source: delete legacy-shop')
      expect(refused.type).toBe('ValidationError')
    })
  })
})
