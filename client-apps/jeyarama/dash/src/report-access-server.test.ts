// The Report access page's reads and actions (#1046) against made-up Tables in memory: the
// refusals, the names it falls back to, and the save rules. The real-read tests on the platform
// are platform-test/report-access.test.ts.
import { describe, expect, it } from 'vitest'
import {
  accessKey, accessPage, addToBundle, becauseLine, giveReport, makeBundle, personLookup, personSearch,
  removeAccess, removeFromBundle, validators, type AccessContext,
} from './report-access-server'
import { checkedSave } from './team-access'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]

/** Made-up Tables, read with the filters the code uses: =, in and like. */
function tables(data: Record<string, Row[]>) {
  const matches = (row: Row, [column, operator, value]: Filter) =>
    operator === '=' ? row[column] === value
      : operator === 'in' ? (value as unknown[]).includes(row[column])
        : String(row[column] ?? '').toLowerCase().includes(String(value).replaceAll('%', '').toLowerCase())
  return {
    async list(table: string, args: { filters?: Filter[]; limit_start?: number; limit_page_length?: number }) {
      const rows = (data[table] ?? []).filter(row => (args.filters ?? []).every(filter => matches(row, filter)))
      const start = args.limit_start ?? 0
      return rows.slice(start, start + (args.limit_page_length ?? rows.length))
    },
  }
}

const REPORTS = [
  { report_key: 'sales', report_name: 'Sales versus target', filter_shape: 'One store and subcategories' },
  { report_key: 'whole', report_name: 'Store target', filter_shape: 'Whole stores' },
  { report_key: 'open', report_name: 'Company notices', filter_shape: 'No filter' },
]

function context(over: Partial<AccessContext> = {}, data: Record<string, Row[]> = {}): AccessContext & { written: [string, Row][] } {
  const written: [string, Row][] = []
  const base = tables({ 'dash.report_bundle': [{ row_id: 'b1', bundle_name: 'Team leader pack' }], ...data })
  return {
    user: 'meera', roles: ['Report Access Manager'], userName: 'Meera', payload: {},
    baseTables: base,
    documents: {
      ...tables({ 'dash.report': REPORTS, ...data }),
      async create(table, values) { written.push([table, values]); return { row_id: 'new' } },
      async update(table, values) { written.push([table, values]); return values },
    },
    people: { async names() { return {} } },
    reject(message: string): never { throw new Error(message) },
    written,
    ...over,
  }
}

describe('only a Report Access Manager or a System Manager', () => {
  it.each([
    ['access_page', (ctx: AccessContext) => accessPage(ctx)],
    ['person_search', (ctx: AccessContext) => personSearch(ctx)],
    ['make_bundle', (ctx: AccessContext) => makeBundle(ctx)],
  ])('refuses %s to anyone else', async (_name, call) => {
    await expect(call(context({ roles: ['Dash Reader'] }))).rejects.toThrow('Only a Report Access Manager or a System Manager can see or change who has which report')
  })

  it('lets a System Manager in, with no roles listed meaning none', async () => {
    await expect(personSearch(context({ roles: ['System Manager'] }))).resolves.toEqual([])
    await expect(personSearch(context({ roles: undefined }))).rejects.toThrow('Only a Report Access Manager')
  })
})

