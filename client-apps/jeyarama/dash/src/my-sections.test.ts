// The edges of Your sections' rules, on a stand-in for the platform's helpers. The rules' main
// paths run on the real platform in platform-test/my-sections.test.ts; these are what that
// suite has no cheap way to reach. Made-up stores and people.
import { describe, expect, it } from 'vitest'
import { actions, asDecider, BASE_TABLES, fewNames, reads, type ActionContext, type ReadContext } from './my-sections.ts'
import { istToday } from './report.ts'

type Row = Record<string, unknown>
const today = istToday()
const later = '2999-01-01'
const LISTED = JSON.stringify(BASE_TABLES)

function matches(row: Row, [column, op, value]: [string, string, unknown]) {
  const cell = row[column]
  if (op === '=') return (cell ?? null) === value
  if (op === '!=') return (cell ?? null) !== value
  if (op === 'in') return (value as unknown[]).includes(cell)
  const needle = String(value).replaceAll('%', '').toLowerCase()
  return String(cell ?? '').toLowerCase().includes(needle)
}

function world(over: Partial<Record<string, Row[]>> = {}) {
  return {
    Employee: [
      { row_id: 'E1', name: 'Asha', status: 'Current', person: 'asha' },
      { row_id: 'E2', name: 'Mani', status: 'Current', person: 'mani' },
    ],
    'Job Assignment': [{ row_id: 'J1', employee: 'E1', job: 'Team Leader', site: 'LKS', section: 'S1', reports_to: 'E2', starts_on: '2026-01-01', ends_on: null }],
    Section: [
      { row_id: 'S1', name: 'Ladies', site: 'LKS', floor: 'F1', status: 'Active' },
      { row_id: 'S2', name: 'Silk', site: 'LKS', floor: null, status: 'Active' },
    ],
    'Store Floor': [{ row_id: 'F1', name: 'First', site: 'LKS' }],
    'Section Subcategory': [{ row_id: 'P1', section_subcategory_id: 'P1', store: 'LKS', subcategory: 'C1', section: 'S1', starts_on: '2026-01-01', ends_on: null }],
    Subcategory: [{ row_id: 'C1', subcategory: 'Sarees', subcategory_type: 'Merchandise' }, { row_id: 'C2', subcategory: 'Silk Sarees', subcategory_type: 'Merchandise' }],
    Site: [{ row_id: 'LKS', name: 'Lakeside', is_store: true }],
    ...over,
  } as Record<string, Row[]>
}

