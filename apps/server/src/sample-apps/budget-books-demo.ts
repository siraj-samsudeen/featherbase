// Budget Books demo app (spec 0007): the scenario world from the design
// document, as pure data — two differently-shaped books over one engine.
//
//   Sales Budget 2026 — store × category × subcategory, twelve monthly
//   measures, owners split between two users.
//   Opex Budget 2026 — cost_center × gl_account, four quarterly measures.
//
// Both books install as `working` on purpose: the first scenario (build &
// baseline) is the owner's to perform — open the book, press Baseline, and
// watch governance switch on. The Budget Approval workflow carries the
// three lanes from the design: requester → pending → approved, the budget
// owner's self-approve fast lane (condition: not crossing owners), and the
// DOA escalation to the CFO above ±5,00,000. An Email Rule flags every
// approved change to the CFO — including fast-lane approvals, which is the
// point of the flag.
//
// Install: POST /api/install_app { "name": "budget-books-demo" }.
// Demo users have no passwords — test the lanes as Administrator (role
// gates are bypassed but workflow conditions are not), or set passwords on
// the demo users to walk each persona.
import type { AppManifest } from '../apps'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const QUARTERS = ['q1', 'q2', 'q3', 'q4']

const PRIYA = 'priya@demo.featherbase.app'
const MEENA = 'meena@demo.featherbase.app'
const ARUN = 'arun@demo.featherbase.app'
const CFO = 'cfo@demo.featherbase.app'

const currency = (names: string[]) =>
  names.map((column_name) => ({ column_name, column_type: 'Currency', in_list_view: true }))

function months(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of MONTHS) out[m] = values[m] ?? 0
  return out
}

