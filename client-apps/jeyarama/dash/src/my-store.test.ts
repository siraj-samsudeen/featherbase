// The edges of the managers' own-area page and its changes (#1223), on the in-memory stand-in. The main
// paths run on the real platform (platform-test); these are what that suite has no cheap way to reach.
// Made-up stores and people only.
import { describe, expect, it } from 'vitest'
import { storeActions, storeReads } from './my-store.ts'
import { actions } from './my-sections.ts'
import { assignment, context, job, later, sub, today, world, type Row } from './fake-context.test-support.ts'

type Read = (ctx: Parameters<typeof storeReads.my_store>[0]) => Promise<unknown>
const as = (user: string, payload?: unknown, over: Parameters<typeof context>[1] = {}, tables = world()) => context(tables, { user, payload, ...over }).ctx
const read = (fn: Read, user: string, payload?: unknown, over: Parameters<typeof context>[1] = {}, tables = world()) => fn(as(user, payload, over, tables)) as Promise<any>

describe('which page a manager sees', () => {
  it('a store, a floor, categories, or none', async () => {
    expect(await read(storeReads.manages_area, 'sm')).toBe('Your store')
    expect(await read(storeReads.manages_area, 'fm')).toBe('Your floor')
    expect(await read(storeReads.manages_area, 'ch')).toBe('Your categories')
    expect(await read(storeReads.manages_area, 'buy')).toBe('Your categories')
    expect(await read(storeReads.manages_area, 'st')).toBeNull()
  })
})

describe('Your store', () => {
  it('someone not on the staff list, or with no area, is told so', async () => {
    expect(await read(storeReads.my_store, 'stranger')).toEqual({ state: 'unknown_person' })
    expect(await read(storeReads.my_store, 'st', 'not an object')).toEqual({ state: 'nothing' })
    expect(await read(storeReads.my_store, 'sm', { kinds: ['department'] })).toEqual({ state: 'nothing' })
  })

  it("a store manager's store: floors, a section with no floor, staff and the change waiting on each", async () => {
    const open = (n: number, over: Row = {}) => ({ row_id: `PR${n}`, maker: 'tl', state: 'Pending', result_row: null,
      about: { kind: 'section', site: 'LKS', job_assignment: 'J-ST', to_section: 'S2' }, route: { people: ['sm'], roles: [] }, ...over })
    const proposals = [...Array.from({ length: 500 }, (_, n) => open(n, { about: { kind: 'add', site: 'LKS' } })), open(900),
      open(901, { state: 'Not yet reviewed', result_row: 'J-ST2', about: { kind: 'section', site: 'LKS', job_assignment: 'J-X' } })]
    const answer = await read(storeReads.my_store, 'sm', { kinds: ['store'] }, { proposals })
    const [place] = answer.places
    expect(place).toMatchObject({ kind: 'store', page: 'Your store', store: 'Lakeside', store_id: 'LKS', floor: null })
    expect(place.floors.map((f: { floor: string }) => f.floor)).toEqual(['Ground', 'No floor set', 'Unnamed floor'])
    expect(place.floors[0].sections.map((s: { name: string; active: boolean; subcategories: number; team_leaders: unknown[] }) => [s.name, s.active, s.subcategories, s.team_leaders.length]))
      .toEqual([['Closed', false, 0, 0], ['Ladies', true, 1, 1]])
    expect(place.staff.map((s: { name: string; waiting_for: unknown; movable: boolean }) => [s.name, s.movable, typeof s.waiting_for]))
      .toEqual([['Devi', false, 'object'], ['Farida', false, 'object'], ['Sam', true, 'string'], ['Unnamed', true, 'string'], ['Tara', true, 'object']])
    expect(place.sections.map((s: { name: string }) => s.name)).toEqual(['Counter', 'Kids', 'Ladies'])
  })

  it("a floor, a department and a team leader's sections, each with its own staff", async () => {
    const floor = (await read(storeReads.my_store, 'fm')).places[0]
    expect([floor.kind, floor.floor, floor.staff.map((s: { name: string }) => s.name)]).toEqual(['floor', 'Ground', ['Sam', 'Unnamed', 'Tara']])
    const department = (await read(storeReads.my_store, 'dm')).places[0]
    expect([department.kind, department.department]).toEqual(['department', { id: 'D1', name: 'Womens' }])
    const team = (await read(storeReads.my_store, 'tl')).places[0]
    expect([team.kind, team.staff.map((s: { name: string; movable: boolean }) => [s.name, s.movable])]).toEqual(['section', [['Sam', true]]])
  })

  it("a head's categories: who buys what, a buyer who left or buys one region only, and what has no buyer", async () => {
    const answer = await read(storeReads.my_store, 'ch')
    const byCategory = Object.fromEntries(answer.categories.map((c: { category: string; region: string | null }) => [`${c.category}|${c.region}`, c]))
    expect(Object.keys(byCategory).sort()).toEqual(['CAT1|East', 'CAT2|null', 'CAT3|null'])
    const cat1 = byCategory['CAT1|East']
    expect(cat1.buyers.map((b: { name: string; buys: string }) => [b.name, b.buys])).toEqual([['Bala', 'Sarees']])
    expect(cat1.no_buyer.map((s: { name: string }) => s.name)).toEqual(['', 'Lehenga', 'Silk'])
    expect(byCategory['CAT2|null'].buyers.map((b: { buys: string }) => b.buys)).toEqual(['All of SUB2'])
    expect(byCategory['CAT3|null'].buyers.map((b: { buys: string }) => b.buys)).toEqual(['All of DIV2, East only'])
    expect(byCategory['CAT3|null'].no_buyer.map((s: { name: string }) => s.name)).toEqual(['Toys'])
  })

  it("a buyer's own subcategories, by the deepest level named, and none for an assignment naming none", async () => {
    const answer = await read(storeReads.my_store, 'buy')
    expect(answer.buys.map((b: { level: string | null; named: string; subcategories: unknown[] }) => [b.level, b.named, b.subcategories.length]))
      .toEqual([['subcategory', 'C1', 1], ['subdivision', 'SUB2', 1], ['division', 'DIV2', 1], [null, '', 0]])
  })
})