describe('the page', () => {
  it('names what it can, and says plainly what it cannot', async () => {
    const ctx = context({ people: { async names(ids) { return Object.fromEntries(ids.map(id => [id, id === 'asha' ? 'Asha' : null])) } } }, {
      'dash.report_access': [
        { row_id: 'a1', report: 'gone', person: 'asha', updated_at: '2026-11-07T10:00:00Z', created_by: 'Administrator' },
        { row_id: 'a2', report_bundle: 'b9', person: 'hidden', updated_at: '2026-11-07T10:00:00Z', created_by: 'someone' },
        { row_id: 'a3', report_bundle: 'b1', job: 'Team Leader', updated_at: '2026-11-07T10:00:00Z', created_by: 'meera', given_by_name: 'Meera' },
        { row_id: 'a4', updated_at: '2026-11-07T10:00:00Z' },
        { row_id: 'a5', report: 'sales', role: 'Dash Reader', removed: true, updated_at: '2026-11-07T10:00:00Z' },
        { row_id: 'a6', report: 'open', person: 'ravi', updated_at: '2026-11-07T10:00:00Z', created_by: 'ravi' },
      ],
      'dash.report_bundle_member': [
        { row_id: 'm1', report_bundle: 'b1', report: 'whole', updated_at: 'u1' },
        { row_id: 'm2', report_bundle: 'b1', report: 'sales', updated_at: 'u2' },
        { row_id: 'm3', report_bundle: 'b1', report: 'gone', updated_at: 'u3' },
        { row_id: 'm4', report_bundle: 'b1', report: 'open', removed: 1, updated_at: 'u4' },
      ],
      Employee: [{ row_id: 'E1', person: 'ravi', name: 'Ravi' }, { row_id: 'E2', person: 'nameless', name: '' }],
      'Job Assignment': [{ row_id: 'J1', job: 'Team Leader' }, { row_id: 'J2', job: '' }, { row_id: 'J3', job: 'Team Leader' }],
    })
    const page = await accessPage(ctx)
    expect(page.rows.map(row => [row.gives, row.to, row.given_by])).toEqual([
      [{ kind: 'Bundle', name: 'A bundle no longer listed' }, { kind: 'Person', name: 'Someone you can’t see', who: { code: null, jobs: [], staff: 'none' } }, 'Someone'],
      [{ kind: 'Report', name: 'A report no longer listed' }, { kind: 'Person', name: 'Asha', who: { code: null, jobs: [], staff: 'none' } }, 'Administrator'],
      [{ kind: 'Report', name: 'Company notices' }, { kind: 'Person', name: 'Ravi', who: { code: null, jobs: [], staff: 'none' } }, 'Ravi'],
      [{ kind: 'Bundle', name: 'Team leader pack' }, { kind: 'Job', name: 'Team Leader' }, 'Meera'],
    ])
    expect(page.bundles).toEqual([{ id: 'b1', name: 'Team leader pack', reports: [
      { member: 'm2', updated_at: 'u2', key: 'sales', name: 'Sales versus target' },
      { member: 'm1', updated_at: 'u1', key: 'whole', name: 'Store target' },
    ] }])
    expect([page.roles, page.jobs, page.waiting]).toEqual([[], ['Team Leader'], []])
  })

  it('lists who is waiting, by the name the platform gives or the staff list, and lists roles', async () => {
    const ctx = context({ people: {
      async names() { return {} },
      async roleNames() { return ['Dash Reader'] },
      async waitingForAccess() { return [{ person: 'p1', name: 'Priya', asked_at: '2026-11-06T08:00:00Z' }, { person: 'ravi', name: null, asked_at: '2026-11-07T08:00:00Z' }, { person: 'p3', asked_at: '2026-11-07T09:00:00Z' }] },
    } }, { Employee: [{ row_id: 'E1', person: 'ravi', name: 'Ravi' }] })
    const page = await accessPage(ctx)
    expect([page.roles, page.waiting]).toEqual([['Dash Reader'], [
      { person: 'p1', name: 'Priya', asked_on: '2026-11-06', who: { code: null, jobs: [], staff: 'none' } },
      { person: 'ravi', name: 'Ravi', asked_on: '2026-11-07', who: { code: null, jobs: [], staff: 'none' } },
      { person: 'p3', name: 'Someone', asked_on: '2026-11-07', who: { code: null, jobs: [], staff: 'none' } },
    ]])
  })
})

describe('who has what, in order', () => {
  it('sorts rows giving the same thing by whom they go to, named by the platform', async () => {
    const ctx = context({ people: { async names(ids) { return Object.fromEntries(ids.map(id => [id, id.toUpperCase()])) } } }, { 'dash.report_access': [
      { row_id: 'a1', report: 'sales', person: 'ravi', created_by: 'meera', updated_at: '' },
      { row_id: 'a2', report: 'sales', person: 'asha', created_by: 'meera', updated_at: '' },
    ] })
    expect((await accessPage(ctx)).rows.map(row => [row.to?.name, row.given_by, row.given_on])).toEqual([['ASHA', 'MEERA', ''], ['RAVI', 'MEERA', '']])
  })
})

