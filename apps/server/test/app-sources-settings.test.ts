// #808: an app's manifest says, per table it connects, the Table's name, the
// columns left out (never connected), the title column and the list columns.
// Local fixture schema only, in the sibling external database.
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest'
import postgres from 'postgres'
import { test } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { sql } from '../src/db'
import { invalidateSources } from '../src/sources/registry'
import { readFileSync } from 'node:fs'

const ENV_VAR = 'APPSET_FIXTURE_URL'
process.env[ENV_VAR] = EXTERNAL_DATABASE_URL

let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 2 })
  await cli.unsafe(`drop schema if exists appset cascade`)
  await cli.unsafe(`create schema appset`)
  await cli.unsafe(`
    create table appset.person (
      id bigint primary key,
      code text,
      first_name text,
      birth_date date,
      team_id bigint,
      remarks text,
      updated_at timestamptz not null default now()
    )`)
  await cli.unsafe(`create table appset.team (id bigint primary key, name text, size int)`)
  await cli.unsafe(`insert into appset.team values (1, 'Alpha', 3)`)
  await cli.unsafe(`insert into appset.person (id, code, first_name, birth_date, team_id, remarks)
    values (10, 'P-10', 'Asha', '2000-01-02', 1, 'private note')`)
})

beforeEach(() => invalidateSources())

afterAll(async () => {
  invalidateSources()
  await cli.unsafe(`drop schema if exists appset cascade`)
  await cli.end({ timeout: 2 })
})

const manifest = (name: string, tables: unknown[]) => ({
  name,
  sources: [{
    name: `${name}-src`,
    engine: 'postgres',
    url_env: ENV_VAR,
    default_schema: 'appset',
    access: 'read_only',
    reflect: { schema: 'appset', module: 'Appset', tables },
  }],
})

const PERSON = {
  table: 'person',
  name: 'Appset Person',
  leave_out_columns: ['birth_date', 'remarks'],
  title_column: 'first_name',
  list_columns: ['code', 'team_id'],
}

type Meta = { title_column: string | null; columns: { column_name: string; in_list_view: boolean }[] }

describe('an app says how each table it connects reads', () => {
  test('name, left-out, title and list columns apply; a plain entry keeps the defaults', async ({ admin }) => {
    const res = await admin.post<{ tables: string[] }>('/api/install_app', {
      manifest: manifest('appset-a', [PERSON, 'team']),
    })
    expect(res.tables.sort()).toEqual(['Appset Person', 'Appset Team'])

    const meta = (await admin.get('/api/table/Appset%20Person:meta')) as Meta
    const columns = meta.columns.map((c) => c.column_name)
    expect(columns).not.toContain('birth_date')
    expect(columns).not.toContain('remarks')
    expect(meta.title_column).toBe('first_name')
    // Listed columns first, in the manifest's order; the rest keep the source's.
    expect(columns).toEqual(['code', 'team_id', 'first_name'])
    expect(meta.columns.filter((c) => c.in_list_view).map((c) => c.column_name)).toEqual(['code', 'team_id'])

    // Left-out columns are never read: a row carries none of them.
    const row = (await admin.get('/api/table/Appset%20Person/10')) as Record<string, unknown>
    expect(row.first_name).toBe('Asha')
    expect(row).not.toHaveProperty('birth_date')
    expect(row).not.toHaveProperty('remarks')

    const team = (await admin.get('/api/table/Appset%20Team:meta')) as Meta
    expect(team.title_column).toBe('name')
    await admin.post('/api/uninstall_app', { name: 'appset-a' })
  })

  test('a list without a title keeps the default title', async ({ admin }) => {
    await admin.post('/api/install_app', {
      manifest: manifest('appset-b', [{ table: 'team', name: 'Appset Squad', list_columns: ['size'] }]),
    })
    const meta = (await admin.get('/api/table/Appset%20Squad:meta')) as Meta
    expect(meta.title_column).toBe('name')
    expect(meta.columns.filter((c) => c.in_list_view).map((c) => c.column_name)).toEqual(['size'])
    await admin.post('/api/uninstall_app', { name: 'appset-b' })
  })

  test.for([
    [{ leave_out_columns: ['birth_dat'] }, 'person has no column birth_dat to leave out'],
    [{ leave_out_columns: ['id'] }, 'person cannot leave out its key id'],
    [{ title_column: 'nickname' }, 'person has no column nickname for its title'],
    [{ leave_out_columns: ['remarks'], list_columns: ['remarks'] }, 'person leaves out remarks, so it cannot be in its list'],
    [{ list_columns: ['updated_at'] }, "person's updated_at is not a connected column"],
    [{ title_column: 'id' }, "person's id is not a connected column"],
  ] as [Record<string, unknown>, string][])('%o refuses the whole install, connecting nothing', async ([settings, message], { admin }) => {
    const res = await admin.fetch('/api/install_app', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: manifest('appset-bad', ['team', { table: 'person', ...settings }]) }),
    })
    expect(res.status).toBe(417)
    expect(await res.text()).toContain(message)
    expect(await sql`select name from table_def where data_source = 'appset-bad-src'`).toEqual([])
    expect(await sql`select 1 from installed_app where name = 'appset-bad'`).toEqual([])
  })

  test('a left-out modified column is not read as the row\'s updated_at', async ({ admin }) => {
    await admin.post('/api/install_app', {
      manifest: manifest('appset-c', [{ table: 'person', name: 'Appset Person', leave_out_columns: ['updated_at'] }]),
    })
    const [def] = await sql`select external_modified from table_def where name = 'Appset Person'`
    expect(def.external_modified).toBeNull()
    await admin.post('/api/uninstall_app', { name: 'appset-c' })
  })

  test('an unknown setting is refused by the manifest schema', async ({ admin }) => {
    await expect(
      admin.post('/api/install_app', { manifest: manifest('appset-d', [{ table: 'person', hide: ['x'] }]) }),
    ).rejects.toMatchObject({ status: 417 })
  })

  // The StyleHR client app's manifest is valid. Its variable points at the
  // local fixture database, never the HR system, which lacks its tables.
  test('the StyleHR app manifest passes the manifest schema', async ({ admin }) => {
    process.env.STYLEHR_URL = EXTERNAL_DATABASE_URL
    const stylehr = JSON.parse(readFileSync(new URL('../../../client-apps/jeyarama/stylehr/app.json', import.meta.url), 'utf8'))
    const res = await admin.fetch('/api/install_app', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: stylehr }),
    })
    const body = await res.text()
    expect(res.status).toBe(417)
    expect(body).not.toContain('Invalid app manifest')
    expect(body).toContain('Not found on the source')
    expect(await sql`select 1 from installed_app where name = 'stylehr'`).toEqual([])
  })
})
