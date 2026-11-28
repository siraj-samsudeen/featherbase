// Who may do what to a number (server.ts): the signed-in person acts, inside their area, along the approval chain.
import { describe, expect, it } from 'vitest'
import { validators, type Context } from './server'
import { SUBS } from './madeUp'

const NAMES: Record<string, string> = { u_asha: 'Asha', u_mani: 'Mani', u_selvi: 'Selvi', u_kumar: 'Kumar', u_ravi: 'Ravi' }
const girls = SUBS.find(s => s.store === 'Lakeside' && s.section === 'Girls Bottoms')!
const base = {
  month: '2026-11', run: 'r', store: 'Lakeside', section: girls.section, scope_level: 'Subcategory', scope_name: girls.name, weeks: '',
  kind: 'Set a total', value: 100000, reason: 'why', entered_by: 'Asha', entered_by_role: 'Team Leader', entered_on: '2026-11-21',
}
function run(user: string, row: Record<string, unknown>, old?: Record<string, unknown>) {
  const ctx: Context = {
    user, roles: user === 'Administrator' ? ['System Manager'] : ['Forecasting Member'], isNew: !old, row, old,
    documents: { members: async () => Object.entries(NAMES).map(([row_id, full_name]) => ({ row_id, full_name })) },
    reject(message: string): never { throw new Error(message) },
  }
  return validators['forecasting.number'](ctx)
}
const waiting = { ...base, row_id: 'FN-1', status: 'Waiting', waiting_on: 'Mani', changed_by: 'Asha' }

describe('who is acting', () => {
  it('is the signed-in person, not the name in the request', async () => {
    await expect(run('u_asha', { ...base, entered_by: 'Kumar', entered_by_role: 'Chief Executive', status: 'Applied' })).rejects.toThrow(/signed in as Asha/)
  })
  it('lets an administrator act as a named made-up person', async () => {
    await expect(run('Administrator', { ...base, status: 'Waiting', waiting_on: 'Mani' })).resolves.toBeUndefined()
  })
  it('keeps engine figures to the system', async () => {
    await expect(run('u_asha', { ...base, entered_by_role: 'Engine', reason: '' })).rejects.toThrow(/written by the system/)
  })
})

describe('a new number', () => {
  it('waits on the person\'s own manager', async () => {
    await expect(run('u_asha', { ...base, status: 'Waiting', waiting_on: 'Mani' })).resolves.toBeUndefined()
    await expect(run('u_asha', { ...base, status: 'Waiting', waiting_on: 'Kumar' })).rejects.toThrow(/Waiting on Mani/)
  })
  it('is not Applied straight away unless it is the Chief Executive\'s', async () => {
    await expect(run('u_asha', { ...base, status: 'Applied' })).rejects.toThrow(/Reference, or Waiting/)
    await expect(run('u_kumar', { ...base, entered_by: 'Kumar', entered_by_role: 'Chief Executive', status: 'Applied' })).resolves.toBeUndefined()
  })
  it('stays inside the person\'s area', async () => {
    await expect(run('u_ravi', { ...base, entered_by: 'Ravi', status: 'Reference' })).rejects.toThrow(/outside it/)
  })
  it('needs a reason', async () => {
    await expect(run('u_asha', { ...base, reason: ' ', status: 'Reference' })).rejects.toThrow(/Say why/)
  })
})

