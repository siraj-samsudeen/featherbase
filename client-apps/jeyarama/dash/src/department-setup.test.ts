// A Department Manager sets up their own department (#1195), on a stand-in for the platform's
// helpers. Made-up stores and people. The main path also runs on the real platform in
// platform-test/department-setup.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APPROVAL, DEPARTMENT_TABLES, departmentActions, departmentReads } from './department-setup.ts'
import { BASE_TABLES, type ActionContext, type ReadContext } from './my-sections.ts'
import { istToday } from './report.ts'

type Row = Record<string, unknown>
const today = istToday()
const LISTED = JSON.stringify([...BASE_TABLES, ...DEPARTMENT_TABLES])
const job = (row_id: string, employee: string, job: string, site: string, section: string | null, reports_to: string | null, over: Row = {}) =>
  ({ row_id, employee, job, site, section, floor: null, reports_to, starts_on: '2026-01-01', ends_on: null, ...over })

function world(over: Partial<Record<string, Row[]>> = {}) {
  return {
    Employee: [
      { row_id: 'E1', name: 'Deepa', status: 'Current', person: 'deepa' },
      { row_id: 'E2', name: 'Mani', status: 'Current', person: 'mani' },
      { row_id: 'E3', name: 'Asha', status: 'Current', person: null },
      { row_id: 'E4', name: 'Bala', status: 'Current', person: null },
      { row_id: 'E5', name: 'Kavya', status: 'Current', person: null },
      { row_id: 'E6', name: 'Arun', status: 'Current', person: 'arun' },
      { row_id: 'E7', name: 'Ravi', status: 'Current', person: null },
      { row_id: 'E8', name: 'Siva', status: 'Current', person: null },
      { row_id: 'E12', name: 'Zara', status: 'Current', person: null },
    ],
    'Job Assignment': [
      job('J1', 'E1', 'Department Manager', 'LKS', null, 'E2'),
      job('J2', 'E2', 'Store Manager', 'LKS', null, null),
      job('J3', 'E3', 'Team Leader', 'LKS', 'S1', 'E1'),
      // Two steps up: Bala reports to Siva, who reports to Deepa.
      job('J4', 'E4', 'Team Leader', 'LKS', 'S2', 'E8'),
      job('J8', 'E8', 'Staff', 'LKS', 'S2', 'E1'),
      job('J5', 'E5', 'Team Leader', 'LKS', 'S5', 'E2'),
      job('J6', 'E6', 'Department Manager', 'LKS', null, 'E2'),
      job('J7', 'E7', 'Team Leader', 'LKS', 'S3', 'E6'),
      // A second row for the same Team Leader, and one whose person HR no longer lists.
      job('J10', 'E7', 'Team Leader', 'LKS', 'S3', 'E6'),
      job('J9', 'E99', 'Team Leader', 'LKS', 'S5', 'E2'),
      job('J11', 'E12', 'Team Leader', 'LKS', 'S3', 'E6'),
    ],
    Section: [
      { row_id: 'S1', name: 'Sarees', site: 'LKS', floor: 'F1', status: 'Active' },
      { row_id: 'S2', name: 'Silk', site: 'LKS', floor: 'F1', status: 'Active' },
      { row_id: 'S5', name: 'Bags', site: 'LKS', floor: 'F1', status: 'Active' },
      { row_id: 'S3', name: 'Kids Wear', site: 'LKS', floor: 'F2', status: 'Active' },
      { row_id: 'S6', name: 'Footwear', site: 'LKS', floor: 'F2', status: 'Active' },
      { row_id: 'S9', name: 'Closed Corner', site: 'LKS', floor: 'F2', status: 'Inactive' },
      { row_id: 'S7', name: 'Loose', site: 'LKS', floor: null, status: 'Active' },
      { row_id: 'H1', name: 'Tops', site: 'HIL', floor: null, status: 'Active' },
    ],
    'Store Floor': [{ row_id: 'F1', name: 'First floor', site: 'LKS' }, { row_id: 'F2', name: 'Second floor', site: 'LKS' }],
    'Section Subcategory': ['C1', 'C2', 'C3', 'C4'].map(code => ({ row_id: `P-${code}`, store: 'LKS', subcategory: code, section: 'S1', starts_on: '2026-01-01', ends_on: null as string | null }))
      .concat([{ row_id: 'P-C9', store: 'LKS', subcategory: 'C9', section: 'S1', starts_on: '2026-01-01', ends_on: '2026-02-01' },
        { row_id: 'P-C5', store: 'LKS', subcategory: 'C5', section: 'S2', starts_on: '2026-01-01', ends_on: null }]),
    Subcategory: [
      { row_id: 'C1', subcategory: 'Silk sarees', subcategory_type: 'Merchandise' }, { row_id: 'C2', subcategory: 'Cotton sarees', subcategory_type: 'Merchandise' },
      { row_id: 'C3', subcategory: 'Kanchi sarees', subcategory_type: 'Merchandise' }, { row_id: 'C4', subcategory: 'Banarasi sarees', subcategory_type: 'Merchandise' },
      { row_id: 'C5', subcategory: 'Salwar sets', subcategory_type: 'Merchandise' },
    ],
    Site: [{ row_id: 'LKS', name: 'Lakeside', is_store: true }, { row_id: 'HIL', name: 'Hillview', is_store: true }, { row_id: 'RIV', name: 'Riverside', is_store: true }],
    Department: [
      { row_id: 'D1', department_id: 'D1', store: 'LKS', name: 'Kids', manager: 'E6', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'D2', department_id: 'D2', store: 'HIL', name: 'Kids', manager: 'E9', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'D3', department_id: 'D3', store: 'HIL', name: 'Menswear', manager: 'E9', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'D4', department_id: 'D4', store: 'HIL', name: 'Old name', manager: 'E9', starts_on: '2026-01-01', ends_on: '2026-02-01' },
      { row_id: 'D5', department_id: 'D5', store: 'NGT', name: 'Footwear and Bags', manager: 'E9', starts_on: '2026-01-01', ends_on: null },
      // Here: one whose manager is no longer on the staff list, and one that has ended.
      { row_id: 'D6', department_id: 'D6', store: 'LKS', name: 'Shoes', manager: 'E99', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'D7', department_id: 'D7', store: 'LKS', name: 'Gone', manager: 'E1', starts_on: '2026-01-01', ends_on: '2026-02-01' },
    ],
    'Department Section': [
      { row_id: 'DS1', department_section_id: 'DS1', store: 'LKS', department: 'D1', section: 'S3', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'DS6', department_section_id: 'DS6', store: 'LKS', department: 'D6', section: 'S6', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'DS7', department_section_id: 'DS7', store: 'LKS', department: 'D7', section: 'S7', starts_on: '2026-01-01', ends_on: null },
    ],
    ...over,
  } as Record<string, Row[]>
}

