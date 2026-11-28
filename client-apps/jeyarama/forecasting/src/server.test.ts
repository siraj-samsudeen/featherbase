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
  ]
  const IDS: Record<string, string> = { u_tara: 'Tara', u_omar: 'Omar' }
  const list = async (table: string, args: { filters?: [string, string, unknown][] }) => {
    const rows: Record<string, unknown>[] = table === 'forecasting.reach' ? REACH : table === 'forecasting.run_line' ? [{ row_id: 'x' }] : table === 'forecasting.forecast_line_month' ? LINES : []
    return rows.filter(r => (args.filters ?? []).every(([c, , v]) => r[c] === v))
  }
  function call(user: string, row: Record<string, unknown>, old?: Record<string, unknown>) {
    const ctx: Context = { user, roles: user === 'Administrator' ? ['System Manager'] : ['Forecasting Member'], isNew: !old, row, old,
      documents: { members: async () => Object.entries(IDS).map(([row_id, full_name]) => ({ row_id, full_name })), list },
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
  // Known gap (#1428): a validator cannot read the live org chart, so a Team Leader is held to their store, not their
  // section. This pins the check we want: Tara (Kids) is refused Tops' day.
  it.fails("refuses another section's day in the same store (#1428)", async () => {
    await expect(call('u_tara', { ...day, section_name: 'Tops' })).rejects.toThrow(/outside it/)
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