describe('the person picker', () => {
  it('needs two letters, and lists each current person once', async () => {
    const data = { Employee: [
      { row_id: 'E1', person: 'asha', name: 'Asha One', status: 'Current' },
      { row_id: 'E2', person: 'asha', name: 'Asha One', status: 'Current' },
      { row_id: 'E3', person: '', name: 'Asha Nobody', status: 'Current' },
      { row_id: 'E4', person: 'old', name: 'Asha Left', status: 'Left' },
    ] }
    expect(await personSearch(context({ payload: { q: 'a' } }, data))).toEqual([])
    expect(await personSearch(context({ payload: undefined }, data))).toEqual([])
    expect(await personSearch(context({ payload: { q: 'asha' } }, data))).toEqual([{ person: 'asha', name: 'Asha One', code: null, jobs: [], staff: 'current' }])
  })
})

// #1216: people with the same name are told apart by their code, and the jobs they hold today with the site.
const SAME_NAMES = {
  Employee: [
    { row_id: 'E1', employee_code: 'E1001', person: 'k1', name: 'Kumar', status: 'Current' },
    { row_id: 'E2', employee_code: 'E1002', person: 'k2', name: 'Kumar', status: 'Current' },
    { row_id: 'E3', employee_code: 'E1003', person: 'k3', name: 'Kumar', status: 'Current' },
    { row_id: 'E4', employee_code: 'E0900', person: 'gone', name: 'Kumar Old', status: 'Left' },
    { row_id: 'E5', employee_code: 'E2001', person: 'two', name: 'Tara', status: 'Current' },
  ],
  'Job Assignment': [
    { row_id: 'J1', employee: 'E1', job: 'Team Leader', site: 'S1', starts_on: '2026-01-01' },
    { row_id: 'J2', employee: 'E2', job: 'Head office staff', site: 'HO', starts_on: '2026-01-01' },
    { row_id: 'J3', employee: 'E2', job: 'Staff', site: 'S1', starts_on: '2025-01-01', ends_on: '2026-01-01' },
    { row_id: 'J4', employee: 'E5', job: 'Store Manager', site: 'S2', starts_on: '2026-01-01' },
    { row_id: 'J5', employee: 'E5', job: 'Floor Manager', site: 'S1', starts_on: '2026-01-01' },
    { row_id: 'J6', employee: 'E4', job: 'Staff', site: 'S1', starts_on: '2020-01-01' },
  ],
  Site: [{ row_id: 'S1', name: 'Lakeside' }, { row_id: 'S2', name: 'Hilltop' }, { row_id: 'HO', name: 'Head office' }],
}

