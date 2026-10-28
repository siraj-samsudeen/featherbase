import { randomBytes } from 'node:crypto'
import { opaqueId } from './opaque-id'
import { tableSchemaToZod, zodFieldErrors } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { sessionMayAddWayIn } from './session-context'
import { appOperation } from './app-lifecycle'
import { afterCommitOf, afterDocumentCommit } from './action-transaction'
import { assertNothingRetained, repointRowActivity, retainedActivityCounts, retainedDocumentCounts } from './document-activity'
import { ROW_KEY, defaultValueFor, getMeta, physicalRowKey, type TableMeta } from './meta'
import { STANDARD_COLUMNS, tableName, tableRelation } from './table-engine'
import { runHooks, type HookContext } from './controllers'
import { evaluateEmailRules, type LifecycleEvent } from './email-rules'
import { evaluateAssignmentRules } from './assignment-rules'
import { applySla } from './sla'
import { getActiveWorkflow, stateField, rethrowWorkflowConflict, notifyApproversOfNewRow } from './workflow'
import { evaluateWebhooks } from './webhooks'
import { runDocEventScripts } from './server-scripts'
import { SENSITIVE_COLUMNS } from './sensitive-columns'
import { FULL_READER, ROW_ATTACHED_TABLES, readerFor, restrictRow, seesEveryColumn, type Tiers } from './row-readers'
import { assertNotSystemWritten } from './system-written'
import { assertManagedUnchanged, assertNoManagedReference, assertRowNotManaged, holdManagedSet } from './managed-settings'
import { assertSecurityWriter, isSecurityTable, securityRefusal } from './security-tables'
import {
  assertDocPermission,
  assertPermission,
  checkUserPermissions,
  filterReadFields,
  getScopeMap,
  isPrivileged,
  isSharedWith,
  permittedTiers,
  stripUnwritableFields,
} from './permissions'
import {
  assertBoundScope,
  boundFetchDoc,
  explainRefusal,
  isBound,
  mapRowOut,
  mapValuesIn,
  writableContext,
} from './sources/dispatch'

// #436: a row's value for a column, read only from the row itself: a column
// named after an Object.prototype key (constructor) must not find the built-in.
function own(row: RowValues, column: string): unknown {
  return Object.hasOwn(row, column) ? row[column] : undefined
}

// Hooks may set any writable column; re-filter after they run so a hook
// can't inject unknown keys into SQL.
function columnValues(meta: TableMeta, row: RowValues): RowValues {
  const out: RowValues = {}
  for (const f of meta.columns) {
    if (NO_COLUMN_TYPES.has(f.column_type)) continue
    if (Object.hasOwn(row, f.column_name)) out[f.column_name] = row[f.column_name]
  }
  return out
}

// DOC-011 + META-009: validate field values against the metadata-generated
// zod schema. Inserts validate the whole row (missing reqd columns fail);
// updates validate only the columns being changed.
function validateValues(
  meta: TableMeta,
  values: RowValues,
  mode: 'insert' | 'update',
): RowValues {
  const schema = tableSchemaToZod(meta.columns)
  const result = (mode === 'update' ? schema.partial() : schema).safeParse(values)
  if (!result.success)
    throw new AppError(
      'ValidationError',
      `Invalid values for ${meta.name}`,
      zodFieldErrors(result.error),
    )
  const parsed = result.data as RowValues
  // zod's empty-preprocess turns provided-but-empty optionals into
  // undefined; write them back as explicit nulls so updates can clear values.
  for (const key of Object.keys(values))
    if (parsed[key] === undefined) parsed[key] = null
  // #436: zod keeps a key the input only inherits (constructor) as undefined;
  // a column the row left out stays out.
  for (const key of Object.keys(parsed))
    if (parsed[key] === undefined && !Object.hasOwn(values, key)) delete parsed[key]
  return parsed
}

type RowValues = Record<string, unknown>

const NO_COLUMN_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break'])

function hashRowId(): string {
  return randomBytes(5).toString('hex')
}