const DECIDED: Record<string, string> = { approve: 'Applied', reject: 'Rejected', withdraw: 'Withdrawn', confirm: 'Confirmed', undo: 'Undone' }
function context(tables: Record<string, Row[]>, { user = 'deepa', payload, settings = { linked_tables: LISTED }, proposals = [] as Row[], route = 'people', decides = true }: { user?: string; payload?: unknown; settings?: Record<string, string>; proposals?: Row[]; route?: string; decides?: boolean } = {}) {
  const sent: { call: string; first: unknown; second?: unknown }[] = []
  let made = 0
  const answer = (call: string) => async (first: unknown, second?: unknown) => {
    sent.push({ call, first, second })
    const id = call === 'propose' ? `PR${++made}` : String(first)
    const known = proposals.find(p => p.row_id === id)
    // #1191: a proposal of an apply-now type applies at once and is not yet reviewed.
    const appliedNow = call === 'propose' && 'type' in (first as Row)
    return { row_id: id, maker: 'deepa', state: appliedNow ? 'Not yet reviewed' : DECIDED[call] ?? 'Pending', about: call === 'propose' ? (first as Row).about : known?.about ?? null,
      decision_reason: (second as { reason?: string } | undefined)?.reason ?? null, result_row: call === 'approve' || appliedNow ? `ROW-${id}` : null,
      changes: [], created_at: `${today}T00:00:00Z`, decided_at: null, route: { people: route === 'people' ? ['mani'] : [], roles: [] } }
  }
  const ctx = {
    user, payload, settings, roles: [],
    reject(message: string): never { throw new Error(message) },
    baseTables: {
      async list(table: string, args: { filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number }) {
        const rows = (tables[table] ?? []).filter(row => (args.filters ?? []).every(([column, op, value]) =>
          op === 'in' ? (value as unknown[]).includes(row[column]) : (row[column] ?? null) === value))
        const start = args.limit_start ?? 0
        return rows.slice(start, start + (args.limit_page_length ?? 500))
      },
    },
    changeProposals: {
      async list(filter: { ids?: string[]; states?: string[]; makers?: string[]; start?: number; limit?: number } = {}) {
        const rows = proposals.filter(p => (!filter.ids || filter.ids.includes(String(p.row_id))) && (!filter.states || filter.states.includes(String(p.state))) && (!filter.makers || filter.makers.includes(String(p.maker))))
        const start = filter.start ?? 0
        return rows.slice(start, start + (filter.limit ?? 200))
      },
      mayDecide: async () => decides,
      routeFor: async (_maker: string, approvers: { people: string[] }) => (route === 'none' ? null : { people: route === 'people' ? approvers.people : [], roles: [] }),
      lockRow: async () => {},
      serialize: async () => {},
      propose: answer('propose'), approve: answer('approve'), reject: answer('reject'), needsFreshReview: answer('needsFreshReview'), withdraw: answer('withdraw'),
      confirm: answer('confirm'), undo: answer('undo'),
    },
  }
  return { ctx: ctx as unknown as ActionContext & ReadContext, sent }
}
const read = (tables = world(), options: Parameters<typeof context>[1] = {}) => departmentReads.department_setup(context(tables, { payload: { job: 'J1' }, ...options }).ctx)

