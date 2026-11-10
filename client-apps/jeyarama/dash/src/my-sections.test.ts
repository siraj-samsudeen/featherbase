// The edges of Your sections' rules, on a stand-in for the platform's helpers. The rules' main
// paths run on the real platform in platform-test/my-sections.test.ts; these are what that
// suite has no cheap way to reach. Made-up stores and people.
import { describe, expect, it } from 'vitest'
import { actions, BASE_TABLES, reads, type ActionContext, type ReadContext } from './my-sections.ts'
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

function context(tables: Record<string, Row[]>, { user = 'asha', payload, settings = { linked_tables: LISTED }, proposals = [] as Row[], route = 'people' }: { user?: string; payload?: unknown; settings?: Record<string, string>; proposals?: Row[]; route?: string } = {}) {
  const sent: { call: string; request: unknown }[] = []
  const answer = (call: string) => async (first: unknown, second?: unknown) => {
    sent.push({ call, request: second ?? first })
    return { row_id: 'new', maker: 'asha', state: call === 'approve' ? 'Applied' : call === 'reject' ? 'Rejected' : call === 'needsFreshReview' ? 'Needs fresh review' : 'Pending',
      about: null, decision_reason: null, changes: [], created_at: `${today}T00:00:00Z`, decided_at: null, route: { people: [], roles: [] } }
  }
  const ctx = {
    user, payload, settings,
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
      routeFor: async (_maker: string, approvers: { people: string[] }) => (route === 'none' ? null : { people: approvers.people, roles: [] }),
      lockRow: async () => {},
      serialize: async () => {},
      propose: answer('propose'), approve: answer('approve'), reject: answer('reject'), needsFreshReview: answer('needsFreshReview'), withdraw: answer('withdraw'),
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
    expect(await reads.category_subcategories(context(tables, { payload: { job: 'J1' } }).ctx)).toEqual([{ code: 'C2', name: 'Silk Sarees', holder: { kind: 'other', section: 'Silk', team_leader: null }, asked: false }])
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
