// #1282 A4: a System Manager makes their whole view of a list the Table's default (layout, columns, sort, compact
// rows, the Links tab's choices). Each save is kept with who and when; Undo puts the one before back while it is
// still the default; a person resets only their own choices. Made-up names.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { createUserWithRole, expectStatus, makeTable } from './fixtures'
import { deleteTable } from '../src/table-engine'

const put = (client: TestClient, table: string, settings: unknown) => client.fetch(`/api/table_view_default/${encodeURIComponent(table)}`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings }) })
const undo = (client: TestClient, table: string, id: string) => client.fetch(`/api/table_view_default/${encodeURIComponent(table)}/undo`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
const current = async (client: TestClient, table: string) =>
  (await (await client.fetch(`/api/table_view_default/${encodeURIComponent(table)}`)).json() as { default: { id: string; settings: unknown; by: string } | null }).default

async function floorTable(admin: TestClient) {
  return makeTable(admin, { name: 'Tvd Section', id_pattern: 'hash', title_column: 'section_name', columns: ['section_name', 'floor', 'remarks'] })
}

describe('#1282 A4: a Table\'s default view', () => {
  test('a System Manager saves their view; a reader of the Table opens on it; anyone else is refused and nothing changes', async ({ admin, createUser }) => {
    const table = await floorTable(admin)
    const reader = await createUserWithRole(admin, createUser, { role: 'Tvd Reader', table: table.name, can_read: true })
    expect(await current(reader, table.name)).toBeNull()
    const view = { layout: 'split', shownCols: ['remarks'], hiddenCols: ['floor'], sort: { field: 'floor', dir: 'asc' }, compact: true, links: { as: 'tree', fields: false } }
    await expectStatus(await put(admin, table.name, view), 200)
    expect(await current(reader, table.name)).toEqual(expect.objectContaining({ settings: view, by: admin.user }))
    await expectStatus(await put(reader, table.name, { compact: false }), 403)
    expect((await current(reader, table.name))!.settings).toEqual(view)
    // Someone who may not read the Table learns nothing of its default.
    const stranger = await createUser({ roles: [] })
    await expectStatus(await stranger.fetch(`/api/table_view_default/${encodeURIComponent(table.name)}`), 403)
  })

  test('a default names only real columns and the known view settings', async ({ admin }) => {
    const table = await floorTable(admin)
    await expectStatus(await put(admin, table.name, { shownCols: ['no_such_column'] }), 417)
    await expectStatus(await put(admin, table.name, { sort: { field: 'no_such_column', dir: 'asc' } }), 417)
    await expectStatus(await put(admin, table.name, { colour: 'red' }), 417)
    await expectStatus(await put(admin, 'No Such Table', { compact: true }), 404)
    expect(await current(admin, table.name)).toBeNull()
  })

  test('a body that is not JSON saves nothing and undoes nothing', async ({ admin }) => {
    const table = await floorTable(admin)
    const saved = await (await put(admin, table.name, { compact: true })).json() as { id: string }
    const broken = { headers: { 'content-type': 'application/json' }, body: '{not json' }
    await expectStatus(await admin.fetch(`/api/table_view_default/${encodeURIComponent(table.name)}`, { method: 'PUT', ...broken }), 417)
    await expectStatus(await admin.fetch(`/api/table_view_default/${encodeURIComponent(table.name)}/undo`, { method: 'POST', ...broken }), 409)
    expect(await current(admin, table.name)).toEqual(expect.objectContaining({ id: saved.id, settings: { compact: true } }))
  })

  test('Undo puts the previous default back, only while the save is still the default', async ({ admin }) => {
    const table = await floorTable(admin)
    const first = await (await put(admin, table.name, { compact: true })).json() as { id: string }
    const second = await (await put(admin, table.name, { compact: false, sort: { field: 'floor', dir: 'desc' } })).json() as { id: string }
    // The first is no longer the default, so it cannot be undone. (Codex adversarial round 1: the check and the
    // insert are one statement under the Table's lock, which a save takes too, so a save landing in between is
    // never replaced; the test sandbox runs one transaction at a time, so this stale Undo stands for the race.)
    await expectStatus(await undo(admin, table.name, first.id), 409)
    await expectStatus(await undo(admin, table.name, second.id), 200)
    expect(await current(admin, table.name)).toEqual(expect.objectContaining({ settings: { compact: true } }))
    // An Undo is not itself undone (no redo).
    const back = (await current(admin, table.name))!
    await expectStatus(await undo(admin, table.name, back.id), 409)
  })

  test('undoing the only save leaves the Table with no default', async ({ admin }) => {
    const table = await floorTable(admin)
    const only = await (await put(admin, table.name, { compact: true })).json() as { id: string }
    await expectStatus(await undo(admin, table.name, only.id), 200)
    expect(await current(admin, table.name)).toBeNull()
  })

  // Codex adversarial round 1: a deleted Table's defaults never come back with a new Table of the same name.
  test("a deleted Table's default goes with it", async ({ admin }) => {
    const table = await floorTable(admin)
    await put(admin, table.name, { compact: true })
    await deleteTable(table.name, admin.user!)
    const again = await floorTable(admin)
    expect(await current(admin, again.name)).toBeNull()
  })

  test("Reset clears only the person's own view choices for that Table, and only theirs", async ({ admin, createUser }) => {
    const table = await floorTable(admin)
    const one = await createUserWithRole(admin, createUser, { role: 'Tvd Reset', table: table.name, can_read: true })
    const two = await createUser({ roles: ['Tvd Reset'] })
    const mine = { sort: { field: 'section_name', dir: 'asc' }, compact: true, showRetired: true, groupBy: 'floor', narrowHidden: true, form: { order: ['floor'] } }
    for (const who of [one, two]) await who.fetch(`/api/user_settings/${encodeURIComponent(table.name)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mine) })
    await expectStatus(await one.fetch(`/api/user_settings/${encodeURIComponent(table.name)}/reset`, { method: 'POST' }), 200)
    const settingsOf = async (who: TestClient) => (await (await who.fetch(`/api/user_settings/${encodeURIComponent(table.name)}`)).json() as { settings: unknown }).settings
    expect(await settingsOf(one)).toEqual({ form: { order: ['floor'] } })
    expect(await settingsOf(two)).toEqual(mine)
  })

  test("the team feed shows each save, offering Undo only for the Table's current default", async ({ admin }) => {
    const table = await floorTable(admin)
    const first = await (await put(admin, table.name, { compact: true })).json() as { id: string }
    const feed = async () => ((await (await admin.fetch('/api/activity_feed?scope=team')).json()) as { items: { kind: string; label: string; count: number; undo?: string }[] }).items
      .filter((i) => i.kind === 'table_default' && i.label === table.name)
    expect(await feed()).toEqual([expect.objectContaining({ count: 1, undo: first.id })])
    // Back-to-back saves are one line of the feed, as every run is; its Undo is for the save that is the default.
    const second = await (await put(admin, table.name, { compact: false })).json() as { id: string }
    expect(await feed()).toEqual([expect.objectContaining({ count: 2, undo: second.id })])
    // Once undone, nothing on the line is the default any more.
    await undo(admin, table.name, second.id)
    expect((await feed()).every((i) => i.undo === undefined)).toBe(true)
  })
})