// META-006: resolve a new row's id from the Table's id_pattern rule.
// Series counters use INSERT ... ON CONFLICT DO UPDATE inside the save
// transaction: concurrent savers serialize on the counter row, so ids are
// unique and sequential; a rolled-back save also rolls back the increment.
async function resolveRowId(
  tx: typeof sql,
  meta: TableMeta,
  values: RowValues,
): Promise<string> {
  const rule = meta.id_pattern || 'hash'
  // person-rename R1: an opaque id is assigned, never chosen — a caller (a
  // form, an API client, an import) may not supply one. Checked before the
  // amendment path, so `amended_from` cannot smuggle one in: an amendment of
  // an opaque-id row simply gets a fresh opaque id.
  if (rule.startsWith('opaque:')) {
    if (values.amended_from == null && String(values[ROW_KEY] ?? '').trim())
      throw new AppError('ValidationError', `${meta.name} ids are assigned by Featherbase; leave the id blank`, {
        [ROW_KEY]: 'assigned automatically',
      })
    return opaqueId(rule.slice('opaque:'.length))
  }
  // DOC-008: amended rows carry a pre-derived ROWID-n.
  if (values.amended_from != null && values[ROW_KEY])
    return String(values[ROW_KEY])
  // UPS-R4 (spec 0004): a caller may supply the row's id outright — the
  // file's own reference codes become row ids, verbatim, and the series is
  // NOT consumed for them (IMP-R6: the pattern is the promise, so unsupplied
  // rows simply continue the series). 'prompt' keeps its required-id error
  // and 'field:' keeps naming from its declared column.
  if (rule !== 'prompt' && !rule.startsWith('field:')) {
    const supplied = String(values[ROW_KEY] ?? '').trim()
    if (supplied) return supplied
  }
  if (rule === 'hash') return hashRowId()
  if (rule === 'prompt') {
    const rowId = String(values[ROW_KEY] ?? '').trim()
    if (!rowId)
      throw new AppError('ValidationError', `${meta.name} requires a Row ID`, {
        [ROW_KEY]: 'Row ID is required',
      })
    return rowId
  }
  if (rule.startsWith('field:')) {
    const columnName = rule.slice('field:'.length)
    const value = String(own(values, columnName) ?? '').trim()
    if (!value)
      throw new AppError('ValidationError', `Naming field ${columnName} is required`, {
        [columnName]: `${columnName} is required for naming`,
      })
    return value
  }
  if (rule.includes('.#')) {
    const dot = rule.indexOf('.')
    const prefix = rule.slice(0, dot)
    const digits = (rule.slice(dot + 1).match(/#/g) ?? []).length || 4
    const [row] = await tx`
      insert into series (name, current) values (${prefix}, 1)
      on conflict (name) do update set current = series.current + 1
      returning current`
    return prefix + String(row.current).padStart(digits, '0')
  }
  throw new AppError('ValidationError', `Unsupported id_pattern rule ${rule}`)
}

// Filter incoming values to real data columns; reject unknown keys so typos
// fail loudly instead of silently dropping data. read_only columns are
// system-managed (META-010): client-sent values for them are ignored.
function pickFieldValues(meta: TableMeta, values: RowValues): RowValues {
  const known = new Map(meta.columns.map((f) => [f.column_name, f]))
  const out: RowValues = {}
  const errors: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (key === 'table') continue
    if ((STANDARD_COLUMNS as readonly string[]).includes(key)) continue
    const field = known.get(key)
    if (!field) {
      errors[key] = `Unknown field ${key} on ${meta.name}`
      continue
    }
    if (NO_COLUMN_TYPES.has(field.column_type)) continue
    if (field.read_only) continue
    out[key] = value ?? null
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', `Unknown fields: ${Object.keys(errors).join(', ')}`, errors)
  return out
}

// META-010: fill defaults for columns absent on insert (read_only included —
// defaults are how system-managed columns get their values).
function applyDefaults(meta: TableMeta, values: RowValues): RowValues {
  const out = { ...values }
  for (const f of meta.columns) {
    if (NO_COLUMN_TYPES.has(f.column_type)) continue
    if (own(out, f.column_name) != null) continue
    if (f.default_value == null) continue
    out[f.column_name] = defaultValueFor(f.column_type, f.default_value)
  }
  return out
}

// The columns a unique violation (23505) is about.
//
// Postgres names the offending columns in `detail`:
//   Key (language, source_text)=(fr, Save) already exists.
// Prefer that over the constraint name. Naming the constraint only works
// for our generated `x_column_uq` singles, and everything else — a
// plain unique INDEX, a composite, the primary key — used to fall back to
// reporting `name`, blaming a field that was not the problem. That cost
// real debugging time on `translation_lang_src` (issue #42). Postgres
// leaves `detail` out when the connecting role may not see the key (row
// security, column privileges); the constraint name is then all there is.
export function duplicateValueFields(table: string, e: { constraint_name?: string; detail?: string }): string[] {
  const detailCols = /^Key \(([^)]+)\)=/.exec(e.detail ?? '')?.[1]
  const prefix = `${tableName(table)}_`
  // An expression index names an expression, not a column, in its detail
  // (`lower(email::text)`): map the case-insensitive rules by name.
  return e.constraint_name === 'person_email_lower_uq'
    ? ['email']
    : e.constraint_name === 'person_username_lower_uq'
    ? ['username']
    : detailCols
    ? detailCols.split(', ').map((c) => c.replace(/^"|"$/g, ''))
    : e.constraint_name?.startsWith(prefix) && e.constraint_name.endsWith('_uq')
      ? [e.constraint_name.slice(prefix.length, -'_uq'.length)]
      : [ROW_KEY]
}

// META-010: translate Postgres constraint violations into field-wise
// ValidationErrors instead of opaque 500s.
async function mapDbError(meta: TableMeta, err: unknown, refTable?: unknown): Promise<never> {
  if (meta.name === 'Workflow') await rethrowWorkflowConflict(err, refTable)
  const e = err as {
    code?: string
    constraint_name?: string
    column_name?: string
    detail?: string
  }
  if (e?.code === '23505') {
    const fields = duplicateValueFields(meta.name, e)
    const label = fields.join(', ')
    throw new AppError('ValidationError', `Duplicate value for ${label}`, {
      ...Object.fromEntries(fields.map((f) => [f, `${label} must be unique`])),
    })
  }
  if (e?.code === '22003' || e?.code === '22001' || e?.code === '22P02')
    throw new AppError('ValidationError', 'Value out of range for a field')
  throw err as Error
}

// META-008: every Reference value must point at an existing row of the
// target Table. Local targets are checked inside the save transaction;
// source-bound targets are asked of their source.
async function validateLinks(
  tx: typeof sql,
  meta: TableMeta,
  fieldValues: RowValues,
  prefix = '',
) {
  const errors: Record<string, string> = {}
  for (const f of meta.columns) {
    if (f.column_type !== 'Reference') continue
    const value = own(fieldValues, f.column_name)
    if (value == null || value === '') continue
    const target = f.reference_table
    if (!target) continue
    // select *: early migrations save rows before table_def has data_source.
    const [targetMeta] = await tx`select * from table_def where name = ${target}`
    if (!targetMeta) {
      errors[prefix + f.column_name] = `Reference target Table ${target} does not exist`
      continue
    }
    // A source-bound target has no local table: ask its source (EDS-5). Like
    // the native lookup, this checks existence only, not the caller's access.
    // It runs outside the save transaction, so it is best-effort: the source
    // can drop the row before this save commits.
    if (targetMeta.data_source) {
      if (!(await boundFetchDoc(await getMeta(target), String(value))))
        errors[prefix + f.column_name] = `${target} ${String(value)} does not exist`
      continue
    }
    const [row] = await tx`
      select 1 from ${tx(await tableRelation(target))}
      where ${tx(physicalRowKey(target))} = ${String(value)}
      ${target.includes('.') ? tx`for key share` : tx``}`
    if (!row)
      errors[prefix + f.column_name] = `${target} ${String(value)} does not exist`
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', `Invalid links for ${meta.name}`, errors)
}

async function lockCoreDocumentTargets(tx: typeof sql, meta: TableMeta, row: RowValues, user: string, old?: RowValues) {
  if (!['Comment', 'Version', 'File', 'Share'].includes(meta.name)) return
  const tableField = meta.name === 'Share' ? 'share_table' : 'ref_table'
  const nameField = meta.name === 'Share' ? 'share_name' : 'ref_name'
  for (const target of [old, row]) {
    const table = target?.[tableField]
    if (typeof table !== 'string' || !table) continue
    const name = String(target?.[nameField] ?? '')
    // File may attach to a Table rather than one document, or be unattached.
    if (meta.name === 'File' && !name) continue
    const appTable = table.includes('.')
    // #321: a plain stored row is locked too, so this write and the row's
    // deletion serialise: either the delete waits and then sees this activity
    // and refuses, or this write waits and then finds the row gone. A
    // connected row lives on its source and a settings table has no rows.
    const [def] = await tx`select kind, data_source from table_def where name = ${table}`
    if (!appTable && (!def || def.data_source || def.kind === 'settings')) continue
    const targetMeta = await getMeta(table)
    const [exists] = await tx`select 1 from ${tx(await tableRelation(table))}
      where ${tx(targetMeta.row_key)} = ${name} for key share`
    if (!exists) throw new AppError('NotFoundError', `${table} ${name} not found`)
    if (appTable) await getDoc(table, name, user)
  }
}

// PERM-005: gate a concrete row against the user's Data Scopes.
export async function assertUserPermissions(
  user: string,
  meta: TableMeta,
  row: RowValues,
) {
  if (await isPrivileged(user)) return
  const map = await getScopeMap(user)
  if (!map.size) return
  const linkFields = meta.columns
    .filter((f) => f.column_type === 'Reference')
    .map((f) => ({ column_name: f.column_name, reference_table: f.reference_table }))
  checkUserPermissions(user, meta.name, linkFields, row, map)
}

// PERM-007: a child row is only as readable as the row it hangs on. A grant
// on a sub_table Table says "may read rows of this shape" — it never says
// WHICH rows, because child rows have no standing of their own. Without this,
// an own_rows_only grant on the parent leaks the moment someone reads the
// child directly: the child's created_by is whoever saved the parent, and the
// row is served. Sub-tables never hang off a source-bound Table (the engine
// refuses that shape), so the parent always has a physical row to judge.
async function assertParentReadable(row: RowValues, user: string) {
  const parentType = row.parenttype ? String(row.parenttype) : ''
  const parentRowId = row.parent ? String(row.parent) : ''
  // An orphan has no parent to defer to; the child's own grant governs.
  if (!parentType || !parentRowId) return
  if (await isSharedWith(user, parentType, parentRowId, 'read')) return
  const parentMeta = await getMeta(parentType)
  const [parent] = await sql`
    select * from ${sql(await tableRelation(parentType))}
    where ${sql(parentMeta.row_key)} = ${parentRowId}`
  if (!parent) return
  await assertPermission(user, parentType, 'read')
  await assertDocPermission(user, parentType, 'read', String(parent.created_by))
  await assertUserPermissions(user, parentMeta, parent as RowValues)
}

// #342: a comment or an edit opens only for someone who may open its row;
// an edit also needs every column of that row, unless the row is shared with
// them (a share shows every column). The row's activity is the way in for
// everyone else. Privileged callers pass, as everywhere.
async function assertAttachedRowReadable(table: string, row: RowValues, user: string) {
  if (await isPrivileged(user)) return
  const refTable = row.ref_table ? String(row.ref_table) : ''
  const refName = row.ref_name ? String(row.ref_name) : ''
  if (!refTable || !refName) return
  const refused = () => new AppError('PermissionError', `No read permission on this ${table} row for ${user}`)
  const refMeta = await getMeta(refTable).catch(() => null)
  if (!refMeta) throw refused()
  try {
    await getDoc(refTable, refName, user)
  } catch (err) {
    if (err instanceof AppError) throw refused()
    throw err
  }
  if (table === 'Version' && !(await isSharedWith(user, refTable, refName, 'read')) && !(await seesEveryColumn(user, refMeta)))
    throw refused()
}

// META-007/DOC-005: extract Sub-table column arrays from the payload; they are
// saved as child rows in the same transaction as the parent.
function pickChildInputs(meta: TableMeta, values: RowValues) {
  const out: { columnName: string; childTable: string; rows: RowValues[] }[] = []
  for (const f of meta.columns) {
    if (f.column_type !== 'Sub-table') continue
    const raw = own(values, f.column_name)
    if (raw === undefined) continue
    if (!Array.isArray(raw))
      throw new AppError('ValidationError', 'Invalid child table payload', {
        [f.column_name]: `${f.column_name} must be an array of rows`,
      })
    // saveChildren applies child rows by row_id, so a repeated id would
    // overwrite one stored row twice and delete another. Never valid.
    const seen = new Set<string>()
    const repeated: Record<string, string> = {}
    for (const [i, r] of (raw as unknown[]).entries()) {
      const id = r && typeof r === 'object' ? (r as RowValues)[ROW_KEY] : null
      if (id == null) continue
      if (seen.has(String(id))) repeated[`${f.column_name}.${i}.${ROW_KEY}`] = 'Repeated row id'
      seen.add(String(id))
    }
    if (Object.keys(repeated).length)
      throw new AppError('ValidationError', `Invalid values for ${meta.name}`, repeated)
    out.push({ columnName: f.column_name, childTable: f.row_table!, rows: raw as RowValues[] })
  }
  return out
}

// #231: `reqd: true` on a Sub-table column means what it means on a scalar
// column — the row cannot be created without at least one child row.
// The scalar rule lives in the metadata-generated zod schema, but that layer
// cannot carry this one: tableSchemaToZod drops Sub-table columns from its
// shape, and pickFieldValues strips them from the payload before
// validateValues ever runs, so a schema-level rule would either fire on every
// save (the server never hands zod the key) or force child arrays through the
// whole scalar pipeline — defaults, tier stripping, the null backfill, dbRow
// construction — only to be filtered out again. So it is enforced here, beside
// the children handling that owns the arrays, and raised as the same
// field-keyed ValidationError a missing reqd scalar raises (417, fields keyed
// by column name, message 'Required') so every renderer treats them alike.
//
// Update mirrors the scalar partial-update rule exactly: an absent key means
// "children untouched" and is no violation; a key present as [] is the caller
// clearing a required grid, and is refused. A present non-array still falls
// through to pickChildInputs' shape error.
function assertRequiredChildren(
  meta: TableMeta,
  values: RowValues,
  mode: 'insert' | 'update',
): void {
  const errors: Record<string, string> = {}
  for (const f of meta.columns) {
    if (f.column_type !== 'Sub-table' || !f.reqd) continue
    const raw = own(values, f.column_name)
    if (raw === undefined) {
      if (mode === 'insert') errors[f.column_name] = 'Required'
      continue
    }
    if (Array.isArray(raw) && raw.length === 0) errors[f.column_name] = 'Required'
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', `Invalid values for ${meta.name}`, errors)
}

// #437: the columns of an ordinary Table that grant access — a Sub-table of
// a security Table (Person.roles -> Has Role) and a Person's enabled flag —
// change only for a System Manager, whatever the writer's grant on the
// parent. Unchanged values ride along, so a form that echoes them back still
// saves. `existing` is null on insert, where any access-granting child row is
// a change. `trusted` is the save's skipPermissions flag, which never counts
// as privilege here.
async function assertAccessColumnsUnchanged(
  tx: typeof sql,
  meta: TableMeta,
  values: RowValues,
  existing: RowValues | null,
  user: string,
  trusted: boolean,
  writeTiers: Tiers,
): Promise<void> {
  const changed: string[] = []
  for (const input of pickChildInputs(meta, values)) {
    if (!(await isSecurityTable(input.childTable))) continue
    if (existing === null) {
      if (input.rows.length) changed.push(input.columnName)
      continue
    }
    const childMeta = await getMeta(input.childTable)
    const childTiers = await childWriteTiers(user, writeTiers, childMeta.name)
    const cols = childMeta.columns.filter((f) => !NO_COLUMN_TYPES.has(f.column_type))
    const key = (r: RowValues) => JSON.stringify(cols.map((f) => (own(r, f.column_name) == null ? '' : String(r[f.column_name]))))
    const current = await tx`
      select * from ${tx(await tableRelation(childMeta.name))}
      where parent = ${String(existing[meta.row_key] ?? existing[ROW_KEY])} and parenttype = ${meta.name}
        and parentfield = ${input.columnName}`
    // Judge the rows as saveChildren applies them: a payload row whose row_id
    // names a stored row updates that row, any other row is an insert, and a
    // stored row the payload does not name is deleted. Unchanged means every
    // stored row is named once with its values as stored, and nothing else.
    // Values are compared as saveChildren will write them (the same
    // defaulting and validation), over the stored row, so a value that only
    // looks the same before validation cannot pass. A row that fails
    // validation counts as a change.
    const stored = new Map(current.map((r) => [String(r[childMeta.row_key]), r as RowValues]))
    const named = new Set<string>()
    const same = input.rows.every((r) => {
      const id = r[ROW_KEY] == null ? null : String(r[ROW_KEY])
      if (id === null || !stored.has(id) || named.has(id)) return false
      named.add(id)
      let written: RowValues
      try {
        written = { ...stored.get(id)!, ...childFieldValues(childMeta, r, 'update', childTiers) }
      } catch {
        // A row that fails validation counts as a change; the save that
        // follows meets the same failure and reports it.
        return false
      }
      return key(stored.get(id)!) === key(written)
    })
    if (!same || named.size !== stored.size) changed.push(input.columnName)
  }
  if (meta.name === 'Person' && 'enabled' in values) {
    // Judged as the database will store it. The driver writes any value that
    // is not `true` as false, so a script's "true" or 1 would read as
    // unchanged here and still disable the person. Only a real boolean, or
    // the stored value left as it is, may be written.
    const stored = existing === null ? undefined : existing.enabled
    if (values.enabled !== stored && typeof values.enabled !== 'boolean')
      throw new AppError('ValidationError', `Invalid values for ${meta.name}`, { enabled: 'must be true or false' })
    if (existing !== null && values.enabled !== stored) changed.push('enabled')
  }
  if (meta.name === 'Person' && 'expects_google_sign_in' in values) {
    // #473: lets the first Google sign-in with the person's own address link
    // to them, so it is access like `enabled` — judged the same way, and on a
    // new person too (switching it on there is the whole point).
    const value = values.expects_google_sign_in
    const stored = existing === null ? false : existing.expects_google_sign_in === true
    if (value != null && typeof value !== 'boolean')
      throw new AppError('ValidationError', `Invalid values for ${meta.name}`, { expects_google_sign_in: 'must be true or false' })
    if ((value === true) !== stored) {
      // Turning it on adds a way in; so does turning it off and on again. A
      // test-mode or preview session may do neither, whoever it belongs to.
      if (!sessionMayAddWayIn())
        throw new AppError('PermissionError', 'Not allowed from this sign-in. Sign in again normally to change how this account signs in.')
      changed.push('expects_google_sign_in')
    }
  }
  if (!changed.length) return
  if (!trusted && (await isPrivileged(user))) return
  throw securityRefusal(`a ${meta.name}'s ${changed.join(' or ')}`)
}

// The column values saveChildren writes for one payload row.
// #341: as readerFor, for writes — the parent's grant or the sub-table's own
// reaches a restricted child column. Basic columns stay writable whatever the
// tier grant says: whether this writer may save these child rows at all was
// already settled on the parent (a create-only grant carries no write tier).
async function childWriteTiers(user: string, parentWriteTiers: Tiers, childTable: string): Promise<Tiers> {
  return new Set(['basic', ...parentWriteTiers, ...(await permittedTiers(user, childTable, 'write'))])
}

// Tiers are stripped before defaults on insert (a hidden column still gets
// its default) and after them on update (a default never lands on a stored
// value the writer could not see).
function childFieldValues(childMeta: TableMeta, row: RowValues, mode: 'insert' | 'update', writeTiers: Tiers): RowValues {
  const strip = (values: RowValues) => stripUnwritableFields(childMeta.columns, writeTiers, values)
  const values = mode === 'insert'
    ? applyDefaults(childMeta, strip(pickFieldValues(childMeta, row)))
    : strip(applyDefaults(childMeta, pickFieldValues(childMeta, row)))
  return validateValues(childMeta, values, mode)
}

async function saveChildren(
  tx: typeof sql,
  parentMeta: TableMeta,
  parentRowId: string,
  input: { columnName: string; childTable: string; rows: RowValues[] },
  user: string,
  parentWriteTiers: Tiers,
) {
  const childMeta = await getMeta(input.childTable)
  // #341: a child column above the writer's tier is dropped, as on the
  // parent — so a form that was never shown it cannot overwrite or set it.
  const writeTiers = await childWriteTiers(user, parentWriteTiers, childMeta.name)
  const table = await tableRelation(childMeta.name)
  const childKey = childMeta.row_key
  const existing = await tx`
    select ${tx(childKey)} from ${tx(table)}
    where parent = ${parentRowId} and parenttype = ${parentMeta.name}
      and parentfield = ${input.columnName}`
  const existingIds = new Set(existing.map((r) => r[childKey] as string))
  const keep = new Set<string>()
  const errors: Record<string, string> = {}

  for (const [i, row] of input.rows.entries()) {
    const rowId = row[ROW_KEY]
    const isExisting = rowId != null && existingIds.has(String(rowId))
    let fieldValues: RowValues
    try {
      fieldValues = childFieldValues(childMeta, row, isExisting ? 'update' : 'insert', writeTiers)
    } catch (err) {
      // childFieldValues refuses only field by field; anything else is a bug.
      if (!(err instanceof AppError) || !err.fields) throw err
      for (const [k, v] of Object.entries(err.fields))
        errors[`${input.columnName}.${i}.${k}`] = v
      continue
    }
    await validateLinks(tx, childMeta, fieldValues, `${input.columnName}.${i}.`)
    const now = new Date()
    if (isExisting) {
      keep.add(String(rowId))
      await tx`update ${tx(table)} set ${tx({
        ...fieldValues,
        position: i + 1,
        updated_at: now,
        updated_by: user,
      })} where ${tx(childKey)} = ${String(rowId)}`
    } else {
      await tx`insert into ${tx(table)} ${tx({
        [childKey]: hashRowId(),
        created_by: user,
        updated_by: user,
        created_at: now,
        updated_at: now,
        status: 'draft',
        position: i + 1,
        parent: parentRowId,
        parenttype: parentMeta.name,
        parentfield: input.columnName,
        ...fieldValues,
      })}`
    }
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', `Invalid child rows for ${input.columnName}`, errors)

  // Rows omitted from the payload are deleted — the payload is authoritative.
  const remove = [...existingIds].filter((n) => !keep.has(n))
  if (remove.length)
    await tx`delete from ${tx(table)} where ${tx(childKey)} in ${tx(remove)}`
}

// Credential columns that must NEVER be serialized, even though some are
// declared as (hidden) Columns for storage. Everything not listed here
// and not a standard column or Column is dropped too.

// Raw table columns carry server-internal state. Only standard columns and
// declared (non-sensitive) Columns leave through the API, regardless of
// the caller's tier.
function stripInternalColumns(meta: TableMeta, row: RowValues): RowValues {
  const known = new Set<string>(['table', ...STANDARD_COLUMNS, ...meta.columns.map((f) => f.column_name)])
  const out: RowValues = {}
  // #132: the single physical→wire crossing. Storage may key the row under a
  // different column (only `Table` does, see meta.ts); everything above this
  // line — API responses, the Admin, tests — sees `row_id` and nothing else.
  if (meta.row_key !== ROW_KEY && Object.hasOwn(row, meta.row_key)) out[ROW_KEY] = row[meta.row_key]
  for (const [k, v] of Object.entries(row))
    if (known.has(k) && !SENSITIVE_COLUMNS.has(k)) out[k] = v
  return out
}

// The whole row with its sub-table rows, every tier included. Only the
// server's own consumers (hooks, assignment rules) take it as it is; anything
// a person or another system sees passes through restrictRow first.
async function loadChildren(meta: TableMeta, row: RowValues): Promise<RowValues> {
  for (const f of meta.columns) {
    if (f.column_type !== 'Sub-table') continue
    const childMeta = await getMeta(f.row_table!)
    const rows = await sql`
      select * from ${sql(await tableRelation(f.row_table!))}
      where parent = ${String(row[meta.row_key] ?? row[ROW_KEY])}
        and parenttype = ${meta.name}
        and parentfield = ${f.column_name}
      order by position`
    row[f.column_name] = rows.map((r) => stripInternalColumns(childMeta, r as RowValues))
  }
  return stripInternalColumns(meta, row)
}

// Table/Column writes must go through the table engine (runs DDL);
// the generic row path would silently skip table changes.
const ENGINE_MANAGED = new Set(['Table', 'Column'])

// IMP-007: validation-only pass for dry-run imports — the same field
// filtering, defaults, and zod validation an insert runs, plus the checks a
// provided/required name would hit, with no writes. Automation triggers and
// tier stripping do not run here, so a trigger can still reject at real
// import time; the dry run catches everything schema-level.
// The import action refuses source-bound Tables before it gets here.
export async function checkRowForInsert(meta: TableMeta, values: RowValues): Promise<void> {
  validateValues(meta, applyDefaults(meta, pickFieldValues(meta, values)), 'insert')
  // #231: the real import inserts through saveDoc, so the dry run has to
  // apply the same required-children rule or it would pass rows the import
  // then refuses.
  assertRequiredChildren(meta, values, 'insert')
  const rowId = String(values[ROW_KEY] ?? '').trim()
  if (meta.id_pattern === 'prompt' && !rowId)
    throw new AppError('ValidationError', `${meta.name} requires a Row ID`, {
      [ROW_KEY]: 'Row ID is required',
    })
  if (rowId) {
    const [exists] = await sql`
      select 1 from ${sql(await tableRelation(meta.name))}
      where ${sql(meta.row_key)} = ${rowId}`
    if (exists) throw new AppError('ConflictError', `${meta.name} ${rowId} already exists`)
  }
}

// UPS-R1: the dry-run counterpart for rows an upsert will UPDATE — the same
// field filtering and zod validation the update runs (partial schema: reqd
// columns may stay untouched on the matched row), no writes. Insert-only
// checks (name conflicts, prompt-requires-name) deliberately absent.
export function validateRowForUpdate(meta: TableMeta, values: RowValues): void {
  validateValues(meta, pickFieldValues(meta, values), 'update')
}

interface SaveOptions {
  // WEB-002/003: the web-form surface is server-controlled (whitelisted columns
  // on one configured Table), so it may insert on behalf of a session user
  // who holds no create Permission — the row still gets that user as
  // created_by, which is what makes own_rows_only portals work. Never expose
  // this to callers that pass through arbitrary client input.
  skipPermissions?: boolean
}

export function saveDoc(...args: Parameters<typeof saveDocImpl>) {
  return appOperation(() => saveDocImpl(...args))
}
// #432: the public save. A system-written Table is refused here, ahead of any
// permission check, so no principal's bypass reaches the write.
async function saveDocImpl(
  table: string,
  values: RowValues,
  user = 'Administrator',
  mode: 'upsert' | 'insert' = 'upsert',
  opts: SaveOptions = {},
): Promise<RowValues> {
  assertNotSystemWritten(await getMeta(table), mode === 'insert' ? 'created' : 'saved')
  return writeDoc(table, values, user, mode, opts)
}

// #432: the trusted path for the server's own writers into a system-written
// Table (the import logger today), reached by importing it, never through any
// route, action or script. A plain insert of exactly the given columns: no
// hooks, no Server Scripts, no defaults, no validation — nothing a person can
// configure may rewrite, block or drop the record.
export async function saveSystemRow(table: string, values: RowValues, actor: string): Promise<RowValues> {
  const meta = await getMeta(table)
  if (!meta.system_written)
    throw new AppError('ValidationError', `${table} is not system-written; use saveDoc`)
  const known = new Set(meta.columns.filter((f) => !NO_COLUMN_TYPES.has(f.column_type)).map((f) => f.column_name))
  const unknown = Object.keys(values).filter((k) => !known.has(k) && k !== ROW_KEY)
  if (unknown.length) throw new AppError('ValidationError', `Unknown ${table} columns: ${unknown.join(', ')}`)
  const row: RowValues = {}
  for (const [k, v] of Object.entries(values)) if (v !== undefined && k !== ROW_KEY) row[k] = v
  // created_at/updated_at are left to the column default, now(): history is
  // dated by the database clock, the same clock that dates its Table, so a
  // skewed app clock can never make a record look older than its Table.
  const [saved] = await sql`insert into ${sql(await tableRelation(table))} ${sql({
    ...row,
    [meta.row_key]: String(values[ROW_KEY] ?? '') || hashRowId(),
    created_by: actor,
    updated_by: actor,
    status: 'draft',
    position: 0,
  } as unknown as Record<string, never>)} returning *`
  return { table, ...(saved as RowValues) }
}

async function writeDoc(
  table: string,
  values: RowValues,
  user: string,
  mode: 'upsert' | 'insert',
  opts: SaveOptions,
): Promise<RowValues> {
  const meta = await getMeta(table)
  if (ENGINE_MANAGED.has(table))
    throw new AppError(
      'ValidationError',
      `${table} rows are managed via /api/table`,
    )
  await assertSecurityWriter(table, user, { trusted: opts.skipPermissions })
  if (isBound(meta)) return saveBoundDoc(meta, values, user, mode)
  if (meta.kind === 'settings') return saveSingle(table, values, user)
  if (meta.kind === 'sub_table')
    throw new AppError(
      'ValidationError',
      `${table} is a child Table; save it through its parent`,
    )
  if (values[ROW_KEY] != null && values[ROW_KEY] !== '') {
    const [exists] = await sql`
      select 1 from ${sql(await tableRelation(table))}
      where ${sql(meta.row_key)} = ${String(values[ROW_KEY])}`
    if (exists) {
      if (mode === 'insert')
        throw new AppError('ConflictError', `${table} ${values[ROW_KEY]} already exists`)
      return updateDoc(meta, String(values[ROW_KEY]), values, user, Boolean(opts.skipPermissions))
    }
    // In upsert mode an unknown name on a generated-id Table is almost
    // certainly a mistyped update — refuse it. Insert mode is different:
    // the caller is explicitly creating, so the supplied id is intent
    // (UPS-R4) and resolveName adopts it verbatim.
    if (meta.id_pattern !== 'prompt' && values.amended_from == null && mode !== 'insert')
      throw new AppError('NotFoundError', `${table} ${values[ROW_KEY]} not found`)
  }
  if (!opts.skipPermissions) {
    await assertPermission(user, table, 'create')
    await assertUserPermissions(user, meta, values)
  }
  const writeTiers = opts.skipPermissions
    ? new Set<'basic' | 'restricted'>(['basic', 'restricted'])
    : await permittedTiers(user, table, 'write')
  const fieldValues = validateValues(
    meta,
    applyDefaults(meta, stripUnwritableFields(meta.columns, writeTiers, pickFieldValues(meta, values))),
    'insert',
  )
  assertRequiredChildren(meta, values, 'insert')
  // SLA: stamp response/resolution deadlines from the active SLA (if any)
  // before the row is written, so they are part of the insert itself.
  await applySla(meta, fieldValues)
  // WF-003: when a workflow governs this Table, every row starts at the
  // workflow's initial state — a caller can't smuggle in a later state.
  {
    const wf = await getActiveWorkflow(meta.name)
    if (wf?.states.length) {
      const sf = stateField(wf)
      if (meta.columns.some((f) => f.column_name === sf)) fieldValues[sf] = wf.states[0].state
    }
  }

  const childInputs = pickChildInputs(meta, values)
  const tbl = await tableRelation(table)
  let attemptedRow: RowValues = {}
  const [saved] = await afterCommitOf(() => sql
    .begin(async (tx) => {
      const stx = tx as unknown as typeof sql
      await holdManagedSet(stx, meta.name)
      const rowId = await resolveRowId(stx, meta, values)
      const now = new Date()
      const row: RowValues = {
        [ROW_KEY]: rowId,
        created_by: user,
        updated_by: user,
        created_at: now,
        updated_at: now,
        status: 'draft',
        position: 0,
        ...fieldValues,
      }
      // Expose child rows to hooks (validate/before_save) under their
      // column names; columnValues ignores non-scalar keys when building the row.
      for (const ci of childInputs) row[ci.columnName] = ci.rows
      const ctx: HookContext = { row, meta, user, isNew: true, tx: stx }
      await runHooks('before_insert', ctx)
      await runHooks('before_validate', ctx)
      await runHooks('validate', ctx)
      await runDocEventScripts('validate', meta.name, ctx.row, ctx.tx)
      await runHooks('before_save', ctx)
      await runDocEventScripts('before_save', meta.name, ctx.row, ctx.tx)
      // Hooks may add or replace Sub-table arrays on ctx.row (an app hook
      // snapshotting template items into a new row, say) — re-pick from the
      // hooked row so what saves is what the chain left behind.
      const finalChildInputs = pickChildInputs(meta, row)
      // #437: judged on the row the hooks and scripts leave behind, the one
      // that is written — not on the payload.
      await assertAccessColumnsUnchanged(stx, meta, row, null, user, Boolean(opts.skipPermissions), writeTiers)
      const dbRow = {
        ...columnValues(meta, row),
        [meta.row_key]: String(row[ROW_KEY]),
        created_by: row.created_by,
        updated_by: row.updated_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        status: row.status,
        position: row.position,
      }
      await lockCoreDocumentTargets(stx, meta, dbRow, user)
      await validateLinks(stx, meta, dbRow)
      attemptedRow = dbRow
      const inserted = await tx`insert into ${tx(tbl)} ${tx(dbRow as unknown as Record<string, never>)} returning *`
      // #465 D5: a new row under a locked row's id would set its locked fields.
      await assertManagedUnchanged(stx, meta, String(rowId), null, inserted[0] as RowValues, user)
      for (const input of finalChildInputs)
        await saveChildren(stx, meta, rowId, input, user, writeTiers)
      ctx.row = { ...(inserted[0] as RowValues) }
      await runHooks('after_insert', ctx)
      await runHooks('after_save', ctx)
      await runHooks('on_update', ctx)
      await runDocEventScripts('after_save', meta.name, ctx.row, ctx.tx)
      return inserted
    })
    .catch((err) => mapDbError(meta, err, attemptedRow.ref_table)))
  const insertResult = await loadChildren(meta, { table, ...(saved as RowValues) })
  // EML-004: fire matching email rules post-commit. A save covers inserts too,
  // so both on_create and on_save rules are evaluated here.
  await afterDocumentCommit(async () => {
    await evaluateEmailRules('on_create', meta.name, insertResult)
    await evaluateEmailRules('on_save', meta.name, insertResult)
    await notifyApproversOfNewRow(meta.name, insertResult, user)
    await evaluateAssignmentRules(meta.name, insertResult)
    await evaluateWebhooks('after_insert', meta.name, insertResult)
    await runHooks('after_commit', { row: insertResult, meta, user, isNew: true, tx: sql })
  })
  return insertResult
}

// EDS-6: the write path for source-bound Tables. Hooks run control-side
// (design doc §3.1: "hooks always run on the core Postgres side"), the write
// itself is one statement on the source, and only mapped columns present in
// the payload are ever written (BV2!: CLI-owned columns survive untouched).
// No versions, no children, no submit lifecycle — those are control-DB
// concepts a foreign row doesn't have.
async function saveBoundDoc(
  meta: TableMeta,
  values: RowValues,
  user: string,
  mode: 'upsert' | 'insert',
): Promise<RowValues> {
  const ctx = await writableContext(meta)
  const providedName =
    values[ROW_KEY] == null || values[ROW_KEY] === '' ? null : String(values[ROW_KEY])
  // Authorization BEFORE any statement reaches the source, and through the
  // bound gate: an own_rows grant can never authorize a table with no owner
  // column (review finding 1). insert-mode (or no name) is a create; a
  // named upsert is a write.
  await assertBoundScope(meta, user, mode === 'insert' || !providedName ? 'create' : 'write')
  if (providedName) {
    const existing = await ctx.driver.getDoc(ctx.bind, providedName)
    if (existing) {
      if (mode === 'insert')
        throw new AppError('ConflictError', `${meta.name} ${providedName} already exists`)
      return updateBoundDoc(meta, ctx, providedName, mapRowOut(ctx.bind, existing), values, user)
    }
    if (mode !== 'insert')
      throw new AppError('NotFoundError', `${meta.name} ${providedName} not found`)
  }
  // PERM-005: Data Scopes judge the incoming Reference values exactly as on
  // a native insert.
  await assertUserPermissions(user, meta, values)
  const writeTiers = await permittedTiers(user, meta.name, 'write')
  const fieldValues = validateValues(
    meta,
    applyDefaults(meta, stripUnwritableFields(meta.columns, writeTiers, pickFieldValues(meta, values))),
    'insert',
  )
  const row: RowValues = { [ROW_KEY]: providedName, status: 'draft', ...fieldValues }
  const hctx: HookContext = { row, meta, user, isNew: true, tx: sql }
  await runHooks('before_insert', hctx)
  await runHooks('before_validate', hctx)
  await runHooks('validate', hctx)
  await runHooks('before_save', hctx)
  // Re-judge the FINALIZED row: defaults and hooks can set Reference values
  // the raw payload never carried (review finding 2).
  await assertUserPermissions(user, meta, hctx.row)
  const inserted = await ctx.driver
    .insert(ctx.bind, mapValuesIn(ctx.bind, columnValues(meta, hctx.row)), providedName)
    .catch((err) => explainRefusal(meta, ctx.bind, err))
  const doc = mapRowOut(ctx.bind, inserted)
  hctx.row = { ...doc }
  await runHooks('after_insert', hctx)
  await runHooks('after_save', hctx)
  await runHooks('on_update', hctx)
  const result: RowValues = { table: meta.name, ...doc }
  await evaluateEmailRules('on_create', meta.name, result)
  await evaluateEmailRules('on_save', meta.name, result)
  await evaluateWebhooks('after_insert', meta.name, result)
  return result
}

// A server-side caller usually echoes back the `updated_at` it loaded, which
// comes off the driver as a Date. String(Date) truncates to whole seconds, so
// any row whose stamp carries milliseconds would fail its own echo; normalize
// through toISOString instead. HTTP callers already send an ISO string.
function expectedStamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

// EDS-8, 'modified' mode: when the source has a mapped modified column the
// client must echo the updated_at it loaded, exactly like native updates.
// Without one, updates are last-write-wins; the Admin row form says so (#328).
async function updateBoundDoc(
  meta: TableMeta,
  ctx: Awaited<ReturnType<typeof writableContext>>,
  name: string,
  current: RowValues,
  values: RowValues,
  user: string,
): Promise<RowValues> {
  if (ctx.bind.modified && values.updated_at == null)
    throw new AppError(
      'ValidationError',
      'Updates must include the updated_at timestamp of the loaded row',
    )
  // Re-asserted for direct callers; own_rows can never authorize a bound
  // write (finding 1). Data Scopes judge the row as loaded — and again
  // below, after hooks, as it will be written.
  await assertBoundScope(meta, user, 'write')
  await assertUserPermissions(user, meta, current)
  const writeTiers = await permittedTiers(user, meta.name, 'write')
  const fieldValues = validateValues(
    meta,
    stripUnwritableFields(meta.columns, writeTiers, pickFieldValues(meta, values)),
    'update',
  )
  const row: RowValues = { ...current, ...fieldValues }
  const hctx: HookContext = { row, old: current, meta, user, isNew: false, tx: sql }
  await runHooks('before_validate', hctx)
  await runHooks('validate', hctx)
  await runHooks('before_save', hctx)
  // BV2!: write only fields present in the payload — plus any a hook
  // actually changed — so CLI-owned columns the Admin never touched survive.
  const toWrite: RowValues = {}
  const norm = (v: unknown) => JSON.stringify(v instanceof Date ? v.toISOString() : (v ?? null))
  for (const f of meta.columns) {
    if (NO_COLUMN_TYPES.has(f.column_type)) continue
    const k = f.column_name
    if (k in fieldValues) toWrite[k] = k in hctx.row ? hctx.row[k] : fieldValues[k]
    else if (k in hctx.row && norm(hctx.row[k]) !== norm(current[k])) toWrite[k] = hctx.row[k]
  }
  const sourceValues = mapValuesIn(ctx.bind, toWrite)
  // PERM-005 (review finding 2): the row as it will EXIST after this write
  // must also sit inside the caller's Data Scopes — otherwise a permitted
  // row could be edited (by the payload or by a hook) into a Reference
  // value the caller may not access.
  await assertUserPermissions(user, meta, { ...current, ...toWrite })
  const expect = ctx.bind.modified ? expectedStamp(values.updated_at) : null
  const updated = await ctx.driver
    .update(ctx.bind, name, sourceValues, expect)
    .catch((err) => explainRefusal(meta, ctx.bind, err))
  if (updated === 'missing')
    throw new AppError('NotFoundError', `${meta.name} ${name} not found`)
  if (updated === 'conflict')
    throw new AppError(
      'ConflictError',
      `${meta.name} ${name} has been modified after you loaded it`,
    )
  const doc = mapRowOut(ctx.bind, updated)
  hctx.row = { ...doc }
  await runHooks('after_save', hctx)
  await runHooks('on_update', hctx)
  const result: RowValues = { table: meta.name, ...doc }
  await evaluateEmailRules('on_save', meta.name, result, current)
  await evaluateWebhooks('on_update', meta.name, result)
  return result
}

// DOC-002: optimistic concurrency — the client must echo back the
// `updated_at` timestamp it loaded; a mismatch means someone else saved first.
async function updateDoc(
  meta: TableMeta,
  name: string,
  values: RowValues,
  user: string,
  trusted = false,
): Promise<RowValues> {
  const table = await tableRelation(meta.name)
  if (values.updated_at == null)
    throw new AppError(
      'ValidationError',
      'Updates must include the updated_at timestamp of the loaded row',
    )
  // A write-share grants full field access; otherwise honor tiers.
  const sharedWrite = await isSharedWith(user, meta.name, name, 'write')
  const writeTiers = sharedWrite
    ? new Set<'basic' | 'restricted'>(['basic', 'restricted'])
    : await permittedTiers(user, meta.name, 'write')
  const fieldValues = validateValues(
    meta,
    stripUnwritableFields(meta.columns, writeTiers, pickFieldValues(meta, values)),
    'update',
  )
  assertRequiredChildren(meta, values, 'update')
  // WF-003: the workflow-bound state field only changes through workflow
  // actions (apply_workflow_action) — a direct save changing it would bypass
  // the role-gated transitions.
  {
    const wf = await getActiveWorkflow(meta.name)
    if (wf) {
      const sf = stateField(wf)
      if (sf in fieldValues) {
        const [current] = await sql`
          select ${sql(sf)} as v from ${sql(table)} where ${sql(meta.row_key)} = ${name}`
        if (current && String(fieldValues[sf] ?? '') !== String(current.v ?? ''))
          throw new AppError(
            'ValidationError',
            `${sf} is controlled by workflow "${wf.row_id}" — use a workflow action to change it`,
          )
      }
    }
  }

  // Snapshot of the row before this save, for post-commit transition checks.
  let previous: RowValues | undefined
  let attemptedRow: RowValues = {}
  const saved = await afterCommitOf(() => sql
    .begin(async (tx) => {
      const stx = tx as unknown as typeof sql
      await holdManagedSet(stx, meta.name)
      const [existing] = await tx`
        select * from ${tx(table)} where ${tx(meta.row_key)} = ${name} for update`
      if (!existing)
        throw new AppError('NotFoundError', `${meta.name} ${name} not found`)
      previous = { ...(existing as RowValues) }
      // PERM-008: a share with write grants update even without role write.
      if (!sharedWrite) {
        await assertDocPermission(user, meta.name, 'write', String(existing.created_by))
        await assertUserPermissions(user, meta, existing as RowValues)
      }
      const dbModified = (existing.updated_at as Date).getTime()
      const sentModified = new Date(expectedStamp(values.updated_at)).getTime()
      if (Number.isNaN(sentModified) || dbModified !== sentModified)
        throw new AppError(
          'ConflictError',
          `${meta.name} ${name} has been modified after you loaded it`,
        )
      if ((existing.status as string) === 'submitted')
        throw new AppError(
          'ValidationError',
          `${meta.name} ${name} is submitted and cannot be modified (cancel it first)`,
        )
      if ((existing.status as string) === 'cancelled')
        throw new AppError(
          'ValidationError',
          `${meta.name} ${name} is cancelled and cannot be modified`,
        )
      const row: RowValues = { ...(existing as RowValues), ...fieldValues }
      // Expose child rows to hooks under their column names (see insert path).
      for (const ci of pickChildInputs(meta, values)) row[ci.columnName] = ci.rows
      const ctx: HookContext = {
        row,
        old: existing as RowValues,
        meta,
        user,
        isNew: false,
        tx: stx,
      }
      await runHooks('before_validate', ctx)
      await runHooks('validate', ctx)
      await runDocEventScripts('validate', meta.name, ctx.row, ctx.tx)
      await runHooks('before_save', ctx)
      await runDocEventScripts('before_save', meta.name, ctx.row, ctx.tx)
      // #437: neither a role grant nor a write-share opens access columns.
      // Judged on the row the hooks and scripts leave behind — the one that
      // is written — against the stored row.
      await assertAccessColumnsUnchanged(stx, meta, row, existing as RowValues, user, trusted, writeTiers)
      const dbRow = {
        ...columnValues(meta, row),
        updated_at: new Date(),
        updated_by: user,
      }
      await lockCoreDocumentTargets(stx, meta, { ...existing, ...dbRow }, user, existing as RowValues)
      await validateLinks(stx, meta, dbRow)
      attemptedRow = dbRow
      const [updated] = await tx`
        update ${tx(table)} set ${tx(dbRow)} where ${tx(meta.row_key)} = ${name} returning *`
      // #465 D5: judged on the row as written (after hooks and scripts)
      // against the row as stored, so an echoed locked value is no change.
      await assertManagedUnchanged(stx, meta, name, existing as RowValues, updated as RowValues, user)
      // Re-picked from the hooked row, as on insert. An absent key still
      // means "children untouched": the physical row spread into ctx.row
      // carries no Sub-table columns, so the key exists only if the payload
      // sent it or a hook set it.
      for (const input of pickChildInputs(meta, row))
        await saveChildren(stx, meta, name, input, user, writeTiers)
      await recordVersion(stx, meta, name, existing as RowValues, updated as RowValues, user)
      ctx.row = { ...(updated as RowValues) }
      await runHooks('after_save', ctx)
      await runHooks('on_update', ctx)
      await runDocEventScripts('after_save', meta.name, ctx.row, ctx.tx)
      return updated
    })
    .catch((err) => mapDbError(meta, err, attemptedRow.ref_table)))
  const updateResult = await loadChildren(meta, { table: meta.name, ...(saved as RowValues) })
  // EML-004: on_save rules fire post-commit; the pre-save snapshot lets a
  // conditional rule fire only when the value transitions into the match.
  await afterDocumentCommit(async () => {
    await evaluateEmailRules('on_save', meta.name, updateResult, previous)
    await evaluateWebhooks('on_update', meta.name, updateResult)
    await runHooks('after_commit', {
      row: updateResult, old: previous, meta, user, isNew: false, tx: sql,
    })
  })
  return updateResult
}

// DOC-009: record a field-level diff in the Version Table on every
// tracked update. Runs inside the save transaction.
const UNVERSIONED = new Set(['Version', 'Table', 'Column'])

async function recordVersion(
  tx: typeof sql,
  meta: TableMeta,
  name: string,
  before: RowValues,
  after: RowValues,
  user: string,
) {
  if (!meta.track_changes || UNVERSIONED.has(meta.name)) return
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null)
  const changed: [string, unknown, unknown][] = []
  for (const f of meta.columns) {
    if (NO_COLUMN_TYPES.has(f.column_type)) continue
    const b = norm(own(before, f.column_name))
    const a = norm(own(after, f.column_name))
    if (JSON.stringify(b) !== JSON.stringify(a)) changed.push([f.column_name, b, a])
  }
  if (!changed.length) return
  // #432: dated by the database's wall clock, like its Table, so a skewed
  // app clock never misdates history. clock_timestamp(), not now(): the
  // import's revert trail ties a version to its run by comparing against a
  // run start read from the same clock.
  const [{ at }] = await tx<{ at: Date }[]>`select clock_timestamp() as at`
  await tx`insert into version ${tx({
    [ROW_KEY]: hashRowId(),
    created_by: user,
    updated_by: user,
    created_at: at,
    updated_at: at,
    status: 'draft',
    position: 0,
    ref_table: meta.name,
    ref_name: name,
    data: { changed } as unknown as string,
  })}`
}

// DOC-007: status transitions. draft -> submit -> submitted -> cancel ->
// cancelled. Submitted rows are immutable; cancelled rows are terminal
// (until amend, DOC-008).
async function setStatus(
  table: string,
  name: string,
  from: 'draft' | 'submitted' | 'cancelled',
  to: 'draft' | 'submitted' | 'cancelled',
  event: 'on_submit' | 'on_cancel',
  user: string,
): Promise<RowValues> {
  const meta = await getMeta(table)
  assertNotSystemWritten(meta, event === 'on_submit' ? 'submitted' : 'cancelled')
  await assertSecurityWriter(table, user)
  if (!meta.is_submittable)
    throw new AppError('ValidationError', `${table} is not submittable`)
  const tbl = await tableRelation(table)
  const [saved] = await afterCommitOf(() => sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    const [existing] = await tx`
      select * from ${tx(tbl)} where ${tx(meta.row_key)} = ${name} for update`
    if (!existing)
      throw new AppError('NotFoundError', `${table} ${name} not found`)
    await assertDocPermission(
      user, table, event === 'on_submit' ? 'submit' : 'cancel', String(existing.created_by))
    await assertUserPermissions(user, meta, existing as RowValues)
    if ((existing.status as string) !== from)
      throw new AppError(
        'ValidationError',
        `${table} ${name} has status ${existing.status}; expected ${from}`,
      )
    // Order: before_submit/before_cancel run BEFORE the write and may
    // abort it; on_update fires after the write, then on_submit/on_cancel.
    const preCtx: HookContext = {
      row: { ...(existing as RowValues) },
      old: existing as RowValues,
      meta,
      user,
      isNew: false,
      tx: stx,
    }
    await runHooks(event === 'on_submit' ? 'before_submit' : 'before_cancel', preCtx)
    const [updated] = await tx`
      update ${tx(tbl)} set status = ${to}, updated_at = ${new Date()},
        updated_by = ${user}
      where ${tx(meta.row_key)} = ${name} returning *`
    const ctx: HookContext = {
      row: updated as RowValues,
      old: existing as RowValues,
      meta,
      user,
      isNew: false,
      tx: stx,
    }
    await runHooks('on_update', ctx)
    await runHooks(event, ctx)
    return [updated]
  }))
  const result = await loadChildren(meta, { table, ...(saved as RowValues) })
  // EML-004: fire matching email rules for this lifecycle event (post-commit).
  // The loaded row, not the raw one: internal columns never reach a template.
  await evaluateEmailRules(event as LifecycleEvent, table, result)
  // PLAT-005: fire webhooks for submit/cancel (post-commit).
  await evaluateWebhooks(event === 'on_submit' ? 'on_submit' : 'on_cancel', table, result)
  return result
}

export function submitDoc(table: string, name: string, user = 'Administrator') {
  return appOperation(() => setStatus(table, name, 'draft', 'submitted', 'on_submit', user))
}

export function cancelDoc(table: string, name: string, user = 'Administrator') {
  return appOperation(() => setStatus(table, name, 'submitted', 'cancelled', 'on_cancel', user))
}

// DOC-008: create a fresh draft from a cancelled row. The copy carries
// amended_from and a derived NAME-n; children are copied as new rows.
export function amendDoc(...args: Parameters<typeof amendDocImpl>) {
  return appOperation(() => amendDocImpl(...args))
}
async function amendDocImpl(
  table: string,
  name: string,
  user = 'Administrator',
): Promise<RowValues> {
  const meta = await getMeta(table)
  assertNotSystemWritten(meta, 'amended')
  await assertSecurityWriter(table, user)
  if (!meta.is_submittable)
    throw new AppError('ValidationError', `${table} is not submittable`)
  const source = await getDoc(table, name, user)
  if ((source.status as string) !== 'cancelled')
    throw new AppError('ValidationError', `${table} ${name} must be cancelled before amending`)
  await assertDocPermission(user, table, 'amend', String(source.created_by))

  const [{ count }] = await sql`
    select count(*)::int as count from ${sql(await tableRelation(table))}
    where amended_from = ${name}`
  const newRowId = `${name}-${(count as number) + 1}`

  const values: RowValues = { [ROW_KEY]: newRowId, amended_from: name }
  for (const f of meta.columns) {
    if (f.column_name === 'amended_from') continue
    if (f.column_type === 'Section Break' || f.column_type === 'Column Break') continue
    if (f.column_type === 'Sub-table') {
      const rows = (own(source, f.column_name) as RowValues[] | undefined) ?? []
      values[f.column_name] = rows.map((r) => {
        const copy: RowValues = {}
        for (const [k, v] of Object.entries(r))
          if (!(STANDARD_COLUMNS as readonly string[]).includes(k)) copy[k] = v
        return copy
      })
    } else {
      values[f.column_name] = own(source, f.column_name)
    }
  }
  return saveDoc(table, values, user)
}

// #559: deleting or renaming a row removes or re-points its child rows
// directly, outside saveChildren. A Sub-table marked decides_scope guards
// those rows as a save would. (A named security child such as a Person's
// roles goes with its parent, under the parent's own delete rule.)
async function assertChildRowsWritable(tx: typeof sql, meta: TableMeta, name: string, user: string): Promise<void> {
  for (const f of meta.columns) {
    if (f.column_type !== 'Sub-table' || !(await getMeta(f.row_table!)).decides_scope) continue
    const [held] = await tx`
      select 1 from ${tx(await tableRelation(f.row_table!))}
      where parent = ${name} and parenttype = ${meta.name} limit 1`
    if (held) await assertSecurityWriter(f.row_table!, user)
  }
}

// DOC-006: a row referenced by Reference columns anywhere cannot be deleted.
export function deleteDoc(...args: Parameters<typeof deleteDocImpl>) {
  return appOperation(() => deleteDocImpl(...args))
}
async function deleteDocImpl(
  table: string,
  name: string,
  user = 'Administrator',
  opts: { expectUpdatedAt?: string | null } = {},
): Promise<void> {
  const meta = await getMeta(table)
  assertNotSystemWritten(meta, 'deleted')
  await assertSecurityWriter(table, user)
  if (meta.kind === 'settings' || meta.kind === 'sub_table' || ENGINE_MANAGED.has(table))
    throw new AppError('ValidationError', `${table} rows cannot be deleted directly`)
  if (isBound(meta)) return deleteBoundDoc(meta, name, user, opts.expectUpdatedAt ?? null)
  await afterCommitOf(() => sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    await holdManagedSet(stx, meta.name)
    const [existing] = await tx`
      select * from ${tx(await tableRelation(table))} where ${tx(meta.row_key)} = ${name} for update`
    if (!existing)
      throw new AppError('NotFoundError', `${table} ${name} not found`)
    await assertDocPermission(user, table, 'delete', String(existing.created_by))
    await assertUserPermissions(user, meta, existing as RowValues)
    await assertRowNotManaged(stx, meta, name, user)
    if (meta.owner_app) {
      if (!opts.expectUpdatedAt || !Number.isFinite(Date.parse(opts.expectUpdatedAt))
        || new Date(existing.updated_at as string).getTime() !== Date.parse(opts.expectUpdatedAt))
        throw new AppError('ConflictError', `${table} ${name} has been modified after you loaded it; supply its current updated_at`)
      assertNothingRetained(table, name, await retainedDocumentCounts(stx, table, name))
    } else {
      // #321: a plain row keeps its comments, history, attachments and shares
      // by refusing the delete while it has any (links are checked below).
      assertNothingRetained(table, name, await retainedActivityCounts(stx, table, name))
    }
    if ((existing.status as string) === 'submitted')
      throw new AppError(
        'ValidationError',
        `${table} ${name} is submitted and cannot be deleted (cancel it first)`,
      )

    // Any Reference column in any Table pointing at this table blocks deletion.
    const linkFields = await tx`
      select parent, column_name from column_def
      where column_type = 'Reference' and reference_table = ${table}`
    for (const lf of linkFields) {
      const parentTable = lf.parent as string
      const [parentMeta] = await tx`
        select kind from table_def where name = ${parentTable}`
      if (!parentMeta || parentMeta.kind === 'settings') continue
      const parentKey = physicalRowKey(parentTable)
      const refCols = parentMeta.kind === 'sub_table'
        ? [parentKey, 'parent', 'parenttype']
        : [parentKey]
      const [ref] = await tx`
        select ${tx(refCols)} from ${tx(await tableRelation(parentTable))}
        where ${tx(lf.column_name as string)} = ${name} limit 1`
      if (ref) {
        const holder = parentMeta.kind === 'sub_table'
          ? `${ref.parenttype as string} ${ref.parent as string}`
          : `${parentTable} ${ref[parentKey] as string}`
        throw new AppError(
          'ValidationError',
          `Cannot delete ${table} ${name}: it is linked from ${holder}`,
        )
      }
    }

    const ctx: HookContext = {
      row: existing as RowValues,
      meta,
      user,
      isNew: false,
      tx: stx,
    }
    await runHooks('on_trash', ctx)

    // Remove this row's own child rows, then the row.
    await assertChildRowsWritable(stx, meta, name, user)
    for (const f of meta.columns) {
      if (f.column_type !== 'Sub-table') continue
      await tx`
        delete from ${tx(await tableRelation(f.row_table!))}
        where parent = ${name} and parenttype = ${table}`
    }
    await tx`delete from ${tx(await tableRelation(table))} where ${tx(meta.row_key)} = ${name}`
  }))
  // Post-commit: caches keyed on this row (e.g. a Data Source's pool and
  // the meta of Tables bound to it) may only be dropped once the delete is
  // actually visible to other connections.
  await afterDocumentCommit(() => runHooks('after_commit', {
    row: { [ROW_KEY]: name },
    meta,
    user,
    isNew: false,
    tx: sql,
  }))
}