/** A pending bundle as the platform would hold it: the department and one link per section. */
const bundle = (over: Row = {}, state = 'Pending', reason: string | null = null) => {
  const about = { kind: 'department', bundle: 'B1', job_assignment: 'J1', site: 'LKS', store: 'Lakeside', name: 'Ladies Ethnic', sections: ['S1', 'S2'], section_names: ['Sarees', 'Silk'], maker_name: 'Deepa', manager_name: 'Mani', ...over }
  const base = { maker: 'deepa', state, decision_reason: reason, changes: [], created_at: `${today}T03:00:00Z`, decided_at: state === 'Pending' ? null : `${today}T05:00:00Z`, route: { people: ['mani'], roles: [] } }
  return [
    { ...base, row_id: 'PD', about },
    { ...base, row_id: 'PL1', about: { ...about, kind: 'department_section', section: 'S1' } },
    { ...base, row_id: 'PL2', about: { ...about, kind: 'department_section', section: 'S2' } },
  ]
}

describe('the department set-up read', () => {
  it.each([[{}], [{ linked_tables: 'not json' }], [{ linked_tables: JSON.stringify(BASE_TABLES) }]])('says it is not set up with %j', async settings => {
    expect(await read(world(), { settings })).toEqual({ state: 'not_set_up' })
  })
  it('says so for someone not on the staff list, or with no Department Manager job', async () => {
    expect(await read(world(), { user: 'stranger' })).toEqual({ state: 'unknown_person' })
    expect(await read(world(), { user: 'mani', payload: {} })).toEqual({ state: 'no_job' })
  })
  it('takes their first Department Manager job when none is named', async () => {
    expect(await read(world(), { payload: {} })).toMatchObject({ state: 'ok', job: { id: 'J1', store: 'Lakeside' } })
  })
  it("says a store with no sections can't be set up yet, and who sets up its sections", async () => {
    const tables = world({ 'Job Assignment': [job('J1', 'E1', 'Department Manager', 'RIV', null, 'E2')] })
    expect(await read(tables)).toEqual({ state: 'no_sections', job: { id: 'J1', store: 'Riverside' }, reviewer: 'Mani', reviewer_is_team: false })
  })

  it('lists the floors, the sections with what they sell and who leads them, and what is suggested', async () => {
    const answer = await read()
    expect(answer).toMatchObject({ state: 'ok', name: 'Deepa', job: { id: 'J1', store: 'Lakeside' }, reviewer: 'Mani', current: null })
    if (answer.state !== 'ok') throw new Error('not ok')
    expect(answer.floors).toEqual([{ id: 'F1', name: 'First floor' }, { id: 'F2', name: 'Second floor' }, { id: '', name: 'No floor' }])
    expect(answer.start_floors).toEqual(['F1'])
    // Floor by floor, as the floors are listed, then by name; a closed section is left out.
    expect(answer.sections).toEqual([
      { id: 'S5', name: 'Bags', floor: 'F1', sells: [], more: 0, team_leaders: ['Kavya'], suggested: false, held_by: null },
      { id: 'S1', name: 'Sarees', floor: 'F1', sells: ['Banarasi sarees', 'Cotton sarees', 'Kanchi sarees'], more: 1, team_leaders: ['Asha'], suggested: true, held_by: null },
      { id: 'S2', name: 'Silk', floor: 'F1', sells: ['Salwar sets'], more: 0, team_leaders: ['Bala'], suggested: true, held_by: null },
      { id: 'S6', name: 'Footwear', floor: 'F2', sells: [], more: 0, team_leaders: [], suggested: false, held_by: 'Shoes (no manager now)' },
      { id: 'S3', name: 'Kids Wear', floor: 'F2', sells: [], more: 0, team_leaders: ['Ravi', 'Zara'], suggested: false, held_by: 'Kids (Arun)' },
      { id: 'S7', name: 'Loose', floor: '', sells: [], more: 0, team_leaders: [], suggested: false, held_by: null },
    ])
    // Names used at other stores, most used first; never one in force here, nor one that has ended.
    expect(answer.names).toEqual(['Footwear and Bags', 'Menswear'])
  })
  it('starts on every floor when nothing is suggested', async () => {
    const tables = world()
    tables['Job Assignment'] = tables['Job Assignment'].map(row => ({ ...row, reports_to: row.employee === 'E1' ? 'E2' : 'E2' }))
    const answer = await read(tables)
    expect(answer.state === 'ok' && answer.start_floors).toEqual(['F1', 'F2', ''])
  })
  it('follows a reporting line no further than five steps, and survives a loop', async () => {
    const chain = ['E3', 'E10', 'E11', 'E12', 'E13', 'E14']
    const tables = world()
    tables['Job Assignment'] = [job('J1', 'E1', 'Department Manager', 'LKS', null, 'E2'),
      ...chain.map((e, i) => job(`JC${i}`, e, i ? 'Staff' : 'Team Leader', 'LKS', i ? null : 'S1', chain[i + 1] ?? 'E1')),
      job('JL1', 'E4', 'Team Leader', 'LKS', 'S2', 'E15'), job('JL2', 'E15', 'Staff', 'LKS', null, 'E4'),
      // A line that runs to someone with no job at this store.
      job('JL3', 'E5', 'Team Leader', 'LKS', 'S5', 'E77')]
    const answer = await read(tables)
    expect(answer.state === 'ok' && answer.sections.filter(s => s.suggested).map(s => s.id)).toEqual([])
  })
  it("names the master data team when their manager can't sign in", async () => {
    expect(await read(world(), { route: 'roles' })).toMatchObject({ reviewer: 'the master data team', reviewer_is_team: true })
  })

  it('shows the department they manage now', async () => {
    const tables = world()
    tables.Department.push({ row_id: 'D9', department_id: 'D9', store: 'LKS', name: 'Ladies Ethnic', manager: 'E1', starts_on: '2026-01-01', ends_on: null })
    tables['Department Section'].push({ row_id: 'DS9', store: 'LKS', department: 'D9', section: 'S1', starts_on: '2026-01-01', ends_on: null })
    expect(await read(tables)).toMatchObject({ current: { state: 'set_up', name: 'Ladies Ethnic', sections: ['Sarees'] } })
  })
  it('shows a set-up waiting for review, and who it waits for', async () => {
    expect(await read(world(), { proposals: bundle() })).toMatchObject({ current: { state: 'waiting', bundle: 'B1', name: 'Ladies Ethnic', sections: ['Sarees', 'Silk'], waiting_for: 'Mani', asked_on: today } })
  })
  it('shows why the last set-up was turned down, until they send another', async () => {
    expect(await read(world(), { proposals: bundle({}, 'Rejected', 'Bags is in Kids') })).toMatchObject({ current: { state: 'turned_down', reason: 'Bags is in Kids', name: 'Ladies Ethnic' } })
    expect(await read(world(), { proposals: bundle({}, 'Withdrawn') })).toMatchObject({ current: null })
  })
})

