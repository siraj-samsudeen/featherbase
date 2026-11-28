// Who may do what on a line of the Run (server.ts): the signed-in person acts as their Person on the live org chart.
import { describe, expect, it } from 'vitest'
import { reads, validators, type Context } from './server'

describe('a day explanation (#1425)', () => {
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
    // a second Tara (E6, Person u_tara2) leads Tops: she shares the first Tara's name, not her section (#1430)
    'Job Assignment': [{ employee: 'E1', job: 'Team Leader', site: 'North', section: 'N-Kids', starts_on: '2026-01-01', ends_on: null },
      { employee: 'E6', job: 'Team Leader', site: 'North', section: 'N-Tops', starts_on: '2026-01-01', ends_on: null }],
    // each employee signs in as their Person (#1430)
    Employee: [{ row_id: 'E1', name: 'Tara', person: 'u_tara', status: 'Current' }, { row_id: 'E2', name: 'Omar', person: 'u_omar', status: 'Current' },
      { row_id: 'E6', name: 'Tara', person: 'u_tara2', status: 'Current' }],
  }
  const baseTables = { list: async (table: string, args: { filters?: [string, string, unknown][] }) =>
    (ORG[table] ?? []).filter(r => (args.filters ?? []).every(([c, op, v]) => (op === 'in' ? (v as unknown[]).includes(r[c]) : r[c] === v))) }
  const list = async (table: string, args: { filters?: [string, string, unknown][] }) => {
    const rows: Record<string, unknown>[] = table === 'forecasting.forecast_line_month' ? LINES : []
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

  it('knows the signed-in person by their Person, not their name: two Team Leaders named Tara each keep to their own section (#1430)', async () => {
    await expect(call('u_tara2', day)).rejects.toThrow(/outside it/)
    await expect(call('u_tara2', { ...day, section_name: 'Tops' })).resolves.toMatchObject({ section_name: 'Tops' })
    await expect(call('u_tara', { ...day, section_name: 'Tops' })).rejects.toThrow(/outside it/)
  })
  it('refuses a sign-in that is not linked to an employee (#1430)', async () => {
    await expect(call('u_nobody', day)).rejects.toThrow(/not linked to an employee/)
  })

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
    await expect(call('u_tara', day, undefined, null)).rejects.toThrow(/org chart cannot be read/)
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
  const LINES = [
    { row_id: 'L1', run_id: 'r', store_code: '9001', store_short_code: 'North', subcategory_code: 'C1', division_name: 'D', subdivision_name: 'S', category_name: 'Kids Bottom',
      subcategory_name: 'Kids Jean', forecast_month: '2026-12-01', forecast_value_before_tax: 100000, forecast_qty: 100 },
    { row_id: 'L3', run_id: 'r', store_code: '9001', store_short_code: 'North', subcategory_code: 'C3', division_name: 'D', subdivision_name: 'S', category_name: 'Kids Top',
      subcategory_name: 'Kids Shirt', forecast_month: '2026-12-01', forecast_value_before_tax: 50000, forecast_qty: 40 },
  ]
  const IDS: Record<string, string> = { u_tara: 'Tara', u_omar: 'Omar', u_sam: 'Sam', u_priya: 'Priya', u_lena: 'Lena' }
  const ORG: Record<string, Record<string, unknown>[]> = {
    Site: [{ row_id: 'North', name: 'North', operating_region: 'R' }],
    Section: [{ row_id: 'N-Kids', name: 'Kids', site: 'North', floor: null, status: 'Active' }, { row_id: 'S-Kids', name: 'Kids', site: 'South', floor: null, status: 'Active' }],
    'Store Floor': [],
    'Section Subcategory': [{ store: 'North', subcategory: 'C1', section: 'N-Kids', starts_on: '2026-01-01', ends_on: null }],
    'Job Assignment': [{ employee: 'E1', job: 'Team Leader', site: 'North', section: 'N-Kids', starts_on: '2026-01-01', ends_on: null },
      { employee: 'E2', job: 'Store Manager', site: 'North', section: null, starts_on: '2026-01-01', ends_on: null },
      { employee: 'E4', job: 'Store Manager', site: 'South', section: null, starts_on: '2026-01-01', ends_on: null },
      // the Chief Executive is a Director on the org chart (#1438)
      { employee: 'E5', job: 'Director', site: 'HO', section: null, starts_on: '2026-01-01', ends_on: null },
      // #1430: another Tara (E8) leads Kids at South; Ravi (E9) leads Kids at South and also manages North
      { employee: 'E8', job: 'Team Leader', site: 'South', section: 'S-Kids', starts_on: '2026-01-01', ends_on: null },
      { employee: 'E9', job: 'Team Leader', site: 'South', section: 'S-Kids', starts_on: '2026-01-01', ends_on: null },
      { employee: 'E9', job: 'Store Manager', site: 'North', section: null, starts_on: '2026-01-01', ends_on: null }],
    'Merchandise Assignment': [{ employee: 'E3', responsibility: 'Category head', operating_region: 'R', category: null, subcategory: 'C1', starts_on: '2026-01-01', ends_on: null }],
    Subcategory: [{ row_id: 'C1', category: 'K' }, { row_id: 'C3', category: 'K2' }],
    Employee: [{ row_id: 'E1', name: 'Tara', person: 'u_tara', status: 'Current' }, { row_id: 'E2', name: 'Omar', person: 'u_omar', status: 'Current' },
      { row_id: 'E3', name: 'Priya', person: 'u_priya', status: 'Current' }, { row_id: 'E4', name: 'Sam', person: 'u_sam', status: 'Current' },
      { row_id: 'E5', name: 'Lena', person: 'u_lena', status: 'Current' }, { row_id: 'E7', name: 'Priya', person: 'u_priya2', status: 'Current' },
      { row_id: 'E8', name: 'Tara', person: 'u_tara_south', status: 'Current' }, { row_id: 'E9', name: 'Ravi', person: 'u_ravi', status: 'Current' }],
  }
  const match = (r: Record<string, unknown>, filters: [string, string, unknown][] = []) =>
    filters.every(([c, op, v]) => (op === 'in' ? (v as unknown[]).includes(r[c]) : r[c] === v))
  const baseTables = { list: async (table: string, args: { filters?: [string, string, unknown][] }) => (ORG[table] ?? []).filter(r => match(r, args.filters)) }
  const list = async (table: string, args: { filters?: [string, string, unknown][] }) => {
    const rows: Record<string, unknown>[] = table === 'forecasting.forecast_line_month' ? LINES : []
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
    it("does not let someone who only shares a category head's name act as her (#1430)", async () => {
      await expect(call('forecasting.forecast_change', 'u_priya2', { ...ask, proposed_by: 'Priya' })).rejects.toThrow(/no forecasting job/)
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
    it("is not taken back by someone who only shares the proposer's name, at another store (#1430)", async () => {
      await expect(call('forecasting.forecast_change', 'u_tara_south', { change_status: 'withdrawn' }, sent)).rejects.toThrow(/outside it/)
      await expect(call('forecasting.forecast_change', 'u_tara_south', { change_status: 'replaced' }, sent)).rejects.toThrow(/outside it/)
    })
    it('is decided by someone holding several jobs, in the one that holds the line (#1430)', async () => {
      await expect(call('forecasting.forecast_change', 'u_ravi', { change_status: 'approved', decided_by: 'Ravi' }, sent)).resolves.toMatchObject({ decided_by: 'Ravi' })
    })
    it('keeps its numbers: a change is never edited once sent', async () => {
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'approved', decided_by: 'Omar', changed_value_before_tax: 1 }, sent)).rejects.toThrow(/cannot change once it is sent/)
      await expect(call('forecasting.forecast_change', 'u_tara', { set_value_before_tax: 1 }, sent)).rejects.toThrow(/not edited/)
    })
  })

  describe('who decides, and who only reviews', () => {
    it('is the Store Manager only: a Department Manager of the store does not decide', async () => {
      // Dev is North's Department Manager on the live org chart (#1430)
      ORG.Employee.push({ row_id: 'E10', name: 'Dev', person: 'u_dev', status: 'Current' })
      ORG['Job Assignment'].push({ employee: 'E10', job: 'Department Manager', site: 'North', section: null, starts_on: '2026-01-01', ends_on: null })
      try { await expect(call('forecasting.forecast_change', 'u_dev', { change_status: 'approved', decided_by: 'Dev' }, sent)).rejects.toThrow(/Store Manager decides/) }
      finally { ORG.Employee.pop(); ORG['Job Assignment'].pop() }
    })
    it("keeps line answers and day explanations to Team Leaders and Store Managers: a category head or the Chief Executive changes and asks, nothing more", async () => {
      const review = { run_id: 'r', store_code: '9001', category_name: 'Kids Bottom', subcategory_name: 'Kids Jean', answer: 'accepted' }
      const ctxOf = (user: string, table: 'forecasting.forecast_line_review' | 'forecasting.day_explanation', row: Record<string, unknown>) => validators[table]({ user, roles: ['Forecasting Member'], isNew: true, row,
        documents: { members: async () => Object.entries(IDS).map(([row_id, full_name]) => ({ row_id, full_name })), list }, baseTables, reject(message: string): never { throw new Error(message) } })
      await expect(ctxOf('u_lena', 'forecasting.forecast_line_review', { ...review, reviewer: 'Lena' })).rejects.toThrow(/does not do this/)
      await expect(ctxOf('u_priya', 'forecasting.forecast_line_review', { ...review, reviewer: 'Priya' })).rejects.toThrow(/does not do this/)
      await expect(ctxOf('u_omar', 'forecasting.forecast_line_review', { ...review, reviewer: 'Omar' })).resolves.toBeUndefined()
      const day = { run_id: 'r', store_code: '9001', section_name: 'Kids', subcategory_name: null, explained_date: '2026-12-03', direction: 'below',
        causes: 'Weak store execution', tags: 'Weak store execution › Low footfall', explained_by: 'Lena' }
      await expect(ctxOf('u_lena', 'forecasting.day_explanation', day)).rejects.toThrow(/does not do this/)
    })
  })

  describe('an administrator viewing a manager\'s page', () => {
    it('decides and takes back as the person named, stamped; never edits the numbers, and names who decides', async () => {
      await expect(call('forecasting.forecast_change', 'Administrator', { change_status: 'approved', decided_by: 'Omar' }, sent)).resolves.toMatchObject({ decided_by: 'Omar', decided_at: expect.any(String) })
      await expect(call('forecasting.forecast_change', 'Administrator', { change_status: 'approved' }, sent)).rejects.toThrow(/Say who decides/)
      await expect(call('forecasting.forecast_change', 'Administrator', { change_status: 'approved', decided_by: 'Omar', changed_value_before_tax: 1 }, sent)).rejects.toThrow(/cannot change once it is sent/)
      const approved = { ...sent, change_status: 'approved', decided_by: 'Omar', decided_at: '2026-12-02T10:00:00Z' }
      await expect(call('forecasting.forecast_change', 'Administrator', { change_status: 'sent' }, approved)).resolves.toMatchObject({ change_status: 'sent', decided_by: null })
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
    it('refuses a proposer taking back their own replaced change, and moves the chain does not list', async () => {
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'sent' }, { ...sent, change_status: 'replaced' })).rejects.toThrow(/never decided/)
      const rejected = { ...sent, change_status: 'rejected', decided_by: 'Omar', decision_note: 'no' }
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'withdrawn' }, rejected)).rejects.toThrow(/cannot go from rejected to withdrawn/)
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'approved', decided_by: 'Omar' }, rejected)).rejects.toThrow(/cannot go from rejected to approved/)
    })
    it("keeps who proposed it, in what role, and what it replaces; a decision never sends the proposer's reasons", async () => {
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'approved', decided_by: 'Omar', proposed_by_role: 'Store Manager' }, sent)).rejects.toThrow(/proposed_by_role cannot change/)
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'withdrawn', replaces_change: 'CH-9' }, sent)).rejects.toThrow(/replaces_change cannot change/)
      await expect(call('forecasting.forecast_change', 'u_omar', { change_status: 'approved', decided_by: 'Omar', reasons: [] }, sent)).rejects.toThrow(/reasons are its proposer's/)
    })
    it('never moves a withdrawn change', async () => {
      await expect(call('forecasting.forecast_change', 'u_tara', { change_status: 'sent' }, { ...sent, change_status: 'withdrawn' })).rejects.toThrow(/cannot go from withdrawn to sent/)
    })
  })
})

