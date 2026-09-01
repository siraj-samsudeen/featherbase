// Spec 0007 (Budget Books, M1): the grain-agnostic budget engine core.
//
// A Budget Book binds an ordinary table and declares which columns are the
// grain (key columns) and which are amounts (measure columns, ordered).
// The engine never interprets the grain: everything here works over the
// declared column lists, so a monthly store×subcategory sales budget and a
// quarterly cost-center×account expense budget run on this same code.
//
// Lifecycle (BUD-R2): working (open spreadsheet) → :baseline writes the v0
// snapshot and activates governance → active (writes only through approved
// Budget Changes) → :close. All engine writes to bound rows happen inside
// the caller's transaction and record Version diffs (BUD-R5, BUD-I2).
import { randomBytes } from 'node:crypto'
import type { sql as sqlType } from './db'
import { AppError } from './errors'
import { getMeta, invalidateMeta, physicalRowKey } from './meta'
import { getRoles } from './permissions'
import { tableName } from './table-engine'
import { recordVersion, saveDoc, type RowValues } from './document'

type Sql = typeof sqlType

export const MAX_CHANGE_LINES = 200
// Engine-managed flag a discontinue change sets on the bound row; added to
// the bound table at first baseline (the workflow ensureStateField idiom).
export const DISCONTINUED_FLAG = 'budget_discontinued'
export const NUMERIC_TYPES = new Set(['Int', 'Float', 'Currency'])
const NON_SCALAR = new Set(['Sub-table', 'Section Break', 'Column Break'])

export const BOOK = 'Budget Book'
export const CHANGE = 'Budget Change'
/**
 * The capability an approved apply carries (SaveOptions.capabilities). It
 * lets the engine's own writes past the BUD-R3 write-lock — and nothing
 * else: validation, controller hooks, Document Event Scripts and link checks
 * all still run on the bound row. Never derived from client input.
 */
export const ENGINE_APPLY = 'budget-apply'
const SNAPSHOT_CHUNK = 200

export type BookMode = 'mutate_rows' | 'append_decisions'
export const DECISION = 'Budget Decision'

export interface BookBinding {
  name: string
  refTable: string
  lifecycle: 'working' | 'active' | 'closed'
  /**
   * What approval DOES (owner decision 2026-09-01, Q7):
   *   mutate_rows      — replace values in the bound table.
   *   append_decisions — leave the bound table alone (it is a read-only
   *                      model) and append one immutable Budget Decision.
   */
  mode: BookMode
  /** append mode: the model run decisions are being made against. */
  modelVersion: string | null
  ownerColumn: string | null
  keyColumns: string[]
  measureColumns: string[]
  // Book policy (design §6): the DOA threshold and which delta direction
  // escalates. The engine computes over_doa from these on every change save.
  doaAmount: number | null
  escalationDir: 'increase' | 'decrease' | 'any'
  row: RowValues
}

// The escalation fact a workflow condition consumes (`doc.over_doa`).
export function overDoa(book: BookBinding, totalDelta: number): boolean {
  if (book.doaAmount == null || book.doaAmount <= 0) return false
  if (book.escalationDir === 'increase') return totalDelta > book.doaAmount
  if (book.escalationDir === 'decrease') return -totalDelta > book.doaAmount
  return Math.abs(totalDelta) > book.doaAmount
}

function newName(): string {
  return randomBytes(5).toString('hex')
}

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v))

function auditColumns(user: string, now: Date) {
  return {
    created_by: user,
    updated_by: user,
    created_at: now,
    updated_at: now,
    status: 'draft',
    position: 0,
  }
}