// EDS-6: delete a bound row on the source. The link-integrity check runs
// over control-DB Tables only (a Reference from a native Table to this bound
// row still blocks deletion); the source's own FKs enforce themselves.
// expectUpdatedAt carries the revision the client loaded (finding 5: a
// positional csv row may shift under an outside edit — the delete must
// conflict, not splice whatever now sits at that position).
async function deleteBoundDoc(
  meta: TableMeta,
  name: string,
  user: string,
  expectUpdatedAt: string | null,
): Promise<void> {
  const ctx = await writableContext(meta)
  await assertBoundScope(meta, user, 'delete')
  // Where the binding HAS a revision, deleting requires it — exactly like
  // updates. Optional would leave the positional-csv hazard open to every
  // caller that simply omits it (review finding 5).
  if (ctx.bind.modified && expectUpdatedAt == null)
    throw new AppError(
      'ValidationError',
      'Deletes must include the updated_at timestamp of the loaded row',
      { updated_at: 'Required — pass ?updated_at= from the row you loaded' },
    )
  const existing = await ctx.driver.getDoc(ctx.bind, name)
  if (!existing) throw new AppError('NotFoundError', `${meta.name} ${name} not found`)
  await assertUserPermissions(user, meta, mapRowOut(ctx.bind, existing))
  const linkFields = await sql`
    select parent, column_name from column_def
    where column_type = 'Reference' and reference_table = ${meta.name}`
  for (const lf of linkFields) {
    const parentTable = lf.parent as string
    const [pm] = await sql`
      select kind, data_source from table_def where name = ${parentTable}`
    if (!pm || pm.kind === 'settings' || pm.data_source) continue
    const parentKey = physicalRowKey(parentTable)
    const [ref] = await sql`
      select ${sql(parentKey)} from ${sql(await tableRelation(parentTable))}
      where ${sql(lf.column_name as string)} = ${name} limit 1`
    if (ref)
      throw new AppError(
        'ValidationError',
        `Cannot delete ${meta.name} ${name}: it is linked from ${parentTable} ${ref[parentKey] as string}`,
      )
  }
  const hctx: HookContext = {
    row: mapRowOut(ctx.bind, existing),
    meta,
    user,
    isNew: false,
    tx: sql,
  }
  // #321: a connected row's comments, history, attachments and shares live
  // here; the delete is refused while it has any, as for a stored row.
  assertNothingRetained(meta.name, name, await retainedActivityCounts(sql, meta.name, name))
  await runHooks('on_trash', hctx)
  const outcome = await ctx.driver
    .remove(ctx.bind, name, expectUpdatedAt)
    .catch((err) => explainRefusal(meta, ctx.bind, err, name))
  if (outcome === 'missing')
    throw new AppError('NotFoundError', `${meta.name} ${name} not found`)
  if (outcome === 'conflict')
    throw new AppError(
      'ConflictError',
      `${meta.name} ${name} has been modified after you loaded it`,
    )
}

