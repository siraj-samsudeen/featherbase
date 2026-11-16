// #1246 on the real platform: a category head moves subcategories between their own Buyer Sections, and the
// master data team decides. Made-up people and codes only. Approval is approve-first, as on a fresh instance.
import { randomUUID } from 'node:crypto'
import { describe, expect, vi } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { createCoreTables, installApp, pinned, saveRow } from './helpers'

vi.setConfig({ testTimeout: 60_000 })
process.env.MOTHERDUCK_TOKEN = 'made-up-token'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
const read = async (client: TestClient, name: string, payload: object = {}) =>
  (await client.post<any>(`/api/app_reads/dash/${name}`, { payload })).result
const act = (client: TestClient, name: string, payload: object) =>
  client.post<any>(`/api/app_actions/dash/${name}`, { idempotencyKey: randomUUID(), payload }).then(r => r.result)
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

/** Two category heads in East: Hema heads Kurtis (desks Kurti and Salwar); Omar heads Sarees (desk Silk). */
async function world(admin: TestClient, createUser: CreateUserFn) {
  await installApp(admin)
  await createCoreTables(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Master Data Editor' } })
  const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
  const login = async (name: string, roles = ['Dash Reader']) => {
    const who = await createUser({ email: `${name}-${randomUUID()}@example.test`, roles })
    await sql`update person set password_hash = 'made-up' where row_id = ${who.user!}`
    return who
  }
  const [hema, omar, editor, nobody] = [await login('hema'), await login('omar'), await login('editor', ['Dash Reader', 'Master Data Editor']), await login('nobody')]
  await save('Operating Region', { region: 'East' })
  await save('Division', { division: 'Women' })
  await save('Subdivision', { subdivision: 'Ethnic', division: 'Women' })
  for (const category of ['Kurtis', 'Sarees']) await save('Category', { category, subdivision: 'Ethnic' })
  for (const [row_id, subcategory, category] of [['010505003', 'Women Kurti', 'Kurtis'], ['010505001', 'Churidar', 'Kurtis'], ['010505009', 'Kurti Sets', 'Kurtis'], ['010101001', 'Silk sarees', 'Sarees']])
    await save('Subcategory', { row_id, subcategory, category, subdivision: 'Ethnic', division: 'Women', subcategory_type: 'Merchandise' })
  for (const [employee_code, name, person] of [['2001', 'Hema Head', hema.user], ['2002', 'Omar Head', omar.user], ['2010', 'Kavin Buyer', null], ['2011', 'Sara Buyer', null], ['2012', 'Silk Buyer', null], ['2003', 'Nobody Special', nobody.user]])
    await save('Employee', { employee_code, name, status: 'Current', person })
  await save('Merchandise Assignment', { assignment_id: 'MA-HEMA', employee: '2001', responsibility: 'Category head', category: 'Kurtis', operating_region: 'East', starts_on: '2026-10-01' })
  await save('Merchandise Assignment', { assignment_id: 'MA-OMAR', employee: '2002', responsibility: 'Category head', category: 'Sarees', operating_region: 'East', starts_on: '2026-10-01' })
  const desk = (buyer_section_id: string, name: string, buyer: string | null, category_head: string) =>
    save('Buyer Section', { buyer_section_id, name, operating_region: 'East', buyer, category_head, starts_on: '2026-11-01' })
  await desk('BS-KURTI', 'Women Kurti', '2010', '2001')
  await desk('BS-SALWAR', 'Salwar', '2011', '2001')
  await desk('BS-SILK', 'Silk', '2012', '2002')
  const link = (id: string, buyer_section: string, subcategory: string) =>
    save('Buyer Section Subcategory', { buyer_section_subcategory_id: id, buyer_section, subcategory, starts_on: '2026-11-01' })
  await link('BSS-1', 'BS-KURTI', '010505003')
  await link('BSS-2', 'BS-KURTI', '010505001')
  await link('BSS-3', 'BS-SILK', '010101001')
  return { hema, omar, editor, nobody }
}

const desksOf = async (client: TestClient) => (await read(client, 'buyer_sections')).desks
  .map((d: any) => [d.id, d.buyer?.name ?? null, d.subcategories.map((s: any) => s.code)])
const openLinks = async () => (await sql`select buyer_section, subcategory, starts_on::text as starts, ends_on::text as ends
  from featherbase.buyer_section_subcategory order by subcategory, starts_on`).map(r => [r.buyer_section, r.subcategory, r.ends])

describe('#1246 a category head and their Buyer Sections', () => {
  test('sees their own desks, each buyer and the subcategories it buys; and what in their categories no desk buys', async ({ admin, createUser }) => {
    const { hema, omar, nobody } = await world(admin, createUser)
    expect(await desksOf(hema)).toEqual([['BS-SALWAR', 'Sara Buyer', []], ['BS-KURTI', 'Kavin Buyer', ['010505001', '010505003']]])
    expect((await read(hema, 'buyer_sections')).unplaced).toEqual([{ code: '010505009', name: 'Kurti Sets', region: 'East' }])
    expect(await desksOf(omar)).toEqual([['BS-SILK', 'Silk Buyer', ['010101001']]])
    expect(await read(nobody, 'buyer_sections')).toEqual({ desks: [], unplaced: [], waiting: [], decided: [] })
  })

  test('moves a subcategory to another of their desks; the master data team approves and it applies today', async ({ admin, createUser }) => {
    const { hema, editor } = await world(admin, createUser)
    const asked = await act(hema, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-SALWAR' })
    expect(asked).toMatchObject({ state: 'Pending', waiting_for: 'the master data team' })
    expect((await read(hema, 'buyer_sections')).waiting).toEqual([expect.objectContaining({ subcategory: '010505001', region: 'East', from: 'Women Kurti', to: 'Salwar' })])
    // Nothing changes until it is approved.
    expect(await desksOf(hema)).toEqual([['BS-SALWAR', 'Sara Buyer', []], ['BS-KURTI', 'Kavin Buyer', ['010505001', '010505003']]])
    expect((await read(editor, 'buyer_section_approvals')).map((p: any) => [p.who, p.who_code, p.subcategory_name, p.from, p.from_id, p.to, p.to_id]))
      .toEqual([['Hema Head', '2001', 'Churidar', 'Women Kurti', 'BS-KURTI', 'Salwar', 'BS-SALWAR']])
    expect(await act(editor, 'decide_buyer_section', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Applied' })
    expect(await desksOf(hema)).toEqual([['BS-SALWAR', 'Sara Buyer', ['010505001']], ['BS-KURTI', 'Kavin Buyer', ['010505003']]])
    expect(await openLinks()).toEqual(expect.arrayContaining([['BS-KURTI', '010505001', yesterday], ['BS-SALWAR', '010505001', null]]))
    // Who buys it follows: Sara now buys Churidar.
    const kurtis = (await read(hema, 'my_store')).categories.find((c: any) => c.category === 'Kurtis')
    expect(kurtis.buyers.find((b: any) => b.subcategory === '010505001')).toMatchObject({ name: 'Sara Buyer', buyer_section: { id: 'BS-SALWAR', name: 'Salwar' } })
  })

  test('puts a subcategory no desk buys yet into one of their desks', async ({ admin, createUser }) => {
    const { hema, editor } = await world(admin, createUser)
    const asked = await act(hema, 'move_buyer_subcategory', { subcategory: '010505009', to_section: 'BS-SALWAR' })
    await expect(act(hema, 'move_buyer_subcategory', { subcategory: '010505009', to_section: 'BS-KURTI' })).rejects.toThrow(/already waiting/)
    await act(editor, 'decide_buyer_section', { proposal: asked.id, decision: 'approve' })
    expect((await read(hema, 'buyer_sections')).unplaced).toEqual([])
    expect(await desksOf(hema)).toEqual([['BS-SALWAR', 'Sara Buyer', ['010505009']], ['BS-KURTI', 'Kavin Buyer', ['010505001', '010505003']]])
  })

  test("refuses a desk that isn't theirs, a subcategory outside their categories, and a move to where it already is", async ({ admin, createUser }) => {
    const { hema, omar, nobody } = await world(admin, createUser)
    await expect(act(hema, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-SILK' })).rejects.toThrow(/your own Buyer Sections/)
    await expect(act(omar, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-SILK' })).rejects.toThrow(/outside your categories/)
    await expect(act(hema, 'move_buyer_subcategory', { subcategory: '010101001', to_section: 'BS-KURTI' })).rejects.toThrow(/outside your categories/)
    await expect(act(hema, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-KURTI' })).rejects.toThrow(/already in Women Kurti/)
    await expect(act(nobody, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-SALWAR' })).rejects.toThrow(/your own Buyer Sections/)
  })

  test('a move goes stale when the subcategory was moved another way before the decision; turning one down changes nothing', async ({ admin, createUser }) => {
    const { hema, editor } = await world(admin, createUser)
    const asked = await act(hema, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-SALWAR' })
    await sql`update featherbase.buyer_section_subcategory set ends_on = ${yesterday}::date where row_id = 'BSS-2'`
    expect(await act(editor, 'decide_buyer_section', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    const again = await act(hema, 'move_buyer_subcategory', { subcategory: '010505003', to_section: 'BS-SALWAR' })
    await expect(act(editor, 'decide_buyer_section', { proposal: again.id, decision: 'reject' })).rejects.toThrow(/Say why/)
    expect(await act(editor, 'decide_buyer_section', { proposal: again.id, decision: 'reject', reason: 'Kavin keeps Kurti' })).toMatchObject({ state: 'Rejected' })
    // The head sees what was decided, and why (Codex): the stale one and the one turned down.
    expect((await read(hema, 'buyer_sections')).decided.map((d: any) => [d.subcategory_name, d.to, d.state, d.reason]).sort()).toEqual([
      ['Churidar', 'Salwar', 'Needs fresh review', 'That subcategory has since been moved another way.'],
      ['Women Kurti', 'Salwar', 'Rejected', 'Kavin keeps Kurti']])
    expect(await desksOf(hema)).toEqual([['BS-SALWAR', 'Sara Buyer', []], ['BS-KURTI', 'Kavin Buyer', ['010505003']]])
  })

  test('a move goes stale when the desk it goes to moves to another region before the decision (Codex)', async ({ admin, createUser }) => {
    const { hema, editor } = await world(admin, createUser)
    await saveRow(admin, 'Operating Region', { region: 'West' })
    const asked = await act(hema, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-SALWAR' })
    await sql`update featherbase.buyer_section set operating_region = 'West' where row_id = 'BS-SALWAR'`
    expect(await act(editor, 'decide_buyer_section', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    expect(await openLinks()).toEqual(expect.arrayContaining([['BS-KURTI', '010505001', null]]))
  })

  test('a subcategory already set to join a desk on a later day is refused, and a move asked before that goes stale (Codex)', async ({ admin, createUser }) => {
    const { hema, editor } = await world(admin, createUser)
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    const asked = await act(hema, 'move_buyer_subcategory', { subcategory: '010505009', to_section: 'BS-SALWAR' })
    await saveRow(admin, 'Buyer Section Subcategory', { buyer_section_subcategory_id: 'BSS-LATER', buyer_section: 'BS-KURTI', subcategory: '010505009', starts_on: tomorrow })
    expect(await act(editor, 'decide_buyer_section', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    await expect(act(hema, 'move_buyer_subcategory', { subcategory: '010505009', to_section: 'BS-SALWAR' })).rejects.toThrow(/set to join .* on a later day/)
  })

  test('a move goes stale once its maker no longer heads the category', async ({ admin, createUser }) => {
    const { hema, editor } = await world(admin, createUser)
    const asked = await act(hema, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-SALWAR' })
    await sql`update featherbase.merchandise_assignment set ends_on = ${yesterday}::date where row_id = 'MA-HEMA'`
    expect(await act(editor, 'decide_buyer_section', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
  })

  test('only the master data team decides, never the head who asked', async ({ admin, createUser }) => {
    const { hema, omar } = await world(admin, createUser)
    const asked = await act(hema, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-SALWAR' })
    expect(await read(omar, 'buyer_section_approvals')).toEqual([])
    await expect(act(hema, 'decide_buyer_section', { proposal: asked.id, decision: 'approve' })).rejects.toThrow()
    await expect(act(omar, 'decide_buyer_section', { proposal: asked.id, decision: 'approve' })).rejects.toThrow()
  })

  test("a buyer move stays out of the section flow: not in its approvals, not decided by its decide", async ({ admin, createUser }) => {
    const { hema, editor } = await world(admin, createUser)
    const asked = await act(hema, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-SALWAR' })
    expect(await read(editor, 'approvals')).toEqual(expect.not.arrayContaining([expect.objectContaining({ id: asked.id })]))
    await expect(act(editor, 'decide', { proposal: asked.id, decision: 'approve' })).rejects.toThrow(/Buyer Section list/)
    // The head may take back a move still waiting.
    await act(hema, 'withdraw', { proposal: asked.id })
    expect((await read(hema, 'buyer_sections')).waiting).toEqual([])
  })

  test('apply now, review after: the move is made at once; keeping it confirms it, turning it down puts it back', async ({ admin, createUser }) => {
    const { hema, editor } = await world(admin, createUser)
    await admin.post('/api/save_row', { table: 'Approval Type', row: { row_id: 'dash.buyer_section_move', mode: 'Apply now, review after' } })
    const kept = await act(hema, 'move_buyer_subcategory', { subcategory: '010505001', to_section: 'BS-SALWAR' })
    expect(kept.state).toBe('Not yet reviewed')
    expect(await desksOf(hema)).toEqual([['BS-SALWAR', 'Sara Buyer', ['010505001']], ['BS-KURTI', 'Kavin Buyer', ['010505003']]])
    await expect(act(hema, 'withdraw', { proposal: kept.id })).rejects.toThrow(/master data team/)
    expect(await act(editor, 'decide_buyer_section', { proposal: kept.id, decision: 'approve' })).toMatchObject({ state: 'Confirmed' })
    const undone = await act(hema, 'move_buyer_subcategory', { subcategory: '010505003', to_section: 'BS-SALWAR' })
    expect(await act(editor, 'decide_buyer_section', { proposal: undone.id, decision: 'reject', reason: 'Kavin keeps Kurti' })).toMatchObject({ state: 'Undone' })
    expect(await desksOf(hema)).toEqual([['BS-SALWAR', 'Sara Buyer', ['010505001']], ['BS-KURTI', 'Kavin Buyer', ['010505003']]])
  })
})
