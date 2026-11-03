import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { issueSession } from '../src/auth'
import { makeTable, createUserWithRole } from './fixtures'
import { createTable, renameTable } from '../src/table-engine'
import { provisionApp } from '../src/app-lifecycle'
import { withTransaction } from '../src/db'
import { invalidateMeta } from '../src/meta'
import type { TestClient } from 'feather-testing-postgres'

// #101 Phase 3: batched capture of read-side intent into user_event —
// append-only, caller-scoped, clamped timestamps, 90-day retention.

const DAY = 86_400_000

async function visit(client: TestClient, table: string, row?: string) {
  const read = await client.fetch(`/api/table/${encodeURIComponent(table)}${row ? `/${row}` : ':meta'}`, { headers: { 'X-Navigation-Visit': '1' } })
  expect(read.status).toBe(200)
  const event = { kind: row ? 'row' : 'list', key: row ? `row:${table}/${row}` : `list:${table}?`,
    label: row ?? table, ...(row ? { sub: table } : {}),
    path: `/featherbase/admin/${encodeURIComponent(table)}${row ? `/${row}` : ''}`,
    at: Date.now(), claim: read.headers.get('X-Navigation-Claim') }
  expect(event.claim).toBeTruthy()
  return event
}
type Home = { entries: Array<{ label: string; path: string }> }
type Feed = { items: Array<{ label: string; path: string; destination_state: string; sub?: string }> }