// DOC-012: rename a row's primary key and update every Reference that
// pointed at the old name — across all Tables and child tables — in one
// transaction. The row keeps all its other data and children, and its
// comments, history, attachments and shares (#509).
export function renameDoc(...args: Parameters<typeof renameDocImpl>) {
  return appOperation(() => renameDocImpl(...args))
}
async function renameDocImpl(
  table: string,
  oldName: string,
  newName: string,
  user = 'Administrator',
): Promise<RowValues> {
  const meta = await getMeta(table)
  assertNotSystemWritten(meta, 'renamed')
  await assertSecurityWriter(table, user)
  if (meta.kind === 'settings' || meta.kind === 'sub_table' || ENGINE_MANAGED.has(table))
    throw new AppError('ValidationError', `${table} rows cannot be renamed`)
  // person-identities: a User's id is the permanent person id (the warehouse
  // person_id); change the name or username instead. A trigger backs this up.
  // person-rename R1: an opaque id (a person's, a service account's) is
  // permanent — never renamed.
  if ((meta.id_pattern ?? '').startsWith('opaque:'))
    throw new AppError('ValidationError', `A ${meta.name}'s id is permanent and cannot be renamed; change its name instead`)
  if (isBound(meta))
    throw new AppError(
      'ValidationError',
      `${table} is bound to data source ${meta.data_source}; its primary keys belong to the source and cannot be renamed here`,
    )
  const target = newName.trim()
  if (!target) throw new AppError('ValidationError', 'A new Row ID is required', { [ROW_KEY]: 'Required' })
  if (target === oldName) return getDoc(table, oldName, user)

  await sql.begin(async (tx) => {
    const tbl = await tableRelation(table)
    await holdManagedSet(tx as unknown as typeof sql, null)
    const [existing] = await tx`
      select * from ${tx(tbl)} where ${tx(meta.row_key)} = ${oldName} for update`
    if (!existing) throw new AppError('NotFoundError', `${table} ${oldName} not found`)
    await assertDocPermission(user, table, 'write', String(existing.created_by))
    await assertUserPermissions(user, meta, existing as RowValues)
    const [clash] = await tx`select 1 from ${tx(tbl)} where ${tx(meta.row_key)} = ${target}`
    if (clash) throw new AppError('ConflictError', `${table} ${target} already exists`)
    // #465 D5: neither a locked row's id, nor the id a locked field refers
    // to (the cascade below would rewrite it), nor a locked row's id as the
    // new name.
    const stx = tx as unknown as typeof sql
    await assertRowNotManaged(stx, meta, oldName, user)
    await assertRowNotManaged(stx, meta, target, user)
    await assertNoManagedReference(stx, table, oldName, user)

    await assertChildRowsWritable(stx, meta, oldName, user)
    // Rename the row itself.
    await tx`update ${tx(tbl)} set ${tx(meta.row_key)} = ${target}, updated_at = now() where ${tx(meta.row_key)} = ${oldName}`

    // Re-point this row's own child rows to the new parent name.
    for (const f of meta.columns) {
      if (f.column_type !== 'Sub-table') continue
      await tx`
        update ${tx(await tableRelation(f.row_table!))} set parent = ${target}
        where parent = ${oldName} and parenttype = ${table}`
    }

    // Update every Reference column, in any Table, that points at this table.
    const linkFields = await tx`
      select parent, column_name from column_def
      where column_type = 'Reference' and reference_table = ${table}`
    for (const lf of linkFields) {
      const parentTable = lf.parent as string
      const [pm] = await tx`select kind from table_def where name = ${parentTable}`
      if (!pm || pm.kind === 'settings') continue
      const col = lf.column_name as string
      await tx`
        update ${tx(await tableRelation(parentTable))} set ${tx(col)} = ${target}
        where ${tx(col)} = ${oldName}`
    }

    // #509: and every record that names the row by id in plain text.
    await repointRowActivity(stx, table, oldName, target)
  })
  return getDoc(table, target, user)
}