async function withChildren(tx: Sql, row: RowValues): Promise<BookBinding> {
  const parent = String(row.row_id)
  const keys = await tx`
    select column_name from ${tx(tableName('Budget Book Key Column'))}
    where parent = ${parent} and parenttype = ${BOOK} order by position`
  const measures = await tx`
    select column_name from ${tx(tableName('Budget Book Measure Column'))}
    where parent = ${parent} and parenttype = ${BOOK} order by position`
  return {
    name: parent,
    refTable: String(row.ref_table),
    lifecycle: String(row.lifecycle) as BookBinding['lifecycle'],
    ownerColumn: row.owner_column ? String(row.owner_column) : null,
    keyColumns: keys.map((k) => String(k.column_name)),
    measureColumns: measures.map((m) => String(m.column_name)),
    mode: row.mode === 'append_decisions' ? 'append_decisions' : 'mutate_rows',
    modelVersion: row.model_version == null || row.model_version === '' ? null : String(row.model_version),
    doaAmount: row.doa_amount == null ? null : Number(row.doa_amount),
    escalationDir:
      row.escalation_dir === 'increase' || row.escalation_dir === 'decrease'
        ? row.escalation_dir
        : 'any',
    row,
  }
}

export async function loadBook(tx: Sql, name: string): Promise<BookBinding | null> {
  const [row] = await tx`
    select * from ${tx(tableName(BOOK))} where row_id = ${name}`
  return row ? withChildren(tx, row as RowValues) : null
}

// The write-lock's question (BUD-R3): which active book, if any, governs
// this table? At most one can (BUD-R1's uniqueness rule).
export async function activeBookFor(tx: Sql, table: string): Promise<BookBinding | null> {
  const [row] = await tx`
    select * from ${tx(tableName(BOOK))}
    where ref_table = ${table} and lifecycle = 'active' limit 1`
  return row ? withChildren(tx, row as RowValues) : null
}

export function declaredColumns(book: BookBinding): string[] {
  return [
    ...book.keyColumns,
    ...book.measureColumns,
    ...(book.ownerColumn ? [book.ownerColumn] : []),
    DISCONTINUED_FLAG,
  ]
}

export interface BindingInput {
  refTable: string
  ownerColumn: string | null
  keyColumns: string[]
  measureColumns: string[]
}

// BUD-R1: a binding must be real before a book can claim it.
export async function validateBinding(input: BindingInput): Promise<void> {
  const bad = (message: string): never => {
    throw new AppError('ValidationError', message)
  }
  if (!input.refTable) bad('ref_table is required')
  if (input.refTable.startsWith('Budget '))
    bad('the budget engine cannot govern its own tables')
  let refMeta
  try {
    refMeta = await getMeta(input.refTable)
  } catch {
    return bad(`ref_table "${input.refTable}" does not exist`)
  }
  if (refMeta.kind !== 'table')
    bad(`a Budget Book binds a plain table — "${input.refTable}" is a ${refMeta.kind}`)
  if (refMeta.system) bad(`"${input.refTable}" is a system table and cannot be budgeted`)
  if (refMeta.data_source)
    bad(`"${input.refTable}" is bound to an external Data Source and cannot be budgeted`)
  if (!input.keyColumns.length) bad('a book declares at least one key column')
  if (!input.measureColumns.length) bad('a book declares at least one measure column')
  const byName = new Map(refMeta.columns.map((f) => [f.column_name, f]))
  const seen = new Set<string>()
  for (const k of input.keyColumns) {
    const f = byName.get(k)
    if (!f || NON_SCALAR.has(f.column_type))
      bad(`key column "${k}" is not a scalar column of ${input.refTable}`)
    if (seen.has(k)) bad(`column "${k}" is declared twice`)
    seen.add(k)
  }
  for (const m of input.measureColumns) {
    const f = byName.get(m)
    if (!f || !NUMERIC_TYPES.has(f.column_type))
      bad(`measure column "${m}" must be a numeric column (Int, Float, Currency) of ${input.refTable}`)
    if (seen.has(m)) bad(`column "${m}" is declared twice`)
    seen.add(m)
  }
  if (input.ownerColumn) {
    const f = byName.get(input.ownerColumn)
    if (!f || NON_SCALAR.has(f.column_type))
      bad(`owner column "${input.ownerColumn}" is not a scalar column of ${input.refTable}`)
    if (input.measureColumns.includes(input.ownerColumn))
      bad('the owner column cannot also be a measure')
  }
}