describe("a section's subcategories", () => {
  it('are shown only to a manager whose area holds the section', async () => {
    expect(await read(storeReads.section_subcategories, 'sm')).toEqual({ state: 'not_allowed' })
    expect(await read(storeReads.section_subcategories, 'st', { section: 'S1' })).toEqual({ state: 'not_allowed' })
  })

  it('lists what is placed there now, naming an unnamed one plainly', async () => {
    expect(await read(storeReads.section_subcategories, 'sm', { section: 'S2' })).toEqual({ state: 'ok', section: { id: 'S2', name: 'Kids' },
      placed: [{ placement: 'P2', code: 'C9', name: 'Unnamed subcategory' }] })
    expect((await read(storeReads.section_subcategories, 'sm', { section: 'S3' })).placed).toEqual([])
  })
})

describe('finding a subcategory to add', () => {
  it('needs two letters; finds by name or by code, merchandise only', async () => {
    expect(await read(storeReads.find_subcategories, 'sm')).toEqual([])
    expect(await read(storeReads.find_subcategories, 'sm', { q: ' s ' })).toEqual([])
    expect(await read(storeReads.find_subcategories, 'sm', { q: 'sa' })).toEqual([{ code: 'C1', name: 'Sarees' }])
    expect(await read(storeReads.find_subcategories, 'sm', { q: 'ba' })).toEqual([])
    const numbered = world({ Subcategory: [sub('101', 'Shirts'), sub('102', 'Trousers')] })
    expect((await read(storeReads.find_subcategories, 'sm', { q: '10' }, {}, numbered)).map((s: { code: string }) => s.code)).toEqual(['101', '102'])
  })
})