export function getDoc(...args: Parameters<typeof getDocImpl>) {
  return appOperation(() => getDocImpl(...args))
}
async function getDocImpl(
  table: string,
  name: string,
  user = 'Administrator',
): Promise<RowValues> {
  const meta = await getMeta(table)
  if (meta.kind === 'settings') return getSingle(meta, user)
  if (isBound(meta)) {
    // EDS-5: single row by pk from the source; permission gate control-side
    // and BEFORE the foreign fetch (review finding 1). Bound rows have no
    // created_by, so own-rows scoping denies by design; Data Scopes judge
    // the fetched row exactly as natively.
    // A concrete share authorizes this pk on its own; otherwise the bound
    // gate runs BEFORE the source is contacted, so an own_rows-only caller
    // cannot make the server issue foreign lookups (review finding 8).
    const boundShared = await isSharedWith(user, table, name, 'read')
    if (!boundShared) await assertBoundScope(meta, user, 'read')
    const doc = await boundFetchDoc(meta, name)
    if (!doc) throw new AppError('NotFoundError', `${table} ${name} not found`)
    if (!boundShared) {
      await assertDocPermission(user, table, 'read', String(doc.created_by ?? ''))
      await assertUserPermissions(user, meta, doc)
    }
    const tiers = boundShared
      ? new Set<'basic' | 'restricted'>(['basic', 'restricted'])
      : await permittedTiers(user, table, 'read')
    return { table, ...filterReadFields(meta.columns, tiers, doc) }
  }
  const [row] = await sql`
    select * from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = ${name}`
  if (!row) throw new AppError('NotFoundError', `${table} ${name} not found`)
  // PERM-008: a direct share grants read even without role permission.
  const shared = await isSharedWith(user, table, name, 'read')
  if (!shared) {
    await assertPermission(user, table, 'read')
    await assertDocPermission(user, table, 'read', String(row.created_by))
    await assertUserPermissions(user, meta, row as RowValues)
    if (meta.kind === 'sub_table') await assertParentReadable(row as RowValues, user)
    if (ROW_ATTACHED_TABLES.has(meta.name)) await assertAttachedRowReadable(meta.name, row as RowValues, user)
  }
  // A share grants full field visibility; otherwise honor tiers, on the row
  // and on its sub-table rows alike (#341).
  const reader = shared ? FULL_READER : await readerFor(user, table, 'read')
  return restrictRow(meta, await loadChildren(meta, { table, ...(row as RowValues) }), reader)
}

