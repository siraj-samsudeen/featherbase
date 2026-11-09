// master-data-sync's fenced scenarios (#1070), against the real in-process
// server and a stand-in warehouse with synthetic rows. Each test is one
// scenario of openspec/specs/master-data-sync/spec.md, step by step. The
// ticket app is the ticket-sink test app, which keeps each ticket the sync
// asks for.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SeedFn, TestClient } from 'feather-testing-postgres'
import { sql } from '../../src/db'
import { overrideVariable } from '../../src/env'
import { invalidateSources } from '../../src/sources/registry'
import { discoverPackages } from '../../src/runtime-packages'
import { test } from '../pg-test'
import { makeTable } from '../fixtures'
import { buildStandin, changeStandin, STANDIN_TOKENS } from '../motherduck-standin'
import { scenarioFor } from '../scenario'

const scenario = scenarioFor(test, 'master-data-sync')

let dir: string
beforeAll(async () => {
  dir = await buildStandin()
  overrideVariable('MOTHERDUCK_STANDIN', dir)
  overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader)
})
afterAll(() => {
  invalidateSources()
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  rmSync(dir, { recursive: true, force: true })
})

type Row = Record<string, any>
const SOURCES = '/api/table/Data%20Source'
const path = (name: string) => `/api/table/${encodeURIComponent(name)}`
const GIVEN = "StyleHR's staff are copied in and kept in step with People, Asha linked to her StyleHR row"

/** A copy of StyleHR's staff kept in step with a People Table; Asha (P1) is linked to StyleHR's E1. */
async function staffKeptInStep(admin: TestClient, seed: SeedFn, tag: string) {
  const s = { source: `staff_${tag}`, copy: `Staff Copy ${tag}`, person: `Sync Person ${tag}`, link: `Sync Link ${tag}`, dataSource: `acc-sync-${tag}` }
  await changeStandin(dir, 'sales', [
    `create or replace table ${s.source} (emp_id varchar, name varchar, phone varchar)`,
    `insert into ${s.source} values ('E1', 'Asha', '111')`,
  ])
  await admin.post(`${SOURCES}:motherduck_connect`, { name: s.dataSource, databases: ['sales'] })
  await admin.post(`${SOURCES}/${s.dataSource}:refresh_tables`, { database: 'sales' })
  await admin.post(`${SOURCES}/${s.dataSource}:copy_create`, {
    database: 'sales', schema: 'main', table: s.source, name: s.copy, key: 'emp_id',
    columns: ['emp_id', 'name', 'phone'].map((c) => ({ source: c, column_name: c })),
  })
  await makeTable(admin, { name: s.person, id_pattern: 'prompt', columns: ['full_name', 'phone', 'employment_status'] })
  await makeTable(admin, { name: s.link, columns: ['source_system', 'source_key', 'person'] })
  await seed(s.person, { row_id: 'P1', full_name: 'Asha', phone: '111', employment_status: 'Active' })
  await seed(s.link, { source_system: 'StyleHR', source_key: 'E1', person: 'P1' })
  await discoverPackages([resolve('../..', 'test-apps/ticket-sink')])
  await admin.post('/api/install_app', { name: 'ticketsink' })
  await admin.post(`${path(s.copy)}:set_master_sync`, {
    rule: {
      master_table: s.person, source_system: 'StyleHR',
      link: { table: s.link, system_column: 'source_system', key_column: 'source_key', master_column: 'person' },
      columns: { full_name: { source: 'name', owner: 'source' }, phone: { source: 'phone', owner: 'source' } },
      inactive: { column: 'employment_status', value: 'Inactive' },
      tickets: { app: 'ticketsink', type: 'source_change', source_system: 'StyleHR' },
    },
  })
  await admin.post(`${path(s.copy)}:master_sync_run`, {})
  return s
}
type Sync = Awaited<ReturnType<typeof staffKeptInStep>>