describe("a manager's changes to a section", () => {
  const run = (action: keyof typeof storeActions, user: string, payload?: unknown, tables = world(), over: Parameters<typeof context>[1] = {}) => {
    const c = context(tables, { user, payload, ...over })
    return { done: storeActions[action](c.ctx), sent: c.sent }
  }

  it('taking one out needs a placement in a section the manager looks after, and none planned', async () => {
    await expect(run('manage_remove', 'sm', 'nonsense').done).rejects.toThrow('That subcategory is not in this section')
    await expect(run('manage_remove', 'sm', { placement: 'P9' }).done).rejects.toThrow('That subcategory is not in this section')
    await expect(run('manage_remove', 'tl', { placement: 'P1' }).done).rejects.toThrow('You can change only the sections in your own store, floor or department')
    const planned = world({ 'Section Subcategory': [...world()['Section Subcategory'], { row_id: 'P8', store: 'LKS', section: 'S2', subcategory: 'C1', starts_on: later, ends_on: null }] })
    await expect(run('manage_remove', 'sm', { placement: 'P1' }, planned).done).rejects.toThrow('already planned')
    const ok = run('manage_remove', 'sm', { placement: 'P1' })
    await ok.done
    expect(ok.sent[0]).toMatchObject({ call: 'propose', request: expect.objectContaining({ ends: true, row: 'P1' }) })
  })

  it('taking one out refuses a placement that changed under the lock', async () => {
    const tables = world()
    const moved = tables['Section Subcategory'].map(p => (p.row_id === 'P1' ? { ...p, section: 'S2' } : p))
    const c = context(tables, { user: 'sm', payload: { placement: 'P1' }, reads: (table, n) => (table === 'Section Subcategory' && n === 2 ? moved : undefined) })
    await expect(storeActions.manage_remove(c.ctx)).rejects.toThrow('That subcategory is not in this section')
  })

  it('putting one in needs a section, an open one, and a merchandise subcategory', async () => {
    await expect(run('manage_add', 'sm', 'nonsense').done).rejects.toThrow('Pick a section in your area')
    await expect(run('manage_add', 'sm', { section: 'S4', subcategory: 'C2' }).done).rejects.toThrow('That section is no longer open')
    await expect(run('manage_add', 'sm', { section: 'S3' }).done).rejects.toThrow('Pick a subcategory from the list')
    await expect(run('manage_add', 'sm', { section: 'S3', subcategory: 'C8' }).done).rejects.toThrow('Pick a subcategory from the list')
    const moved = run('manage_add', 'sm', { section: 'S3', subcategory: 'C1' })
    await moved.done
    expect(moved.sent[0].call).toBe('propose')
  })

  it("a department manager's section that moved out of the department is refused", async () => {
    await expect(run('manage_add', 'dm', { section: 'S2', subcategory: 'C1' }).done).rejects.toThrow('outside your area now')
  })
})

