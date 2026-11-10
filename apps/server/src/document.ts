import { readOnce } from './permission-reads'
import { randomBytes } from 'node:crypto'
import { opaqueId } from './opaque-id'
import { DEFAULT_ID_PATTERN, idFromColumn, namingColumn, tableSchemaToZod, zodFieldErrors, type RowCapabilities } from 'shared'
import { assertMandatoryAccess, hasMandatoryRowAccess } from './mandatory-access'
import { sql } from './db'
import { AppError, orWhenRefused } from './errors'
import { refusalSubject, tableWords } from './refusals'
import { sessionMayAddWayIn } from './session-context'
import { appOperation } from './app-lifecycle'
import { afterCommitOf, afterDocumentCommit } from './action-transaction'
import { mayPurge } from './purge'
import { UNTICK_INSTEAD, assertNothingRetained, deleteInstead, repointRowActivity, retainedActivityCounts, retainedDocumentCounts } from './document-activity'
import { rowLabel } from './row-titles'
import { allowedTables, anyTableLinkHolder, linkableTable, repointAnyTableLinks } from './any-table-link'
import { EVERYONE_ROLES_FIELD, checkEveryoneRoles, parseEveryoneRoles } from './everyone-roles'
import { ROW_KEY, defaultValueFor, getMeta, physicalRowKey, type TableMeta } from './meta'
import { RESERVED_COLUMNS, canRetire, seriesKey, tableName, tableRelation } from './table-engine'
import { runHooks, type HookContext } from './controllers'
import { holdBeforeRowLock } from './row-lock-order'
import { evaluateEmailRules, type LifecycleEvent } from './email-rules'
import { evaluateAssignmentRules } from './assignment-rules'
import { applySla } from './sla'
import { getActiveWorkflow, stateField, rethrowWorkflowConflict, notifyApproversOfNewRow } from './workflow'
import { evaluateWebhooks } from './webhooks'
import { runDocEventScripts } from './server-scripts'
import { SENSITIVE_COLUMNS } from './sensitive-columns'
import { FULL_READER, ROW_ATTACHED_TABLES, SENSITIVE_HISTORY_TABLES, childColumns, readerFor, restrictRow, seesEveryColumn } from './row-readers'
import { assertRowsWritable } from './system-written'
import { assertNotView, linkTargetNames, rowsInView } from './views'
import { scopedWhere } from './query'
import { agentMark } from './agent-context'
import { assertManagedUnchanged, assertNoManagedReference, assertRowNotManaged, holdManagedSet } from './managed-settings'
import { assertSecurityWriter, isSecurityTable, securityRefusal } from './security-tables'
import {
  assertDocPermission,
  assertPermission,
  assertSystemManager,
  checkUserPermissions,
  filterReadFields,
  getScopeMap,
  isPrivileged,
  isSharedWith,
  ALL_COLUMNS,
  includesColumn,
  permittedColumns,
  sameStoredValue,
  stripUnwritableFields,
  type ColumnSelection,
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
  const schema = tableSchemaToZod(meta.columns, { sourceLimitsLength: Boolean(meta.data_source) })
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
// #855: one counter per Table and prefix (seriesKey), never per prefix text
// alone, so two Tables numbered alike never draw from each other's count.
async function resolveRowId(
  tx: typeof sql,
  meta: TableMeta,
  values: RowValues,
): Promise<string> {
  const rule = meta.id_pattern || DEFAULT_ID_PATTERN
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
  // and a column rule (#858) keeps naming from its declared column.
  const naming = namingColumn(rule)
  if (rule !== 'prompt' && !naming) {
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
  if (naming) {
    const { prefix, column } = naming
    const value = String(own(values, column) ?? '').trim()
    const rowId = idFromColumn(prefix, value)
    if (!rowId)
      throw new AppError('ValidationError', `Naming field ${column} is required`, {
        [column]: `${column} is required for naming`,
      })
    // #858: a second row with the same value would take an id already in use;
    // say which column clashes rather than "Duplicate value for row_id".
    const [taken] = await tx`select 1 from ${tx(await tableRelation(meta.name))} where ${tx(meta.row_key)} = ${rowId}`
    if (taken)
      throw new AppError('ValidationError', `${meta.name} with ${column} ${value} already exists`, {
        [column]: `${rowId} is already taken`,
      })
    return rowId
  }
  if (rule === 'integer') return nextInSeries(tx, meta, '', (n) => String(n))
  if (rule.includes('.#')) {
    const dot = rule.indexOf('.')
    const prefix = rule.slice(0, dot)
    // rule holds '.#' after its first '.', so the mask has at least one #.
    const digits = rule.slice(dot + 1).split('#').length - 1
    return nextInSeries(tx, meta, prefix, (n) => prefix + String(n).padStart(digits, '0'))
  }
  throw new AppError('ValidationError', `Unsupported id_pattern rule ${rule}`)
}

// #855: the Table's next number. A number already used by one of its rows
// (an id an import supplied, UPS-R4) is skipped rather than refused, so the
// next generated id never collides with a row already in the Table.
async function nextInSeries(
  tx: typeof sql,
  meta: TableMeta,
  prefix: string,
  format: (n: number) => string,
): Promise<string> {
  const relation = await tableRelation(meta.name)
  for (;;) {
    const [row] = await tx`
      insert into series (name, current) values (${seriesKey(meta.name, prefix)}, 1)
      on conflict (name) do update set current = series.current + 1
      returning current`
    const id = format(Number(row.current))
    const [taken] = await tx`select 1 from ${tx(relation)} where ${tx(meta.row_key)} = ${id}`
    if (!taken) return id
  }
}

// Filter incoming values to real data columns; reject unknown keys so typos
// fail loudly instead of silently dropping data. read_only columns are
// system-managed (META-010): client-sent values for them are ignored.
function pickFieldValues(meta: TableMeta, values: RowValues, managedValues: RowValues = {}): RowValues {
  const known = new Map(meta.columns.map((f) => [f.column_name, f]))
  const out: RowValues = {}
  const errors: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...values, ...managedValues })) {
    if (key === 'table') continue
    // #1021: the read-only flag a row's read adds; a form sends it back.
    if (key === 'links_outside_view') continue
    // #859: retirement is changed only by :retire and :reactivate.
    if (RESERVED_COLUMNS.includes(key)) continue
    const field = known.get(key)
    if (!field) {
      errors[key] = `Unknown field ${key} on ${meta.name}`
      continue
    }
    if (NO_COLUMN_TYPES.has(field.column_type)) continue
    if (field.read_only && !Object.hasOwn(managedValues, key)) continue
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
  user: string,
  prefix = '',
  old?: RowValues,
) {
  const errors: Record<string, string> = {}
  for (const f of meta.columns) {
    if (f.column_type !== 'Reference') continue
    const value = own(fieldValues, f.column_name)
    if (value == null || value === '') continue
    if (f.table_column) {
      const problem = await anyTableLinkProblem(tx, f, fieldValues, user, old)
      if (problem) errors[prefix + f.column_name] = problem
      continue
    }
    // The engine refuses a Reference column with neither a target Table nor
    // a column naming one (table-engine validateDef), handled just above.
    const linked = f.reference_table!
    // select *: early migrations save rows before table_def has data_source.
    const [linkedDef] = await readOnce(JSON.stringify(['table definition', linked]), () => tx`select * from table_def where name = ${linked}`)
    if (!linkedDef) {
      errors[prefix + f.column_name] = `Reference target Table ${linked} does not exist`
      continue
    }
    // #1021: a link to a view stores a row of its base. The row is checked
    // there, and then against the view's filter, below.
    const view = linkedDef.kind === 'view' ? await getMeta(linked) : null
    const target = view ? String(linkedDef.view_of) : linked
    const [targetMeta] = view ? await tx`select * from table_def where name = ${target}` : [linkedDef]
    // A source-bound target has no local table: ask its source (EDS-5). Like
    // the native lookup, this checks existence only, not the caller's access.
    // It runs outside the save transaction, so it is best-effort: the source
    // can drop the row before this save commits.
    if (targetMeta.data_source) {
      if (!(await boundFetchDoc(await getMeta(target), String(value))))
        errors[prefix + f.column_name] = `${target} ${String(value)} does not exist`
      continue
    }
    const mandatory = !!targetMeta.access_policy || targetMeta.kind === 'sub_table'
    const [row] = await tx`
      select ${mandatory ? tx`*` : tx`1`} from ${tx(await tableRelation(target))}
      where ${tx(physicalRowKey(target))} = ${String(value)}
      ${target.includes('.') ? tx`for key share` : tx``}`
    if (mandatory) {
      if (!row) throw new AppError('PermissionError', 'This work is not available to you')
      await assertMandatoryAccess(user, await getMeta(target), row)
    }
    if (!row)
      errors[prefix + f.column_name] = `${target} ${String(value)} does not exist`
    // #1021: a new or changed value must be one of the view's rows. A value
    // kept from before stays, even once its row has left the view, so the
    // rows linking to it are never locked by that.
    else if (view && !(old != null && String(own(old, f.column_name)) === String(value))
      && !(await rowsInView(tx, view, [String(value)], await tableRelation(target))).has(String(value)))
      errors[prefix + f.column_name] = `${target} ${String(value)} is not one of the ${linked} rows`
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', `Invalid links for ${meta.name}`, errors)
}

// #881: a link to a row of any Table. Its Table comes from the row's own Table
// column, must be one the column allows and one whose rows can be linked to,
// and the row must exist. A new or changed link must also be to a row the
// person saving can read: nobody links what they cannot see.
async function anyTableLinkProblem(tx: typeof sql, f: TableMeta['columns'][number], row: RowValues, user: string, old?: RowValues): Promise<string | null> {
  const value = String(own(row, f.column_name))
  const table = own(row, f.table_column!)
  if (table == null || table === '') return 'Choose its Table first'
  const target = String(table)
  const allowed = allowedTables(f.choices)
  if (allowed.length && !allowed.includes(target)) return `${target} is not one of the Tables this column links to`
  const [def] = await tx`select kind, data_source from table_def where name = ${target}`
  if (!def || !linkableTable(def)) return `${target} cannot be linked to`
  const targetMeta = await getMeta(target)
  const [found] = await tx`select 1 from ${tx(await tableRelation(target))}
    where ${tx(targetMeta.row_key)} = ${value} for key share`
  if (!found) return `${target} ${value} does not exist`
  const unchanged = old != null && [f.column_name, f.table_column!].every((c) => String(own(old, c)) === String(own(row, c)))
  if (!unchanged && await orWhenRefused(() => getDoc(target, value, user).then(() => false), () => true))
    return `${target} ${value} does not exist`
  return null
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
    // #1021: comments, versions, files and shares stay with the base row.
    if (def?.kind === 'view') assertNotView(await getMeta(table), 'attached')
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
  await assertMandatoryAccess(user, meta, { created_by: user, ...row })
  if (await isPrivileged(user)) return
  checkUserPermissions(user, meta, row, await getScopeMap(user))
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
// everyone else. Mandatory privacy also applies to privileged callers.
async function assertAttachedRowReadable(table: string, row: RowValues, user: string) {
  if (await isPrivileged(user) && !(await hasMandatoryRowAccess(String(row.ref_table ?? ''), String(row.ref_name ?? '')))) return
  const refTable = row.ref_table ? String(row.ref_table) : ''
  const refName = row.ref_name ? String(row.ref_name) : ''
  if (!refTable || !refName) return
  const refused = async () => new AppError('PermissionError', `${refusalSubject(user)} have read permission on the row this ${await tableWords(table)} is on.`)
  // A comment or file may sit on a comment, edit or file that is itself on a
  // plain row, one level deep (assertAttachedTarget); a deeper chain, which
  // only a direct write could leave, is refused rather than followed, so it
  // can never loop. The list leaves rows on such Tables out (the row's own
  // activity shows them).
  if (ROW_ATTACHED_TABLES.has(refTable) && (await attachedToAttached(refTable, refName))) throw await refused()
  const refMeta = await getMeta(refTable).catch(() => null)
  if (!refMeta) throw await refused()
  const target = await orWhenRefused(() => getDoc(refTable, refName, user), async (): Promise<never> => { throw await refused() })
  if (SENSITIVE_HISTORY_TABLES.has(table) && !(await isSharedWith(user, refTable, refName, 'read')) && !(await seesEveryColumn(user, refMeta, String(target.created_by))))
    throw await refused()
}

// Whether a comment, edit or file is itself on another comment, edit or file.
async function attachedToAttached(table: string, name: string): Promise<boolean> {
  const [held] = await sql`
    select ref_table, ref_name from ${sql(await tableRelation(table))} where row_id = ${name}`
  return Boolean(held && ROW_ATTACHED_TABLES.has(String(held.ref_table ?? '')) && String(held.ref_name ?? ''))
}

async function hasAttachments(table: string, name: string): Promise<boolean> {
  for (const held of ROW_ATTACHED_TABLES) {
    const [hit] = await sql`
      select 1 from ${sql(await tableRelation(held))} where ref_table = ${table} and ref_name = ${name} limit 1`
    if (hit) return true
  }
  return false
}

// #609, #610: a comment or file is attached only to a row its writer may
// open, and one already on a row is changed only by someone who may open that
// row, so moving it elsewhere cannot carry it out of its row's reach, and
// only a privileged caller takes it off its row (which hands it to the File
// grant). A row names its Table whenever it names a row, and one on a
// comment, edit or file goes one level deep only. Judged on the row as written.
async function assertAttachedTarget(
  meta: TableMeta,
  row: RowValues,
  old: RowValues | null,
  user: string,
  trusted: boolean,
) {
  if (!ROW_ATTACHED_TABLES.has(meta.name)) return
  const refTable = String(row.ref_table ?? '')
  const refName = String(row.ref_name ?? '')
  if (refName && !refTable) throw new AppError('ValidationError', `A ${meta.name} on a row must name its Table`)
  if (refName && ROW_ATTACHED_TABLES.has(refTable)) {
    if (await attachedToAttached(refTable, refName))
      throw new AppError('ValidationError', `A ${meta.name} cannot be attached to a ${refTable} that is itself attached to one`)
    // Whatever already hangs on this row would then sit two levels deep.
    // An update's row is merged with the stored one, so it carries its id.
    if (old && (await hasAttachments(meta.name, String(row[ROW_KEY]))))
      throw new AppError('ValidationError', `This ${meta.name} has comments, files or history of its own, so it cannot be attached to a ${refTable}`)
  }
  if (trusted) return
  if (old) await assertAttachedRowReadable(meta.name, old, user)
  const moved = !old || String(old.ref_table ?? '') !== refTable || String(old.ref_name ?? '') !== refName
  if (!moved) return
  if (old && String(old.ref_name ?? '') && !refName && !(await isPrivileged(user)))
    throw new AppError('PermissionError', `Only a System Manager can take a ${meta.name} off its row`)
  await assertAttachedRowReadable(meta.name, row, user)
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
  writeTiers: ColumnSelection,
): Promise<void> {
  const changed: string[] = []
  for (const input of pickChildInputs(meta, values)) {
    if (!(await isSecurityTable(input.childTable))) continue
    if (existing === null) {
      if (input.rows.length) changed.push(input.columnName)
      continue
    }
    const childMeta = await getMeta(input.childTable)
    const parentColumn = meta.columns.find((column) => column.column_name === input.columnName)!.row_id
    const childTiers = await childWriteColumns(user, writeTiers, meta.name, childMeta.name, parentColumn, 'write', String(existing.created_by))
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
        written = { ...stored.get(id)!, ...childFieldValues(childMeta, r, 'update', childTiers, stored.get(id)) }
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
async function childWriteColumns(user: string, parentColumns: ColumnSelection, parentTable: string, childTable: string, parentColumn: string, action: 'write' | 'create', createdBy?: string): Promise<ColumnSelection> {
  if (parentColumns.has('*')) return new Set(ALL_COLUMNS)
  // A parent grant that reaches the grid lends its level to the line items;
  // childColumns checks each grant's reach to this link.
  const columns = new Set(await childColumns(user, parentTable, childTable, parentColumn, action, createdBy))
  // #608: what a new line item may hold is what create or edit access reaches.
  if (action === 'create') for (const column of await childColumns(user, parentTable, childTable, parentColumn, 'write', createdBy)) columns.add(column)
  return columns
}

// #608: a new row keeps every Column its creator's create or edit grant reaches.
async function insertColumns(user: string, table: string): Promise<ColumnSelection> {
  return new Set([...await permittedColumns(user, table, 'create', user), ...await permittedColumns(user, table, 'write', user)])
}

// Defaults may initialise a hidden column, but may not overwrite an existing
// hidden value. Check supplied values before adding any defaults.
function childFieldValues(childMeta: TableMeta, row: RowValues, mode: 'insert' | 'update', writeTiers: ColumnSelection, stored?: RowValues): RowValues {
  const supplied = stripUnwritableFields(childMeta.columns, writeTiers, pickFieldValues(childMeta, row), stored)
  const defaultsMeta = mode === 'insert' ? childMeta : {
    ...childMeta, columns: childMeta.columns.filter((column) => includesColumn(writeTiers, column)),
  }
  const values = applyDefaults(defaultsMeta, supplied)
  return validateValues(childMeta, values, mode)
}

async function saveChildren(
  tx: typeof sql,
  parentMeta: TableMeta,
  parentRowId: string,
  input: { columnName: string; childTable: string; rows: RowValues[] },
  user: string,
  parentWriteTiers: ColumnSelection,
  action: 'write' | 'create',
  createdBy: string,
) {
  const childMeta = await getMeta(input.childTable)
  // Child columns are subject to the same atomic refusal as parent columns.
  const parentColumn = parentMeta.columns.find((column) => column.column_name === input.columnName)!.row_id
  const writeTiers = await childWriteColumns(user, parentWriteTiers, parentMeta.name, childMeta.name, parentColumn, action, createdBy)
  const table = await tableRelation(childMeta.name)
  const childKey = childMeta.row_key
  const existing = await tx`
    select * from ${tx(table)}
    where parent = ${parentRowId} and parenttype = ${parentMeta.name}
      and parentfield = ${input.columnName}`
  const stored = new Map(existing.map((r) => [String(r[childKey]), r as RowValues]))
  // A grid outside the writer's grant may only come back unchanged: the same
  // rows, each with its stored values. Then there is nothing to write.
  const link = parentMeta.columns.find((column) => column.row_id === parentColumn)!
  if (!includesColumn(parentWriteTiers, link)) {
    const unchanged = input.rows.length === stored.size && input.rows.every((row) => {
      const before = row[ROW_KEY] == null ? undefined : stored.get(String(row[ROW_KEY]))
      return before && childMeta.columns.every((column) => !Object.hasOwn(row, column.column_name) ||
        sameStoredValue(column.column_type, row[column.column_name], before[column.column_name]))
    })
    if (!unchanged) throw new AppError('PermissionError', `No write permission on column ${input.columnName}`)
    return
  }
  const keep = new Set<string>()
  const errors: Record<string, string> = {}

  for (const [i, row] of input.rows.entries()) {
    const rowId = row[ROW_KEY]
    const isExisting = rowId != null && stored.has(String(rowId))
    let fieldValues: RowValues
    try {
      fieldValues = childFieldValues(childMeta, row, isExisting ? 'update' : 'insert', writeTiers, stored.get(String(rowId)))
    } catch (err) {
      // childFieldValues refuses only field by field; anything else is a bug.
      if (!(err instanceof AppError) || !err.fields) throw err
      for (const [k, v] of Object.entries(err.fields))
        errors[`${input.columnName}.${i}.${k}`] = v
      continue
    }
    await validateLinks(tx, childMeta, fieldValues, user, `${input.columnName}.${i}.`, isExisting ? stored.get(String(rowId)) : undefined)
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
        submission_status: 'draft',
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
  const remove = [...stored.keys()].filter((n) => !keep.has(n))
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
  const known = new Set<string>(['table', ...RESERVED_COLUMNS, ...meta.columns.map((f) => f.column_name)])
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
// Returns the id the row will take, when known now, so the import check can
// spot one repeated within the file.
export async function checkRowForInsert(meta: TableMeta, values: RowValues, user: string): Promise<string> {
  // The real save refuses a value outside the caller's reach; so must the rehearsal.
  const reach = await insertColumns(user, meta.name)
  stripUnwritableFields(meta.columns, reach, pickFieldValues(meta, values))
  for (const link of meta.columns.filter((column) => column.column_type === 'Sub-table' && Array.isArray(values[column.column_name]))) {
    const childMeta = await getMeta(link.row_table!)
    const childReach = await childWriteColumns(user, reach, meta.name, childMeta.name, link.row_id, 'create', user)
    for (const line of values[link.column_name] as RowValues[]) stripUnwritableFields(childMeta.columns, childReach, pickFieldValues(childMeta, line))
  }
  const inserted = applyDefaults(meta, pickFieldValues(meta, values))
  validateValues(meta, inserted, 'insert')
  // #1072: the save refuses a link to no row; a rehearsal that passed one
  // would let Check say "ready" about a row the import then refuses.
  await validateLinks(sql, meta, inserted, user)
  // #231: the real import inserts through saveDoc, so the dry run has to
  // apply the same required-children rule or it would pass rows the import
  // then refuses.
  assertRequiredChildren(meta, values, 'insert')
  // #858: a column rule's id is known before the save; check it like a supplied one.
  const naming = namingColumn(meta.id_pattern)
  const rowId = naming ? (idFromColumn(naming.prefix, own(values, naming.column)) ?? '') : String(values[ROW_KEY] ?? '').trim()
  if (naming && !rowId)
    throw new AppError('ValidationError', `Naming field ${naming.column} is required`, {
      [naming.column]: `${naming.column} is required for naming`,
    })
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
  return rowId
}

/** #1072: a rehearsed update checks its links as the save will, against the row it changes. */
export async function checkLinksForUpdate(meta: TableMeta, values: RowValues, user: string, current: RowValues): Promise<void> {
  await validateLinks(sql, meta, values, user, '', current)
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
  // Only the upload route supplies the exact path returned by storage.
  // Never derive this option from a client row or request body.
  uploadedFileUrl?: string
  // Only the upload route sets this, after rowCapabilities found that the
  // uploader may write the row the new File is attached to: that write stands
  // in for create on File. Every other check still runs. Never derive it from
  // a client row or request body.
  attachedRowWritable?: boolean
  // Trusted import/copy writers and version-backed undo only. This is NOT
  // read from HTTP args; permissions, tiers, validation and hooks still run.
  managedValues?: RowValues
}

function assertStoredFileUrl(meta: TableMeta, row: RowValues, allowed: unknown) {
  if (meta.name === 'File' && String(row.file_url ?? '') !== String(allowed ?? ''))
    throw new AppError('ValidationError', 'file_url is managed by uploads and cannot be assigned or changed')
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
  assertRowsWritable(await getMeta(table), mode === 'insert' ? 'created' : 'saved')
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
    submission_status: 'draft',
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
      return updateDoc(meta, String(values[ROW_KEY]), values, user, Boolean(opts.skipPermissions), opts.managedValues)
    }
    // In upsert mode an unknown name on a generated-id Table is almost
    // certainly a mistyped update — refuse it. Insert mode is different:
    // the caller is explicitly creating, so the supplied id is intent
    // (UPS-R4) and resolveName adopts it verbatim.
    if (meta.id_pattern !== 'prompt' && values.amended_from == null && mode !== 'insert')
      throw new AppError('NotFoundError', `${table} ${values[ROW_KEY]} not found`)
  }
  // The upload route fills every column of a File on a writable row itself.
  const attachedWrite = Boolean(opts.attachedRowWritable) && meta.name === 'File' && Boolean(values.ref_table) && Boolean(values.ref_name)
  if (!opts.skipPermissions) {
    if (!attachedWrite) await assertPermission(user, table, 'create')
    await assertUserPermissions(user, meta, { ...values, created_by: user })
  }
  const writeTiers = opts.skipPermissions || attachedWrite
    ? new Set(ALL_COLUMNS)
    : await insertColumns(user, table)
  const fieldValues = validateValues(
    meta,
    applyDefaults(meta, stripUnwritableFields(meta.columns, writeTiers, pickFieldValues(meta, values, opts.managedValues))),
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
      await holdBeforeRowLock(stx, meta, user, { ...values }, true)
      const rowId = await resolveRowId(stx, meta, values)
      const now = new Date()
      const row: RowValues = {
        [ROW_KEY]: rowId,
        created_by: user,
        updated_by: user,
        created_at: now,
        updated_at: now,
        submission_status: 'draft',
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
      await assertMandatoryAccess(user, meta, row)
      stripUnwritableFields(meta.columns.filter((column) => !column.read_only), writeTiers, row, fieldValues)
      await assertAttachedTarget(meta, row, null, user, Boolean(opts.skipPermissions))
      assertStoredFileUrl(meta, row, opts.uploadedFileUrl)
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
        submission_status: row.submission_status,
        position: row.position,
      }
      await lockCoreDocumentTargets(stx, meta, dbRow, user)
      await validateLinks(stx, meta, dbRow, user)
      attemptedRow = dbRow
      const inserted = await tx`insert into ${tx(tbl)} ${tx(dbRow as unknown as Record<string, never>)} returning *`
      // #465 D5: a new row under a locked row's id would set its locked fields.
      await assertManagedUnchanged(stx, meta, String(rowId), null, inserted[0] as RowValues, user)
      // #897: roles given at creation are a grant like any later one.
      const accessBefore = await accessChildSummaries(stx, meta, String(rowId), finalChildInputs)
      for (const input of finalChildInputs)
        await saveChildren(stx, meta, rowId, input, user, writeTiers, 'create', user)
      const accessChanges = await accessChildChanges(stx, meta, String(rowId), finalChildInputs, accessBefore)
      await recordVersion(stx, meta, String(rowId), inserted[0] as RowValues, inserted[0] as RowValues, user, accessChanges, true)
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
  const writeTiers = await insertColumns(user, meta.name)
  const fieldValues = validateValues(
    meta,
    applyDefaults(meta, stripUnwritableFields(meta.columns, writeTiers, pickFieldValues(meta, values))),
    'insert',
  )
  const row: RowValues = { [ROW_KEY]: providedName, submission_status: 'draft', ...fieldValues }
  const hctx: HookContext = { row, meta, user, isNew: true, tx: sql }
  await runHooks('before_insert', hctx)
  await runHooks('before_validate', hctx)
  await runHooks('validate', hctx)
  await runHooks('before_save', hctx)
  stripUnwritableFields(meta.columns.filter((column) => !column.read_only), writeTiers, hctx.row, fieldValues)
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
  const writeTiers = await permittedColumns(user, meta.name, 'write', String(current.created_by ?? ''))
  const fieldValues = validateValues(
    meta,
    stripUnwritableFields(meta.columns, writeTiers, pickFieldValues(meta, values), current),
    'update',
  )
  const row: RowValues = { ...current, ...fieldValues }
  const hctx: HookContext = { row, old: current, meta, user, isNew: false, tx: sql }
  await runHooks('before_validate', hctx)
  await runHooks('validate', hctx)
  await runHooks('before_save', hctx)
  stripUnwritableFields(meta.columns.filter((column) => !column.read_only), writeTiers, hctx.row, current)
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
  managedValues: RowValues = {},
): Promise<RowValues> {
  const table = await tableRelation(meta.name)
  if (values.updated_at == null)
    throw new AppError(
      'ValidationError',
      'Updates must include the updated_at timestamp of the loaded row',
    )
  // A write-share grants full field access; otherwise honor tiers.
  // #975: a trusted save is the platform's own, such as an approved Change Proposal: approving
  // is not editing, so neither the maker's nor the approver's grants are what it runs on.
  const sharedWrite = trusted || await isSharedWith(user, meta.name, name, 'write')
  let writeTiers = sharedWrite
    ? new Set(ALL_COLUMNS)
    : await permittedColumns(user, meta.name, 'write')
  const fieldValues = validateValues(
    meta,
    pickFieldValues(meta, values, managedValues),
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
      await holdBeforeRowLock(stx, meta, user, { ...values, [meta.row_key]: name })
      const [existing] = await tx`
        select * from ${tx(table)} where ${tx(meta.row_key)} = ${name} for update`
      if (!existing)
        throw new AppError('NotFoundError', `${meta.name} ${name} not found`)
      previous = { ...(existing as RowValues) }
      // PERM-008: a share with write grants update even without role write.
      if (!trusted) await assertMandatoryAccess(user, meta, existing as RowValues)
      if (!sharedWrite) {
        await assertDocPermission(user, meta.name, 'write', String(existing.created_by))
        await assertUserPermissions(user, meta, existing as RowValues)
        writeTiers = await permittedColumns(user, meta.name, 'write', String(existing.created_by))
      }
      const dbModified = (existing.updated_at as Date).getTime()
      const sentModified = new Date(expectedStamp(values.updated_at)).getTime()
      if (Number.isNaN(sentModified) || dbModified !== sentModified)
        throw new AppError(
          'ConflictError',
          `${meta.name} ${name} has been modified after you loaded it`,
        )
      if ((existing.submission_status as string) === 'submitted')
        throw new AppError(
          'ValidationError',
          `${meta.name} ${name} is submitted and cannot be modified (cancel it first)`,
        )
      if ((existing.submission_status as string) === 'cancelled')
        throw new AppError(
          'ValidationError',
          `${meta.name} ${name} is cancelled and cannot be modified`,
        )
      const writableValues = stripUnwritableFields(meta.columns, writeTiers, fieldValues, existing as RowValues)
      const row: RowValues = { ...(existing as RowValues), ...writableValues }
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
      // A grid is judged row by row in saveChildren, against its stored rows.
      stripUnwritableFields(meta.columns.filter((column) => !column.read_only && column.column_type !== 'Sub-table'), writeTiers, row, existing as RowValues)
      await assertAccessColumnsUnchanged(stx, meta, row, existing as RowValues, user, trusted, writeTiers)
      await assertMandatoryAccess(user, meta, row)
      await assertAttachedTarget(meta, row, existing as RowValues, user, trusted)
      assertStoredFileUrl(meta, row, existing.file_url)
      const dbRow = {
        ...columnValues(meta, row),
        updated_at: new Date(),
        updated_by: user,
      }
      await lockCoreDocumentTargets(stx, meta, { ...existing, ...dbRow }, user, existing as RowValues)
      await validateLinks(stx, meta, dbRow, user, '', existing as RowValues)
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
      const childInputs = pickChildInputs(meta, row)
      const accessBefore = await accessChildSummaries(stx, meta, name, childInputs)
      for (const input of childInputs)
        await saveChildren(stx, meta, name, input, user, writeTiers, 'write', String(existing.created_by))
      const accessChanges = await accessChildChanges(stx, meta, name, childInputs, accessBefore)
      await recordVersion(stx, meta, name, existing as RowValues, updated as RowValues, user, accessChanges)
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
  childChanges: [string, unknown, unknown][] = [],
  // #897: the entry a row is created with. It alone does not keep the row
  // from being deleted, and goes with it.
  created = false,
) {
  if (!meta.track_changes || UNVERSIONED.has(meta.name)) return
  // #421: a Date column is a calendar day, which the driver hands back as UTC
  // midnight; record the day itself. A Datetime keeps its full instant.
  const norm = (v: unknown, type: string) =>
    v instanceof Date ? (type === 'Date' ? v.toISOString().slice(0, 10) : v.toISOString()) : v ?? null
  const changed: [string, unknown, unknown][] = []
  for (const f of meta.columns) {
    if (NO_COLUMN_TYPES.has(f.column_type)) continue
    const b = norm(own(before, f.column_name), f.column_type)
    const a = norm(own(after, f.column_name), f.column_type)
    if (JSON.stringify(b) !== JSON.stringify(a)) changed.push([f.column_name, b, a])
  }
  changed.push(...childChanges)
  // #1083 (D8): a row an agent creates gets its created entry, so the mark
  // has somewhere to live; a row created by hand needs none (#829 reads its
  // creator off the row).
  const agent = agentMark()
  if (!changed.length && !(created && agent)) return
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
    submission_status: 'draft',
    position: 0,
    ref_table: meta.name,
    ref_name: name,
    // #1083 (D8): a change an agent made through /mcp says so, with its token.
    data: { ...(created ? { changed, created } : { changed }), ...(agent ? { agent } : {}) } as unknown as string,
  })}`
}

// #830: a Sub-table whose rows decide access (a Person's roles are Has Role
// rows) is history an auditor needs, yet its rows are saved beside the parent
// and never diffed as a column. Each such grid is summarised as its rows'
// names in order ("System Manager, Sales Viewer"; null for none), before and
// after the save, and a difference is recorded on the parent like any field.
type ChildInput = ReturnType<typeof pickChildInputs>[number]

async function accessChildSummaries(tx: typeof sql, meta: TableMeta, parent: string, inputs: ChildInput[]) {
  // Untracked parents are left to recordVersion, which records nothing.
  const out = new Map<string, string | null>()
  for (const input of inputs) {
    if (!(await isSecurityTable(input.childTable))) continue
    const childMeta = await getMeta(input.childTable)
    // A Sub-table has at least one column; its title, else its first one, names a row.
    const column = childMeta.title_column ?? childMeta.columns.find((c) => !NO_COLUMN_TYPES.has(c.column_type))!.column_name
    const rows = await tx`
      select ${tx(column)}::text as name from ${tx(await tableRelation(childMeta.name))}
      where parent = ${parent} and parenttype = ${meta.name} and parentfield = ${input.columnName}
        and ${tx(column)} is not null
      order by position`
    out.set(input.columnName, rows.map((r) => r.name as string).join(', ') || null)
  }
  return out
}

async function accessChildChanges(
  tx: typeof sql,
  meta: TableMeta,
  parent: string,
  inputs: ChildInput[],
  before: Map<string, string | null>,
): Promise<[string, unknown, unknown][]> {
  const after = await accessChildSummaries(tx, meta, parent, inputs)
  const changes: [string, unknown, unknown][] = []
  for (const [column, now] of after) {
    // The same inputs were summarised before the save, so the key is there.
    const was = before.get(column)
    if (was !== now) changes.push([column, was, now])
  }
  return changes
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
  assertRowsWritable(meta, event === 'on_submit' ? 'submitted' : 'cancelled')
  await assertSecurityWriter(table, user)
  if (!meta.is_submittable)
    throw new AppError('ValidationError', `${table} is not submittable`)
  const tbl = await tableRelation(table)
  const [saved] = await afterCommitOf(() => sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    await runHooks('before_lock', { row: { [meta.row_key]: name }, meta, user, isNew: false, tx: stx })
    const [existing] = await tx`
      select * from ${tx(tbl)} where ${tx(meta.row_key)} = ${name} for update`
    if (!existing)
      throw new AppError('NotFoundError', `${table} ${name} not found`)
    await assertDocPermission(
      user, table, event === 'on_submit' ? 'submit' : 'cancel', String(existing.created_by))
    await assertUserPermissions(user, meta, existing as RowValues)
    if ((existing.submission_status as string) !== from)
      throw new AppError(
        'ValidationError',
        `${table} ${name} has status ${existing.submission_status}; expected ${from}`,
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
      update ${tx(tbl)} set submission_status = ${to}, updated_at = ${new Date()},
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
  assertRowsWritable(meta, 'amended')
  await assertSecurityWriter(table, user)
  if (!meta.is_submittable)
    throw new AppError('ValidationError', `${table} is not submittable`)
  const source = await getDoc(table, name, user)
  if ((source.submission_status as string) !== 'cancelled')
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
          if (!RESERVED_COLUMNS.includes(k)) copy[k] = v
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
export function deleteDoc(table: string, name: string, user = 'Administrator', opts: { expectUpdatedAt?: string | null } = {}) {
  return appOperation(() => deleteDocImpl(table, name, user, opts))
}
// #1034: the permission matrix ends a grant even when the grant has history.
// Clearing the old flag was an update, which history never blocked, and access
// must not outlast the decision to end it. So everything on the row stays,
// with one more entry saying who ended it and what it was. No other delete,
// and no other Table, comes this way.
export function revokeGrant(name: string, user: string) {
  return appOperation(() => deleteDocImpl('Permission', name, user, {}, true))
}
async function deleteDocImpl(
  table: string,
  name: string,
  user: string,
  opts: { expectUpdatedAt?: string | null },
  revoking = false,
): Promise<void> {
  const meta = await getMeta(table)
  assertRowsWritable(meta, 'deleted')
  await assertSecurityWriter(table, user)
  if (meta.kind === 'settings' || meta.kind === 'sub_table' || ENGINE_MANAGED.has(table))
    throw new AppError('ValidationError', `${table} rows cannot be deleted directly`)
  if (isBound(meta)) return deleteBoundDoc(meta, name, user, opts.expectUpdatedAt ?? null)
  await afterCommitOf(() => sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    await holdBeforeRowLock(stx, meta, user, { [meta.row_key]: name })
    const [existing] = await tx`
      select * from ${tx(await tableRelation(table))} where ${tx(meta.row_key)} = ${name} for update`
    if (!existing)
      throw new AppError('NotFoundError', `${table} ${name} not found`)
    await assertDocPermission(user, table, 'delete', String(existing.created_by))
    await assertUserPermissions(user, meta, existing as RowValues)
    // #610: a comment or file on a row is removed only by someone who may
    // open that row, as only they may read it (#342, #609).
    if (ROW_ATTACHED_TABLES.has(meta.name)) await assertAttachedRowReadable(meta.name, existing as RowValues, user)
    await assertRowNotManaged(stx, meta, name, user)
    // #959: the refusals below name each row as this caller reads it.
    const label = () => rowLabel(user, table, name)
    const instead = deleteInstead(table, true)
    if (revoking) {
      // Nothing held back and nothing removed: see revokeGrant.
    } else if (meta.owner_app) {
      if (!opts.expectUpdatedAt || !Number.isFinite(Date.parse(opts.expectUpdatedAt))
        || new Date(existing.updated_at as string).getTime() !== Date.parse(opts.expectUpdatedAt))
        throw new AppError('ConflictError', `${table} ${name} has been modified after you loaded it; supply its current updated_at`)
      await assertNothingRetained(await retainedDocumentCounts(stx, table, name), instead, label)
    } else {
      // #321: a plain row keeps its comments, history, attachments and shares
      // by refusing the delete while it has any (links are checked below).
      await assertNothingRetained(await retainedActivityCounts(stx, table, name), instead, label)
    }
    if (!revoking) await tx`delete from version where ref_table = ${table} and ref_name = ${name} and data->>'created' = 'true'`
    if ((existing.submission_status as string) === 'submitted')
      throw new AppError(
        'ValidationError',
        `${await label()} is submitted and cannot be deleted (cancel it first)`,
      )

    // Any Reference column in any Table pointing at this table blocks deletion.
    // #1021: so does one pointing at a view of it.
    const linkFields = await tx`
      select parent, column_name from column_def
      where column_type = 'Reference' and reference_table in ${tx(await linkTargetNames(table, stx))}`
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
          ? await rowLabel(user, ref.parenttype as string, ref.parent as string)
          : await rowLabel(user, parentTable, ref[parentKey] as string)
        throw new AppError(
          'ValidationError',
          `Cannot delete ${await label()}: it is linked from ${holder}. ${instead!.advice}`,
          instead!.fields,
        )
      }
    }
    // #881: and so does a link to a row of any Table naming this row.
    const anyHolder = await anyTableLinkHolder(stx, table, name)
    if (anyHolder)
      throw new AppError(
        'ValidationError',
        `Cannot delete ${await label()}: it is linked from ${await rowLabel(user, anyHolder.table, anyHolder.row_id)}. ${instead!.advice}`,
        instead!.fields,
      )

    const ctx: HookContext = {
      row: existing as RowValues,
      meta,
      user,
      isNew: false,
      tx: stx,
    }
    await runHooks('on_trash', ctx)
    if (revoking) await recordVersion(stx, meta, name, existing as RowValues, {}, user)

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
    where column_type = 'Reference' and reference_table in ${sql(await linkTargetNames(meta.name))}`
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
        `Cannot delete ${await rowLabel(user, meta.name, name)}: it is linked from ${await rowLabel(user, parentTable, ref[parentKey] as string)}`,
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
  await assertNothingRetained(await retainedActivityCounts(sql, meta.name, name), null, () => rowLabel(user, meta.name, name))
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

// #859 (ADR 0019): retire a row, taking it out of use without deleting it,
// or reactivate it. Retire needs the delete right on the Table, reactivate
// the write right; a reason is required to retire. Only the three
// retirement columns (and the update stamp) change, and each step is one
// history entry, recorded whether or not the Table tracks changes.
export function retireDoc(table: string, name: string, reason: unknown, user = 'Administrator') {
  return appOperation(() => setRetirement(table, name, user, { reason }))
}
export function reactivateDoc(table: string, name: string, user = 'Administrator') {
  return appOperation(() => setRetirement(table, name, user, null))
}
const MAX_RETIRED_REASON = 1000
async function setRetirement(
  table: string,
  name: string,
  user: string,
  retire: { reason: unknown } | null,
): Promise<RowValues> {
  const meta = await getMeta(table)
  assertRowsWritable(meta, retire ? 'retired' : 'reactivated')
  if (!canRetire(meta))
    throw new AppError('ValidationError', `${table} rows cannot be retired${table === 'Permission' ? `. ${UNTICK_INSTEAD}` : ''}`)
  await assertSecurityWriter(table, user)
  let reason: string | null = null
  if (retire) {
    reason = typeof retire.reason === 'string' ? retire.reason.trim() : ''
    if (!reason)
      throw new AppError('ValidationError', 'A reason is required to retire a row', { retired_reason: 'Required' })
    if (reason.length > MAX_RETIRED_REASON)
      throw new AppError('ValidationError', `A reason is at most ${MAX_RETIRED_REASON} characters`, { retired_reason: 'Too long' })
  }
  // Only someone who may open the row may retire or reactivate it: the read
  // path's own checks (mandatory access, shares, a comment's or file's row).
  await getDoc(table, name, user)
  // PERM-008: reactivating is editing, so a write share grants it as it
  // grants an update; retiring is deleting, which no share grants.
  const sharedWrite = !retire && await isSharedWith(user, table, name, 'write')
  const tbl = await tableRelation(table)
  let previous: RowValues = {}
  const [saved] = await afterCommitOf(() => sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    await holdBeforeRowLock(stx, meta, user, { [meta.row_key]: name })
    const [existing] = await tx`
      select * from ${tx(tbl)} where ${tx(meta.row_key)} = ${name} for update`
    if (!existing) throw new AppError('NotFoundError', `${table} ${name} not found`)
    previous = existing as RowValues
    await assertMandatoryAccess(user, meta, existing as RowValues)
    if (!sharedWrite) {
      await assertDocPermission(user, table, retire ? 'delete' : 'write', String(existing.created_by))
      await assertUserPermissions(user, meta, existing as RowValues)
    }
    if (ROW_ATTACHED_TABLES.has(meta.name)) await assertAttachedRowReadable(meta.name, existing as RowValues, user)
    await assertRowNotManaged(stx, meta, name, user)
    if (retire && existing.retired_at != null)
      throw new AppError('ValidationError', `${table} ${name} is already retired`)
    if (!retire && existing.retired_at == null)
      throw new AppError('ValidationError', `${table} ${name} is not retired`)
    // The database's clock, as for history (#432).
    const [{ at }] = await tx<{ at: Date }[]>`select clock_timestamp() as at`
    // The whole update trigger chain (AGENTS.md invariant 2): the pre-save
    // hooks and scripts see the row as it will be, and may refuse it (a
    // Table whose controller refuses generic writes refuses this too). Only
    // the retirement columns are written, whatever a hook changes.
    // Hooks see the whole document, its lines included, as on any save.
    const whole = await loadChildren(meta, { table: meta.name, ...(existing as RowValues) })
    const pre: HookContext = {
      row: { ...whole, retired_at: retire ? at : null, retired_by: retire ? user : null, retired_reason: reason },
      old: whole, meta, user, isNew: false, tx: stx,
    }
    await runHooks('before_validate', pre)
    await runHooks('validate', pre)
    await runDocEventScripts('validate', meta.name, pre.row, stx)
    await runHooks('before_save', pre)
    await runDocEventScripts('before_save', meta.name, pre.row, stx)
    const [updated] = await tx`
      update ${tx(tbl)} set retired_at = ${retire ? at : null}, retired_by = ${retire ? user : null},
        retired_reason = ${reason}, updated_at = ${at}, updated_by = ${user}
      where ${tx(meta.row_key)} = ${name} returning *`
    await tx`insert into version ${tx({
      [ROW_KEY]: hashRowId(),
      created_by: user,
      updated_by: user,
      created_at: at,
      updated_at: at,
      submission_status: 'draft',
      position: 0,
      ref_table: meta.name,
      ref_name: name,
      data: { changed: [], retirement: retire ? { action: 'retired', reason } : { action: 'reactivated' } } as unknown as string,
    })}`
    const ctx: HookContext = { row: { ...whole, ...(updated as RowValues) }, old: whole, meta, user, isNew: false, tx: stx }
    await runHooks('after_save', ctx)
    await runHooks('on_update', ctx)
    await runDocEventScripts('after_save', meta.name, ctx.row, ctx.tx)
    return [updated]
  }))
  const result = await loadChildren(meta, { table: meta.name, ...(saved as RowValues) })
  await afterDocumentCommit(async () => {
    await evaluateEmailRules('on_save', meta.name, result, previous)
    await evaluateWebhooks('on_update', meta.name, result)
    await runHooks('after_commit', { row: result, old: previous, meta, user, isNew: false, tx: sql })
  })
  return getDoc(table, name, user)
}

// DOC-012: rename a row's primary key and update every Reference that
// pointed at the old name — across all Tables and child tables — in one
// transaction. The row keeps all its other data and children, and its
// comments, history, attachments and shares (#509).
// #1029: a row named after its own column moves that column with the id, and
// the column's rules judge the new value as a save would.
async function renamedSourceColumn(tx: typeof sql, meta: TableMeta, row: RowValues, target: string, user: string): Promise<RowValues> {
  const naming = namingColumn(meta.id_pattern)
  const def = meta.columns.find((c) => c.column_name === naming?.column)
  if (!naming || !def) return {}
  const { prefix, column } = naming
  const refuse = (message: string) => new AppError('ValidationError', message, { [ROW_KEY]: message })
  if (!target.startsWith(prefix) || target === prefix)
    throw refuse(`A ${meta.name} ID is ${prefix} followed by its ${def.label ?? column}`)
  if (def.read_only) throw refuse(`${def.label ?? column} names this row and is read-only, so the row can't be renamed`)
  const source = validateValues(meta, { [column]: target.slice(prefix.length) }, 'update')
  await validateLinks(tx, meta, source, user, '', row)
  await assertUserPermissions(user, meta, { ...row, ...source })
  return source
}

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
  assertRowsWritable(meta, 'renamed')
  await assertSecurityWriter(table, user)
  if (meta.kind === 'settings' || meta.kind === 'sub_table' || ENGINE_MANAGED.has(table))
    throw new AppError('ValidationError', `${table} rows cannot be renamed`)
  // person-identities: a User's id is the permanent person id (the warehouse
  // person_id); change the name or username instead. A trigger backs this up.
  // person-rename R1: an opaque id (a person's, a service account's) is
  // permanent — never renamed.
  if (meta.id_pattern.startsWith('opaque:'))
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
    await runHooks('before_lock', { row: { [meta.row_key]: oldName }, meta, user, isNew: false, tx: tx as unknown as typeof sql })
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
    const source = await renamedSourceColumn(stx, meta, existing as RowValues, target, user)
    await assertRowNotManaged(stx, meta, oldName, user)
    await assertRowNotManaged(stx, meta, target, user)
    await assertNoManagedReference(stx, table, oldName, user)

    await assertChildRowsWritable(stx, meta, oldName, user)
    await runHooks('before_rename', { row: existing as RowValues, meta, user, isNew: false, tx: stx })
    // Rename the row itself.
    try {
      await tx`update ${tx(tbl)} set ${tx({ [meta.row_key]: target, ...source, updated_at: new Date() } as unknown as Record<string, never>)} where ${tx(meta.row_key)} = ${oldName}`
    } catch (err) {
      await mapDbError(meta, err)
    }

    // Re-point this row's own child rows to the new parent name.
    for (const f of meta.columns) {
      if (f.column_type !== 'Sub-table') continue
      await tx`
        update ${tx(await tableRelation(f.row_table!))} set parent = ${target}
        where parent = ${oldName} and parenttype = ${table}`
    }

    // Update every Reference column, in any Table, that points at this table
    // or (#1021) at a view of it.
    const linkFields = await tx`
      select parent, column_name from column_def
      where column_type = 'Reference' and reference_table in ${tx(await linkTargetNames(table, stx))}`
    for (const lf of linkFields) {
      const parentTable = lf.parent as string
      const [pm] = await tx`select kind from table_def where name = ${parentTable}`
      if (!pm || pm.kind === 'settings') continue
      const col = lf.column_name as string
      await tx`
        update ${tx(await tableRelation(parentTable))} set ${tx(col)} = ${target}
        where ${tx(col)} = ${oldName}`
    }

    // #881: every link to it from a link to a row of any Table.
    await repointAnyTableLinks(stx, table, oldName, target)
    // #509: and every record that names the row by id in plain text.
    await repointRowActivity(stx, table, oldName, target)
  })
  return getDoc(table, target, user)
}