describe('sending a department', () => {
  const send = (payload: Row, tables = world(), proposals: Row[] = []) => {
    const { ctx, sent } = context(tables, { payload: { job: 'J1', ...payload }, proposals })
    return { run: () => departmentActions.set_up_department(ctx), sent }
  }

  it('proposes the department and one link per section, as one bundle for their manager', async () => {
    const { run, sent } = send({ name: '  Ladies Ethnic ', sections: ['S2', 'S1'] })
    const answer = await run()
    expect(answer).toMatchObject({ state: 'waiting', name: 'Ladies Ethnic', sections: ['Sarees', 'Silk'], waiting_for: 'Mani' })
    expect(sent.map(s => s.call)).toEqual(['propose', 'propose', 'propose'])
    const [department, ...links] = sent.map(s => s.first as { table: string; row: null; changes: Row; approvers: Row; about: Row })
    expect(department).toMatchObject({ table: 'Department', row: null, changes: { store: 'LKS', name: 'Ladies Ethnic', manager: 'E1' },
      approvers: { people: ['mani'], fallbackRoles: ['Master Data Editor'] }, about: { kind: 'department', job_assignment: 'J1', sections: ['S1', 'S2'], section_names: ['Sarees', 'Silk'] } })
    expect(links.map(l => [l.table, l.changes, l.about.kind, l.about.section])).toEqual([
      ['Department Section', { store: 'LKS', section: 'S1', department: null }, 'department_section', 'S1'],
      ['Department Section', { store: 'LKS', section: 'S2', department: null }, 'department_section', 'S2'],
    ])
    expect(new Set([department, ...links].map(p => p.about.bundle)).size).toBe(1)
  })
  it.each([
    [{ job: 'J2' }, 'That is not a Department Manager job of yours'],
    [{ sections: [] }, 'Tick at least one section'],
    [{ sections: 'S1' }, 'Tick at least one section'],
    [{ name: '   ' }, 'Give your department a name'],
    [{ name: 7 }, 'Give your department a name'],
    [{ name: 'Kids' }, 'Lakeside already has a department called Kids'],
    [{ name: 'x'.repeat(61) }, 'Keep the name to 60 characters'],
    [{ sections: ['H1'] }, 'Pick sections in Lakeside'],
    [{ sections: ['S9'] }, 'Closed Corner is no longer open'],
    [{ sections: ['S3'] }, 'Kids Wear is already in Kids. Ask Mani to move it'],
  ])('refuses %j', async (over, message) => {
    await expect(send({ name: 'Ladies Ethnic', sections: ['S1'], ...over }).run()).rejects.toThrow(message)
  })
  it('keeps the sections in name order, whatever their ids', async () => {
    const { run, sent } = send({ name: 'Ladies Ethnic', sections: ['S5', 'S1'] })
    expect(await run()).toMatchObject({ sections: ['Bags', 'Sarees'] })
    expect((sent[0].first as { about: Row }).about).toMatchObject({ sections: ['S5', 'S1'], section_names: ['Bags', 'Sarees'] })
  })
  it('names the Department in each link when the platform applies it at once (#1191)', async () => {
    const { ctx, sent } = context(world(), { payload: { job: 'J1', name: 'Ladies Ethnic', sections: ['S1'] } })
    const propose = ctx.changeProposals.propose
    let first = true
    ctx.changeProposals.propose = (async (request: never) => {
      const made = await propose(request)
      if (!first) return made
      first = false
      return { ...made, state: 'Not yet reviewed', result_row: 'D-NEW' }
    }) as typeof propose
    await departmentActions.set_up_department(ctx)
    expect((sent[1].first as { changes: Row }).changes).toEqual({ store: 'LKS', section: 'S1', department: 'D-NEW' })
  })
  it('is approved first for now: no approval type is sent until #1191 lands', async () => {
    const { APPROVAL } = await import('./department-setup.ts')
    expect(APPROVAL).toEqual({})
    const { run, sent } = send({ name: 'Ladies', sections: ['S1'] })
    await run()
    expect(sent.every(s => !('type' in (s.first as Row)))).toBe(true)
  })
  it('orders two sections of one name by their ids', async () => {
    const tables = world()
    tables.Section.push({ row_id: 'S0', name: 'Bags', site: 'LKS', floor: 'F2', status: 'Active' })
    const { run } = send({ name: 'Ladies Ethnic', sections: ['S5', 'S0'] }, tables)
    expect(await run()).toMatchObject({ sections: ['Bags', 'Bags'] })
  })
  it('sends a changed one in place of the one waiting, withdrawing it first (#1195 verifier A)', async () => {
    const { run, sent } = send({ name: 'Ladies', sections: ['S5'], replaces: 'B1' }, world(), bundle())
    expect(await run()).toMatchObject({ state: 'waiting', name: 'Ladies' })
    expect(sent.map(s => [s.call, s.call === 'withdraw' ? s.first : (s.first as { table: string }).table])).toEqual([
      ['withdraw', 'PL2'], ['withdraw', 'PL1'], ['withdraw', 'PD'], ['propose', 'Department'], ['propose', 'Department Section']])
  })
  it('refuses a second while one waits, and when they already have a department', async () => {
    await expect(send({ name: 'Other', sections: ['S5'] }, world(), bundle()).run()).rejects.toThrow('You already sent one. Change or withdraw it first')
    const tables = world()
    tables.Department.push({ row_id: 'D9', store: 'LKS', name: 'Ladies Ethnic', manager: 'E1', starts_on: '2026-01-01', ends_on: null })
    await expect(send({ name: 'Other', sections: ['S5'] }, tables).run()).rejects.toThrow('You already have a department here')
  })
})