// BUD-R8: the bound table carries an engine-managed discontinued flag,
// added on demand at first baseline (the workflow ensureStateField idiom).
export async function ensureDiscontinuedFlag(tx: Sql, table: string): Promise<void> {
  const meta = await getMeta(table)
  if (meta.columns.some((f) => f.column_name === DISCONTINUED_FLAG)) return
  await tx.unsafe(
    `alter table "${tableName(table)}" add column if not exists "${DISCONTINUED_FLAG}" boolean not null default false`,
  )
  await tx`
    insert into column_def ${tx({
      parent: table,
      position: meta.columns.length + 1,
      column_name: DISCONTINUED_FLAG,
      label: 'Budget Discontinued',
      column_type: 'Check',
      default_value: '0',
      read_only: true,
    })}`
  invalidateMeta(table)
}

// BUD-R10: a snapshot is the whole book — one Budget Version Line per bound
// row, data = every declared key, measure and owner value at snapshot time.
export async function snapshotBook(
  tx: Sql,
  book: BookBinding,
  label: string,
  kind: 'baseline' | 'reforecast' | 'adhoc',
  user: string,
  // BUD-R2 (review finding: baseline could race a final direct edit). The
  // book row is locked by the caller, but the BOUND rows are not: an
  // ordinary edit that started while the book still read `working` could
  // commit after this snapshot read, leaving "current" different from v0
  // before any Budget Change existed. Holding the rows for the baseline
  // transaction closes that window — updateDoc takes its row lock before it
  // runs the write-lock hook, so a waiting edit re-judges against `active`
  // once we commit, and is refused.
  lockRows = false,
): Promise<{ version: string; line_count: number }> {
  const now = new Date()
  const versionName = newName()
  const cols = [
    ...book.keyColumns,
    ...book.measureColumns,
    ...(book.ownerColumn ? [book.ownerColumn] : []),
  ]
  const rows = lockRows
    ? await tx`
        select ${tx(['row_id', ...cols])} from ${tx(tableName(book.refTable))}
        order by row_id for update`
    : await tx`
        select ${tx(['row_id', ...cols])} from ${tx(tableName(book.refTable))} order by row_id`
  await tx`
    insert into ${tx(tableName('Budget Version'))} ${tx({
      row_id: versionName,
      ...auditColumns(user, now),
      book: book.name,
      label,
      kind,
      line_count: rows.length,
    })}`
  const lineRows = rows.map((r) => {
    const data: Record<string, unknown> = {}
    for (const c of cols) data[c] = (r as RowValues)[c] ?? null
    // Measures land in the snapshot as numbers, whatever the physical
    // column type returned (numeric columns arrive as strings).
    for (const m of book.measureColumns) data[m] = num((r as RowValues)[m])
    return {
      row_id: newName(),
      ...auditColumns(user, now),
      version: versionName,
      ref_name: String((r as RowValues).row_id),
      data: data as unknown as string,
    }
  })
  const lineTbl = tableName('Budget Version Line')
  for (let i = 0; i < lineRows.length; i += SNAPSHOT_CHUNK)
    await tx`insert into ${tx(lineTbl)} ${tx(lineRows.slice(i, i + SNAPSHOT_CHUNK))}`
  return { version: versionName, line_count: rows.length }
}

async function lockedBookRow(tx: Sql, name: string): Promise<RowValues> {
  const [row] = await tx`
    select * from ${tx(tableName(BOOK))} where row_id = ${name} for update`
  if (!row) throw new AppError('NotFoundError', `${BOOK} ${name} not found`)
  return row as RowValues
}

async function setLifecycle(
  tx: Sql,
  before: RowValues,
  to: BookBinding['lifecycle'],
  user: string,
): Promise<void> {
  const [after] = await tx`
    update ${tx(tableName(BOOK))}
    set lifecycle = ${to}, updated_at = ${new Date()}, updated_by = ${user}
    where row_id = ${String(before.row_id)} returning *`
  await recordVersion(tx, await getMeta(BOOK), String(before.row_id), before, after as RowValues, user)
}

