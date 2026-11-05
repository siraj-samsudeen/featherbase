// #905: a System Manager archives a custom Table something else replaced.
// Its rows and history stay readable; no new rows or edits, through the UI,
// the API or an import; it leaves the menus, the command bar and the pickers;
// it can be un-archived, and deleting it stays a separate step.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { expectApiError, makeTable } from './fixtures'
import { sql } from '../src/db'

const T = 'Arc Old Plant'
const url = `/api/table/${encodeURIComponent(T)}`
const archive = (client: TestClient, note?: unknown, table = T) =>
  client.post<Record<string, unknown>>(`/api/table_def/${encodeURIComponent(table)}/archive`, note === undefined ? {} : { note })
const unarchive = (client: TestClient, table = T) =>
  client.post<Record<string, unknown>>(`/api/table_def/${encodeURIComponent(table)}/unarchive`, {})

async function plants(admin: TestClient) {
  await makeTable(admin, { name: T, id_pattern: 'PLANT-{plant_code}', columns: ['plant_code', 'city'] })
  await admin.post('/api/save_row', { table: T, row: { plant_code: '8151', city: 'Chennai' } })
}

type Page = { cards: { links: { link_to: string }[] }[]; shortcuts: { link_to: string }[] }
async function homeLinks(client: TestClient): Promise<string[]> {
  const { pages } = await client.get<{ pages: Page[] }>('/api/home_pages')
  return pages.flatMap((p) => [...p.cards.flatMap((c) => c.links.map((l) => l.link_to)), ...p.shortcuts.map((s) => s.link_to)])
}
const commandTables = async (client: TestClient) =>
  (await client.get<{ tables: { row_id: string }[] }>('/api/command_destinations')).tables.map((t) => t.row_id)

describe('#905: archiving a Table', () => {
  test('rows stay readable; who, when and what replaced it ride on the meta', async ({ admin }) => {
    await plants(admin)
    const meta = await archive(admin, '  Replaced by Plant  ')
    expect(meta).toMatchObject({ name: T, archived_by: 'Administrator', archived_note: 'Replaced by Plant' })
    expect(meta.archived_at).toBeTruthy()
    expect(await admin.get(`${url}:meta`)).toMatchObject({ archived_by: 'Administrator', archived_note: 'Replaced by Plant' })
    expect(await admin.get(`${url}/PLANT-8151`)).toMatchObject({ city: 'Chennai' })
    expect((await admin.get<{ data: unknown[] }>(url)).data).toHaveLength(1)
    const [log] = await sql`select operation from access_log where operation = 'archive_table'`
    expect(log).toBeTruthy()
  })

  test('no new rows, edits, deletes or imports, whoever asks', async ({ admin }) => {
    await plants(admin)
    await archive(admin)
    const refused = { status: 403, message: expect.stringContaining(`${T} is archived`) }
    await expectApiError(admin.post('/api/save_row', { table: T, row: { plant_code: '9000', city: 'Pune' } }), refused)
    const row = await admin.get<{ updated_at: string }>(`${url}/PLANT-8151`)
    await expectApiError(admin.post('/api/save_row', { table: T, row: { row_id: 'PLANT-8151', city: 'Madurai', updated_at: row.updated_at } }), refused)
    await expectApiError(admin.delete(`${url}/PLANT-8151`), refused)
    await expectApiError(admin.post(`${url}:import`, { key_column: 'plant_code', rows: [{ plant_code: '9001', city: 'Salem' }] }), refused)
    const caps = await admin.get<Record<string, boolean>>(`${url}/PLANT-8151:capabilities`)
    expect(caps).toMatchObject({ write: false, delete: false, rename: false })
    expect(await admin.get(`${url}/PLANT-8151`)).toMatchObject({ city: 'Chennai' })
    expect((await admin.get<{ data: unknown[] }>(url)).data).toHaveLength(1)
  })

  test('it leaves the menus and the command bar, and comes back when un-archived', async ({ admin }) => {
    await plants(admin)
    const before = await homeLinks(admin)
    expect(before.some((l) => l.includes('arc-old-plant') || l.includes(encodeURIComponent(T)) || l === T)).toBe(true)
    expect(await commandTables(admin)).toContain(T)

    await archive(admin, 'Replaced by Plant')
    expect((await homeLinks(admin)).some((l) => l.includes('arc-old-plant') || l.includes(encodeURIComponent(T)) || l === T)).toBe(false)
    expect(await commandTables(admin)).not.toContain(T)
    expect((await admin.get<{ capabilities: { archived: string[] } }>('/api/whoami')).capabilities.archived).toEqual([T])

    const back = await unarchive(admin)
    expect(back).toMatchObject({ archived_at: null, archived_by: null, archived_note: null })
    expect(await commandTables(admin)).toContain(T)
    expect((await homeLinks(admin)).length).toBe(before.length)
    expect((await admin.get<{ capabilities: { archived: string[] } }>('/api/whoami')).capabilities.archived).toEqual([])
    await admin.post('/api/save_row', { table: T, row: { plant_code: '9000', city: 'Pune' } })
    expect((await admin.get<{ data: unknown[] }>(url)).data).toHaveLength(2)
  })

  test('a reader sees it under archived and cannot add rows; only a System Manager archives', async ({ admin, createUser }) => {
    await plants(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Arc Clerk' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: T, role: 'Arc Clerk', can_read: true, can_write: true, can_create: true } })
    const clerk = await createUser({ email: 'arc.clerk@example.com', roles: ['Arc Clerk'] })
    await expectApiError(archive(clerk), { status: 403 })
    await archive(admin)
    const who = await clerk.get<{ capabilities: { archived: string[]; creatable: string[]; tables: string[] } }>('/api/whoami')
    expect(who.capabilities).toMatchObject({ archived: [T], creatable: [] })
    expect(who.capabilities.tables).toContain(T)
    expect(await clerk.get(`${url}/PLANT-8151`)).toMatchObject({ city: 'Chennai' })
    await expectApiError(clerk.post('/api/save_row', { table: T, row: { plant_code: '9100', city: 'Trichy' } }), { status: 403 })
    await expectApiError(unarchive(clerk), { status: 403 })
  })

  test('an archived Table can still be deleted, as a separate step', async ({ admin }) => {
    await plants(admin)
    await archive(admin)
    await admin.delete(`/api/table_def/${encodeURIComponent(T)}`)
    expect(await sql`select name from table_def where name = ${T}`).toEqual([])
  })

  test('only a custom Table, once, with a short note', async ({ admin }) => {
    await plants(admin)
    await expectApiError(archive(admin, 'x'.repeat(501)), { status: 417 })
    await expectApiError(archive(admin, 42), { status: 417 })
    await expectApiError(archive(admin, undefined, 'Person'), { status: 417, message: expect.stringContaining('platform table') })
    await expectApiError(archive(admin, undefined, 'System Settings'), { status: 417 })
    await expectApiError(unarchive(admin), { status: 417, message: expect.stringContaining('is not archived') })
    await archive(admin)
    await expectApiError(archive(admin), { status: 417, message: expect.stringContaining('already archived') })
  })
})