describe('withdrawing a department', () => {
  it('withdraws every part of their own waiting bundle', async () => {
    const { ctx, sent } = context(world(), { payload: { bundle: 'B1' }, proposals: bundle() })
    expect(await departmentActions.withdraw_department(ctx)).toEqual({ withdrawn: 3 })
    // Links first, then the department: nothing is left pointing at nothing (#1191).
    expect(sent.map(s => [s.call, s.first])).toEqual([['withdraw', 'PL2'], ['withdraw', 'PL1'], ['withdraw', 'PD']])
  })
  it("refuses one that isn't waiting, or isn't theirs", async () => {
    await expect(departmentActions.withdraw_department(context(world(), { payload: { bundle: 'B9' }, proposals: bundle() }).ctx)).rejects.toThrow('That set-up is no longer waiting')
    await expect(departmentActions.withdraw_department(context(world(), { user: 'mani', payload: { bundle: 'B1' }, proposals: bundle() }).ctx)).rejects.toThrow('That set-up is no longer waiting')
  })
})

describe('deciding a department', () => {
  const decide = (payload: Row, proposals = bundle()) => {
    const { ctx, sent } = context(world(), { user: 'mani', payload: { bundle: 'B1', ...payload }, proposals })
    return { run: () => departmentActions.decide_department(ctx), sent }
  }
  it('approves the department, then each link pointing at the new department', async () => {
    const { run, sent } = decide({ decision: 'approve' })
    expect(await run()).toEqual({ state: 'Applied', department: 'ROW-PD' })
    expect(sent.map(s => [s.call, s.first])).toEqual([['approve', 'PD'], ['approve', 'PL1'], ['approve', 'PL2']])
    expect(sent[0].second).toMatchObject({ effectiveOn: today, newRow: { department_id: expect.stringMatching(/^LKS-Ladies Ethnic-/), source_key: `Dash, approved ${today}` } })
    expect(sent[1].second).toMatchObject({ instead: { department: 'ROW-PD' }, newRow: { department_section_id: expect.stringMatching(/^LKS-S1-/) } })
  })
  it('applies a changed name and leaves out unticked sections, saying why', async () => {
    const { run, sent } = decide({ decision: 'approve', name: 'Ethnic Wear', sections: ['S2'] })
    await run()
    expect(sent.map(s => [s.call, s.first])).toEqual([['approve', 'PD'], ['reject', 'PL1'], ['approve', 'PL2']])
    expect(sent[0].second).toMatchObject({ instead: { name: 'Ethnic Wear' }, reason: 'Named Ethnic Wear instead.' })
    expect(sent[1].second).toMatchObject({ reason: 'Left out by the reviewer.' })
  })
  it('turns the whole bundle down, with the reason', async () => {
    const { run, sent } = decide({ decision: 'reject', reason: 'Bags is in Kids' })
    expect(await run()).toEqual({ state: 'Rejected', department: null })
    expect(sent.map(s => [s.call, (s.second as Row).reason])).toEqual([['reject', 'Bags is in Kids'], ['reject', 'Bags is in Kids'], ['reject', 'Bags is in Kids']])
  })
  it.each([
    [{ decision: 'approve', bundle: 'B9' }, 'That set-up is no longer waiting'],
    [{ decision: 'maybe' }, 'Keep it or turn it down'],
    [{ decision: 'reject', reason: ' ' }, 'Say why it is turned down'],
    [{ decision: 'approve', sections: [] }, 'Keep at least one section'],
    [{ decision: 'approve', name: 'Kids' }, 'Lakeside already has a department called Kids'],
  ])('refuses %j', async (payload, message) => {
    await expect(decide(payload).run()).rejects.toThrow(message)
  })
  it('turns down a bundle whose section was taken meanwhile, saying so', async () => {
    const tables = world()
    tables['Department Section'].push({ row_id: 'DS2', store: 'LKS', department: 'D1', section: 'S1', starts_on: '2026-01-01', ends_on: null })
    const { ctx, sent } = context(tables, { user: 'mani', payload: { bundle: 'B1', decision: 'approve' }, proposals: bundle() })
    expect(await departmentActions.decide_department(ctx)).toEqual({ state: 'Needs fresh review', department: null })
    expect(sent.map(s => s.call)).toEqual(['needsFreshReview', 'needsFreshReview', 'needsFreshReview'])
    expect(sent[0].second).toMatchObject({ reason: 'Sarees is now in Kids.' })
  })
})