// #1461: org_chart answers a store's sections, Team Leaders and people only to someone whose places include it. Made-up
// stores: North (plant 9001) and East (plant 9002) in one region, South (plant 9003) in another.
describe('the org_chart read (#1461)', () => {
  const ORG: Record<string, Record<string, unknown>[]> = {
    Site: [{ row_id: 'NTH', name: 'North', operating_region: 'R1' }, { row_id: 'EST', name: 'East', operating_region: 'R1' }, { row_id: 'STH', name: 'South', operating_region: 'R2' }],
    Section: [{ row_id: 'NTH-Kids', name: 'Kids', site: 'NTH', floor: null, status: 'Active' }, { row_id: 'EST-Kids', name: 'Kids', site: 'EST', floor: null, status: 'Active' }],
    'Store Floor': [], Subcategory: [], 'Merchandise Assignment': [],
    'Section Subcategory': [{ store: 'NTH', subcategory: 'C1', section: 'NTH-Kids', starts_on: '2026-01-01', ends_on: null }],
    'Job Assignment': [{ employee: 'E1', job: 'Team Leader', site: 'NTH', section: 'NTH-Kids', starts_on: '2026-01-01', ends_on: null }],
    Employee: [{ row_id: 'E1', name: 'Tara' }],
  }
  const match = (r: Record<string, unknown>, filters: [string, string, unknown][] = []) =>
    filters.every(([c, op, v]) => (op === 'in' ? (v as unknown[]).includes(r[c]) : r[c] === v))
  const baseTables = { list: async (table: string, args: { filters?: [string, string, unknown][] }) => (ORG[table] ?? []).filter(r => match(r, args.filters)) }
  // the Run's lines, one per store, with both codes
  const LINES = [{ store_short_code: 'NTH', store_code: '9001' }, { store_short_code: 'EST', store_code: '9002' }, { store_short_code: 'STH', store_code: '9003' }]
  const documents = { list: async (_t: string, args: { filters?: [string, string, unknown][] }) => LINES.filter(r => match(r, args.filters)) }
  const place = (plants: string[], subcategory?: string[]) => ({ label: plants.join(','), filters: { store: plants, ...(subcategory ? { subcategory } : {}) } })
  const ask = (places: ReturnType<typeof place>[] | undefined, store: string) => Promise.resolve(reads.org_chart({ payload: { store }, baseTables, authorization: { places }, documents,
    reject(message: string): never { throw new Error(message) } }))

  it("answers a Team Leader, a Store Manager, a category head and a region head for the stores they cover", async () => {
    // a Team Leader: one section of one store; a Store Manager: the whole store; a category head: some subcategories at the region's stores
    await expect(ask([place(['9001'], ['C1'])], 'NTH')).resolves.toMatchObject({ store: 'NTH', sections: [{ name: 'Kids', teamLeaders: ['Tara'] }] })
    await expect(ask([place(['9001'])], 'NTH')).resolves.toMatchObject({ store: 'NTH' })
    await expect(ask([place(['9001'], ['C1']), place(['9002'], ['C1'])], 'EST')).resolves.toMatchObject({ store: 'EST' })
    for (const store of ['NTH', 'EST', 'STH']) await expect(ask([place(['9001']), place(['9002']), place(['9003'])], store)).resolves.toMatchObject({ store })
  })
  it("still names the region's other stores, for a transfer", async () => {
    await expect(ask([place(['9001'])], 'NTH')).resolves.toMatchObject({ stores: { NTH: 'North', EST: 'East' } })
  })
  it('refuses a store outside the places, and anyone with none', async () => {
    await expect(ask([place(['9001'])], 'EST')).rejects.toThrow(/not one of your stores/)
    await expect(ask([place(['9001'], ['C1'])], 'STH')).rejects.toThrow(/not one of your stores/)
    await expect(ask([], 'NTH')).rejects.toThrow(/not one of your stores/)
    await expect(ask(undefined, 'NTH')).rejects.toThrow(/not one of your stores/)
  })
  it('refuses a store that is not named by its site code', async () => {
    await expect(ask([place(['9001'])], '9001x')).rejects.toThrow(/site code/)
    await expect(ask([place(['9001'])], '')).rejects.toThrow(/site code/)
  })
})