// SET-001: read a Settings Table's one instance from the EAV store, applying
// column defaults for any value not yet set. Its name is the Table name.
async function getSingle(meta: TableMeta, user: string): Promise<RowValues> {
  await assertPermission(user, meta.name, 'read')
  const rows = await sql`select field, value from single_value where table_name = ${meta.name}`
  const stored = new Map(rows.map((r) => [r.field as string, r.value as string | null]))
  // A Settings Table holds exactly one row, and its Row ID is the Table name.
  const row: RowValues = {
    table: meta.name,
    [ROW_KEY]: meta.name,
    created_by: 'Administrator',
    status: 'draft',
  }
  for (const f of meta.columns) {
    if (NO_COLUMN_TYPES.has(f.column_type)) continue
    const raw = stored.has(f.column_name) ? (stored.get(f.column_name) ?? null) : (f.default_value ?? null)
    row[f.column_name] = coerceSingleValue(f.column_type, raw)
  }
  const readTiers = await permittedTiers(user, meta.name, 'read')
  return filterReadFields(meta.columns, readTiers, row)
}

// EAV values are stored as text; coerce back to the column's JS type.
function coerceSingleValue(columnType: string, raw: string | null): unknown {
  if (raw == null) return null
  switch (columnType) {
    case 'Int':
      return Number.parseInt(raw, 10)
    case 'Float':
    case 'Currency':
      return Number.parseFloat(raw)
    case 'Check':
      return raw === '1' || raw === 'true'
    default:
      return raw
  }
}