describe('telling people with the same name apart (#1216)', () => {
  it('shows each one\'s code and the jobs they hold today, with the site', async () => {
    expect(await personSearch(context({ payload: { q: 'kumar' } }, SAME_NAMES))).toEqual([
      { person: 'k1', name: 'Kumar', code: 'E1001', jobs: ['Team Leader · Lakeside'], staff: 'current' },
      { person: 'k2', name: 'Kumar', code: 'E1002', jobs: ['Head office staff · Head office'], staff: 'current' },
      { person: 'k3', name: 'Kumar', code: 'E1003', jobs: [], staff: 'current' },
    ])
  })

  it('finds a person by part of their code, in any letter case, and lists everyone once in name order', async () => {
    expect((await personSearch(context({ payload: { q: 'e100' } }, SAME_NAMES))).map(found => found.code)).toEqual(['E1001', 'E1002', 'E1003'])
    expect(await personSearch(context({ payload: { q: 'E2001' } }, SAME_NAMES))).toEqual([
      { person: 'two', name: 'Tara', code: 'E2001', jobs: ['Floor Manager · Lakeside', 'Store Manager · Hilltop'], staff: 'current' },
    ])
    // A name and a code can both match the same person: still once.
    const both = { Employee: [{ row_id: 'E1', employee_code: 'AB12', person: 'ab', name: 'Abby', status: 'Current' }] }
    expect((await personSearch(context({ payload: { q: 'ab' } }, both))).map(found => found.person)).toEqual(['ab'])
  })

  it('keeps the picker to twenty', async () => {
    const many = { Employee: Array.from({ length: 30 }, (_, i) => ({ row_id: `E${i}`, employee_code: `Z${String(i).padStart(3, '0')}`, person: `p${i}`, name: `Zed ${String(i).padStart(2, '0')}`, status: 'Current' })) }
    const found = await personSearch(context({ payload: { q: 'zed' } }, many))
    expect([found.length, found[0].name, found[19].name]).toEqual([20, 'Zed 00', 'Zed 19'])
  })

  it('keeps the first twenty by code when more than twenty share a name, whatever order the rows come in', async () => {
    const codes = Array.from({ length: 25 }, (_, i) => `K${String(i + 1).padStart(3, '0')}`)
    const shuffled = [...codes.slice(12), ...codes.slice(0, 12)].reverse()
    const many = { Employee: shuffled.map(code => ({ row_id: code, employee_code: code, person: `p-${code}`, name: 'Kumar', status: 'Current' })) }
    expect((await personSearch(context({ payload: { q: 'kumar' } }, many))).map(found => found.code)).toEqual(codes.slice(0, 20))
    // A code that also matches the name text is still listed once, in its place.
    expect((await personSearch(context({ payload: { q: 'k0' } }, many))).map(found => found.code)).toEqual(codes.slice(0, 20))
  })

  it('says who a person is in who has what and who is waiting: on the staff list, left, or not on it', async () => {
    const ctx = context({ people: {
      async names(ids) { return Object.fromEntries(ids.map(id => [id, { k1: 'Kumar', k2: 'Kumar', gone: 'Kumar Old', svc: 'Report robot' }[id] ?? null])) },
      async waitingForAccess() { return [{ person: 'k2', name: 'Kumar', asked_at: '2026-11-07T08:00:00Z' }] },
    } }, { ...SAME_NAMES, 'dash.report_access': [
      { row_id: 'a1', report: 'sales', person: 'k1', updated_at: '' },
      { row_id: 'a2', report: 'sales', person: 'gone', updated_at: '' },
      { row_id: 'a3', report: 'sales', person: 'svc', updated_at: '' },
      { row_id: 'a4', report: 'sales', job: 'Team Leader', updated_at: '' },
    ] })
    const page = await accessPage(ctx)
    expect(page.rows.map(row => row.to)).toEqual([
      { kind: 'Person', name: 'Kumar', who: { code: 'E1001', jobs: ['Team Leader · Lakeside'], staff: 'current' } },
      { kind: 'Person', name: 'Kumar Old', who: { code: 'E0900', jobs: [], staff: 'left' } },
      { kind: 'Person', name: 'Report robot', who: { code: null, jobs: [], staff: 'none' } },
      { kind: 'Job', name: 'Team Leader' },
    ])
    expect(page.waiting).toEqual([{ person: 'k2', name: 'Kumar', asked_on: '2026-11-07', who: { code: 'E1002', jobs: ['Head office staff · Head office'], staff: 'current' } }])
  })
})