describe('moving a member of staff', () => {
  const run = (user: string, payload?: unknown, tables = world(), reads?: (table: string, n: number) => Row[] | undefined) =>
    storeActions.move_staff(context(tables, { user, payload, reads }).ctx)

  it('needs someone on the staff list today, unchanged since the page was read, and not yourself', async () => {
    await expect(run('sm', 'nonsense')).rejects.toThrow('Pick someone to move')
    await expect(run('sm', { job: 'J-NOPE' })).rejects.toThrow('That job is no longer on the staff list')
    await expect(run('sm', { job: 'J-OLD', to_section: 'S3' })).rejects.toThrow('That job is no longer on the staff list')
    const changed = world()['Job Assignment'].map(j => (j.row_id === 'J-ST' ? { ...j, section: 'S3' } : j))
    await expect(run('sm', { job: 'J-ST', to_section: 'S2' }, world(), (t, n) => (t === 'Job Assignment' && n === 3 ? changed : undefined))).rejects.toThrow('That job has just changed')
    await expect(run('sm', { job: 'J-SM', to_section: 'S2' })).rejects.toThrow("You can't move yourself")
  })

  it('moves only Staff and Team Leaders in your own area, to an open, different section, while they are still here', async () => {
    await expect(run('sm', { job: 'J-FM', to_section: 'S2' })).rejects.toThrow('Only Staff and Team Leaders can be moved here')
    await expect(run('fm', { job: 'J-ST', to_section: 'S2' })).rejects.toThrow('You can move only your own staff, within your own area')
    await expect(run('sm', { job: 'J-ST', to_section: 'S4' })).rejects.toThrow('That section is no longer open')
    await expect(run('sm', { job: 'J-ST', to_section: 'S1' })).rejects.toThrow('They are already in that section')
    const left = world({ Employee: world().Employee.map(e => (e.row_id === 'E-ST' ? { ...e, status: 'Left' } : e)) })
    await expect(run('sm', { job: 'J-ST', to_section: 'S2' }, left)).rejects.toThrow('They are no longer on the staff list')
  })

  it('sends the move for review, with the floor following the section when the job had one', async () => {
    const c = context(world(), { user: 'sm', payload: { job: 'J-ST', to_section: 'S3' } })
    expect(await storeActions.move_staff(c.ctx)).toMatchObject({ id: 'new', state: 'Pending' })
    expect(c.sent[0].request).toMatchObject({ changes: { section: 'S3', floor: null } })
    const noFloor = context(world(), { user: 'sm', payload: { job: 'J-ST2', to_section: 'S2' } })
    await storeActions.move_staff(noFloor.ctx)
    expect(noFloor.sent[0].request).toMatchObject({ changes: { section: 'S2', floor: 'F2' }, about: expect.objectContaining({ from: 'No section' }) })
  })
})