// BUD-R2: working → active. Freezes the book: v0 written, governance on.
export async function baselineBook(
  tx: Sql,
  name: string,
  user: string,
): Promise<{ book: string; lifecycle: string; version: string; line_count: number }> {
  const before = await lockedBookRow(tx, name)
  const book = await withChildren(tx, before)
  if (book.lifecycle !== 'working')
    throw new AppError(
      'ValidationError',
      `only a working book can be baselined — ${name} is ${book.lifecycle}`,
    )
  // The bound table may have changed since the book was saved: re-check.
  await validateBinding({
    refTable: book.refTable,
    ownerColumn: book.ownerColumn,
    keyColumns: book.keyColumns,
    measureColumns: book.measureColumns,
  })
  await ensureDiscontinuedFlag(tx, book.refTable)
  const snap = await snapshotBook(tx, book, 'v0', 'baseline', user, true)
  await setLifecycle(tx, before, 'active', user)
  return { book: name, lifecycle: 'active', ...snap }
}

// BUD-R2: active → closed. Governance ends; the snapshots and Version
// trail remain the durable history (Q3 asks the owner to ratify).
export async function closeBook(
  tx: Sql,
  name: string,
  user: string,
): Promise<{ book: string; lifecycle: string }> {
  const before = await lockedBookRow(tx, name)
  if (String(before.lifecycle) !== 'active')
    throw new AppError(
      'ValidationError',
      `only an active book can be closed — ${name} is ${String(before.lifecycle)}`,
    )
  await setLifecycle(tx, before, 'closed', user)
  return { book: name, lifecycle: 'closed' }
}

// Later snapshots (reforecast anchors) on an active book.
export async function snapshotActiveBook(
  tx: Sql,
  name: string,
  label: string,
  kind: 'reforecast' | 'adhoc',
  user: string,
): Promise<{ book: string; version: string; line_count: number }> {
  const before = await lockedBookRow(tx, name)
  const book = await withChildren(tx, before)
  if (book.lifecycle !== 'active')
    throw new AppError(
      'ValidationError',
      `only an active book can be snapshotted — ${name} is ${book.lifecycle}`,
    )
  const snap = await snapshotBook(tx, book, label, kind, user)
  return { book: name, ...snap }
}

// Spec 0007 M2 — the compare view's arithmetic. Diffs two snapshots of a
// book (or a snapshot against the live table, via the 'current' sentinel):
// one entry per row that differs, measures as {from, to} pairs.
export interface CompareLine {
  ref_name: string
  key: Record<string, unknown>
  status: 'added' | 'removed' | 'changed'
  measures: Record<string, { from: number | null; to: number | null }>
}

export const CURRENT_VERSION = 'current'

async function versionSide(
  db: Sql,
  book: BookBinding,
  version: string,
): Promise<{ label: string; rows: Map<string, Record<string, unknown>> }> {
  const rows = new Map<string, Record<string, unknown>>()
  if (version === CURRENT_VERSION) {
    const cols = [
      ...book.keyColumns,
      ...book.measureColumns,
      ...(book.ownerColumn ? [book.ownerColumn] : []),
    ]
    const live = await db`
      select ${db(['row_id', ...cols])} from ${db(tableName(book.refTable))}`
    for (const r of live) {
      const data: Record<string, unknown> = {}
      for (const c of cols) data[c] = (r as RowValues)[c] ?? null
      rows.set(String((r as RowValues).row_id), data)
    }
    return { label: 'Current', rows }
  }
  const [header] = await db`
    select * from ${db(tableName('Budget Version'))}
    where row_id = ${version} and book = ${book.name}`
  if (!header)
    throw new AppError('NotFoundError', `Budget Version ${version} not found on ${book.name}`)
  const lines = await db`
    select ref_name, data from ${db(tableName('Budget Version Line'))}
    where version = ${version}`
  for (const l of lines) rows.set(String(l.ref_name), (l.data ?? {}) as Record<string, unknown>)
  return { label: String((header as RowValues).label), rows }
}