/** StyleHR changes, then the copy is refreshed: copying again alone brings the master Table in step too. */
async function refresh(admin: TestClient, s: Sync, statements: string[] = []) {
  if (statements.length) await changeStandin(dir, 'sales', statements)
  await admin.post(`${SOURCES}/${s.dataSource}:refresh_tables`, { database: 'sales' })
  await admin.post(`${path(s.copy)}:copy_again`, {})
}
const asha = (admin: TestClient, s: Sync) => admin.get<Row>(`${path(s.person)}/P1`)
const tickets = async (s: Sync) =>
  (await sql`select payload from ticketsink.ticket`).map((r) => JSON.parse(String(r.payload))).filter((p) => p.title.includes(s.person))

describe('master-data-sync', { timeout: 60_000 }, () => {
  scenario('A name changed in StyleHR reaches the Person row', async ({ admin, seed }, step) => {
    let s: Sync
    await step(GIVEN, async () => { s = await staffKeptInStep(admin, seed, 'name') })
    await step('StyleHR changes Asha\'s name to "Asha R" and the copy is refreshed', () =>
      refresh(admin, s, [`update ${s.source} set name = 'Asha R' where emp_id = 'E1'`]))
    await step('Asha\'s Person row reads "Asha R", and its history says the change came from StyleHR', async () => {
      expect((await asha(admin, s)).full_name).toBe('Asha R')
      const [version] = await sql`select data from version where ref_table = ${s.person} and ref_name = 'P1' order by created_at desc limit 1`
      expect((version!.data as Row).synced_from).toBe('StyleHR')
    })
  })

  scenario('A phone edited in Featherbase asks whether StyleHR should be fixed', async ({ admin, seed }, step) => {
    let s: Sync
    await step(GIVEN, async () => { s = await staffKeptInStep(admin, seed, 'phone') })
    await step('a person changes Asha\'s phone in Featherbase and the copy is refreshed twice', async () => {
      const row = await asha(admin, s)
      await admin.post('/api/save_row', { table: s.person, row: { row_id: 'P1', updated_at: row.updated_at, phone: '999' } })
      await refresh(admin, s)
      await refresh(admin, s)
    })
    await step('Asha\'s phone is kept, and one ticket asks whether StyleHR should be fixed', async () => {
      expect((await asha(admin, s)).phone).toBe('999')
      const asked = (await tickets(s)).filter((p) => p.details.record_key === 'P1' && /Should the source be fixed/.test(p.original))
      expect(asked).toHaveLength(1)
    })
  })

  scenario('A new StyleHR row is raised, not linked', async ({ admin, seed }, step) => {
    let s: Sync
    let before = 0
    await step(GIVEN, async () => { s = await staffKeptInStep(admin, seed, 'new') })
    await step('StyleHR adds Devan and the copy is refreshed', async () => {
      before = Number((await sql`select count(*)::int as n from ticketsink.ticket`)[0]!.n)
      await refresh(admin, s, [`insert into ${s.source} values ('E2', 'Devan', '222')`])
    })
    await step('a ticket asks to create or link Devan, and no Person row is linked to him', async () => {
      const [after] = await sql`select count(*)::int as n from ticketsink.ticket`
      expect(Number(after!.n)).toBe(before + 1)
      const [newest] = await sql`select payload from ticketsink.ticket order by created_at desc limit 1`
      const payload = JSON.parse(String(newest!.payload))
      expect(payload.details.record_key).toBe('E2')
      expect(payload.original).toMatch(/no link/)
      const filters = encodeURIComponent(JSON.stringify([['source_key', '=', 'E2']]))
      expect((await admin.get<{ data: Row[] }>(`${path(s.link)}?filters=${filters}`)).data).toEqual([])
    })
  })

  scenario('A row gone from StyleHR marks the person inactive', async ({ admin, seed }, step) => {
    let s: Sync
    await step(GIVEN, async () => { s = await staffKeptInStep(admin, seed, 'gone') })
    await step('StyleHR removes Asha and the copy is refreshed', () =>
      refresh(admin, s, [`delete from ${s.source} where emp_id = 'E1'`]))
    await step("Asha's Person row is marked inactive and is still there", async () => {
      const row = await asha(admin, s)
      expect(row.employment_status).toBe('Inactive')
      expect(row.full_name).toBe('Asha')
    })
  })
})