export function getDoc(...args: Parameters<typeof getDocImpl>) {
  return appOperation(() => getDocImpl(...args))
}

// UI advice only: do not run mutation hooks, locks or validation speculatively.
// Read first through the normal path, including parent access, tiers and Data
// Scopes. Never turn an unreadable/missing row into a capabilities response.
export function rowCapabilities(table: string, name: string, user: string): Promise<RowCapabilities> {
  return appOperation(async () => {
    const readable = await getDoc(table, name, user)
    const meta = await getMeta(table)
    // #1021: a view's row is its base's row; what may be done to it is too.
    if (meta.kind === 'view') return rowCapabilities(meta.view_of!, name, user)
    // A read share can bypass Data Scopes, but (unlike a write share) cannot
    // authorize saving. Check mutations against the full row, not a read-tier
    // projection that may omit a restricted Reference used by a Data Scope.
    const row = meta.kind === 'settings' ? readable : isBound(meta)
      ? await boundFetchDoc(meta, name)
      : (await sql`select * from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = ${name}`)[0]
    if (!row) throw new AppError('NotFoundError', `${table} ${name} not found`)
    const allowed = (check: () => Promise<void>): Promise<boolean> =>
      orWhenRefused(async () => { await check(); return true }, () => false, ['PermissionError'])
    const rowGrant = (action: 'write' | 'delete' | 'submit' | 'cancel' | 'amend') => allowed(async () => {
      assertRowsWritable(meta, 'changed')
      await assertSecurityWriter(table, user)
      if (isBound(meta) && (action === 'write' || action === 'delete')) {
        await writableContext(meta)
        await assertBoundScope(meta, user, action)
      } else if (meta.kind === 'settings' && action === 'write') {
        await assertPermission(user, table, action)
        return
      } else if (action === 'write' && await isSharedWith(user, table, name, 'write')) {
        return
      } else {
        await assertDocPermission(user, table, action, String(row.created_by))
      }
      if (action !== 'amend') await assertUserPermissions(user, meta, row)
      if (action === 'delete' && ROW_ATTACHED_TABLES.has(table)) await assertAttachedRowReadable(table, row, user)
    })
    // Rename deliberately does NOT inherit update's write-share exception.
    const rename = !isBound(meta) && meta.kind === 'table' && !ENGINE_MANAGED.has(table)
      && !meta.id_pattern?.startsWith('opaque:') && await allowed(async () => {
        assertRowsWritable(meta, 'renamed')
        await assertSecurityWriter(table, user)
        await assertDocPermission(user, table, 'write', String(row.created_by))
        await assertUserPermissions(user, meta, row)
      })
    const createIn = (target: string) => allowed(async () => {
      assertRowsWritable(await getMeta(target), 'created')
      await assertSecurityWriter(target, user)
      await assertPermission(user, target, 'create')
    })
    // #859: exactly the checks setRetirement runs, so advice never disagrees.
    const retirement = (action: 'delete' | 'write') => allowed(async () => {
      assertRowsWritable(meta, 'changed')
      await assertSecurityWriter(table, user)
      if (action === 'delete' || !(await isSharedWith(user, table, name, 'write'))) {
        await assertDocPermission(user, table, action, String(row.created_by))
        await assertUserPermissions(user, meta, row)
      }
    })
    const retirable = canRetire(meta)
    return {
      write: !ENGINE_MANAGED.has(table) && row.submission_status !== 'submitted' && row.submission_status !== 'cancelled' && await rowGrant('write'),
      retire: retirable && row.retired_at == null && await retirement('delete'),
      reactivate: retirable && row.retired_at != null && await retirement('write'),
      purge: await mayPurge(user, meta),
      rename,
      delete: meta.kind === 'table' && !ENGINE_MANAGED.has(table) && row.submission_status !== 'submitted' && await rowGrant('delete'),
      submit: Boolean(meta.is_submittable) && row.submission_status === 'draft' && await rowGrant('submit'),
      cancel: Boolean(meta.is_submittable) && row.submission_status === 'submitted' && await rowGrant('cancel'),
      amend: Boolean(meta.is_submittable) && row.submission_status === 'cancelled' && await rowGrant('amend'),
      assign: await createIn('ToDo'),
      tag: true, // tags, unlike ToDo/Comment/File creation, need only row read
      comment: await createIn('Comment'),
      upload: await createIn('File'),
    }
  })
}