export async function compareVersions(
  db: Sql,
  bookName: string,
  from: string,
  to: string,
): Promise<{
  book: string
  from_label: string
  to_label: string
  measure_columns: string[]
  lines: CompareLine[]
  unchanged: number
}> {
  const book = await loadBook(db, bookName)
  if (!book) throw new AppError('NotFoundError', `${BOOK} ${bookName} not found`)
  const a = await versionSide(db, book, from)
  const b = await versionSide(db, book, to)
  const lines: CompareLine[] = []
  let unchanged = 0
  const names = new Set([...a.rows.keys(), ...b.rows.keys()])
  for (const ref of names) {
    const fromRow = a.rows.get(ref)
    const toRow = b.rows.get(ref)
    const keySource = toRow ?? fromRow ?? {}
    const key: Record<string, unknown> = {}
    for (const c of book.keyColumns) key[c] = keySource[c] ?? null
    const measures: CompareLine['measures'] = {}
    let differs = false
    for (const m of book.measureColumns) {
      const f = fromRow ? num(fromRow[m]) : null
      const t = toRow ? num(toRow[m]) : null
      if (f !== t) differs = true
      measures[m] = { from: f, to: t }
    }
    if (!fromRow) lines.push({ ref_name: ref, key, status: 'added', measures })
    else if (!toRow) lines.push({ ref_name: ref, key, status: 'removed', measures })
    else if (differs) lines.push({ ref_name: ref, key, status: 'changed', measures })
    else unchanged++
  }
  lines.sort((x, y) => (x.ref_name < y.ref_name ? -1 : 1))
  return {
    book: book.name,
    from_label: a.label,
    to_label: b.label,
    measure_columns: book.measureColumns,
    lines,
    unchanged,
  }
}

export function parseNewLineKey(value: unknown): Record<string, unknown> {
  const raw = typeof value === 'string' && value !== '' ? JSON.parse(value) : value
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw))
    throw new AppError('ValidationError', 'new_line_key must be a JSON object of key column values')
  return raw as Record<string, unknown>
}

export function keySignature(key: Record<string, unknown>, keyColumns: string[]): string {
  return keyColumns.map((c) => JSON.stringify(key[c] ?? null)).join('\u0000')
}

function whereKey(tx: Sql, key: Record<string, unknown>) {
  return Object.entries(key)
    .map(([c, v]) => tx`${tx(c)} = ${v as never}`)
    .reduce((a, b) => tx`${a} and ${b}`)
}

export async function keyCollides(
  tx: Sql,
  book: BookBinding,
  key: Record<string, unknown>,
): Promise<boolean> {
  const [hit] = await tx`
    select 1 from ${tx(tableName(book.refTable))} where ${whereKey(tx, key)} limit 1`
  return Boolean(hit)
}

// BUD-R5/R6/R7/R8: apply an approved change to the bound table, inside the
// caller's transaction (the submit/workflow-transition transaction — BUD-I2).
// Every touched row is re-verified against its snapped current_value first:
// a stale snapshot refuses the whole approval (BUD-R5's branch).

/**
 * BUD-R15: a scope names declared key columns only, and an absent or null
 * dimension means "all". That is the ONE thing the engine can check about a
 * scope without knowing the domain — it catches a typo'd dimension while
 * leaving leaf resolution and roll-up placement entirely to the application.
 *
 * Returns the normalized scope: declared keys only, nulls dropped, so two
 * spellings of "all of Kerala" store identically.
 */
export function normalizeScope(
  book: BookBinding,
  raw: unknown,
): Record<string, unknown> {
  const parsed = typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : raw
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new AppError('ValidationError', 'scope must be a JSON object of key column values')
  const obj = parsed as Record<string, unknown>
  const unknown = Object.keys(obj).filter((k) => !book.keyColumns.includes(k))
  if (unknown.length)
    throw new AppError(
      'ValidationError',
      `scope names ${unknown.join(', ')}, which ${unknown.length > 1 ? 'are' : 'is'} not a key column of ${book.name} (declared: ${book.keyColumns.join(', ')})`,
    )
  const out: Record<string, unknown> = {}
  for (const c of book.keyColumns) {
    const v = obj[c]
    if (v == null || v === '') continue // absent = every value of this dimension
    out[c] = v
  }
  if (!Object.keys(out).length)
    throw new AppError(
      'ValidationError',
      'a scope with every dimension left open addresses the whole book — name at least one',
    )
  return out
}