describe('changing a number', () => {
  it('is approved only by the person it waits for', async () => {
    await expect(run('u_mani', { ...waiting, status: 'Applied', waiting_on: null, changed_by: 'Mani' }, waiting)).resolves.toBeUndefined()
    await expect(run('u_selvi', { ...waiting, status: 'Applied', waiting_on: null, changed_by: 'Selvi' }, waiting)).rejects.toThrow(/waits for Mani/)
  })
  it('is sent up only to the approver\'s own manager', async () => {
    await expect(run('u_mani', { ...waiting, waiting_on: 'Selvi', changed_by: 'Mani' }, waiting)).resolves.toBeUndefined()
    await expect(run('u_mani', { ...waiting, waiting_on: 'Kumar', changed_by: 'Mani' }, waiting)).rejects.toThrow(/up to Selvi/)
  })
  it('keeps its scope', async () => {
    const other = SUBS.find(s => s.store === 'Lakeside' && s.section === 'Girls Bottoms' && s.name !== girls.name)!
    await expect(run('u_asha', { ...waiting, scope_name: other.name }, waiting)).rejects.toThrow(/cannot change once it is entered/)
  })
  it('moves only along the chain', async () => {
    const applied = { ...waiting, status: 'Applied', waiting_on: null }
    await expect(run('u_asha', { ...applied, status: 'Waiting', changed_by: 'Asha' }, applied)).rejects.toThrow(/cannot go from Applied to Waiting/)
  })
  it('is withdrawn only by the person who entered it', async () => {
    await expect(run('u_asha', { ...waiting, status: 'Withdrawn', changed_by: 'Asha' }, waiting)).resolves.toBeUndefined()
    await expect(run('u_mani', { ...waiting, status: 'Withdrawn', changed_by: 'Mani' }, waiting)).rejects.toThrow(/Only the person who entered/)
  })
})

// A loaded Run: people and lines come from forecasting.reach and forecasting.run_line (made-up rows here).
describe('a loaded Run', () => {
  const REACH = [
    { full_name: 'Tara', role: 'Team Leader', place: 'North · Kids', reports_to: 'Omar', places_json: JSON.stringify([{ store: 'North', codes: ['C1', 'C2'] }]) },
    { full_name: 'Omar', role: 'Department Manager', place: 'North', reports_to: 'Lena', places_json: JSON.stringify([{ store: 'North', codes: ['C1', 'C2', 'C3'] }]) },
    { full_name: 'Lena', role: 'Chief Executive', place: 'Head Office', reports_to: '', places_json: '[]' },
  ]
  const LINES = [
    { store: 'North', code: 'C1', subcategory: 'Kids Jean', category: 'Kids Bottom' },
    { store: 'North', code: 'C2', subcategory: 'Kids Short', category: 'Kids Bottom' },
    { store: 'North', code: 'C3', subcategory: 'Kids Shirt', category: 'Kids Top' },
  ]
  const IDS: Record<string, string> = { u_tara: 'Tara', u_omar: 'Omar', u_lena: 'Lena' }
  const list = async (table: string, args: { filters?: [string, string, unknown][] }) => {
    const rows: Record<string, unknown>[] = table === 'forecasting.reach' ? REACH : table === 'forecasting.run_line' ? LINES : []
    return rows.filter(r => (args.filters ?? []).every(([c, , v]) => r[c] === v))
  }
  function call(table: 'forecasting.number' | 'forecasting.explanation', user: string, row: Record<string, unknown>) {
    const ctx: Context = { user, roles: ['Forecasting Member'], isNew: true, row,
      documents: { members: async () => Object.entries(IDS).map(([row_id, full_name]) => ({ row_id, full_name })), list },
      reject(message: string): never { throw new Error(message) } }
    return validators[table](ctx)
  }
  const number = { month: '2026-12', run: 'r', store: 'North', scope_level: 'Subcategory', scope_name: 'Kids Jean', weeks: '', kind: 'Change by a percent', value: 1, percent: 5,
    reason: 'why', entered_by: 'Tara', entered_by_role: 'Team Leader', entered_on: '2026-11-26', status: 'Waiting', waiting_on: 'Omar', changed_by: 'Tara' }
  it('reaches a line through the person\'s places, and waits on the manager named in reports_to', async () => {
    await expect(call('forecasting.number', 'u_tara', number)).resolves.toBeUndefined()
    await expect(call('forecasting.number', 'u_tara', { ...number, waiting_on: 'Lena' })).rejects.toThrow(/Waiting on Omar/)
  })
  it('refuses a line, or a category, the person does not cover', async () => {
    await expect(call('forecasting.number', 'u_tara', { ...number, scope_name: 'Kids Shirt' })).rejects.toThrow(/outside it/)
    await expect(call('forecasting.number', 'u_omar', { ...number, scope_level: 'Category', scope_name: 'Kids Top', entered_by: 'Omar', entered_by_role: 'Department Manager', waiting_on: 'Lena' })).resolves.toBeUndefined()
  })
  it('lets everyone-store people reach every store, and keeps an explanation to its author\'s area', async () => {
    const why = { month: '2026-12', store: 'All', scope_level: 'Category', scope_name: 'Kids Top', day: 3, causes: 'Stock not available', explained_by: 'Lena', explained_by_role: 'Chief Executive' }
    await expect(call('forecasting.explanation', 'u_lena', why)).resolves.toBeUndefined()
    await expect(call('forecasting.explanation', 'u_tara', { ...why, explained_by: 'Tara', explained_by_role: 'Team Leader' })).rejects.toThrow(/outside it/)
    await expect(call('forecasting.explanation', 'u_lena', { ...why, causes: '' })).rejects.toThrow(/at least one cause/)
  })
})

