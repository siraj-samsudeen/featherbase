import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { expectStatus } from './fixtures'

// #1034: unticking a grant in the permission matrix ends the access even when
// the grant has history, and the history outlives it. Before this, an edited
// grant refused with "it has 2 history entries" and the person kept the access.
const DT = 'Untick Doc'
const ROLE = 'Untick Role'
const matrix = `/api/permissions/${encodeURIComponent(DT)}`
const list = `/api/table/${encodeURIComponent(DT)}`

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  return admin.post<{ row_id: string }>(list, { title: 'A row' })
}

const grant = (admin: TestClient, operation: string, scope_mode = 'all') =>
  admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: ROLE, operation, scope_mode } })

// Two saved edits that end where they began: two history entries, as in the report.
async function editTwice(admin: TestClient, id: string, there: string, back: string) {
  for (const scope_mode of [there, back]) {
    const row = await admin.get<Record<string, unknown>>(`/api/table/Permission/${id}`)
    await admin.post('/api/save_row', { table: 'Permission', row: { ...row, scope_mode } })
  }
}

const untick = (admin: TestClient, table: string, flags: Record<string, boolean>) =>
  admin.fetch(`/api/permissions/${encodeURIComponent(table)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: ROLE, ...flags }),
  })

const historyOf = async (admin: TestClient, id: string) => {
  const filters = encodeURIComponent(JSON.stringify([['ref_table', '=', 'Permission'], ['ref_name', '=', id]]))
  const fields = encodeURIComponent(JSON.stringify(['data', 'created_by']))
  const { data } = await admin.get<{ data: { data: { changed: [string, unknown, unknown][] }; created_by: string }[] }>(
    `/api/table/Version?fields=${fields}&filters=${filters}&limit=50`)
  return data
}

describe('#1034: unticking an edited grant', () => {
  test('ends the read and the write on the next request, one tick at a time', async ({ admin, createUser }) => {
    const row = await setup(admin)
    const read = await grant(admin, 'read')
    const update = await grant(admin, 'update')
    await editTwice(admin, read.row_id, 'creator', 'all')
    await editTwice(admin, update.row_id, 'creator', 'all')

    const holder = await createUser({ roles: [ROLE] })
    const write = async (title: string) => {
      const current = await admin.get<Record<string, unknown>>(`${list}/${row.row_id}`)
      return holder.fetch('/api/save_row', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: DT, row: { ...current, title } }),
      })
    }
    await expectStatus(await holder.fetch(list), 200)
    await expectStatus(await write('holder wrote this'), 201)

    await expectStatus(await untick(admin, DT, { can_read: true, can_write: false }), 200)
    await expectStatus(await write('holder wrote this too'), 403)
    expect((await admin.get<{ title: string }>(`${list}/${row.row_id}`)).title).toBe('holder wrote this')
    await expectStatus(await holder.fetch(list), 200)

    // The holder refused the table after this tick is the scenario "A grant that was edited" (permissions-and-roles).
    await expectStatus(await untick(admin, DT, { can_read: false }), 200)
    await expectStatus(await holder.fetch(`${list}/${row.row_id}`), 403)

    const { perms } = await admin.get<{ perms: { role: string; can_read: boolean; can_write: boolean }[] }>(matrix)
    expect(perms.find((p) => p.role === ROLE)).toMatchObject({ can_read: false, can_write: false })
    expect(await sql`select 1 from permission where ref_table = ${DT} and role = ${ROLE}`).toHaveLength(0)
  })

  test('keeps the history readable, ending with who revoked it and what the grant was', async ({ admin }) => {
    await setup(admin)
    const read = await grant(admin, 'read')
    await editTwice(admin, read.row_id, 'creator', 'all')
    const before = await historyOf(admin, read.row_id)
    expect(before.length).toBeGreaterThanOrEqual(2)

    await expectStatus(await untick(admin, DT, { can_read: false }), 200)

    const after = await historyOf(admin, read.row_id)
    expect(after).toHaveLength(before.length + 1)
    expect(after).toEqual(expect.arrayContaining(before))
    // Who took it away and what it was is the scenario "A grant that was edited" (permissions-and-roles).
    // The team feed reads every history entry, this one's row gone or not.
    const feed = await admin.get<{ items: { kind: string; sub?: string; label: string }[] }>('/api/activity_feed?scope=team')
    expect(feed.items).toContainEqual(expect.objectContaining({ kind: 'change', sub: 'Permission', label: read.row_id }))
  })

  test('a grant never edited leaves who revoked it too', async ({ admin }) => {
    await setup(admin)
    const read = await grant(admin, 'read')
    await expectStatus(await untick(admin, DT, { can_read: false }), 200)
    expect((await historyOf(admin, read.row_id)).at(-1)?.data.changed).toEqual(expect.arrayContaining([['operation', 'read', null]]))
  })

  test('a comment on the grant does not keep the access either, and stays', async ({ admin, createUser }) => {
    await setup(admin)
    const read = await grant(admin, 'read')
    await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'Permission', ref_name: read.row_id, content: 'Given for the audit' } })
    const holder = await createUser({ roles: [ROLE] })
    await expectStatus(await untick(admin, DT, { can_read: false }), 200)
    await expectStatus(await holder.fetch(list), 403)
    expect(await sql`select content from comment where ref_table = 'Permission' and ref_name = ${read.row_id}`)
      .toEqual([{ content: 'Given for the audit' }])
  })

  test('ticking it again grants afresh, and the old history stays on the old grant', async ({ admin, createUser }) => {
    await setup(admin)
    const read = await grant(admin, 'read')
    await editTwice(admin, read.row_id, 'creator', 'all')
    const holder = await createUser({ roles: [ROLE] })
    await untick(admin, DT, { can_read: false })
    await expectStatus(await untick(admin, DT, { can_read: true }), 200)
    await expectStatus(await holder.fetch(list), 200)
    const [again] = await sql`select row_id from permission where ref_table = ${DT} and role = ${ROLE}`
    expect(again.row_id).not.toBe(read.row_id)
    expect((await historyOf(admin, read.row_id)).length).toBeGreaterThanOrEqual(3)
  })
})

describe('#1034: what the matrix still refuses, with history on the grant', () => {
  test('the last tick of a creator-only grant', async ({ admin }) => {
    await setup(admin)
    const read = await grant(admin, 'read', 'creator')
    await editTwice(admin, read.row_id, 'all', 'creator')
    const before = (await historyOf(admin, read.row_id)).length
    const refused = await untick(admin, DT, {})
    await expectStatus(refused, 417)
    expect(await refused.text()).toContain('preserve their scopes and app ownership')
    expect(await sql`select row_id from permission where ref_table = ${DT} and role = ${ROLE}`).toEqual([{ row_id: read.row_id }])
    expect(await historyOf(admin, read.row_id)).toHaveLength(before)
  })

  test('the last tick of an app-owned grant', async ({ admin }) => {
    await setup(admin)
    const read = await grant(admin, 'read')
    await editTwice(admin, read.row_id, 'creator', 'all')
    await sql`update permission set owner_app = 'untick_app' where row_id = ${read.row_id}`
    const refused = await untick(admin, DT, {})
    await expectStatus(refused, 417)
    expect(await refused.text()).toContain('preserve their scopes and app ownership')
    expect(await sql`select row_id from permission where ref_table = ${DT} and role = ${ROLE}`).toEqual([{ row_id: read.row_id }])
  })

  test('a grant another grant depends on, and none of its neighbours go either', async ({ admin }) => {
    await setup(admin)
    const update = await grant(admin, 'update')
    await editTwice(admin, update.row_id, 'creator', 'all')
    const read = await grant(admin, 'read')
    await editTwice(admin, read.row_id, 'creator', 'all')
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Untick Detail' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: 'Untick Detail', operation: 'update', column_rule: 'every', requires_permission: update.row_id } })
    const before = (await historyOf(admin, read.row_id)).length
    // Both unticked: read goes first in the matrix's order, so a refusal on
    // update must roll that back as well.
    const refused = await untick(admin, DT, { can_read: false, can_write: false })
    await expectStatus(refused, 417)
    expect(await refused.text()).toContain('Deeper access of Untick Detail')
    expect((await sql`select row_id from permission where ref_table = ${DT} and role = ${ROLE} order by row_id`).map((r) => r.row_id).sort())
      .toEqual([read.row_id, update.row_id].sort())
    expect(await historyOf(admin, read.row_id)).toHaveLength(before)
  })
})

describe('#1034: the exemption is the matrix alone', () => {
  test('a Permission with history is still refused a bulk delete and a purge', async ({ admin }) => {
    await setup(admin)
    const read = await grant(admin, 'read')
    await editTwice(admin, read.row_id, 'creator', 'all')
    // The single-row delete is the scenario "Deleting the same grant any other way" (permissions-and-roles).
    const bulk = await admin.fetch('/api/table/Permission:bulk-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [read.row_id] }),
    })
    await expectStatus(bulk, 417)
    expect(await bulk.text()).toContain('history entries')
    const purge = await admin.fetch('/api/table/Permission:purge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [read.row_id], reason: 'x', confirm: true }),
    })
    await expectStatus(purge, 417)
    expect(await purge.text()).toContain('cannot be deleted permanently')
    expect(await sql`select 1 from permission where row_id = ${read.row_id}`).toHaveLength(1)
  })

  test('a normal row with history is still refused a delete, for anyone but a permanent one by a System Manager', async ({ admin, createUser }) => {
    const row = await setup(admin)
    const current = await admin.get<Record<string, unknown>>(`${list}/${row.row_id}`)
    await admin.post('/api/save_row', { table: DT, row: { ...current, title: 'Edited' } })
    await grant(admin, 'read')
    await grant(admin, 'delete')
    const editor = await createUser({ roles: [ROLE] })

    for (const client of [admin, editor]) {
      const refused = await client.fetch(`${list}/${row.row_id}`, { method: 'DELETE' })
      await expectStatus(refused, 417)
      expect(await refused.text()).toContain('it has 1 history entry')
    }
    const notAllowed = await editor.fetch(`${list}:purge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [row.row_id], reason: 'x', confirm: true }),
    })
    await expectStatus(notAllowed, 403)
    expect((await admin.get<{ title: string }>(`${list}/${row.row_id}`)).title).toBe('Edited')
  })
})
