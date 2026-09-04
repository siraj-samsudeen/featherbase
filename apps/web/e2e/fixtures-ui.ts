// Shared UI fixture builders.
//
// #215 gave each spec ownership of the fixtures it needs, rather than letting
// one spec silently depend on another having run first (which, on an isolated
// fresh database, made the alphabetically-earlier spec self-skip forever).
// That was the right call, but it was paid for with verbatim copies: three
// specs carried formview.spec's CUST/ROW/DT builder word for word, and
// filters.spec carried listview.spec's fill-to-30 builder. #216 collects them
// here.
//
// Ownership is unchanged — every spec still calls the builder itself, in its
// own `beforeAll`. What is shared is the *definition*, so the Table shapes
// cannot drift apart. Each builder stays idempotent in either direction:
// whichever spec runs first creates, the rest find it already there (a `:meta`
// 404 check for Tables, 409-tolerance for rows).
import { type APIRequestContext } from '@playwright/test'

/** Create a Table from its definition unless it already exists. */
export async function ensureTable(
  request: APIRequestContext,
  auth: { Authorization: string },
  def: Record<string, unknown> & { name: string },
): Promise<void> {
  const meta = await request.get(`/api/table/${encodeURIComponent(def.name)}:meta`, {
    headers: auth,
  })
  if (meta.status() === 404) {
    const res = await request.post('/api/table_def', { headers: auth, data: def })
    if (![201, 409].includes(res.status())) {
      throw new Error(`table ${def.name}: ${res.status()} ${await res.text()}`)
    }
  }
}

// ---------------------------------------------------------------------------
// The FormView trio: a parent Table exercising every column type, its
// sub-table, and the Table its Reference column points at. Shared by
// formview, grid-layout and link-autocomplete.
// ---------------------------------------------------------------------------

export const FORM_DT = 'UI Form A'
export const FORM_ROW = 'UI Form Row'
export const FORM_CUST = 'UI Form Cust'

/**
 * The three Tables, in dependency order: DT's Sub-table column references ROW
 * and its Reference column references CUST, so both must exist before DT.
 */
export async function ensureFormTables(
  request: APIRequestContext,
  auth: { Authorization: string },
): Promise<void> {
  await ensureTable(request, auth, {
    name: FORM_CUST,
    id_pattern: 'prompt',
    columns: [{ column_name: 'city', column_type: 'Data' }],
  })
  await ensureTable(request, auth, {
    name: FORM_ROW,
    kind: 'sub_table',
    columns: [
      { column_name: 'item', column_type: 'Data', label: 'Item' },
      { column_name: 'qty', column_type: 'Int', label: 'Qty' },
    ],
  })
  await ensureTable(request, auth, {
    name: FORM_DT,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', reqd: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty' },
      { column_name: 'done', column_type: 'Check', label: 'Done' },
      { column_name: 'stage', column_type: 'Choice', label: 'Status', choices: 'Open\nClosed' },
      { column_name: 'due', column_type: 'Date', label: 'Due' },
      { column_name: 'customer', column_type: 'Reference', label: 'Customer', reference_table: FORM_CUST },
      { column_name: 'notes', column_type: 'Text', label: 'Notes' },
      { column_name: 'items', column_type: 'Sub-table', label: 'Items', row_table: FORM_ROW },
    ],
  })
}

/** A customer row for the Reference column. Tolerates one left by an earlier run. */
export async function ensureFormCustomer(
  request: APIRequestContext,
  auth: { Authorization: string },
  rowId: string,
  city = 'Chennai',
): Promise<void> {
  const res = await request.post(`/api/table/${encodeURIComponent(FORM_CUST)}`, {
    headers: auth,
    data: { row_id: rowId, city },
  })
  if (![201, 409].includes(res.status())) throw new Error(`cust fixture: ${res.status()}`)
}

/**
 * A row of the parent Table. Returns its id — specs that need "their" row must
 * hold on to this rather than reading back the newest row, which races every
 * other spec writing to the same shared Table.
 */
export async function createFormRow(
  request: APIRequestContext,
  auth: { Authorization: string },
  row: Record<string, unknown>,
): Promise<string> {
  const res = await request.post(`/api/table/${encodeURIComponent(FORM_DT)}`, {
    headers: auth,
    data: row,
  })
  if (res.status() !== 201) throw new Error(`doc fixture: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as { row_id: string }).row_id
}

/**
 * The full FormView fixture: the three Tables, the "Formco" customer, and one
 * row with every column populated. Returns the row's id.
 */
export async function ensureFormFixtures(
  request: APIRequestContext,
  auth: { Authorization: string },
): Promise<string> {
  await ensureFormTables(request, auth)
  await ensureFormCustomer(request, auth, 'Formco')
  return createFormRow(request, auth, {
    title: 'form fixture',
    qty: 4,
    done: true,
    stage: 'Open',
    due: '2026-08-01',
    customer: 'Formco',
    notes: 'multi\nline',
    items: [
      { item: 'bolt', qty: 2 },
      { item: 'nut', qty: 6 },
    ],
  })
}

// ---------------------------------------------------------------------------
// The ListView table: 30 rows, qty 0..29, titles item-00..item-29. Both
// listview.spec and filters.spec assert exact counts against it, so the fill
// is to a fixed total rather than "add 30 more".
// ---------------------------------------------------------------------------

export const LIST_DT_A = 'UI List A'

/** Fill a Table up to `total` rows, leaving an already-full one alone. */
export async function fillRows(
  request: APIRequestContext,
  auth: { Authorization: string },
  table: string,
  total: number,
  row: (i: number) => Record<string, unknown>,
): Promise<void> {
  const listed = await request.get(`/api/table/${encodeURIComponent(table)}?limit_page_length=1`, {
    headers: auth,
  })
  const have = ((await listed.json()) as { total: number }).total
  for (let i = have; i < total; i++) {
    await request.post(`/api/table/${encodeURIComponent(table)}`, { headers: auth, data: row(i) })
  }
}

export async function ensureListTableA(
  request: APIRequestContext,
  auth: { Authorization: string },
): Promise<void> {
  await ensureTable(request, auth, {
    name: LIST_DT_A,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
    ],
  })
  await fillRows(request, auth, LIST_DT_A, 30, (i) => ({
    title: `item-${String(i).padStart(2, '0')}`,
    qty: i,
  }))
}