describe('a day explanation (#1425)', () => {
  const REACH = [
    { full_name: 'Tara', role: 'Team Leader', place: 'North · Kids', reports_to: 'Omar', places_json: JSON.stringify([{ store: 'North', codes: ['C1', 'C2'] }]) },
    { full_name: 'Omar', role: 'Department Manager', place: 'North', reports_to: '', places_json: JSON.stringify([{ store: 'North', codes: ['C1', 'C2', 'C3'] }]) },
  ]
  const LINES = [
    // the Run's lines, as the read-only copy holds them: no section (that comes live from the org chart)
    { run_id: 'r', store_code: '9001', store_short_code: 'North', subcategory_code: 'C1', subcategory_name: 'Kids Jean' },
    { run_id: 'r', store_code: '9001', store_short_code: 'North', subcategory_code: 'C3', subcategory_name: 'Kids Shirt' },
    // a line the Run merged from several codes: it has none
    { run_id: 'r', store_code: '9001', store_short_code: 'North', subcategory_code: null, subcategory_name: 'Kids Mixed' },
  ]
  const IDS: Record<string, string> = { u_tara: 'Tara', u_omar: 'Omar' }
  // the live org chart (#1428): Kids Jean (C1) sits in Kids, whose Team Leader is Tara; Kids Shirt (C3) in Tops
  const ORG: Record<string, Record<string, unknown>[]> = {
    Site: [{ row_id: 'North', name: 'North', operating_region: 'R' }],
    Section: [{ row_id: 'N-Kids', name: 'Kids', site: 'North', floor: 'N-1F', status: 'Active' }, { row_id: 'N-Tops', name: 'Tops', site: 'North', floor: 'N-1F', status: 'Active' }],
    'Store Floor': [{ row_id: 'N-1F', name: 'First Floor', site: 'North', floor_order: 1 }],
    'Section Subcategory': [{ store: 'North', subcategory: 'C1', section: 'N-Kids', starts_on: '2026-01-01', ends_on: null }, { store: 'North', subcategory: 'C3', section: 'N-Tops', starts_on: '2026-01-01', ends_on: null }],
    'Job Assignment': [{ employee: 'E1', job: 'Team Leader', site: 'North', section: 'N-Kids', starts_on: '2026-01-01', ends_on: null }],
    Employee: [{ row_id: 'E1', name: 'Tara' }],
  }
  const baseTables = { list: async (table: string, args: { filters?: [string, string, unknown][] }) =>
    (ORG[table] ?? []).filter(r => (args.filters ?? []).every(([c, op, v]) => (op === 'in' ? (v as unknown[]).includes(r[c]) : r[c] === v))) }
  const list = async (table: string, args: { filters?: [string, string, unknown][] }) => {
    const rows: Record<string, unknown>[] = table === 'forecasting.reach' ? REACH : table === 'forecasting.run_line' ? [{ row_id: 'x' }] : table === 'forecasting.forecast_line_month' ? LINES : []
    return rows.filter(r => (args.filters ?? []).every(([c, , v]) => r[c] === v))
  }
  function call(user: string, row: Record<string, unknown>, old?: Record<string, unknown>, base: Context['baseTables'] | null = baseTables) {
    const ctx: Context = { user, roles: user === 'Administrator' ? ['System Manager'] : ['Forecasting Member'], isNew: !old, row, old,
      documents: { members: async () => Object.entries(IDS).map(([row_id, full_name]) => ({ row_id, full_name })), list }, baseTables: base ?? undefined,
      reject(message: string): never { throw new Error(message) } }
    return validators['forecasting.day_explanation'](ctx).then(() => row)
  }
  const day = { run_id: 'r', store_code: '9001', section_name: 'Kids', subcategory_name: null, explained_date: '2026-11-03', direction: 'below',
    causes: 'Weak store execution', tags: 'Weak store execution › Low footfall', note: 'Rain all evening', explained_by: 'Tara' }

  it("is a Team Leader's of that store, for a section's day or one of its subcategories' days, the store taken from the Run", async () => {
    await expect(call('u_tara', day)).resolves.toMatchObject({ store_name: 'North', section_name: 'Kids', explained_by_role: 'Team Leader' })
    await expect(call('u_tara', { ...day, subcategory_name: 'Kids Jean' })).resolves.toMatchObject({ store_name: 'North' })
  })
  it("refuses another person's name, a subcategory not in the Run, and a day with no section", async () => {
    await expect(call('u_tara', { ...day, explained_by: 'Omar' })).rejects.toThrow(/cannot act as Omar/)
    await expect(call('u_tara', { ...day, subcategory_name: 'Kids Sock' })).rejects.toThrow(/not in Run r/)
    await expect(call('u_tara', { ...day, section_name: '' })).rejects.toThrow(/which section/)
  })
  it("refuses another section's day, or a subcategory of another section, in the same store: the live org chart (#1428)", async () => {
    await expect(call('u_tara', { ...day, section_name: 'Tops' })).rejects.toThrow(/outside it/)
    await expect(call('u_tara', { ...day, subcategory_name: 'Kids Shirt' })).rejects.toThrow(/outside it/)
  })
  it("files a subcategory's day under its section today, whatever the page sent; refuses a merged line, and refuses without the org chart on a real instance", async () => {
    await expect(call('u_tara', { ...day, subcategory_name: 'Kids Jean', section_name: 'Tops' })).resolves.toMatchObject({ section_name: 'Kids' })
    await expect(call('u_tara', { ...day, subcategory_name: 'Kids Mixed' })).rejects.toThrow(/outside it/)
    await expect(call('u_tara', day, undefined, null)).rejects.toThrow(/outside it/)
  })
  it('lets an administrator explain as the Team Leader, and keeps an edit to its writer', async () => {
    await expect(call('Administrator', { ...day, explained_by: 'Anisha' })).resolves.toMatchObject({ explained_by_role: 'Team Leader' })
    await expect(call('u_omar', { ...day, explained_by: 'Omar' }, { ...day, row_id: 'DE-1' })).rejects.toThrow(/writer's own/)
  })
  it('takes causes and tags only from the agreed set for the day\'s direction', async () => {
    await expect(call('u_tara', { ...day, causes: '', tags: '' })).rejects.toThrow(/at least one cause/)
    await expect(call('u_tara', { ...day, causes: 'Weak store execution\nStock not available', tags: 'Weak store execution › Low footfall\nStock not available › Inaccurate stock' })).resolves.toBeTruthy()
    await expect(call('u_tara', { ...day, direction: 'above', causes: 'Festival or event', tags: 'Festival or event › Salary day' })).resolves.toMatchObject({ direction: 'above' })
    await expect(call('u_tara', { ...day, direction: 'above' })).rejects.toThrow(/not one of the causes for a day above/)
    await expect(call('u_tara', { ...day, direction: '' })).rejects.toThrow(/below or above/)
  })
})

// #1442: who moves a forecast_change's status. Made-up people and lines: Tara leads Kids at North; Omar is North's
// Store Manager, Sam another store's; Priya is the category head of Kids Jean (C1) only; Lena the Chief Executive.
describe('a change on the managers\' pages (#1442)', () => {
  const REACH = [
    { full_name: 'Tara', role: 'Team Leader', place: 'North · Kids', reports_to: 'Omar', places_json: JSON.stringify([{ store: 'North', codes: ['C1'] }]) },
    { full_name: 'Omar', role: 'Store Manager', place: 'North', reports_to: 'Lena', places_json: JSON.stringify([{ store: 'North', codes: null }]) },
    { full_name: 'Sam', role: 'Store Manager', place: 'South', reports_to: 'Lena', places_json: JSON.stringify([{ store: 'South', codes: null }]) },
    { full_name: 'Priya', role: 'Category Head', place: 'R', reports_to: 'Lena', places_json: '[]' },
    { full_name: 'Lena', role: 'Chief Executive', place: 'Head Office', reports_to: '', places_json: '[]' },
  ]
  const LINES = [
    { row_id: 'L1', run_id: 'r', store_code: '9001', store_short_code: 'North', subcategory_code: 'C1', division_name: 'D', subdivision_name: 'S', category_name: 'Kids Bottom',
      subcategory_name: 'Kids Jean', forecast_month: '2026-12-01', forecast_value_before_tax: 100000, forecast_qty: 100 },
    { row_id: 'L3', run_id: 'r', store_code: '9001', store_short_code: 'North', subcategory_code: 'C3', division_name: 'D', subdivision_name: 'S', category_name: 'Kids Top',
      subcategory_name: 'Kids Shirt', forecast_month: '2026-12-01', forecast_value_before_tax: 50000, forecast_qty: 40 },
  ]
  const IDS: Record<string, string> = { u_tara: 'Tara', u_omar: 'Omar', u_sam: 'Sam', u_priya: 'Priya', u_lena: 'Lena' }
  const ORG: Record<string, Record<string, unknown>[]> = {
    Site: [{ row_id: 'North', name: 'North', operating_region: 'R' }],
    Section: [{ row_id: 'N-Kids', name: 'Kids', site: 'North', floor: null, status: 'Active' }],
    'Store Floor': [],
    'Section Subcategory': [{ store: 'North', subcategory: 'C1', section: 'N-Kids', starts_on: '2026-01-01', ends_on: null }],
    'Job Assignment': [{ employee: 'E1', job: 'Team Leader', site: 'North', section: 'N-Kids', starts_on: '2026-01-01', ends_on: null },
      { employee: 'E2', job: 'Store Manager', site: 'North', section: null, starts_on: '2026-01-01', ends_on: null }],
    'Merchandise Assignment': [{ employee: 'E3', responsibility: 'Category head', operating_region: 'R', category: null, subcategory: 'C1', starts_on: '2026-01-01', ends_on: null }],
    Subcategory: [{ row_id: 'C1', category: 'K' }, { row_id: 'C3', category: 'K2' }],
    Employee: [{ row_id: 'E1', name: 'Tara' }, { row_id: 'E2', name: 'Omar' }, { row_id: 'E3', name: 'Priya' }],
  }
  const match = (r: Record<string, unknown>, filters: [string, string, unknown][] = []) =>
    filters.every(([c, op, v]) => (op === 'in' ? (v as unknown[]).includes(r[c]) : r[c] === v))
  const baseTables = { list: async (table: string, args: { filters?: [string, string, unknown][] }) => (ORG[table] ?? []).filter(r => match(r, args.filters)) }
  const list = async (table: string, args: { filters?: [string, string, unknown][] }) => {
    const rows: Record<string, unknown>[] = table === 'forecasting.reach' ? REACH : table === 'forecasting.run_line' ? [{ row_id: 'x' }] : table === 'forecasting.forecast_line_month' ? LINES : []
    return rows.filter(r => match(r, args.filters))
  }
  function call(table: 'forecasting.forecast_change' | 'forecasting.forecast_question', user: string, row: Record<string, unknown>, old?: Record<string, unknown>) {
    const ctx: Context = { user, roles: user === 'Administrator' ? ['System Manager'] : ['Forecasting Member'], isNew: !old, row: { ...old, ...row }, old,
      documents: { members: async () => Object.entries(IDS).map(([row_id, full_name]) => ({ row_id, full_name })), list }, baseTables,
      reject(message: string): never { throw new Error(message) } }
    return validators[table](ctx).then(() => ctx.row)
  }
  const ask = { run_id: 'r', store_code: '9001', category_name: 'Kids Bottom', subcategory_name: 'Kids Jean', change_scope: 'month', change_method: 'set_value',
    set_value_before_tax: 80000, explanation: 'Stock arriving late', proposed_by: 'Tara', change_status: 'sent' }
  const sent = { ...ask, row_id: 'CH-1', division_name: 'D', subdivision_name: 'S', proposed_by_role: 'Team Leader', engine_value_before_tax: 100000, changed_value_before_tax: 80000,
    decided_by: null, decided_at: null, decision_note: null }

  describe('a new change', () => {
    it("is sent by a Team Leader, and final when a manager makes it", async () => {
      await expect(call('forecasting.forecast_change', 'u_tara', ask)).resolves.toMatchObject({ change_status: 'sent', proposed_by_role: 'Team Leader' })
      await expect(call('forecasting.forecast_change', 'u_omar', { ...ask, proposed_by: 'Omar' })).resolves.toMatchObject({ change_status: 'approved', proposed_by_role: 'Store Manager' })
      await expect(call('forecasting.forecast_change', 'u_priya', { ...ask, proposed_by: 'Priya' })).resolves.toMatchObject({ change_status: 'approved', proposed_by_role: 'Category Head' })
      await expect(call('forecasting.forecast_change', 'u_lena', { ...ask, proposed_by: 'Lena', subcategory_name: 'Kids Shirt' })).resolves.toMatchObject({ change_status: 'approved', proposed_by_role: 'Chief Executive' })
    })
    it("keeps a category head to their merchandise and a Store Manager to their store", async () => {
      await expect(call('forecasting.forecast_change', 'u_priya', { ...ask, proposed_by: 'Priya', subcategory_name: 'Kids Shirt' })).rejects.toThrow(/outside it/)
      await expect(call('forecasting.forecast_change', 'u_sam', { ...ask, proposed_by: 'Sam' })).rejects.toThrow(/outside it/)
    })
    it("lets an administrator viewing a manager's page make that manager's final change", async () => {
      await expect(call('forecasting.forecast_change', 'Administrator', { ...ask, proposed_by: 'Omar', proposed_by_role: 'Store Manager' })).resolves.toMatchObject({ change_status: 'approved', proposed_by_role: 'Store Manager' })
    })
    it('lets a category head and the Chief Executive ask a question on a line they review', async () => {
      const q = { run_id: 'r', store_code: '9001', category_name: 'Kids Bottom', subcategory_name: 'Kids Jean', question_text: 'Why so high?' }
      await expect(call('forecasting.forecast_question', 'u_priya', { ...q, asked_by: 'Priya' })).resolves.toMatchObject({ question_status: 'open' })
      await expect(call('forecasting.forecast_question', 'u_lena', { ...q, asked_by: 'Lena' })).resolves.toMatchObject({ question_status: 'open' })
      await expect(call('forecasting.forecast_question', 'u_priya', { ...q, subcategory_name: 'Kids Shirt', asked_by: 'Priya' })).rejects.toThrow(/outside it/)
    })
  })

  describe("a sent change's status", () => {
    it("is approved or rejected by the store's Store Manager, who is stamped as deciding", async () => {
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'approved', decided_by: 'Omar' }, sent)).resolves.toMatchObject({ change_status: 'approved', decided_by: 'Omar', decided_at: expect.any(String) })
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'rejected', decided_by: 'Omar', decision_note: 'Stock is here' }, sent)).resolves.toMatchObject({ change_status: 'rejected' })
    })
    it('is not decided by a Team Leader, another store\'s manager, a category head or the Chief Executive', async () => {
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'approved', decided_by: 'Tara' }, sent)).rejects.toThrow(/Store Manager decides/)
      await expect(call('forecasting.forecast_change', 'u_sam', { change_status: 'approved', decided_by: 'Sam' }, sent)).rejects.toThrow(/outside it/)
      await expect(call('forecasting.forecast_change', 'u_priya', { change_status: 'approved', decided_by: 'Priya' }, sent)).rejects.toThrow(/Store Manager decides/)
      await expect(call('forecasting.forecast_change', 'u_lena', { change_status: 'rejected', decided_by: 'Lena', decision_note: 'no' }, sent)).rejects.toThrow(/Store Manager decides/)
    })
    it('is decided by the signed-in person only, never a name in the request', async () => {
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'approved', decided_by: 'Omar' }, sent)).rejects.toThrow(/cannot act as Omar/)
    })
    it('is sent back only with a reason', async () => {
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'rejected', decided_by: 'Omar', decision_note: ' ' }, sent)).rejects.toThrow(/Say why/)
    })
    it("is replaced by the Store Manager's own number, or by the Team Leader's next one", async () => {
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'replaced', decided_by: 'Omar' }, sent)).resolves.toMatchObject({ change_status: 'replaced', decided_by: 'Omar' })
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'replaced' }, sent)).resolves.toMatchObject({ change_status: 'replaced', decided_by: null })
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'withdrawn' }, sent)).resolves.toMatchObject({ change_status: 'withdrawn' })
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'withdrawn' }, sent)).rejects.toThrow(/cannot act as Tara/)
    })
    it('keeps its numbers: a change is never edited once sent', async () => {
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'approved', decided_by: 'Omar', changed_value_before_tax: 1 }, sent)).rejects.toThrow(/cannot change once it is sent/)
      await expect(call('forecasting.forecast_change', 'u_tara', { set_value_before_tax: 1 }, sent)).rejects.toThrow(/not edited/)
    })
  })

  describe('a decision taken back (Undo)', () => {
    const approved = { ...sent, change_status: 'approved', decided_by: 'Omar', decided_at: '2026-12-02T10:00:00Z' }
    it('is taken back to sent only by the person who decided it', async () => {
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'sent' }, approved)).resolves.toMatchObject({ change_status: 'sent', decided_by: null, decided_at: null })
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'sent' }, approved)).rejects.toThrow(/cannot act as Omar/)
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'sent' }, { ...approved, change_status: 'replaced' })).resolves.toMatchObject({ change_status: 'sent' })
    })
    it("lets a manager withdraw their own final change, but not a Team Leader's approved one", async () => {
      const own = { ...sent, row_id: 'CH-2', proposed_by: 'Omar', proposed_by_role: 'Store Manager', change_status: 'approved' }
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'withdrawn' }, own)).resolves.toMatchObject({ change_status: 'withdrawn' })
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'withdrawn' }, approved)).rejects.toThrow(/taken back by the person who approved it/)
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'sent' }, own)).rejects.toThrow(/never decided/)
    })
    it('never moves a withdrawn change', async () => {
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'sent' }, { ...sent, change_status: 'withdrawn' })).rejects.toThrow(/cannot go from withdrawn to sent/)
    })
  })
})