async function getDocImpl(
  table: string,
  name: string,
  user = 'Administrator',
): Promise<RowValues> {
  const meta = await getMeta(table)
  if (meta.kind === 'settings') return getSingle(meta, user)
  // #1021: a view's row is its base's row, read as one, and found through
  // the view only while the view's filter matches it.
  if (meta.kind === 'view') {
    const { table: base, where } = await scopedWhere(table, user, [[ROW_KEY, '=', name]])
    const [inView] = await sql`select 1 from ${sql(base)} where ${where}`
    if (!inView) throw new AppError('NotFoundError', `${table} ${name} not found`)
    return getDocImpl(meta.view_of!, name, user)
  }
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
      ? new Set(ALL_COLUMNS)
      : await permittedColumns(user, table, 'read', String(doc.created_by ?? ''))
    return { table, ...filterReadFields(meta.columns, tiers, doc) }
  }
  const [row] = await sql`
    select * from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = ${name}`
  if (!row) throw new AppError('NotFoundError', `${table} ${name} not found`)
  // PERM-008: a direct share grants read even without role permission.
  await assertMandatoryAccess(user, meta, row as RowValues)
  if (ROW_ATTACHED_TABLES.has(meta.name)) await assertAttachedRowReadable(meta.name, row as RowValues, user)
  const shared = await isSharedWith(user, table, name, 'read')
  if (!shared) {
    await assertPermission(user, table, 'read')
    await assertDocPermission(user, table, 'read', String(row.created_by))
    await assertUserPermissions(user, meta, row as RowValues)
    if (meta.kind === 'sub_table') await assertParentReadable(row as RowValues, user)
  }
  // A share grants full field visibility; otherwise honor tiers, on the row
  // and on its sub-table rows alike (#341).
  const reader = shared ? FULL_READER : await readerFor(user, table, 'read', String(row.created_by))
  const readable = await restrictRow(meta, await loadChildren(meta, { table, ...(row as RowValues) }), reader)
  const outside = await linksOutsideViews(meta, readable)
  return outside.length ? { ...readable, links_outside_view: outside } : readable
}