/**
 * BUD-R14/R16: approval in append mode. The bound table is never touched;
 * one immutable Budget Decision is appended per line, in the approval's own
 * transaction. Two decisions may address the same target on purpose — which
 * one is in force is the application's to derive, and the superseded one
 * stays readable for grading.
 */
async function appendDecisions(
  tx: Sql,
  change: RowValues,
  lines: RowValues[],
  book: BookBinding,
  user: string,
): Promise<void> {
  const now = new Date()
  const changeName = String(change.row_id)
  // The actor's roles are SERVER-derived (the platform's own getRoles), so a
  // client cannot claim a stronger one by putting it in the payload. The
  // application ranks them; the engine only records what was true.
  const decidedRole = (await getRoles(user)).join(', ') || null
  for (const [i, l] of lines.entries()) {
    const kind = l.target_kind === 'scope' ? 'scope' : 'row'
    await tx`
      insert into ${tx(tableName(DECISION))} ${tx({
        row_id: `${changeName}-${i + 1}`,
        ...auditColumns(user, now),
        book: book.name,
        change: changeName,
        target_kind: kind,
        line_ref: kind === 'row' ? String(l.line_ref) : null,
        scope: kind === 'scope' ? JSON.stringify(l.scope ?? {}) : null,
        measure: String(l.measure_column),
        basis: l.basis === 'delta' ? 'delta' : 'set',
        value: num(l.proposed_value),
        payload: l.payload == null ? null : JSON.stringify(l.payload),
        model_version: book.modelVersion,
        reason: String(change.reason ?? ''),
        decided_by: user,
        decided_role: decidedRole,
        decided_at: now,
      })}`
  }
}