function context(tables: Record<string, Row[]>, { user = 'asha', payload, settings = { linked_tables: LISTED }, proposals = [] as Row[], route = 'people', roles = [] as string[] }: { user?: string; payload?: unknown; settings?: Record<string, string>; proposals?: Row[]; route?: string; roles?: string[] } = {}) {
  const sent: { call: string; request: unknown }[] = []
  const answer = (call: string) => async (first: unknown, second?: unknown) => {
    sent.push({ call, request: second ?? first })
    return { row_id: 'new', maker: 'asha', state: call === 'approve' ? 'Applied' : call === 'reject' ? 'Rejected' : call === 'needsFreshReview' ? 'Needs fresh review' : 'Pending',
      about: null, decision_reason: null, changes: [], created_at: `${today}T00:00:00Z`, decided_at: null, route: { people: [], roles: [] } }
  }
  const ctx = {
    user, payload, settings, roles,
    reject(message: string): never { throw new Error(message) },
    baseTables: {
      async list(table: string, args: { filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number }) {
        const rows = (tables[table] ?? []).filter(row => (args.filters ?? []).every(filter => matches(row, filter)))
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
      mayDecide: async () => true,
      mayDecideMany: async (asks: unknown[]) => asks.map(() => true),
      modeOf: async () => 'Approve first',
      routeFor: async (_maker: string, approvers: { people: string[] }) => (route === 'none' ? null : { people: route === 'ghost' ? ['nobody-on-staff'] : approvers.people, roles: [] }),
      lockRow: async () => {},
      serialize: async () => {},
      propose: answer('propose'), approve: answer('approve'), reject: answer('reject'), needsFreshReview: answer('needsFreshReview'), withdraw: answer('withdraw'), confirm: answer('confirm'), undo: answer('undo'),
    },
  }
  return { ctx: ctx as unknown as ActionContext & ReadContext, sent }
}

const proposal = (about: Row, over: Row = {}) => ({ row_id: 'PR', maker: 'asha', state: 'Pending', about, decision_reason: null, changes: [], created_at: `${today}T00:00:00Z`, decided_at: null, route: { people: ['mani'], roles: [] }, ...over })
const move = { kind: 'move', what: 'Sarees', from: 'Ladies', to: 'Silk', store: 'Lakeside', site: 'LKS', maker_name: 'Asha', manager_name: 'Mani', job_assignment: 'J1', subcategory: 'C1', from_section: 'S1', to_section: 'S2' }
const add = { ...move, kind: 'add', subcategory: 'C2', from_section: '', from: 'No section', to: 'Ladies', to_section: 'S1' }

describe('whether it is set up', () => {
  it.each([[{}], [{ linked_tables: 'not json' }], [{ linked_tables: '{"a":1}' }], [{ linked_tables: '["Employee"]' }]])('says so with %j', async settings => {
    expect(await reads.my_sections(context(world(), { settings }).ctx)).toEqual({ state: 'not_set_up' })
    expect(await reads.approvals(context(world(), { settings }).ctx)).toEqual({ state: 'not_set_up' })
    expect(await reads.subcategory_levels(context(world(), { settings, payload: { job: 'J1' } }).ctx)).toEqual({ start: null, levels: [] })
    expect(await reads.category_subcategories(context(world(), { settings, payload: { job: 'J1' } }).ctx)).toEqual([])
    expect(await reads.unplaced(context(world(), { settings }).ctx)).toEqual({ state: 'not_set_up' })
  })
})

describe('who decides a subcategory taken from another section (#1254, Codex)', () => {
  it("reaches that section's Team Leader's manager however many past jobs the section has", async () => {
    const past = Array.from({ length: 500 }, (_, n) => ({ row_id: `H${String(n).padStart(3, '0')}`, employee: 'E2', job: 'Staff', site: 'LKS', section: 'S2', reports_to: 'E2', starts_on: '2020-01-01', ends_on: '2020-12-31' }))
    const base = world()
    const tables = world({
      Employee: [...base.Employee, { row_id: 'E3', name: 'Tara', status: 'Current', person: 'tara' }, { row_id: 'E4', name: 'Nila', status: 'Current', person: 'nila' }],
      'Job Assignment': [...base['Job Assignment'], ...past, { row_id: 'J9', employee: 'E3', job: 'Team Leader', site: 'LKS', section: 'S2', reports_to: 'E4', starts_on: '2026-01-01', ends_on: null }],
      'Section Subcategory': [...base['Section Subcategory'], { row_id: 'P2', section_subcategory_id: 'P2', store: 'LKS', subcategory: 'C2', section: 'S2', starts_on: '2026-01-01', ends_on: null }],
    })
    const { ctx, sent } = context(tables, { payload: { job: 'J1', subcategories: ['C2'] } })
    await actions.propose_adds(ctx)
    expect(sent.find(s => s.call === 'propose')?.request).toMatchObject({ approvers: { people: ['mani', 'nila'] } })
  })
})

describe('Your sections', () => {
  it('a person on the staff list with no job has nothing to read', async () => {
    expect(await reads.my_sections(context(world({ 'Job Assignment': [] })).ctx)).toMatchObject({ state: 'ok', jobs: [], proposals: [] })
  })

  it('reads every page of a large section, and names what it can', async () => {
    const many = Array.from({ length: 501 }, (_, n) => ({ row_id: `P${n}`, store: 'LKS', subcategory: n ? `X${n}` : 'C1', section: 'S1', starts_on: '2026-01-01', ends_on: n % 2 ? later : null }))
    const answer = await reads.my_sections(context(world({ 'Section Subcategory': many })).ctx) as { jobs: { subcategories: { name: string }[] }[] }
    expect(answer.jobs[0].subcategories).toHaveLength(501)
    expect(answer.jobs[0].subcategories.at(-1)?.name).toBe('Unnamed subcategory')
  })

  it('a section with no floor says none; a pending ask says who it waits for now, or the team', async () => {
    const tables = world({ 'Job Assignment': [{ row_id: 'J1', employee: 'E1', job: 'Staff', site: 'LKS', section: 'S2', reports_to: 'E2', starts_on: '2026-01-01' }] })
    const answer = await reads.my_sections(context(tables, { proposals: [proposal(move)], route: 'none' }).ctx) as { jobs: { section: { floor: unknown } }[]; proposals: { waiting_for: string }[] }
    expect(answer.jobs[0].section.floor).toBeNull()
    expect(answer.proposals[0].waiting_for).toBe('the master data team')
  })

  it('a decided proposal with no description still reads', async () => {
    const answer = await reads.my_sections(context(world(), { proposals: [proposal(null as unknown as Row, { state: 'Rejected', route: { people: ['mani'], roles: [] } })] }).ctx) as { proposals: { state: string; waiting_for: string }[] }
    expect(answer.proposals[0]).toMatchObject({ state: 'Rejected', waiting_for: 'the master data team' })
  })

  it('dates a proposal by the day in India', async () => {
    const justAfterMidnightInIndia = '2026-11-08T19:00:00Z'
    const decided = proposal(move, { state: 'Applied', created_at: justAfterMidnightInIndia, decided_at: justAfterMidnightInIndia })
    const answer = await reads.my_sections(context(world(), { proposals: [decided] }).ctx) as { proposals: { asked_on: string; decided_on: string }[] }
    expect(answer.proposals[0]).toMatchObject({ asked_on: '2026-11-09', decided_on: '2026-11-09' })
  })

  it('a pending proposal has no decision day', async () => {
    const answer = await reads.my_sections(context(world(), { proposals: [proposal(move)] }).ctx) as { proposals: { decided_on: string }[] }
    expect(answer.proposals[0].decided_on).toBe('')
  })
})

describe('browsing', () => {
  it('a category nobody holds anything in, and a job with no section, start nowhere in particular', async () => {
    const tables = world({ 'Job Assignment': [{ row_id: 'J1', employee: 'E1', job: 'Staff', site: 'LKS', section: null, reports_to: 'E2', starts_on: '2026-01-01' }] })
    expect(await reads.subcategory_levels(context(tables, { payload: { job: 'J1' } }).ctx)).toMatchObject({ start: null })
    expect(await reads.category_subcategories(context(world(), { payload: { job: 'J1', division: 'Nowhere' } }).ctx)).toEqual([])
  })

  it('a section with no Team Leader is named without one', async () => {
    const tables = world({ Subcategory: [{ row_id: 'C2', subcategory: 'Silk Sarees', subcategory_type: 'Merchandise' }],
      'Section Subcategory': [{ row_id: 'P2', store: 'LKS', subcategory: 'C2', section: 'S2', starts_on: '2026-01-01', ends_on: null }] })
    expect(await reads.category_subcategories(context(tables, { payload: { job: 'J1' } }).ctx)).toEqual([{ code: 'C2', name: 'Silk Sarees', holder: { kind: 'other', section: 'Silk', team_leader: null }, asked: false, taken_out: false }])
  })
})

describe('what is refused', () => {
  const refuses = (name: keyof typeof actions, payload: unknown, tables = world()) => expect(actions[name](context(tables, { payload }).ctx)).rejects.toThrow()

  it('a removal or an addition with nothing to go on', async () => {
    await refuses('propose_removal', null)
    await refuses('propose_removal', { job: 'J1' })
    await refuses('propose_removal', { job: 'J1', placement: 'P9' })
    await refuses('propose_adds', { job: 'J1', subcategories: 'C2' })
    await refuses('propose_adds', { job: 'J1', subcategories: ['C2', 'C2'] })
    await refuses('withdraw', {})
  })

  it('a job with no section to move from or add to', async () => {
    const tables = world({ 'Job Assignment': [{ row_id: 'J1', employee: 'E1', job: 'Staff', site: 'LKS', section: null, reports_to: 'E2', starts_on: '2026-01-01' }] })
    await refuses('propose_removal', { job: 'J1', placement: 'P1' }, tables)
    await refuses('propose_adds', { job: 'J1', subcategories: ['C2'] }, tables)
  })

  it('a removal or an add when a change is already planned for it', async () => {
    const planned = [...world()['Section Subcategory'], { row_id: 'P9', store: 'LKS', subcategory: 'C1', section: 'S2', starts_on: later, ends_on: null }, { row_id: 'P8', store: 'LKS', subcategory: 'C2', section: 'S2', starts_on: later, ends_on: null }]
    await expect(actions.propose_removal(context(world({ 'Section Subcategory': planned }), { payload: { job: 'J1', placement: 'P1' } }).ctx)).rejects.toThrow('already planned')
    await expect(actions.propose_adds(context(world({ 'Section Subcategory': planned }), { payload: { job: 'J1', subcategories: ['C2'] } }).ctx)).rejects.toThrow('already planned')
  })

  it('an add with no subcategory, into a closed section, or of one placed twice', async () => {
    await refuses('propose_adds', { job: 'J1' })
    await refuses('propose_adds', { job: 'J1', subcategories: [7] })
    const closed = world()
    closed.Section[0].status = 'Inactive'
    await refuses('propose_adds', { job: 'J1', subcategories: ['C2'] }, closed)
    await refuses('propose_adds', { job: 'J1', subcategories: ['C2'] }, world({ 'Section Subcategory': [
      { row_id: 'P2', store: 'LKS', subcategory: 'C2', section: 'S2', starts_on: '2026-01-01' }, { row_id: 'P3', store: 'LKS', subcategory: 'C2', section: 'S3', starts_on: '2026-01-01' }] }))
  })

  it('a section change with no job, or to the same section', async () => {
    await refuses('propose_section', { to_section: 'S2' })
    await refuses('propose_section', { job: 'J1', to_section: 'S1' })
  })

  it('a section change carrying a floor to a section with none clears it', async () => {
    const tables = world({ 'Job Assignment': [{ row_id: 'J1', employee: 'E1', job: 'Staff', site: 'LKS', section: 'S1', floor: 'F1', reports_to: 'E2', starts_on: '2026-01-01' }] })
    const { ctx, sent } = context(tables, { payload: { job: 'J1', to_section: 'S2' } })
    await actions.propose_section(ctx)
    expect((sent[0].request as { changes: unknown }).changes).toEqual({ section: 'S2', floor: null })
  })

  it('a decision with no proposal, or neither approve nor reject', async () => {
    await refuses('decide', { decision: 'approve' })
    await refuses('decide', { proposal: 'missing', decision: 'approve' })
    await expect(actions.decide(context(world(), { user: 'mani', proposals: [proposal(move)], payload: { proposal: 'PR', decision: 'maybe' } }).ctx)).rejects.toThrow('Approve or reject')
    // Only something going to a section can be put elsewhere.
    const removal = { ...move, kind: 'removal', to: '', to_section: '' }
    await expect(actions.decide(context(world(), { user: 'mani', proposals: [proposal(removal)], payload: { proposal: 'PR', decision: 'approve', to_section: 'S2' } }).ctx)).rejects.toThrow('put elsewhere')
  })
})

describe('approval sends it for a fresh review when', () => {
  const decide = async (about: Row, tables = world(), over: Row = {}) => {
    const { ctx, sent } = context(tables, { user: 'mani', proposals: [proposal(about, over)], payload: { proposal: 'PR', decision: 'approve' } })
    await actions.decide(ctx)
    return sent[0]
  }
  const jobOn = (section: string) => [{ row_id: 'J1', employee: 'E1', job: 'Staff', site: 'LKS', section, reports_to: 'E2', starts_on: '2026-01-01' }]

  it('the job has ended or gone', async () => {
    expect((await decide(move, world({ 'Job Assignment': [{ row_id: 'J1', employee: 'E1', site: 'LKS', section: 'S1', reports_to: 'E2', ends_on: '2026-01-01' }] }))).call).toBe('needsFreshReview')
    expect((await decide(move, world({ 'Job Assignment': [] }))).call).toBe('needsFreshReview')
  })

  it('the person left or no longer holds the job', async () => {
    const left = world()
    left.Employee[0].status = 'Left'
    expect((await decide(move, left)).call).toBe('needsFreshReview')
    const other = world()
    other.Employee[0].person = 'someone-else'
    expect((await decide(move, other)).call).toBe('needsFreshReview')
  })

  it('an add whose person moved on, or whose subcategory has since been placed or planned', async () => {
    expect((await decide(add, world({ 'Job Assignment': jobOn('S2') }))).call).toBe('needsFreshReview')
    const placed = [...world()['Section Subcategory'], { row_id: 'P2', store: 'LKS', subcategory: 'C2', section: 'S2', starts_on: '2026-01-01', ends_on: null }]
    expect((await decide(add, world({ 'Section Subcategory': placed }))).call).toBe('needsFreshReview')
    const planned = [...world()['Section Subcategory'], { row_id: 'P2', store: 'LKS', subcategory: 'C2', section: 'S2', starts_on: later, ends_on: null }]
    expect((await decide(add, world({ 'Section Subcategory': planned }))).call).toBe('needsFreshReview')
  })

  it('a carried floor no longer matches, and not when the section has none and neither does the ask', async () => {
    const section = { ...move, kind: 'section', what: 'Staff at Lakeside', subcategory: undefined }
    const floorChange = (proposed: string | null) => ({ changes: [{ column_name: 'floor', proposed_value: proposed, review_base_value: 'F1' }] })
    expect((await decide(section, world(), floorChange('F9'))).call).toBe('needsFreshReview')
    expect((await decide(section, world(), floorChange(null))).call).toBe('approve')
  })
})

describe('approval goes ahead when', () => {
  it('the subcategory was only ever placed in the past', async () => {
    const over = [...world()['Section Subcategory'], { row_id: 'P2', store: 'LKS', subcategory: 'C2', section: 'S2', starts_on: '2020-01-01', ends_on: '2020-02-01' }]
    const { ctx, sent } = context(world({ 'Section Subcategory': over }), { user: 'mani', proposals: [proposal(add)], payload: { proposal: 'PR', decision: 'approve' } })
    await actions.decide(ctx)
    expect(sent[0].call).toBe('approve')
  })
})

describe('the edges of the new reads (#1175)', () => {
  it('a pending addition whose subcategory has gone keeps its asked-for name; a route to nobody on the staff is the team', async () => {
    const asked = { ...add, subcategory: 'GONE', what: 'Old line', to_section: 'S1' }
    const answer = await reads.my_sections(context(world(), { proposals: [proposal(asked)], route: 'ghost' }).ctx) as { jobs: { additions: { name: string; waiting_for: string }[] }[] }
    expect(answer.jobs[0].additions).toEqual([expect.objectContaining({ name: 'Old line', waiting_for: 'the master data team', division: '' })])
  })

  it('browsing with nothing sent names no job of theirs', async () => {
    await expect(reads.subcategory_levels(context(world()).ctx)).rejects.toThrow('not a job of yours')
    await expect(reads.category_subcategories(context(world()).ctx)).rejects.toThrow('not a job of yours')
  })

  it('a category nobody holds anything of lists each as in no section, two of one name by code', async () => {
    const tables = world({ Subcategory: [{ row_id: 'Z2', subcategory: 'Leggings', subcategory_type: 'Merchandise' }, { row_id: 'Z1', subcategory: 'Leggings', subcategory_type: 'Merchandise' }], 'Section Subcategory': [] })
    expect(await reads.category_subcategories(context(tables, { payload: { job: 'J1' } }).ctx)).toEqual([
      { code: 'Z1', name: 'Leggings', holder: { kind: 'none' }, asked: false, taken_out: false },
      { code: 'Z2', name: 'Leggings', holder: { kind: 'none' }, asked: false, taken_out: false },
    ])
  })

  it('the master data team: nothing ended is an empty list; of several ended rows the latest says where it was', async () => {
    const editor = { roles: ['Master Data Editor'] }
    expect(await reads.unplaced(context(world(), editor).ctx)).toEqual({ state: 'ok', rows: [] })
    expect(await reads.unplaced(context(world()).ctx)).toEqual({ state: 'not_allowed' })
    const ended = (row_id: string, store: string, subcategory: string, section: string, ends_on: string) => ({ row_id, store, subcategory, section, starts_on: '2020-01-01', ends_on })
    const tables = world({
      Site: [{ row_id: 'LKS', name: 'Lakeside', is_store: true }, { row_id: 'HIL', name: 'Hillview', is_store: true }],
      Subcategory: [{ row_id: 'C1', subcategory: 'Sarees', subcategory_type: 'Merchandise' }, { row_id: 'C2', subcategory: 'Belts', subcategory_type: 'Merchandise' }, { row_id: 'C9', subcategory: 'Hangers', subcategory_type: 'Consumable' }],
      'Section Subcategory': [ended('E1', 'LKS', 'C1', 'S2', '2026-01-10'), ended('E2', 'LKS', 'C1', 'S1', '2026-02-10'), ended('E0', 'LKS', 'C1', 'S2', '2026-01-01'),
        ended('E3', 'LKS', 'C2', 'S2', '2026-03-01'), ended('E4', 'HIL', 'C1', 'S2', '2026-03-01'), ended('E5', 'LKS', 'C9', 'S2', '2026-03-01')],
    })
    const { rows } = await reads.unplaced(context(tables, editor).ctx) as { rows: { store: string; name: string; was_in: string; since: string }[] }
    expect(rows.map(r => [r.store, r.name, r.was_in, r.since])).toEqual([
      ['Hillview', 'Sarees', 'Silk', '2026-03-02'], ['Lakeside', 'Belts', 'Silk', '2026-03-02'], ['Lakeside', 'Sarees', 'Ladies', '2026-02-11']])
  })

  it('an addition from no section shows no From, and nothing to put elsewhere', async () => {
    const answer = await reads.approvals(context(world(), { user: 'mani', proposals: [proposal(add)] }).ctx) as { proposals: { kind: string; from: unknown; to: unknown; sections: unknown[] }[] }
    expect(answer.proposals[0]).toMatchObject({ kind: 'add', from: null, to: { section: 'Ladies', holder: 'Asha' }, sections: [] })
  })

  it('an old-style move out of a section since closed needs asking again', async () => {
    const closed = world()
    closed.Section[0].status = 'Inactive'
    const { ctx, sent } = context(closed, { user: 'mani', proposals: [proposal(move)], payload: { proposal: 'PR', decision: 'approve' } })
    await actions.decide(ctx)
    expect(sent[0]).toMatchObject({ call: 'needsFreshReview', request: { reason: 'The section it would leave is no longer open.' } })
  })
})

describe('who holds a section, in a few words', () => {
  it('names one or two, then the first and how many others', () => {
    expect(fewNames([])).toBeNull()
    expect(fewNames(['Bala'])).toBe('Bala')
    expect(fewNames(['Vani', 'Asha'])).toBe('Asha and Vani')
    expect(fewNames(['Vani', 'Asha', 'Tara', 'Ravi'])).toBe('Asha and 3 others')
  })
})

describe('a free id on the same day', () => {
  it('counts past those taken', async () => {
    const taken = (id: string) => ({ row_id: id, store: 'LKS', subcategory: 'C9', section: 'S9', starts_on: '2020-01-01', ends_on: '2020-01-02' })
    const tables = world({ 'Section Subcategory': [...world()['Section Subcategory'], taken(`LKS-C1-${today}`), taken(`LKS-C1-${today}-2`)] })
    const { ctx, sent } = context(tables, { user: 'mani', proposals: [proposal(move)], payload: { proposal: 'PR', decision: 'approve' } })
    await actions.decide(ctx)
    expect((sent[0].request as { newRow: { section_subcategory_id: string } }).newRow.section_subcategory_id).toBe(`LKS-C1-${today}-3`)
  })
})

describe('the queue', () => {
  it('reads every page of what is pending', async () => {
    const many = Array.from({ length: 501 }, (_, n) => proposal(move, { row_id: `PR${n}`, maker: 'asha' }))
    const answer = await reads.approvals(context(world(), { user: 'mani', proposals: many }).ctx) as { proposals: unknown[] }
    expect(answer.proposals).toHaveLength(501)
  })
})

describe("a Department Manager's set-up, beside Your sections (#1195)", () => {
  const set = (row_id: string, kind: string, bundle = 'B1') => proposal({ kind, bundle, job_assignment: 'J1', site: 'LKS', store: 'Lakeside', name: 'Ladies', sections: ['S1'], section_names: ['Ladies'], maker_name: 'Asha', manager_name: 'Mani' }, { row_id })
  const sets = [set('PD', 'department'), set('PL', 'department_section'), set('PD2', 'department', 'B2'), set('PL2', 'department_section', 'B2')]
  it("isn't listed as a section proposal, for the person who sent it", async () => {
    expect(await reads.my_sections(context(world(), { proposals: sets }).ctx)).toMatchObject({ state: 'ok', proposals: [] })
  })
  it('counts once per set-up for the reviewer, and stays off their section approvals', async () => {
    const waiting = sets.map(p => ({ ...p, maker: 'asha' }))
    expect(await reads.my_sections(context(world(), { user: 'mani', proposals: waiting }).ctx)).toMatchObject({ waiting_for_me: 2 })
    expect(await reads.approvals(context(world(), { user: 'mani', proposals: waiting }).ctx)).toEqual({ state: 'ok', proposals: [] })
  })
})

describe("a Department Manager's own pre-fill (#1205)", () => {
  it('is not counted as waiting for them, though it is for their manager', async () => {
    const prefill = proposal({ kind: 'department', bundle: 'B1', job_assignment: 'J1', site: 'LKS', store: 'Lakeside', name: 'Womenswear', sections: ['S1'], section_names: ['Ladies'],
      maker_name: 'Asha', manager_name: 'Mani', prefilled: true, for_person: 'asha' }, { row_id: 'PD', maker: 'loader' })
    expect(await reads.my_sections(context(world(), { user: 'asha', proposals: [prefill] }).ctx)).toMatchObject({ waiting_for_me: 0 })
    expect(await reads.my_sections(context(world(), { user: 'mani', proposals: [prefill] }).ctx)).toMatchObject({ waiting_for_me: 1 })
  })
})


// #1219: a Master Data Editor decides any open review as the manager would; nobody else gains anything.
describe('who may decide', () => {
  const approvers = { people: ['manager'], fallbackRoles: ['Master Data Editor'] }
  const as = (user: string, roles: string[]) => ({ user, roles }) as unknown as ReadContext
  it('asks a Master Data Editor as the role, which the platform checks when it decides', () => {
    expect(asDecider(as('editor', ['Dash Reader', 'Master Data Editor']), approvers)).toEqual({ people: [], fallbackRoles: ['Master Data Editor'] })
  })
  it('leaves anyone else, and the manager, exactly as before', () => {
    expect(asDecider(as('someone', ['Dash Reader']), approvers)).toBe(approvers)
    expect(asDecider(as('manager', ['Dash Reader']), approvers)).toBe(approvers)
    expect(asDecider({ user: 'nobody' } as unknown as ReadContext, approvers)).toBe(approvers)
  })
  it('leaves an editor who is also the manager deciding as the manager', () => {
    expect(asDecider(as('manager', ['Master Data Editor']), approvers)).toBe(approvers)
  })
})

describe('Put back (#1219)', () => {
  const refused = (message: string): never => { throw new Error(message) }
  it('is refused to anyone without Master Data Editor, before anything is read', async () => {
    const ctx = { user: 'manager', roles: ['Dash Reader'], payload: { proposal: 'P1' }, settings: {}, reject: refused,
      baseTables: { list: () => { throw new Error('read') } }, changeProposals: { list: () => { throw new Error('read') } } } as unknown as ActionContext
    await expect(actions.put_back(ctx)).rejects.toThrow('Only the master data team can put a subcategory back')
  })
})

// #1219 (Codex): an add queues on its store and subcategory before it reads where that subcategory is,
// as an undo or Put back does, so one waiting behind a Put back reads what the Put back restored.
describe('adding queues before it reads', () => {
  it.each([['from no section', world()], ['from another section', world({ 'Section Subcategory': [
    { row_id: 'P1', section_subcategory_id: 'P1', store: 'LKS', subcategory: 'C1', section: 'S1', starts_on: '2026-01-01', ends_on: null },
    { row_id: 'P2', section_subcategory_id: 'P2', store: 'LKS', subcategory: 'C2', section: 'S2', starts_on: '2026-01-01', ends_on: null }] })]])('%s', async (_case, tables) => {
    const { ctx } = context(tables, { payload: { job: 'J1', subcategories: ['C2'] } })
    const events: string[] = []
    const list = ctx.baseTables.list.bind(ctx.baseTables)
    ;(ctx.baseTables as { list: typeof list }).list = async (table, args) => { if (table === 'Section Subcategory') events.push('read placements'); return list(table, args) }
    ;(ctx.changeProposals as unknown as { serialize: (key: string) => Promise<void> }).serialize = async key => { events.push(`queue ${key}`) }
    await actions.propose_adds(ctx)
    expect(events[0]).toBe('queue LKS:C2')
    expect(events.filter(e => e.startsWith('queue'))).toEqual(['queue LKS:C2'])
  })
})

// #1219 (Codex): a department set-up is decided only on its own card, whole and never by its own Department Manager.
describe('decide leaves department set-ups to their own card', () => {
  it.each(['department', 'department_section'])('refuses a %s proposal', async kind => {
    const setUp = proposal({ kind, bundle: 'B1', job_assignment: 'J1', site: 'LKS', for_person: 'mani' }, { maker: 'loader', state: 'Not yet reviewed' })
    const { ctx, sent } = context(world(), { user: 'mani', roles: ['Master Data Editor'], proposals: [setUp], payload: { proposal: 'PR', decision: 'confirm' } })
    await expect(actions.decide(ctx)).rejects.toThrow('A department set-up is decided on its own card')
    expect(sent).toEqual([])
  })
})

// #1219: who took each out, and the master data team's refusals, in their less common branches.
describe('who took it out, and Put back refusals (#1219)', () => {
  const editor = { roles: ['Master Data Editor'], user: 'eli' }
  const ended = (row_id: string, subcategory: string) => ({ row_id, store: 'LKS', subcategory, section: 'S1', starts_on: '2020-01-01', ends_on: '2026-03-01' })
  const tables = () => world({
    Subcategory: [{ row_id: 'C1', subcategory: 'Sarees', subcategory_type: 'Merchandise' }, { row_id: 'C2', subcategory: 'Belts', subcategory_type: 'Merchandise' },
      { row_id: 'C3', subcategory: 'Bags', subcategory_type: 'Merchandise' }, { row_id: 'C4', subcategory: 'Socks', subcategory_type: 'Merchandise' }],
    'Section Subcategory': [ended('E1', 'C1'), ended('E2', 'C2'), ended('E3', 'C3'), ended('E4', 'C4')],
  })
  const removal = (row_id: string, maker: string, target: string, created_at: string, state = 'Confirmed') =>
    ({ row_id, maker, state, target_row: target, about: { kind: 'removal', what: 'Sarees', from: 'Ladies', site: 'LKS', job_assignment: 'J1', subcategory: 'C1', from_section: 'S1' },
      decision_reason: null, changes: [], created_at, decided_at: null, route: { people: [], roles: [] } })
  async function unplacedWith(names: unknown, changedBy: Record<string, { by: string; at: string }>) {
    // Two settled removals of a row with no history: still nobody, never a guess from an old proposal.
    const { ctx } = context(tables(), { ...editor, proposals: [removal('R1', 'mani', 'E1', '2026-02-01T00:00:00Z'), removal('R2', 'asha', 'E1', '2026-02-20T00:00:00Z')] })
    ;(ctx.baseTables as unknown as { changedBy: unknown }).changedBy = async () => changedBy
    ;(ctx as unknown as { people: unknown }).people = names
    const { rows } = await reads.unplaced(ctx) as { rows: { name: string; removed_by: { name: string } | null }[] }
    return Object.fromEntries(rows.map(r => [r.name, r.removed_by?.name ?? null]))
  }
  const history = { E2: { by: 'psn_gone', at: '' }, E3: { by: 'cli', at: '' } }

  it('names a person the platform cannot name, and a step of its own; no history names nobody, whatever was proposed', async () => {
    expect(await unplacedWith({ names: async () => ({ psn_gone: null, cli: null }) }, history))
      .toEqual({ Sarees: null, Belts: 'Someone not on the staff list', Bags: 'an automatic step', Socks: null })
  })
  it('the same when the platform has no names to give, or fails to', async () => {
    const expected = { Sarees: null, Belts: 'Someone not on the staff list', Bags: 'an automatic step', Socks: null }
    expect(await unplacedWith(undefined, history)).toEqual(expected)
    expect(await unplacedWith({ names: async () => { throw new Error('down') } }, history)).toEqual(expected)
  })

  it('a removal still waiting for approval has not been taken out: nothing to put back', async () => {
    const { ctx } = context(world(), { ...editor, payload: { proposal: 'R1' }, proposals: [removal('R1', 'asha', 'P1', `${today}T00:00:00Z`, 'Pending')] })
    await expect(actions.put_back(ctx)).rejects.toThrow('Sarees has not been taken out yet')
  })

  it.each([['Undone', 'This has already been reviewed'], ['Rejected', 'This has already been decided']])('deciding one %s says it is done', async (state, said) => {
    const { ctx } = context(world(), { ...editor, payload: { proposal: 'R1', decision: 'confirm' }, proposals: [removal('R1', 'asha', 'P1', `${today}T00:00:00Z`, state)] })
    await expect(actions.decide(ctx)).rejects.toThrow(said)
  })

  it('Waiting for you, when the route reaches nobody, names no one else', async () => {
    const { ctx } = context(world(), { ...editor, route: 'none', proposals: [proposal(add)] })
    const answer = await reads.approvals(ctx) as { proposals: { also_with: unknown[] }[] }
    expect(answer.proposals.map(p => p.also_with)).toEqual([[]])
  })
})

// #1219 (Codex): an editor's asks name the role only; the managers behind them go to the platform in the same
// one call, so it reads every route's people together and naming who else each is with asks nothing new.
describe('what Waiting for you asks the platform', () => {
  it('one call for everything waiting, the managers in it beside the role; a role-only route is not asked about', async () => {
    const holder = { ...proposal(move), row_id: 'PR2', maker: 'bala', about: { ...move, job_assignment: 'J2' } }
    const tables = world({
      Employee: [{ row_id: 'E1', name: 'Asha', status: 'Current', person: 'asha' }, { row_id: 'E2', name: 'Mani', status: 'Current', person: 'mani' },
        { row_id: 'E3', name: 'Bala', status: 'Current', person: 'bala' }, { row_id: 'E4', name: 'Nila', status: 'Current', person: 'nila' }],
      'Job Assignment': [{ row_id: 'J1', employee: 'E1', job: 'Team Leader', site: 'LKS', section: 'S1', reports_to: 'E2', starts_on: '2026-01-01', ends_on: null },
        { row_id: 'J2', employee: 'E3', job: 'Team Leader', site: 'LKS', section: 'S2', reports_to: 'E4', starts_on: '2026-01-01', ends_on: null },
        { row_id: 'J3', employee: 'E9', job: 'Staff', site: 'LKS', section: null, reports_to: null, starts_on: '2026-01-01', ends_on: null }],
    })
    const noManager = { ...proposal({ ...move, kind: 'section', job_assignment: 'J3' }), row_id: 'PR3', maker: 'staff9' }
    const { ctx } = context(tables, { user: 'eli', roles: ['Master Data Editor'], proposals: [proposal(move), holder, noManager] })
    const calls: { many: { maker: string; approvers: { people: string[]; fallbackRoles: string[] } }[][]; routes: string[][] } = { many: [], routes: [] }
    const cp = ctx.changeProposals as unknown as Record<string, unknown>
    cp.mayDecideMany = async (asks: { maker: string; approvers: { people: string[] } }[]) => { calls.many.push(asks as never); return asks.map(() => true) }
    cp.mayDecide = async () => { throw new Error('asked one by one') }
    cp.routeFor = async (_maker: string, approvers: { people: string[] }) => { calls.routes.push(approvers.people); return { people: approvers.people, roles: [] } }
    const answer = await reads.approvals(ctx) as { proposals: { id: string; also_with: { name: string }[] }[] }
    expect(calls.many).toHaveLength(1)
    // The editor's own asks, then the managers' own, together.
    expect(calls.many[0].map(ask => ask.approvers.people)).toEqual([[], [], [], ['mani'], ['nila'], []])
    expect(calls.routes).toEqual([['mani'], ['nila']])
    expect(Object.fromEntries(answer.proposals.map(p => [p.id, p.also_with.map(r => r.name)]))).toEqual({ PR: ['Mani'], PR2: ['Nila'], PR3: [] })
  })
})

// #1219 (Codex): Not in any section never reads the app's whole history.
describe('what Not in any section reads', () => {
  const editor = { roles: ['Master Data Editor'], user: 'eli' }
  const spy = (tables: Record<string, Row[]>, history: Record<string, { by: string; at: string }>) => {
    const { ctx } = context(tables, editor)
    const asked: unknown[] = []
    const cp = ctx.changeProposals as unknown as Record<string, unknown>
    const list = cp.list as (filter: unknown) => Promise<unknown[]>
    cp.list = async (filter: unknown) => { asked.push(filter); return list(filter) }
    ;(ctx.baseTables as unknown as { changedBy: unknown }).changedBy = async () => history
    return { ctx, asked }
  }
  it('every ended row placed again: nothing out of a section, and no proposal is read', async () => {
    const tables = world({ 'Section Subcategory': [{ row_id: 'P1', section_subcategory_id: 'P1', store: 'LKS', subcategory: 'C1', section: 'S1', starts_on: '2026-03-02', ends_on: null },
      { row_id: 'E1', store: 'LKS', subcategory: 'C1', section: 'S2', starts_on: '2020-01-01', ends_on: '2026-03-01' }] })
    const { ctx, asked } = spy(tables, {})
    expect(await reads.unplaced(ctx)).toEqual({ state: 'ok', rows: [] })
    expect(asked).toEqual([])
  })
  it('history names every remover: only open reviews are read', async () => {
    const tables = world({ 'Section Subcategory': [{ row_id: 'E1', store: 'LKS', subcategory: 'C1', section: 'S1', starts_on: '2020-01-01', ends_on: '2026-03-01' }] })
    const { ctx, asked } = spy(tables, { E1: { by: 'asha', at: '' } })
    expect((await reads.unplaced(ctx) as { rows: unknown[] }).rows).toHaveLength(1)
    expect(asked).toEqual([{ states: ['Not yet reviewed'], limit: 500, start: 0 }])
  })
  it('a row with no history still reads only open reviews', async () => {
    const tables = world({ 'Section Subcategory': [{ row_id: 'E1', store: 'LKS', subcategory: 'C1', section: 'S1', starts_on: '2020-01-01', ends_on: '2026-03-01' }] })
    const { ctx, asked } = spy(tables, {})
    expect((await reads.unplaced(ctx) as { rows: { removed_by: unknown }[] }).rows.map(r => r.removed_by)).toEqual([null])
    expect(asked).toEqual([{ states: ['Not yet reviewed'], limit: 500, start: 0 }])
  })
})