const manifest: AppManifest = {
  name: 'budget-books-demo',
  roles: ['Budget Requester', 'Budget Approver', 'Budget Owner', 'CFO'],
  tables: [
    {
      name: 'Sales Budget Line',
      module: 'Budget Demo',
      columns: [
        { column_name: 'store', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'category', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'subcategory', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'owner_user', column_type: 'Reference', reference_table: 'User', in_list_view: true },
        ...currency(MONTHS),
      ],
    },
    {
      name: 'Opex Budget Line',
      module: 'Budget Demo',
      columns: [
        { column_name: 'cost_center', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'gl_account', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'owner_user', column_type: 'Reference', reference_table: 'User', in_list_view: true },
        ...currency(QUARTERS),
      ],
    },
  ],
  permissions: [
    ...['Budget Requester', 'Budget Approver', 'Budget Owner', 'CFO'].flatMap((role) => [
      { table: 'Sales Budget Line', role, can_read: true, can_write: true },
      { table: 'Opex Budget Line', role, can_read: true, can_write: true },
      { table: 'Budget Book', role, can_read: true },
      { table: 'Budget Version', role, can_read: true },
      { table: 'Budget Change', role, can_read: true, can_write: true, can_create: true },
    ]),
    { table: 'Budget Change', role: 'Budget Approver', can_read: true, can_submit: true },
    { table: 'Budget Change', role: 'Budget Owner', can_read: true, can_submit: true },
    { table: 'Budget Change', role: 'CFO', can_read: true, can_submit: true },
  ],
  fixtures: [
    {
      table: 'User',
      rows: [
        { row_id: PRIYA, email: PRIYA, full_name: 'Priya (Team Leader, Adyar Beverages)', enabled: true, roles: [{ role: 'Budget Requester' }] },
        { row_id: MEENA, email: MEENA, full_name: 'Meena (Category Head)', enabled: true, roles: [{ role: 'Budget Approver' }] },
        { row_id: ARUN, email: ARUN, full_name: 'Arun (IT Head, Budget Owner)', enabled: true, roles: [{ role: 'Budget Owner' }] },
        { row_id: CFO, email: CFO, full_name: 'CFO', enabled: true, roles: [{ role: 'CFO' }] },
      ],
    },
    {
      table: 'Sales Budget Line',
      rows: [
        { row_id: 'SBL-ADY-JUICES', store: 'Adyar', category: 'Beverages', subcategory: 'Juices', owner_user: PRIYA, ...months({ jan: 110000, feb: 110000, mar: 115000, apr: 120000, may: 120000, jun: 125000 }) },
        { row_id: 'SBL-ADY-CARB', store: 'Adyar', category: 'Beverages', subcategory: 'Carbonated', owner_user: PRIYA, ...months({ jan: 180000, feb: 180000, mar: 185000, apr: 190000, may: 195000, jun: 200000 }) },
        { row_id: 'SBL-ADY-SNACKS', store: 'Adyar', category: 'Snacks', subcategory: 'Namkeen', owner_user: PRIYA, ...months({ jan: 60000, feb: 60000, mar: 65000, apr: 65000, may: 70000, jun: 70000 }) },
        { row_id: 'SBL-BN-JUICES', store: 'Besant Nagar', category: 'Beverages', subcategory: 'Juices', owner_user: ARUN, ...months({ jan: 90000, feb: 90000, mar: 95000, apr: 95000, may: 100000, jun: 100000 }) },
        { row_id: 'SBL-BN-CARB', store: 'Besant Nagar', category: 'Beverages', subcategory: 'Carbonated', owner_user: ARUN, ...months({ jan: 150000, feb: 150000, mar: 155000, apr: 160000, may: 160000, jun: 165000 }) },
      ],
    },
    {
      table: 'Opex Budget Line',
      rows: [
        { row_id: 'OBL-ADY-ELEC', cost_center: 'Adyar Store Ops', gl_account: 'Electricity', owner_user: MEENA, q1: 950000, q2: 950000, q3: 950000, q4: 950000 },
        { row_id: 'OBL-ADY-REPAIR', cost_center: 'Adyar Store Ops', gl_account: 'Repairs & Maintenance', owner_user: MEENA, q1: 600000, q2: 600000, q3: 600000, q4: 600000 },
        { row_id: 'OBL-IT-SOFT', cost_center: 'Head Office IT', gl_account: 'Software Subscriptions', owner_user: ARUN, q1: 400000, q2: 400000, q3: 400000, q4: 400000 },
        { row_id: 'OBL-IT-SAL', cost_center: 'Head Office IT', gl_account: 'Salaries', owner_user: ARUN, q1: 2500000, q2: 2500000, q3: 2500000, q4: 2500000 },
      ],
    },
    {
      table: 'Budget Book',
      rows: [
        {
          row_id: 'Sales Budget 2026',
          ref_table: 'Sales Budget Line',
          fiscal_year: '2026',
          owner_column: 'owner_user',
          // Sales escalates DECREASES (lowering a target is the sensitive
          // direction) over 3,00,000 — design §4/§6.
          doa_amount: 300000,
          escalation_dir: 'decrease',
          key_columns: [{ column_name: 'store' }, { column_name: 'category' }, { column_name: 'subcategory' }],
          measure_columns: MONTHS.map((m) => ({ column_name: m, period_label: m.toUpperCase() })),
        },
        {
          row_id: 'Opex Budget 2026',
          ref_table: 'Opex Budget Line',
          fiscal_year: '2026',
          owner_column: 'owner_user',
          // Opex escalates INCREASES (asking for more money) over 5,00,000.
          doa_amount: 500000,
          escalation_dir: 'increase',
          measure_columns: QUARTERS.map((q) => ({ column_name: q, period_label: q.toUpperCase() })),
          key_columns: [{ column_name: 'cost_center' }, { column_name: 'gl_account' }],
        },
      ],
    },
    {
      table: 'Workflow',
      rows: [
        {
          row_id: 'Budget Approval',
          ref_table: 'Budget Change',
          is_active: true,
          states: [
            { state: 'Draft', target_status: 'draft' },
            { state: 'Pending', target_status: 'draft' },
            { state: 'Pending CFO', target_status: 'draft' },
            { state: 'Approved', target_status: 'submitted' },
            { state: 'Rejected', target_status: 'draft' },
          ],
          transitions: [
            // Standard lane: anyone with the Requester role submits for review.
            { state: 'Draft', action: 'Submit for approval', next_state: 'Pending', allowed: 'Budget Requester' },
            // Fast lane: a budget owner self-approves — but never a change
            // that crosses ownership boundaries (design decision §6.1).
            { state: 'Draft', action: 'Self-approve', next_state: 'Approved', allowed: 'Budget Owner', condition: '!doc.crosses_owner' },
            // Within DOA: the approver lands it. over_doa is the engine's
            // computed fact against EACH book's own doa_amount +
            // escalation_dir — one condition serves every book.
            { state: 'Pending', action: 'Approve', next_state: 'Approved', allowed: 'Budget Approver', condition: '!doc.over_doa' },
            // Over the book's DOA: the approver can only escalate.
            { state: 'Pending', action: 'Send to CFO', next_state: 'Pending CFO', allowed: 'Budget Approver', condition: 'doc.over_doa' },
            { state: 'Pending CFO', action: 'Approve', next_state: 'Approved', allowed: 'CFO' },
            { state: 'Pending', action: 'Reject', next_state: 'Rejected', allowed: 'Budget Approver' },
            { state: 'Pending CFO', action: 'Reject', next_state: 'Rejected', allowed: 'CFO' },
          ],
        },
      ],
    },
    {
      table: 'Email Rule',
      rows: [
        // Fires on EVERY approval — the fast lane included, which is the
        // "approved without review, flagged to management" visibility from
        // the design's §6.2.
        {
          row_id: 'Budget Demo CFO Flag',
          ref_table: 'Budget Change',
          event: 'on_submit',
          recipient: CFO,
          subject: 'Budget change approved',
          message: 'A Budget Change was approved. Review it on its form — the reason, per-line deltas, and the approval trail are on the record.',
          enabled: true,
        },
      ],
    },
  ],
}

export default manifest