/** #1021: the link columns whose value is a row that has since left the view
 *  the column links to. The link stays and still saves unchanged; the row's
 *  page says it no longer matches. Only columns the reader can see count. */
async function linksOutsideViews(meta: TableMeta, row: RowValues): Promise<string[]> {
  const out: string[] = []
  for (const f of meta.columns) {
    if (f.column_type !== 'Reference' || !f.reference_base || !Object.hasOwn(row, f.column_name)) continue
    const value = own(row, f.column_name)
    if (value == null || value === '') continue
    const view = await getMeta(f.reference_table!)
    const inside = await rowsInView(sql, view, [String(value)], await tableRelation(f.reference_base))
    if (!inside.has(String(value))) out.push(f.column_name)
  }
  return out
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
    submission_status: 'draft',
  }
  for (const f of meta.columns) {
    if (NO_COLUMN_TYPES.has(f.column_type)) continue
    const raw = stored.has(f.column_name) ? (stored.get(f.column_name) ?? null) : (f.default_value ?? null)
    row[f.column_name] = coerceSingleValue(f.column_type, raw)
  }
  const readTiers = await permittedColumns(user, meta.name, 'read', 'Administrator')
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

// #923: the roles everyone who signs in holds are stored one per line, each
// a role that exists. Changing them changes what every person may do, so only
// a System Manager may (the rest of System Settings stays as its Permission
// rows allow).
async function settleEveryoneRoles(tx: typeof sql, clean: RowValues, before: Record<string, string | null>, user: string) {
  const roles = parseEveryoneRoles(clean[EVERYONE_ROLES_FIELD])
  clean[EVERYONE_ROLES_FIELD] = roles.join('\n') || null
  if ((clean[EVERYONE_ROLES_FIELD] ?? null) === (before[EVERYONE_ROLES_FIELD] ?? null)) return
  await assertSystemManager(user)
  await checkEveryoneRoles(tx, roles)
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
  assertRowsWritable(meta, 'saved')
  await assertSecurityWriter(table, user)
  if (meta.kind !== 'settings') throw new AppError('ValidationError', `${table} is not a Settings Table`)
  await assertPermission(user, table, 'write')
  const writeTiers = await permittedColumns(user, table, 'write', 'Administrator')
  let clean: RowValues = {}
  // #465: one transaction, and a version like any other row's save, so a
  // settings change has history. Compared as stored text, both sides.
  await sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    const stored = async () => Object.fromEntries(
      (await stx`select field, value from single_value where table_name = ${table}`).map((r) => [r.field as string, r.value as string | null]))
    await holdManagedSet(stx, table)
    const before = await stored()
    // An unchanged value of a Column outside the grant is not a change.
    clean = validateValues(
      meta,
      // What the reader was shown: stored values, else each Column's default.
      stripUnwritableFields(meta.columns, writeTiers, pickFieldValues(meta, values), {
        ...Object.fromEntries(meta.columns.filter((c) => c.default_value != null).map((c) => [c.column_name, c.default_value])),
        ...before,
      }),
      'update',
    )
    if (table === 'System Settings' && EVERYONE_ROLES_FIELD in clean) await settleEveryoneRoles(stx, clean, before, user)
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