export async function applyChange(
  tx: Sql,
  change: RowValues,
  lines: RowValues[],
  book: BookBinding,
  user: string,
): Promise<void> {
  if (book.lifecycle !== 'active')
    throw new AppError(
      'ValidationError',
      `${book.name} is ${book.lifecycle} — only an active book accepts changes`,
    )
  // BUD-R14: append mode leaves the model alone entirely.
  if (book.mode === 'append_decisions') return appendDecisions(tx, change, lines, book, user)
  const boundMeta = await getMeta(book.refTable)
  const boundTbl = tableName(book.refTable)
  const changeName = String(change.row_id)
  const type = String(change.change_type)
  const now = new Date()
  const hasFlag = boundMeta.columns.some((f) => f.column_name === DISCONTINUED_FLAG)

  const stale = (ref: string, col: string, live: number, snapped: number): never => {
    throw new AppError(
      'ConflictError',
      `${changeName}: ${book.refTable} ${ref} ${col} is now ${live}, not ${snapped} as proposed against — refresh the change and resubmit`,
    )
  }
  const lockRow = async (ref: string): Promise<RowValues> => {
    const [row] = await tx`
      select * from ${tx(boundTbl)} where row_id = ${ref} for update`
    if (!row)
      throw new AppError('ValidationError', `${changeName}: ${book.refTable} ${ref} no longer exists`)
    return row as RowValues
  }
  // BUD-R5 (review P0-3): the approved write goes through the SAME document
  // lifecycle an ordinary save would — column validation, controller hooks,
  // Document Event Scripts, link checks and the Version diff — carrying the
  // caller's transaction so it commits or rolls back with the status change
  // (BUD-I2), and the ENGINE_APPLY capability so only the BUD-R3 write-lock
  // stands aside. Raw SQL used to skip all of it, which meant an application
  // could have its own invariants bypassed by an approval.
  //
  // skipPermissions is deliberate and narrow: the actor's authority for this
  // write is the approval they just made on the Budget Change, not a
  // create/write grant on the bound table — an approver governs the budget,
  // and typically holds no direct grant on the line table at all. (Q6 asks
  // the owner to ratify that reading.)
  const engineSave = (values: RowValues, mode: 'upsert' | 'insert'): Promise<RowValues> =>
    saveDoc(book.refTable, values, user, mode, {
      tx,
      capabilities: [ENGINE_APPLY],
      skipPermissions: true,
      // The one read_only column the engine owns on a bound table. Named
      // explicitly so the apply can set the wind-down flag and nothing else
      // system-managed.
      ownedColumns: [DISCONTINUED_FLAG],
    })
  const applyTo = async (ref: string, before: RowValues, sets: RowValues): Promise<void> => {
    // updateDoc's own optimistic-concurrency stamp; the row is already
    // locked FOR UPDATE above, so this reads the value we just took.
    await engineSave({ ...sets, row_id: ref, updated_at: before.updated_at }, 'upsert')
  }

  if (type === 'revise' || type === 'transfer') {
    const byRef = new Map<string, RowValues[]>()
    for (const l of lines) {
      const ref = String(l.line_ref)
      byRef.set(ref, [...(byRef.get(ref) ?? []), l])
    }
    for (const [ref, refLines] of byRef) {
      const before = await lockRow(ref)
      const sets: RowValues = {}
      for (const l of refLines) {
        const m = String(l.measure_column)
        const live = num(before[m])
        if (live !== num(l.current_value)) stale(ref, m, live, num(l.current_value))
        sets[m] = num(l.proposed_value)
      }
      // BUD-R8: a revise touching a discontinued line reinstates it.
      if (type === 'revise' && hasFlag && before[DISCONTINUED_FLAG] === true)
        sets[DISCONTINUED_FLAG] = false
      await applyTo(ref, before, sets)
    }
  } else if (type === 'new_line') {
    const byName = new Map(boundMeta.columns.map((f) => [f.column_name, f]))
    const groups = new Map<string, { key: Record<string, unknown>; measures: RowValues }>()
    for (const l of lines) {
      const key = parseNewLineKey(l.new_line_key)
      const sig = keySignature(key, book.keyColumns)
      const g = groups.get(sig) ?? { key, measures: {} }
      g.measures[String(l.measure_column)] = num(l.proposed_value)
      groups.set(sig, g)
    }
    for (const g of groups.values()) {
      if (await keyCollides(tx, book, g.key))
        throw new AppError(
          'ValidationError',
          `${changeName}: a ${book.refTable} row with that key already exists — revise it instead`,
        )
      // Reference key columns, required columns and defaults are all judged
      // by the save lifecycle now (validateLinks included), so the engine no
      // longer hand-rolls a subset of those checks.
      const zeroed: RowValues = {}
      for (const m of book.measureColumns) zeroed[m] = 0
      await engineSave({ ...zeroed, ...g.key, ...g.measures }, 'insert')
    }
  } else if (type === 'discontinue') {
    const effective = String(change.effective_from)
    const fromIdx = book.measureColumns.indexOf(effective)
    if (fromIdx < 0)
      throw new AppError(
        'ValidationError',
        `${changeName}: effective_from "${effective}" is not a measure of ${book.name}`,
      )
    const zeroCols = book.measureColumns.slice(fromIdx)
    for (const l of lines) {
      const ref = String(l.line_ref)
      const before = await lockRow(ref)
      // BUD-R8 (audit bug #2): never re-zero an already-discontinued line —
      // its remaining periods are the wind-down yardstick.
      if (before[DISCONTINUED_FLAG] === true)
        throw new AppError(
          'ValidationError',
          `${changeName}: ${ref} is already discontinued — reinstate it with a revise first`,
        )
      const liveSum = zeroCols.reduce((s, c) => s + num(before[c]), 0)
      if (liveSum !== num(l.current_value)) stale(ref, `Σ(${effective}…)`, liveSum, num(l.current_value))
      const sets: RowValues = {}
      for (const c of zeroCols) sets[c] = 0
      if (hasFlag) sets[DISCONTINUED_FLAG] = true
      await applyTo(ref, before, sets)
    }
  } else {
    throw new AppError('ValidationError', `unknown change_type "${type}"`)
  }
}