describe('#873: validated Home destinations', () => {
  test('ordinary reads do not capture visits; read-only callers can explicitly record their authorized visit', async ({ admin, createUser }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'] })
    await admin.post(table.url, { row_id: 'north', title: 'North depot' })
    const reader = await createUserWithRole(admin, createUser, { role: 'Resume reader', table: table.name, can_read: true })
    for (const path of [table.metaUrl, table.rowUrl('north')]) {
      const read = await reader.fetch(path)
      expect(read.status).toBe(200)
      expect(read.headers.get('X-Navigation-Claim')).toBeNull()
    }
    expect(await sql`select id from navigation_row_target`).toEqual([])
    const event = await visit(reader, table.name, 'north')
    await reader.post('/api/events', { events: [event] })
    expect((await reader.post<Home>('/api/home_resume', {})).entries[0].path).toBe(event.path)
  })

  test('singleton settings reads never manufacture a native row lifetime', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Resume Settings', kind: 'settings', columns: ['title'] })
    const response = await admin.fetch(table.rowUrl(table.name), { headers: { 'X-Navigation-Visit': '1' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Navigation-Claim')).toBeNull()
    const event = { kind: 'row', key: `row:${table.name}/${table.name}`, label: table.name,
      path: `/featherbase/admin/Resume%20Settings/Resume%20Settings` }
    await admin.post('/api/events', { events: [event] })
    // Pre-claim history may have recorded the singleton through its row API.
    await sql`update user_event set destination = null`
    await sql`update table_def set created_at = now() - interval '1 day' where name = ${table.name}`
    expect((await admin.post<Home>('/api/home_resume', {})).entries).toEqual([])
    expect((await admin.get<Feed>('/api/activity_feed')).items[0]).toMatchObject({ destination_state: 'unavailable', path: '' })
  })

  test('list destinations recheck current read permission for persisted events and signed hints', async ({ admin, createUser }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'] })
    const user = await createUserWithRole(admin, createUser, { role: 'Resume reader', table: table.name, can_read: true })
    const event = await visit(user, table.name)
    await user.post('/api/events', { events: [event] })
    expect((await user.post<Home>('/api/home_resume', {})).entries[0].path).toBe(event.path)
    await sql`delete from has_role where parent = ${user.user!}`
    expect((await user.fetch(table.metaUrl, { headers: { 'X-Navigation-Visit': '1' } })).status).toBe(403)
    expect((await user.post<Home>('/api/home_resume', { hints: [{ ...event, at: event.at + 1 }] })).entries).toEqual([])
    expect((await user.get<Feed>('/api/activity_feed')).items[0]).toMatchObject({ destination_state: 'unavailable', path: '', label: 'Unavailable destination' })
  })

  test('mandatory row privacy overrides a privileged caller’s earlier authorized visit', async ({ admin, createUser }) => {
    const table = await makeTable(admin, {
      name: 'Resume Private Plant', title_column: 'title', columns: ['title', 'shared:Check'],
      access_policy: { version: 1, roles: ['Resume member'], shared_column: 'shared' },
    })
    const owner = await createUserWithRole(admin, createUser, {
      role: 'Resume member', table: table.name, can_read: true, can_create: true, can_write: true,
    })
    const manager = await createUser({ roles: ['System Manager', 'Resume member'] })
    const row = await owner.post<{ row_id: string; updated_at: string }>(table.url, {
      row_id: 'north', title: 'Confidential depot', shared: true,
    })
    const event = await visit(manager, table.name, row.row_id)
    await manager.post('/api/events', { events: [event] })
    expect((await manager.post<Home>('/api/home_resume', {})).entries[0].label).toBe('Confidential depot')
    const history = await sql`select * from user_event where created_by = ${manager.user!}`
    await owner.post('/api/save_row', {
      table: table.name, row: { row_id: row.row_id, updated_at: row.updated_at, shared: false },
    })
    const denied = await manager.fetch(table.rowUrl(row.row_id), { headers: { 'X-Navigation-Visit': '1' } })
    expect(denied.status).toBe(403)
    expect(denied.headers.get('X-Navigation-Claim')).toBeNull()
    expect((await manager.post<Home>('/api/home_resume', { hints: [{ ...event, at: event.at + 1 }] })).entries).toEqual([])
    expect((await manager.get<Feed>('/api/activity_feed')).items[0]).toMatchObject({
      destination_state: 'unavailable', path: '', label: 'Unavailable destination',
    })
    expect(await sql`select * from user_event where created_by = ${manager.user!}`).toEqual(history)
  })

  test('sweep deletion cannot collide with a later rename, and retired targets follow event retention', async ({ admin }) => {
    const victim = await makeTable(admin, { name: 'Resume Deleted', columns: ['title'] })
    const table = await makeTable(admin, { name: 'Resume Plant', columns: [
      'title', { column_name: 'target', column_type: 'Reference', reference_table: 'Table' },
    ], title_column: 'title' })
    await admin.post(table.url, { row_id: 'south', title: 'Surviving depot' })
    await admin.post(table.url, { row_id: 'north', title: 'Deleted depot', target: victim.name })
    const events = [await visit(admin, table.name, 'south'), await visit(admin, table.name, 'north')]
    await admin.post('/api/events', { events })
    const testimony = await sql`select * from user_event order by row_id`
    await admin.delete(victim.defUrl)
    await admin.post(`${table.url}/south:rename`, { new_name: 'north' })
    expect((await admin.post<Home>('/api/home_resume', {})).entries).toEqual([
      expect.objectContaining({ path: '/featherbase/admin/Resume%20Plant/north', label: 'Surviving depot' }),
    ])
    expect((await admin.get<Feed>('/api/activity_feed')).items.some(item => item.destination_state === 'unavailable')).toBe(true)
    expect(await sql`select * from user_event order by row_id`).toEqual(testimony)
    expect((await sql`select id from navigation_row_target where retired`)).toHaveLength(1)
    await sql`update user_event set occurred_at = now() - interval '91 days' where ref_key = ${events[1].key}`
    await admin.post('/api/events', { events: [{ kind: 'search', key: 'search:depot', label: 'depot' }] })
    expect(await sql`select id from navigation_row_target where retired`).toEqual([])
    expect((await admin.post<Home>('/api/home_resume', {})).entries.find(entry => entry.path.endsWith('/north'))?.label).toBe('Surviving depot')
  })

  test('row rename follows the original lifetime after old-ID reuse', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'], title_column: 'title' })
    await admin.post(table.url, { row_id: 'north', title: 'North depot' })
    const event = await visit(admin, table.name, 'north')
    await admin.post('/api/events', { events: [event] })
    const original = await sql`select * from user_event`
    await expect(withTransaction(async () => {
      await admin.post(`${table.url}/north:rename`, { new_name: 'rolledback' })
      throw new Error('later action failed')
    })).rejects.toThrow('later action failed')
    expect((await admin.post<Home>('/api/home_resume', {})).entries[0].path).toBe('/featherbase/admin/Resume%20Plant/north')
    await admin.post(`${table.url}/north:rename`, { new_name: 'central' })
    await admin.post(table.url, { row_id: 'north', title: 'Wrong replacement' })
    const home = await admin.post<Home>('/api/home_resume', {})
    expect(home.entries).toEqual([expect.objectContaining({ path: '/featherbase/admin/Resume%20Plant/central', label: 'North depot' })])
    expect(await sql`select * from user_event`).toEqual(original)
  })

  test('delayed delivery never binds a replacement Table', async ({ admin }) => {
    await makeTable(admin, { name: 'Resume Detail', kind: 'sub_table', columns: ['title'] })
    const def = { name: 'Resume Plant', columns: ['title',
      { column_name: 'details', column_type: 'Sub-table', row_table: 'Resume Detail' },
    ] }
    const table = await makeTable(admin, def)
    await admin.post(table.url, { row_id: 'north', title: 'North depot' })
    const event = await visit(admin, table.name, 'north')
    const list = await visit(admin, table.name)
    await admin.delete(table.defUrl)
    await makeTable(admin, def)
    await admin.post(table.url, { row_id: 'north', title: 'Wrong replacement' })
    // Optional display text cannot force a delayed visit onto the replacement.
    await admin.post('/api/events', { events: [{ ...event, label: undefined }, list] })
    expect((await admin.post<Home>('/api/home_resume', { hints: [{ ...event, label: undefined, at: event.at + 1 }] })).entries).toEqual([])
    const feed = await admin.get<Feed>('/api/activity_feed')
    expect(feed.items).toHaveLength(2)
    expect(feed.items.find(i => i.sub === table.name)).toMatchObject({ label: event.key, path: '', destination_state: 'deleted_table' })
    expect(feed.items.find(i => i.label === table.name)).toMatchObject({ path: '', destination_state: 'deleted_table' })
  })

  test('row deletion does not mark its surviving Table deleted', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'] })
    await admin.post(table.url, { row_id: 'north' })
    const event = await visit(admin, table.name, 'north')
    await admin.post('/api/events', { events: [event] })
    await admin.delete(table.rowUrl('north'))
    await admin.post(table.url, { row_id: 'north', title: 'Replacement' })
    expect((await admin.post<Home>('/api/home_resume', { hints: [event] })).entries).toEqual([])
    expect((await admin.get<Feed>('/api/activity_feed')).items[0]).toMatchObject({ path: '', destination_state: 'unavailable' })
  })

  test('actual app Table rename carries both destinations without rewriting testimony', async ({ admin }) => provisionApp('depot', async () => {
    const def = { name: 'depot.plant', label: 'Plant', title_column: 'title', columns: [{ column_name: 'title', column_type: 'Data' }] }
    await createTable(def, 'depot')
    await admin.post('/api/table/depot.plant', { row_id: 'north', title: 'North depot' })
    const events = [await visit(admin, def.name), await visit(admin, def.name, 'north')]
    await admin.post('/api/events', { events })
    const original = await sql`select * from user_event order by row_id`
    await renameTable(def.name, 'depot.store', 'depot')
    await createTable(def, 'depot')
    const home = await admin.post<Home>('/api/home_resume', {})
    expect(home.entries.map(e => e.path).sort()).toEqual(['/featherbase/admin/depot.store', '/featherbase/admin/depot.store/north'])
    expect(await sql`select * from user_event order by row_id`).toEqual(original)
    // Delivery after rename uses the original captured claim, not the reused name.
    await admin.post('/api/events', { events })
    expect((await admin.post<Home>('/api/home_resume', {})).entries.map(e => e.path).sort()).toEqual(home.entries.map(e => e.path).sort())
  }))

  test('rolled-back app rename leaves the original navigation usable', async ({ admin }) => provisionApp('depot', async () => {
    await createTable({ name: 'depot.plant', label: 'Plant', columns: [{ column_name: 'title', column_type: 'Data' }] }, 'depot')
    const event = await visit(admin, 'depot.plant')
    await admin.post('/api/events', { events: [event] })
    await expect(withTransaction(async () => {
      await renameTable('depot.plant', 'depot.store', 'depot')
      throw new Error('upgrade failed')
    })).rejects.toThrow('upgrade failed')
    invalidateMeta()
    expect((await admin.post<Home>('/api/home_resume', {})).entries[0].path).toBe('/featherbase/admin/depot.plant')
  }))

  test('missing or forged claims cannot become destinations', async ({ admin, createUser }) => {
    const forged = '00000000-0000-4000-8000-000000000001'
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'], navigation_identity: forged })
    const [definition] = await sql`select navigation_identity from table_def where name = ${table.name}`
    expect(definition.navigation_identity).not.toBe(forged)
    const event = await visit(admin, table.name)
    const other = await createUser({ roles: ['System Manager'] })
    for (const invalid of [{ ...event, claim: null }, { ...event, claim: event.claim + 'x' },
      { ...event, path: undefined }, { ...event, path: 'https://evil.example/' }]) {
      await admin.post('/api/events', { events: [invalid] })
    }
    await other.post('/api/events', { events: [event] })
    expect((await admin.post<Home>('/api/home_resume', {})).entries).toEqual([])
    expect((await other.post<Home>('/api/home_resume', {})).entries).toEqual([])
    expect((await admin.fetch(table.metaUrl, { headers: { authorization: `Bearer ${event.claim}` } })).status).toBe(401)
    expect(await admin.get(table.metaUrl)).not.toHaveProperty('navigation_identity')
    expect(await admin.get(`/api/table/Table/${encodeURIComponent(table.name)}`)).not.toHaveProperty('navigation_identity')
  })

  test('permission loss hides current destination details', async ({ admin, createUser }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'], title_column: 'title' })
    await admin.post(table.url, { row_id: 'north', title: 'North depot' })
    const user = await createUser({ roles: ['System Manager'] })
    const event = await visit(user, table.name, 'north')
    await user.post('/api/events', { events: [event] })
    await sql`delete from has_role where parent = ${user.user!}`
    // Delivery after access loss must refuse the once-authorized claim too.
    await user.post('/api/events', { events: [event] })
    await sql`update featherbase.resume_plant set title = 'Confidential depot' where row_id = 'north'`
    expect((await user.post<Home>('/api/home_resume', {})).entries).toEqual([])
    const feed = await user.get<Feed>('/api/activity_feed')
    expect(feed.items[0]).toMatchObject({ destination_state: 'unavailable', path: '', label: 'Unavailable destination' })
    expect(JSON.stringify(feed)).not.toContain('Confidential depot')
  })

  test('row scope and field tiers are rechecked, not granted by a captured claim', async ({ admin, createUser }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', title_column: 'secret', columns: [
      'title', { column_name: 'secret', column_type: 'Data', tier: 'restricted' },
    ] })
    await admin.post(table.url, { row_id: 'north', title: 'Public depot', secret: 'Confidential depot' })
    await admin.post(table.url, { row_id: 'south', title: 'South depot', secret: 'Secret south' })
    const user = await createUserWithRole(admin, createUser, { role: 'Resume reader', table: table.name, can_read: true, tier: 'basic' })
    const event = await visit(user, table.name, 'north')
    await user.post('/api/events', { events: [event] })
    const home = await user.post<Home>('/api/home_resume', {})
    expect(home.entries).toHaveLength(1)
    expect(home.entries[0].path).toBe('/featherbase/admin/Resume%20Plant/north')
    expect(JSON.stringify(home)).not.toContain('Confidential depot')
    const scope = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Data Scope', row: {
      person: user.user, allow_table: table.name, for_value: 'south',
    } })
    expect((await user.post<Home>('/api/home_resume', { hints: [event] })).entries).toEqual([])
    expect((await user.get<Feed>('/api/activity_feed')).items[0]).toMatchObject({ destination_state: 'unavailable', path: '' })
    await admin.delete(`/api/table/Data%20Scope/${scope.row_id}`)
    await sql`update permission set own_rows_only = true where role = 'Resume reader'`
    expect((await user.post<Home>('/api/home_resume', {})).entries).toEqual([])
    await sql`update featherbase.resume_plant set created_by = ${user.user!} where row_id = 'north'`
    expect((await user.post<Home>('/api/home_resume', {})).entries).toHaveLength(1)
  })

  test('a row share can supply a destination only while the share remains', async ({ admin, createUser }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'] })
    await admin.post(table.url, { row_id: 'north', title: 'Shared depot' })
    const user = await createUser({ roles: [] })
    const share = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Share', row: {
      share_table: table.name, share_name: 'north', person: user.user, read: true,
    } })
    const event = await visit(user, table.name, 'north')
    await user.post('/api/events', { events: [event] })
    expect((await user.post<Home>('/api/home_resume', {})).entries).toHaveLength(1)
    await admin.delete(`/api/table/Share/${share.row_id}`)
    expect((await user.post<Home>('/api/home_resume', { hints: [event] })).entries).toEqual([])
    expect((await user.get<Feed>('/api/activity_feed')).items[0]).toMatchObject({ destination_state: 'unavailable', path: '' })
  })

  test('current principal-valued titles use permission-aware names rather than opaque identifiers', async ({ admin, createUser }) => {
    const owner = await createUser({ fullName: 'Current depot owner', roles: [] })
    const table = await makeTable(admin, { name: 'Resume Plant', title_column: 'owner', columns: [
      { column_name: 'owner', column_type: 'Reference', reference_table: 'Person' }, 'description',
    ] })
    await admin.post(table.url, { row_id: 'north', owner: owner.user, description: 'Depot' })
    const reader = await createUserWithRole(admin, createUser, { role: 'Resume reader', table: table.name, can_read: true })
    for (const [client, label] of [[admin, 'Current depot owner'], [reader, 'Unnamed person']] as const) {
      const event = await visit(client, table.name, 'north')
      await client.post('/api/events', { events: [event] })
      expect((await client.post<Home>('/api/home_resume', {})).entries[0].label).toBe(label)
      expect(JSON.stringify(await client.get<Feed>('/api/activity_feed'))).not.toContain(owner.user)
    }
  })

  test('legacy resolution requires strictly earlier creation evidence without backfill', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'] })
    const event = await visit(admin, table.name)
    await admin.post('/api/events', { events: [event] })
    await sql`update user_event set destination = null`
    const before = await sql`select * from user_event`
    await sql`update table_def set created_at = ${new Date(event.at - 1000)} where name = ${table.name}`
    expect((await admin.post<Home>('/api/home_resume', {})).entries[0].label).toBe(table.name)
    await sql`update table_def set created_at = ${new Date(event.at)} where name = ${table.name}`
    expect((await admin.post<Home>('/api/home_resume', {})).entries).toEqual([])
    await sql`update table_def set created_at = ${new Date(event.at + 1000)} where name = ${table.name}`
    expect((await admin.post<Home>('/api/home_resume', {})).entries).toEqual([])
    expect(await sql`select * from user_event`).toEqual(before)
  })

  test('unconfirmed signed visits preserve view filters but unsigned or mismatched hints cannot resurrect destinations', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'] })
    const event = await visit(admin, table.name)
    const filters = JSON.stringify([['title', '=', 'North depot']])
    const filtered = { ...event, key: `list:${table.name}/kanban?${filters}`,
      path: `${event.path}/view/kanban?filters=${encodeURIComponent(filters)}`, sub: 'North depots' }
    const home = await admin.post<Home>('/api/home_resume', { hints: [filtered] })
    expect(home.entries).toEqual([expect.objectContaining({ path: filtered.path, sub: 'North depots' })])
    expect(await sql`select * from user_event`).toEqual([])
    for (const invalid of [
      { ...event, claim: null }, { ...event, key: `list:${table.name}/bad-mode?` },
      { ...event, key: 'list:Another Table?' }, { ...event, kind: 'row', key: `row:${table.name}/north` },
      { ...filtered, path: event.path },
    ]) expect((await admin.post<Home>('/api/home_resume', { hints: [invalid] })).entries).toEqual([])
  })

  test('legacy rows require earlier lifetimes and consistent original routes without persisting inferred bindings', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'], title_column: 'title' })
    await admin.post(table.url, { row_id: 'north', title: 'Current depot' })
    const event = await visit(admin, table.name, 'north')
    await admin.post('/api/events', { events: [event] })
    await sql`update user_event set destination = null`
    await sql`update table_def set created_at = ${new Date(event.at - 2000)} where name = ${table.name}`
    await sql`update featherbase.resume_plant set created_at = ${new Date(event.at - 1000)} where row_id = 'north'`
    const testimony = await sql`select * from user_event`
    expect((await admin.post<Home>('/api/home_resume', {})).entries[0]).toMatchObject({ label: 'Current depot', path: event.path })
    expect(await sql`select * from user_event`).toEqual(testimony)
    // Equal and later birth times cannot prove this is the visited row.
    for (const offset of [0, 1000]) {
      await sql`update featherbase.resume_plant set created_at = ${new Date(event.at + offset)} where row_id = 'north'`
      expect((await admin.post<Home>('/api/home_resume', {})).entries).toEqual([])
    }
    await sql`update featherbase.resume_plant set created_at = ${new Date(event.at - 1000)} where row_id = 'north'`
    await sql`update user_event set path = '/featherbase/admin/Resume%20Plant/south'`
    expect((await admin.post<Home>('/api/home_resume', {})).entries).toEqual([])
    await sql`update user_event set ref_key = 'row:malformed'`
    expect((await admin.post<Home>('/api/home_resume', {})).entries).toEqual([])
  })

  test('Home validates bounded input before considering destinations', async ({ admin }) => {
    for (const body of ['{', 'null', '{"hints":1}', JSON.stringify({ hints: Array(51).fill({ kind: 'search', key: 'search:depot' }) })]) {
      const response = await admin.fetch('/api/home_resume', { method: 'POST', body, headers: { 'content-type': 'application/json' } })
      expect(response.status).toBe(417)
    }
  })

  test('unrecognized legacy history remains unavailable without being rewritten', async ({ admin }) => {
    await admin.post('/api/events', { events: [{ kind: 'page', key: 'page:explore', path: '/featherbase/admin/explore' }] })
    // Stored history permits arbitrary text kinds and missing paths, unlike
    // new event input. Do not reinterpret an unsupported record as a visit.
    await sql`update user_event set kind = 'legacy-unknown', path = null, destination = null`
    const original = await sql`select * from user_event`
    expect((await admin.post<Home>('/api/home_resume', {})).entries).toEqual([])
    expect((await admin.get<Feed>('/api/activity_feed')).items[0]).toMatchObject({
      label: 'Unavailable destination', path: '', destination_state: 'unavailable',
    })
    expect(await sql`select * from user_event`).toEqual(original)
  })

  test('search history accepts omitted optional display text', async ({ admin }) => {
    await admin.post('/api/events', { events: [{ kind: 'search', key: 'search:depot' }] })
    expect((await admin.post<Home>('/api/home_resume', {})).entries).toEqual([
      expect.objectContaining({ label: '', path: '' }),
    ])
    expect((await admin.get<Feed>('/api/activity_feed')).items[0]).toMatchObject({ label: 'search:depot', path: '', destination_state: 'available' })
  })

  test('Home offers authorized pages and search beside a row', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'] })
    await admin.post(table.url, { row_id: 'north' })
    const event = await visit(admin, table.name, 'north')
    const entries = (await admin.post<Home>('/api/home_resume', { hints: [event,
      { kind: 'page', key: 'page:explore', path: '/featherbase/admin/explore', at: event.at + 1 },
      { kind: 'search', key: 'search:depot', label: 'depot', at: event.at + 2 },
    ] })).entries
    expect(entries).toHaveLength(3)
    expect(entries.map(e => e.path)).toEqual(['', '/featherbase/admin/explore', event.path])
    for (const path of [undefined, 'https://evil.example/', '/featherbase/admin/not-a-page'])
      expect((await admin.post<Home>('/api/home_resume', { hints: [{ kind: 'page', key: 'page:unknown', path }] })).entries).toEqual([])
  })

  test('unexpected storage failures are not presented as unavailable history', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'] })
    await admin.post(table.url, { row_id: 'north' })
    const event = await visit(admin, table.name, 'north')
    await admin.post('/api/events', { events: [event] })
    await sql`drop table featherbase.resume_plant`
    expect((await admin.fetch('/api/home_resume', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(500)
  })

  test('a deleted last row yields the older usable destination', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Resume Plant', columns: ['title'], title_column: 'title' })
    for (const row_id of ['south', 'north']) {
      await admin.post(table.url, { row_id, title: `${row_id} depot` })
      const read = await admin.fetch(`${table.url}/${row_id}`, { headers: { 'X-Navigation-Visit': '1' } })
      await admin.post('/api/events', { events: [{ kind: 'row', key: `row:${table.name}/${row_id}`,
        label: row_id, sub: table.name, path: `/featherbase/admin/${encodeURIComponent(table.name)}/${row_id}`,
        claim: read.headers.get('X-Navigation-Claim') }] })
    }
    await admin.delete(`${table.url}/north`)
    const home = await admin.post<{ entries: Array<{ label: string; path: string }> }>('/api/home_resume', {})
    expect(home.entries).toEqual([expect.objectContaining({ label: 'south depot', path: '/featherbase/admin/Resume%20Plant/south' })])
  })
})