describe('the edges of Your store', () => {
  it("someone with no manager reads as such; another store's section changes are not counted", async () => {
    const tables = world({ 'Job Assignment': [...world()['Job Assignment'], job('J-ST3', 'E-NOJOB', 'Staff', { section: 'S3', reports_to: null })] })
    const proposals = [{ row_id: 'PRX', maker: 'x', state: 'Pending', result_row: null, about: { kind: 'section', site: 'HIL', job_assignment: 'J-ST3' }, route: { people: [], roles: [] } },
      { row_id: 'PRY', maker: 'x', state: 'Pending', result_row: null, about: { kind: 'section', job_assignment: 'J-ST3' }, route: { people: [], roles: [] } }]
    const staff = (await read(storeReads.my_store, 'sm', { kinds: ['store'] }, { proposals }, tables)).places[0].staff
    expect(staff.find((s: { job_id: string }) => s.job_id === 'J-ST3')).toMatchObject({ reports_to: null, waiting_for: null })
  })

  it("a narrow lead before a wider one on a category: the wider wins; a subcategory lead sees its own; an unnamed buyer; a category with no buyer", async () => {
    const tables = world({
      Employee: [...world().Employee, { row_id: 'E-BUY3', name: '', status: 'Current', person: 'buy3' }],
      'Merchandise Assignment': [
        assignment('M-A', 'E-CH', 'Category head', { subcategory: 'C2', operating_region: 'East' }),
        assignment('M-B', 'E-CH', 'Category head', { category: 'CAT1', operating_region: 'East' }),
        assignment('M-C', 'E-CH', 'Category head', { subcategory: 'C4' }),
        assignment('M-D', 'E-CH', 'Category head', { subcategory: 'C5' }),
        assignment('M-E', 'E-BUY3', 'Buyer', { subcategory: 'C4' }),
      ],
    })
    const answer = await read(storeReads.my_store, 'ch', undefined, {}, tables)
    const by = Object.fromEntries(answer.categories.map((c: { category: string; region: string | null }) => [`${c.category}|${c.region}`, c]))
    expect(by['CAT1|East'].no_buyer.map((s: { name: string }) => s.name)).toEqual(['', 'Lehenga', 'Sarees', 'Silk'])
    expect(by['CAT2|null'].buyers).toEqual([expect.objectContaining({ name: 'Unnamed', buys: 'Belts' })])
    expect(by['CAT3|null']).toMatchObject({ buyers: [], no_buyer: [{ code: 'C5', name: 'Toys' }] })
  })

  it("#1246: a head of every region whose subcategory a Buyer Section buys in each region has no gap; a buyer sees each Buyer Section's subcategories by name", async () => {
    const buyerSection = (row_id: string, operating_region: string | null, buyer = 'E-BUY') => ({ row_id, name: row_id, operating_region, buyer, category_head: 'E-CH', starts_on: '2026-01-01', ends_on: null })
    const link = (row_id: string, buyer_section: string, subcategory: string) => ({ row_id, buyer_section, subcategory, starts_on: '2026-01-01', ends_on: null })
    const tables = world({ 'Merchandise Assignment': [assignment('M-CH4', 'E-CH', 'Category head', { subcategory: 'C4' })],
      'Buyer Section': [buyerSection('BS-E', 'East'), buyerSection('BS-W', 'West', 'E-BUY2'), buyerSection('BS-NONE', null)],
      'Buyer Section Subcategory': [link('L1', 'BS-E', 'C4'), link('L2', 'BS-W', 'C4'), link('L3', 'BS-E', 'C1')] })
    const head = await read(storeReads.my_store, 'ch', undefined, {}, tables) as any
    expect(head.categories).toEqual([expect.objectContaining({ category: 'CAT2', region: null, no_buyer: [] })])
    expect(head.categories[0].buyers.map((b: any) => b.buys).sort()).toEqual(['Belts, East only', 'Belts, West only'])
    const buyer = await read(storeReads.my_store, 'buy', undefined, {}, tables) as any
    expect(buyer.buys.filter((b: any) => b.level === 'buyer_section')).toEqual([
      expect.objectContaining({ named: 'BS-E', region: 'East', subcategories: [{ code: 'C4', name: 'Belts' }, { code: 'C1', name: 'Sarees' }] }),
      expect.objectContaining({ named: 'BS-NONE', region: null, subcategories: [] })])
  })

  it("a buyer of a whole category sees its subcategories by name", async () => {
    const answer = await read(storeReads.my_store, 'buy2')
    expect(answer.buys[0].subcategories.map((s: { name: string }) => s.name)).toEqual(['', 'Lehenga', 'Sarees', 'Silk'])
  })

  it("a section's subcategories are listed by name", async () => {
    const tables = world({ 'Section Subcategory': [...world()['Section Subcategory'], { row_id: 'P5', store: 'LKS', section: 'S1', subcategory: 'C2', starts_on: '2026-01-01', ends_on: null }] })
    expect((await read(storeReads.section_subcategories, 'sm', { section: 'S1' }, {}, tables)).placed.map((p: { name: string }) => p.name)).toEqual(['Sarees', 'Silk'])
  })
})

describe('the edges of the changes', () => {
  it('putting one in the section it is in already is refused by name', async () => {
    await expect(storeActions.manage_add(context(world(), { user: 'sm', payload: { section: 'S1', subcategory: 'C1' } }).ctx)).rejects.toThrow('Sarees is already in your section')
  })

  it('a department manager moves staff between the sections of their department, holding the department still', async () => {
    const tables = world({
      'Department Section': [...world()['Department Section'], { row_id: 'L2', store: 'LKS', department: 'D1', section: 'S3', starts_on: '2026-01-01', ends_on: null }],
      'Job Assignment': [...world()['Job Assignment'], job('J-ST4', 'E-NOJOB', 'Staff', { section: 'S2', reports_to: 'E-DM' })],
    })
    const c = context(tables, { user: 'dm', payload: { job: 'J-ST4', to_section: 'S3' } })
    await storeActions.move_staff(c.ctx)
    expect(c.locked).toEqual(expect.arrayContaining([['Department', 'D1'], ['Department Section', 'L1'], ['Department Section', 'L2']]))
    expect(c.sent[0].request).toMatchObject({ changes: { section: 'S3' }, reviewed: ['employee', 'site', 'job', 'floor'] })
  })

  it('a move with no section to go to is refused', async () => {
    await expect(storeActions.move_staff(context(world(), { user: 'sm', payload: { job: 'J-ST' } }).ctx)).rejects.toThrow('You can move only your own staff, within your own area')
  })
})