describe('what waits for a reviewer', () => {
  it('lists each waiting bundle once, with its sections and their Team Leaders', async () => {
    const { ctx } = context(world(), { user: 'mani', proposals: [...bundle(), ...bundle({ bundle: 'B2', job_assignment: 'J6', maker_name: 'Arun' }).map(p => ({ ...p, row_id: `${p.row_id}-2`, maker: 'arun' }))] })
    expect(await departmentReads.department_approvals(ctx)).toEqual([
      { bundle: 'B1', who: 'Deepa', job: 'Department Manager', store: 'Lakeside', name: 'Ladies Ethnic', asked_on: today, applied: false,
        sections: [{ id: 'S1', name: 'Sarees', team_leaders: ['Asha'] }, { id: 'S2', name: 'Silk', team_leaders: ['Bala'] }] },
      { bundle: 'B2', who: 'Arun', job: 'Department Manager', store: 'Lakeside', name: 'Ladies Ethnic', asked_on: today, applied: false,
        sections: [{ id: 'S1', name: 'Sarees', team_leaders: ['Asha'] }, { id: 'S2', name: 'Silk', team_leaders: ['Bala'] }] },
    ])
  })
  it('leaves out their own, and answers nothing when not set up', async () => {
    expect(await departmentReads.department_approvals(context(world(), { proposals: bundle() }).ctx)).toEqual([])
    expect(await departmentReads.department_approvals(context(world(), { user: 'mani', settings: {}, proposals: bundle() }).ctx)).toEqual([])
  })
})