function ev(key: string, at?: number, extra: Record<string, unknown> = {}) {
  return { kind: 'row', key, label: key, path: `/admin/X/${key}`, ...(at ? { at } : {}), ...extra }
}

describe('#101: POST /api/events + GET /api/events/summary', () => {
  test('a batch lands and the summary aggregates per key, oldest-first visits', async ({
    admin,
  }) => {
    const now = Date.now()
    const res = await admin.post<{ inserted: number }>('/api/events', {
      events: [
        ev('row:X/A', now - 60_000),
        ev('row:X/A', now - 1_000, { label: 'A latest' }),
        { kind: 'list', key: 'list:X?', label: 'X', sub: 'status = Open', path: '/admin/X', at: now },
      ],
    })
    expect(res.inserted).toBe(3)

    const summary = await admin.get<{ entries: Array<Record<string, unknown>> }>(
      '/api/events/summary',
    )
    const a = summary.entries.find((e) => e.key === 'row:X/A')
    const l = summary.entries.find((e) => e.key === 'list:X?')
    expect(a).toMatchObject({ key: 'row:X/A', kind: 'row' })
    expect(l).toMatchObject({ kind: 'list', sub: 'status = Open' })
    const visits = a!.visits as number[]
    expect(visits).toHaveLength(2)
    expect(visits[0]).toBeLessThan(visits[1])
    // The newest event's label wins the aggregate.
    expect(a!.label).toBe('A latest')
  })

  test('validation: unknown kind, empty batch, oversize batch are all 417', async ({ admin }) => {
    await expect(
      admin.post('/api/events', { events: [{ kind: 'hack', key: 'x' }] }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(admin.post('/api/events', { events: [] })).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.post('/api/events', { events: Array.from({ length: 51 }, (_, i) => ev(`k${i}`)) }),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('the trail is scoped to the caller — another user sees nothing', async ({ admin, api }) => {
    await admin.post('/api/events', { events: [ev('row:X/private')] })
    const person = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'events-b@x.com', enabled: true },
    })
    const { token } = await issueSession(person.row_id)
    const res = await api.fetch('/api/events/summary', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: unknown[] }
    expect(body.entries).toHaveLength(0)
  })

  test('client timestamps are clamped to the trust window', async ({ admin }) => {
    const now = Date.now()
    const result = await admin.post<{ timestamps: number[] }>('/api/events', {
      events: [ev('row:X/old', now - 400 * DAY), ev('row:X/future', now + 5 * DAY)],
    })
    const summary = await admin.get<{ entries: Array<{ key: string; visits: number[] }> }>(
      '/api/events/summary',
    )
    const old = summary.entries.find((e) => e.key === 'row:X/old')!
    const future = summary.entries.find((e) => e.key === 'row:X/future')!
    expect(old.visits[0]).toBeGreaterThanOrEqual(now - 8 * DAY)
    expect(future.visits[0]).toBeLessThanOrEqual(now + 60_000)
    expect(result.timestamps).toEqual([old.visits[0], future.visits[0]])
  })

  // PR #104 review: the contract allows 400-char keys/labels and 1000-char
  // paths — storage must hold what validation accepts, or one long
  // filtered-list key fails its whole batch.
  test('values at the contract limits are stored intact', async ({ admin }) => {
    const longKey = ('list:X?' + JSON.stringify([['status', '=', 'x'.repeat(360)]])).slice(0, 400)
    const res = await admin.post<{ inserted: number }>('/api/events', {
      events: [
        {
          kind: 'list',
          key: longKey,
          label: 'L'.repeat(400),
          sub: 's'.repeat(400),
          path: '/admin/X?filters=' + 'y'.repeat(980),
        },
      ],
    })
    expect(res.inserted).toBe(1)
    const summary = await admin.get<{ entries: Array<{ key: string; path: string }> }>(
      '/api/events/summary',
    )
    const entry = summary.entries.find((e) => e.key === longKey)!
    expect(entry).toMatchObject({ key: longKey })
    expect(entry.path.length).toBeGreaterThan(900)
  })

  test('rows older than the retention window are pruned on the write path', async ({ admin }) => {
    await sql`insert into user_event ${sql({
      row_id: 'evt-ancient',
      created_by: 'Administrator',
      updated_by: 'Administrator',
      created_at: new Date(),
      updated_at: new Date(),
      status: 'draft',
      kind: 'row',
      ref_key: 'row:X/ancient',
      label: 'ancient',
      path: '/admin/X/ancient',
      occurred_at: new Date(Date.now() - 100 * DAY),
    })}`
    // A dormant user's expired trail goes too — retention is global, not
    // per-poster (PR #104 review).
    await sql`insert into user_event ${sql({
      row_id: 'evt-dormant',
      created_by: 'dormant@x.com',
      updated_by: 'dormant@x.com',
      created_at: new Date(),
      updated_at: new Date(),
      status: 'draft',
      kind: 'row',
      ref_key: 'row:X/dormant',
      label: 'dormant',
      path: '/admin/X/dormant',
      occurred_at: new Date(Date.now() - 120 * DAY),
    })}`
    await admin.post('/api/events', { events: [ev('row:X/fresh')] })
    const summary = await admin.get<{ entries: Array<{ key: string }> }>('/api/events/summary')
    expect(summary.entries.some((e) => e.key === 'row:X/fresh')).toBe(true)
    expect(summary.entries.some((e) => e.key === 'row:X/ancient')).toBe(false)
    const [dormant] = await sql`select 1 from user_event where row_id = 'evt-dormant'`
    expect(dormant).toBeUndefined()
  })
})