// SET-001: persist a Settings Table's values into the EAV store.
export function saveSingle(...args: Parameters<typeof saveSingleImpl>) {
  return appOperation(() => saveSingleImpl(...args))
}
async function saveSingleImpl(
  table: string,
  values: RowValues,
  user = 'Administrator',
): Promise<RowValues> {
  const meta = await getMeta(table)
  assertNotSystemWritten(meta, 'saved')
  await assertSecurityWriter(table, user)
  if (meta.kind !== 'settings') throw new AppError('ValidationError', `${table} is not a Settings Table`)
  await assertPermission(user, table, 'write')
  const writeTiers = await permittedTiers(user, table, 'write')
  const clean = validateValues(
    meta,
    stripUnwritableFields(meta.columns, writeTiers, pickFieldValues(meta, values)),
    'update',
  )
  // #465: one transaction, and a version like any other row's save, so a
  // settings change has history. Compared as stored text, both sides.
  await sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    const stored = async () => Object.fromEntries(
      (await stx`select field, value from single_value where table_name = ${table}`).map((r) => [r.field as string, r.value as string | null]))
    await holdManagedSet(stx, table)
    const before = await stored()
    for (const [field, value] of Object.entries(clean)) {
      const text = value == null ? null : typeof value === 'boolean' ? (value ? '1' : '0') : typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : String(value)
      await stx`
        insert into single_value ${stx({ table_name: table, field, value: text })}
        on conflict (table_name, field) do update set value = excluded.value`
    }
    const after = await stored()
    // #465 D5: a locked field, judged as stored text on both sides.
    await assertManagedUnchanged(stx, meta, table, before, after, user)
    await recordVersion(stx, meta, table, before, after, user)
  })
  return getDoc(table, table, user)
}