describe('the person lookup', () => {
  const data = {
    'dash.report_access': [
      { row_id: 'a1', report: 'sales', person: 'asha' }, { row_id: 'a2', report: 'whole', person: 'asha' },
      { row_id: 'a3', report: 'open', person: 'asha' }, { row_id: 'a4', report: 'gone', person: 'asha' },
      { row_id: 'a5', report_bundle: 'b9', person: 'asha' },
    ],
    'dash.report_bundle_member': [{ row_id: 'm1', report_bundle: 'b9', report: 'sales' }],
  }
  const lookup = (reach: { any: boolean; wholeStore: boolean }, over: Partial<AccessContext> = {}) =>
    personLookup(context({ payload: { person: 'asha' }, ...over }, data), '2026-11-07', async () => reach)

  it('says which given reports open, and why the others do not', async () => {
    const closed = async (reach: { any: boolean; wholeStore: boolean }) => (await lookup(reach)).reports.map(report => [report.key, report.closed])
    expect(await closed({ any: true, wholeStore: true })).toEqual([['open', null], ['sales', null], ['whole', null]])
    expect(await closed({ any: true, wholeStore: false })).toEqual([['open', null], ['sales', null], ['whole', 'Given, but it covers whole stores and their job reaches part of a store']])
    expect(await closed({ any: false, wholeStore: false })).toEqual([['open', null], ['sales', 'Given, but their job reaches no store'], ['whole', 'Given, but their job reaches no store']])
  })

  it('names a bundle it cannot find plainly, and a person it cannot name', async () => {
    const found = await lookup({ any: true, wholeStore: true }, { people: { async names() { return {} }, async rolesOf() { return [] } } })
    expect(found.name).toBe('This person')
    expect(found.reports.find(report => report.key === 'sales')?.because).toEqual(['Given directly', 'Given directly, through a bundle'])
  })

  it('asks for a person', async () => {
    await expect(personLookup(context({ payload: undefined }), '2026-11-07', async () => ({ any: true, wholeStore: true }))).rejects.toThrow('Choose a person')
  })
})

describe('giving, removing and bundles', () => {
  it('gives one thing to one receiver, stamping who gave it, and refuses a repeat', async () => {
    const ctx = context({ payload: { report: 'sales', person: 'asha', role: '' } })
    expect(await giveReport(ctx)).toEqual({ id: 'new' })
    expect(ctx.written).toEqual([['dash.report_access', { report: 'sales', report_bundle: null, person: 'asha', role: null, job: null, given_by_name: 'Meera' }]])
    const unnamed = context({ payload: { report: 'sales', person: 'asha' }, userName: '' })
    await giveReport(unnamed)
    expect(unnamed.written[0][1].given_by_name).toBeNull()
    await expect(giveReport(context({ payload: undefined }))).rejects.toThrow('Give exactly one report or one bundle')
    await expect(giveReport(context({ payload: { report: 'sales', person: 'asha' } }, { 'dash.report_access': [{ row_id: 'a1', access_key: 'report:sales/person:asha' }] })))
      .rejects.toThrow('That is already given')
  })

  it('removes by marking removed, and asks which row, as the page loaded it', async () => {
    const ctx = context({ payload: { id: 'a1', updated_at: 'u1' } })
    expect(await removeAccess(ctx)).toEqual({ removed: 'a1' })
    expect(await removeFromBundle(ctx)).toEqual({ removed: 'a1' })
    expect(ctx.written).toEqual([['dash.report_access', { row_id: 'a1', removed: true, updated_at: 'u1' }], ['dash.report_bundle_member', { row_id: 'a1', removed: true, updated_at: 'u1' }]])
    for (const payload of [undefined, { id: '', updated_at: 'u1' }, { id: 'a1' }, { id: 'a1', updated_at: '' }])
      await expect(removeAccess(context({ payload }))).rejects.toThrow('Choose what to remove')
    await expect(removeFromBundle(context({ payload: { id: 7 } }))).rejects.toThrow('Choose a report to take out')
  })

  it('makes a bundle by a new name, and puts a report in it once', async () => {
    const ctx = context({ payload: { name: ' Store pack ' } })
    expect(await makeBundle(ctx)).toEqual({ id: 'new' })
    await expect(makeBundle(context({ payload: undefined }))).rejects.toThrow('Name the bundle')
    await expect(makeBundle(context({ payload: { name: 'Team leader pack' } }, { 'dash.report_bundle': [{ row_id: 'b1', bundle_name: 'Team leader pack' }] })))
      .rejects.toThrow('There is already a bundle with that name')
    const adding = context({ payload: { bundle: 'b1', report: 'sales' } })
    expect(await addToBundle(adding)).toEqual({ id: 'new' })
    expect(adding.written).toEqual([['dash.report_bundle_member', { report_bundle: 'b1', report: 'sales' }]])
    await expect(addToBundle(context({ payload: undefined }))).rejects.toThrow('Choose a bundle and a report')
    await expect(addToBundle(context({ payload: { bundle: 'b1', report: 'sales' } }, { 'dash.report_bundle_member': [{ row_id: 'm1', member_key: 'b1/sales' }] })))
      .rejects.toThrow('That report is already in the bundle')
  })
})