describe('the edges (#1195)', () => {
  it("names the master data team when nobody can be routed to", async () => {
    expect(await read(world(), { route: 'none' })).toMatchObject({ reviewer: 'the master data team' })
  })
  it('lists no "No floor" when every section has a floor, and sells nothing where nothing is placed', async () => {
    const tables = world({ 'Section Subcategory': [] })
    tables.Section = tables.Section.filter(s => s.row_id !== 'S7')
    const answer = await read(tables)
    if (answer.state !== 'ok') throw new Error('not ok')
    expect(answer.floors.map(f => f.id)).toEqual(['F1', 'F2'])
    expect(answer.sections.every(s => !s.sells.length)).toBe(true)
  })
  it('lists the sections of their department in name order', async () => {
    const tables = world()
    tables.Department.push({ row_id: 'D9', store: 'LKS', name: 'Ladies', manager: 'E1', starts_on: '2026-01-01', ends_on: null })
    tables['Department Section'].push({ row_id: 'DS8', store: 'LKS', department: 'D9', section: 'S2', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'DS9', store: 'LKS', department: 'D9', section: 'S1', starts_on: '2026-01-01', ends_on: null })
    expect(await read(tables)).toMatchObject({ current: { state: 'set_up', sections: ['Sarees', 'Silk'] } })
  })
  it('reads the newest set-up first, and a turn-down with no reason as an empty one', async () => {
    const older = bundle({}, 'Rejected').map(p => ({ ...p, row_id: `old-${p.row_id}`, created_at: `${today}T01:00:00Z` }))
    expect(await read(world(), { proposals: [...older, ...bundle({}, 'Withdrawn')] })).toMatchObject({ current: null })
    expect(await read(world(), { proposals: bundle({}, 'Needs fresh review') })).toMatchObject({ current: { state: 'turned_down', reason: '' } })
  })
  it('finds a bundle beyond the first page, past proposals about nothing it knows', async () => {
    const filler = Array.from({ length: 500 }, (_, i) => ({ row_id: `F${String(i).padStart(3, '0')}`, maker: 'deepa', state: 'Pending', about: null, created_at: `${today}T00:00:00Z`, route: { people: [], roles: [] } }))
    const { ctx } = context(world(), { payload: { bundle: 'B1' }, proposals: [...filler, ...bundle()] })
    expect(await departmentActions.withdraw_department(ctx)).toEqual({ withdrawn: 3 })
    const reviewer = context(world(), { user: 'mani', proposals: [...filler, ...bundle()] })
    expect(await departmentReads.department_approvals(reviewer.ctx)).toHaveLength(1)
  })
  it('shows a section with no Team Leader as having none', async () => {
    const proposals = bundle({ sections: ['S6'], section_names: ['Footwear'] })
    expect(await departmentReads.department_approvals(context(world(), { user: 'mani', proposals }).ctx)).toMatchObject([{ sections: [{ id: 'S6', name: 'Footwear', team_leaders: [] }] }])
  })
  it('leaves out set-ups the platform says they may not decide', async () => {
    expect(await departmentReads.department_approvals(context(world(), { user: 'mani', proposals: bundle(), decides: false }).ctx)).toEqual([])
  })
  it('refuses a bundle that is not a name, a send with nothing in it, a turn-down with no reason, and a long name', async () => {
    await expect(departmentActions.withdraw_department(context(world(), { payload: { bundle: 7 }, proposals: bundle() }).ctx)).rejects.toThrow('That set-up is no longer waiting')
    await expect(departmentActions.set_up_department(context(world()).ctx)).rejects.toThrow('Tick at least one section')
    await expect(departmentActions.decide_department(context(world(), { user: 'mani', payload: { bundle: 'B1', decision: 'reject' }, proposals: bundle() }).ctx)).rejects.toThrow('Say why it is turned down')
    await expect(departmentActions.decide_department(context(world(), { user: 'mani', payload: { bundle: 'B1', decision: 'approve', name: 'x'.repeat(61) }, proposals: bundle() }).ctx)).rejects.toThrow('Keep the name to 60 characters')
  })
})

describe('holds_department_job (#1195)', () => {
  it('says whether the signed-in person is a Department Manager now', async () => {
    expect(await departmentReads.holds_department_job(context(world()).ctx)).toBe(true)
    expect(await departmentReads.holds_department_job(context(world(), { user: 'mani' }).ctx)).toBe(false)
    expect(await departmentReads.holds_department_job(context(world(), { settings: {} }).ctx)).toBe(false)
  })
})