// #1223: a manager's change reaching the approver. What reach no longer allows is sent back for a fresh review.
describe("deciding a manager's change", () => {
  const P1 = world()['Section Subcategory'].find(row => row.row_id === 'P1')!
  const proposal = (about: Row, over: Row = {}) => ({ row_id: 'PR', maker: 'sm', state: 'Pending', decision_reason: null, changes: [], created_at: `${today}T00:00:00Z`,
    decided_at: null, route: { people: ['mgr'], roles: [] }, target_row: null, result_row: null, ...over,
    about: { what: 'Sarees', from: 'Ladies', to: 'Counter', store: 'Lakeside', site: 'LKS', subcategory: 'C1', from_section: 'S1', to_section: 'S3', job_assignment: 'J-SM', by_manager: true, ...about } })
  const decide = async (about: Row, over: Row = {}, tables = world(), payload: Row = { decision: 'approve' }) => {
    const c = context(tables, { user: 'mgr', payload: { proposal: 'PR', ...payload }, proposals: [proposal(about, over)] })
    await actions.decide(c.ctx)
    return { call: c.sent[0].call, reason: (c.sent[0].request as { reason?: string }).reason, locked: c.locked }
  }
  const staffMove = { kind: 'section', what: 'Staff at Lakeside', subcategory: undefined, to_section: 'S2', job_assignment: 'J-ST' }

  it('a move of someone whose job has no start day (reach reads it as not held), or who has left, goes back for review', async () => {
    const ending = world({ 'Job Assignment': world()['Job Assignment'].map(j => (j.row_id === 'J-ST' ? { ...j, starts_on: null } : j)) })
    expect(await decide(staffMove, {}, ending)).toMatchObject({ call: 'needsFreshReview', reason: 'The job behind this has ended.' })
    const left = world({ Employee: world().Employee.map(e => (e.row_id === 'E-ST' ? { ...e, status: 'Left' } : e)) })
    expect(await decide(staffMove, {}, left)).toMatchObject({ call: 'needsFreshReview', reason: 'The person being moved has left.' })
  })

  it("an applied move is confirmed holding its replacement job still", async () => {
    const answer = await decide(staffMove, { state: 'Not yet reviewed', result_row: 'J-NEW' }, world(), { decision: 'confirm' })
    expect(answer.call).toBe('confirm')
    expect(answer.locked).toContainEqual(['Job Assignment', 'J-NEW'])
  })

  it('an addition or a removal by a manager who no longer holds the job, or the section, goes back for review', async () => {
    expect(await decide({ kind: 'removal' }, { maker: 'fm' })).toMatchObject({ call: 'needsFreshReview', reason: 'The person who asked no longer holds this job.' })
    expect(await decide({ kind: 'add', from_section: 'S9' })).toMatchObject({ call: 'needsFreshReview', reason: 'The manager who asked no longer manages that section.' })
  })

  it('an addition moved from a section whose placement is gone goes back for review', async () => {
    expect(await decide({ kind: 'add' })).toMatchObject({ call: 'needsFreshReview', reason: 'Where that subcategory was has since changed.' })
    expect((await decide({ kind: 'add' }, { target_row: 'P1' })).call).toBe('approve')
  })

  it('putting one in that moved after the page was read is refused', async () => {
    const moved = (table: string, n: number) => (table === 'Section Subcategory' && n >= 2 ? [{ ...P1, section: 'S2' }] : undefined)
    await expect(storeActions.manage_add(context(world(), { user: 'sm', payload: { section: 'S3', subcategory: 'C1' }, reads: moved }).ctx))
      .rejects.toThrow('Sarees has just moved. Open the page again')
  })
})