describe('the save rules', () => {
  const reject = (message: string): never => { throw new Error(message) }
  const manager = { user: 'meera', roles: ['Report Access Manager'], isNew: true }

  it('keys a given row, clears blanks, and keys a removed one with nothing', () => {
    const row: Row = { report: 'sales', report_bundle: ' ', person: 'asha', role: '', job: null }
    validators['dash.report_access']({ ...manager, row, reject })
    expect(row).toEqual({ report: 'sales', report_bundle: null, person: 'asha', role: null, job: null, access_key: 'report:sales/person:asha' })
    const removed: Row = { report: 'sales', person: 'asha', removed: '1' }
    validators['dash.report_access']({ ...manager, row: removed, reject })
    expect(removed.access_key).toBeNull()
    expect(() => validators['dash.report_access']({ ...manager, row: { report: 'sales', person: 'asha', job: 'Team Leader' }, reject })).toThrow('Give it to exactly one person, one role or one job')
  })

  // #1217: a Team Report Manager's save is taken only as the one save Dash's action checked.
  it('takes a Team Report Manager\'s row only as the save the give or remove action checked', async () => {
    const team = { user: 'asha', roles: ['Dash Reader', 'Team Report Manager'], reject }
    const save = (over: Record<string, unknown>) => validators['dash.report_access']({ ...team, isNew: true, ...over, row: { ...(over.row as Row) } } as Parameters<typeof validators['dash.report_access']>[0])
    const refusal = 'Give and take away reports on the Report access page'
    expect(() => save({ row: { report: 'sales', person: 'ravi' } })).toThrow(refusal)
    await checkedSave({ user: 'asha', key: 'report:sales/person:ravi' }, async () => {
      expect(() => save({ row: { report: 'sales', person: 'ravi' } })).not.toThrow()
      expect(() => save({ row: { report: 'sales', person: 'meena' } })).toThrow(refusal)
      expect(() => save({ user: 'someone-else', row: { report: 'sales', person: 'ravi' } })).toThrow(refusal)
    })
    const old = { row_id: 'g1', report: 'sales', person: 'ravi', removed: 0 }
    await checkedSave({ user: 'asha', row: 'g1' }, async () => {
      expect(() => save({ isNew: false, old, row: { ...old, removed: 1 } })).not.toThrow()
      expect(() => save({ isNew: false, old, row: { ...old, person: 'meena', removed: 1 } })).toThrow(refusal)
      expect(() => save({ isNew: false, old, row: { ...old } })).toThrow(refusal)
      expect(() => save({ isNew: false, old: { ...old, row_id: 'g2' }, row: { ...old, row_id: 'g2', removed: 1 } })).toThrow(refusal)
    })
    expect(() => save({ isNew: false, old, row: { ...old, removed: 1 } })).toThrow(refusal)
  })

  it('keys a bundle member, and refuses one missing its bundle or report', () => {
    const row: Row = { report_bundle: 'b1', report: 'sales' }
    validators['dash.report_bundle_member']({ row, reject })
    expect(row.member_key).toBe('b1/sales')
    const removed: Row = { report_bundle: 'b1', report: 'sales', removed: true }
    validators['dash.report_bundle_member']({ row: removed, reject })
    expect(removed.member_key).toBeNull()
    expect(() => validators['dash.report_bundle_member']({ row: { report_bundle: 'b1' }, reject })).toThrow('A bundle member names a bundle and a report')
  })

  it('says each route the way the lookup shows it', () => {
    expect([
      becauseLine({ kind: 'role', receiver: 'Dash Reader', bundle: null }, () => ''),
      becauseLine({ kind: 'job', receiver: 'Team Leader', bundle: 'b1' }, () => 'Team leader pack'),
      accessKey({ report: 'sales', report_bundle: 'b1', person: 'asha' }),
    ]).toEqual(['Role Dash Reader', 'Job Team Leader, through Team leader pack', { problem: 'Give exactly one report or one bundle' }])
  })
})