// #1191, dormant until it lands: the one APPROVAL line switched on, against stand-in confirm and undo.
describe('apply now, review after (#1191)', () => {
  beforeEach(() => { APPROVAL.type = 'department_setup' })
  afterEach(() => { delete APPROVAL.type })
  const applied = (over: Row = {}) => bundle(over, 'Not yet reviewed').map(p => (p.row_id === 'PD' ? { ...p, result_row: 'D-APPLIED' } : p))

  it('applies the department at once, and links each section to it, every row with its own id', async () => {
    const { ctx, sent } = context(world(), { payload: { job: 'J1', name: 'Ladies Ethnic', sections: ['S1', 'S2'] } })
    expect(await departmentActions.set_up_department(ctx)).toMatchObject({ state: 'set_up', name: 'Ladies Ethnic' })
    const [department, ...links] = sent.map(s => s.first as Row & { apply: { newRow: Row } })
    expect(department).toMatchObject({ type: 'department_setup', apply: { effectiveOn: today, newRow: { department_id: expect.stringMatching(/^LKS-Ladies Ethnic-/), source_key: `Dash, set up ${today}` } } })
    expect(links.map(l => [l.changes, l.apply.newRow.department_section_id])).toEqual([
      [{ store: 'LKS', section: 'S1', department: 'ROW-PR1' }, expect.stringMatching(/^LKS-S1-/)],
      [{ store: 'LKS', section: 'S2', department: 'ROW-PR1' }, expect.stringMatching(/^LKS-S2-/)],
    ])
  })
  it('shows the department in use, and who has yet to review it', async () => {
    const tables = world()
    tables.Department.push({ row_id: 'D9', store: 'LKS', name: 'Ladies Ethnic', manager: 'E1', starts_on: '2026-01-01', ends_on: null })
    expect(await read(tables, { proposals: applied() })).toMatchObject({ current: { state: 'set_up', reviewing: { bundle: 'B1', waiting_for: 'Mani' } } })
    expect(await read(tables, { proposals: bundle({}, 'Confirmed') })).toMatchObject({ current: { state: 'set_up', reviewing: null } })
  })
  it('the maker takes it back with undo, links first and with no reason; a changed one replaces it', async () => {
    const withdraw = context(world(), { payload: { bundle: 'B1' }, proposals: applied() })
    await departmentActions.withdraw_department(withdraw.ctx)
    expect(withdraw.sent.map(s => [s.call, s.first, s.second])).toEqual([
      ['undo', 'PL2', { approvers: expect.anything() }], ['undo', 'PL1', { approvers: expect.anything() }], ['undo', 'PD', { approvers: expect.anything() }]])
    const change = context(world(), { payload: { job: 'J1', name: 'Ladies', sections: ['S5'], replaces: 'B1' }, proposals: applied() })
    await departmentActions.set_up_department(change.ctx)
    expect(change.sent.map(s => s.call)).toEqual(['undo', 'undo', 'undo', 'propose', 'propose'])
  })
  it('the reviewer keeps it with confirm, undoing any section they leave out', async () => {
    const { ctx, sent } = context(world(), { user: 'mani', payload: { bundle: 'B1', decision: 'approve', sections: ['S2'] }, proposals: applied() })
    expect(await departmentActions.decide_department(ctx)).toEqual({ state: 'Confirmed', department: 'D-APPLIED' })
    expect(sent.map(s => [s.call, s.first])).toEqual([['undo', 'PL1'], ['confirm', 'PL2'], ['confirm', 'PD']])
    expect(sent[0].second).toMatchObject({ reason: 'Left out by the reviewer.' })
    const all = context(world(), { user: 'mani', payload: { bundle: 'B1', decision: 'approve', name: 'Ladies Ethnic' }, proposals: applied() })
    await departmentActions.decide_department(all.ctx)
    expect(all.sent.map(s => s.call)).toEqual(['confirm', 'confirm', 'confirm'])
  })
  it('the reviewer turns it down with undo, links first, with the reason', async () => {
    const { ctx, sent } = context(world(), { user: 'mani', payload: { bundle: 'B1', decision: 'reject', reason: 'Bags is in Kids' }, proposals: applied() })
    expect(await departmentActions.decide_department(ctx)).toEqual({ state: 'Undone', department: null })
    expect(sent.map(s => [s.call, s.first, (s.second as Row).reason])).toEqual([['undo', 'PL2', 'Bags is in Kids'], ['undo', 'PL1', 'Bags is in Kids'], ['undo', 'PD', 'Bags is in Kids']])
  })
  it('a department in use keeps its name and at least one section', async () => {
    const decide = (payload: Row) => departmentActions.decide_department(context(world(), { user: 'mani', payload: { bundle: 'B1', decision: 'approve', ...payload }, proposals: applied() }).ctx)
    await expect(decide({ name: 'Ethnic Wear' })).rejects.toThrow('A department in use keeps its name')
    await expect(decide({ sections: [] })).rejects.toThrow('Keep at least one section')
  })
  it('shows the reviewer which set-ups are already in use', async () => {
    expect(await departmentReads.department_approvals(context(world(), { user: 'mani', proposals: applied() }).ctx)).toMatchObject([{ bundle: 'B1', applied: true }])
  })
})

