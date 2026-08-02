import { randomBytes } from 'node:crypto'
import { tableSchemaToZod, zodFieldErrors } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type TableMeta } from './meta'
import { STANDARD_COLUMNS, tableName } from './doctype-engine'
import { runHooks, type HookContext } from './controllers'
import { evaluateEmailRules, type LifecycleEvent } from './email-rules'
import { evaluateAssignmentRules } from './assignment-rules'
import { applySla } from './sla'
import { getActiveWorkflow, stateField } from './workflow'
import { evaluateWebhooks } from './webhooks'
import { runDocEventScripts } from './server-scripts'
import { SENSITIVE_COLUMNS } from './sensitive-columns'
import {
  assertDocPermission,
  assertPermission,
  checkUserPermissions,
  filterReadFields,
  getUserPermissionMap,
  isBypassUser,
  isSharedWith,
  permittedTiers,
  stripUnwritableFields,
} from './permissions'
import {
  assertBoundScope,
  boundFetchDoc,
  isBound,
  mapRowOut,
  mapValuesIn,
  writableContext,
} from './sources/dispatch'

// Hooks may set any writable column; re-filter after they run so a hook
// can't inject unknown keys into SQL.
function columnValues(meta: TableMeta, row: RowValues): RowValues {
  const out: RowValues = {}
  for (const f of meta.columns) {
    if (NO_COLUMN_TYPES.has(f.column_type)) continue
    if (f.column_name in row) out[f.column_name] = row[f.column_name]
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
  return parsed
}

export type RowValues = Record<string, unknown>

const NO_COLUMN_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break'])

function hashName(): string {
  return randomBytes(5).toString('hex')
}

// META-006: resolve a new row's name from the Table's id_pattern rule.
// Series counters use INSERT ... ON CONFLICT DO UPDATE inside the save
// transaction: concurrent savers serialize on the counter row, so names are
// unique and sequential; a rolled-back save also rolls back the increment.
async function resolveName(
  tx: typeof sql,
  meta: TableMeta,
  values: RowValues,
): Promise<string> {
  // DOC-008: amended rows carry a pre-derived NAME-n.
  if (values.amended_from != null && values.name)
    return String(values.name)
  const rule = meta.id_pattern || 'hash'
  if (rule === 'hash') return hashName()
  if (rule === 'prompt') {
    const name = String(values.name ?? '').trim()
    if (!name)
      throw new AppError('ValidationError', `${meta.name} requires a name`, {
        name: 'Name is required',
      })
    return name
  }
  if (rule.startsWith('field:')) {
    const columnName = rule.slice('field:'.length)
    const value = String(values[columnName] ?? '').trim()
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
    throw new AppError('ValidationError', 'Unknown fields', errors)
  return out
}

// META-010: fill defaults for columns absent on insert (read_only included —
// defaults are how system-managed columns get their values).
function applyDefaults(meta: TableMeta, values: RowValues): RowValues {
  const out = { ...values }
  for (const f of meta.columns) {
    if (NO_COLUMN_TYPES.has(f.column_type)) continue
    if (out[f.column_name] != null) continue
    if (f.default_value == null) continue
    if (f.column_type === 'Int' || f.column_type === 'Float' || f.column_type === 'Currency')
      out[f.column_name] = Number(f.default_value)
    else if (f.column_type === 'Check')
      out[f.column_name] = f.default_value === '1' || f.default_value === 'true'
    else out[f.column_name] = f.default_value
  }
  return out
}

// META-010: translate Postgres constraint violations into field-wise
// ValidationErrors instead of opaque 500s.
function mapDbError(meta: TableMeta, err: unknown): never {
  const e = err as {
    code?: string
    constraint_name?: string
    column_name?: string
    detail?: string
  }
  if (e?.code === '23505') {
    // Postgres names the offending columns in `detail`:
    //   Key (language, source_text)=(fr, Save) already exists.
    // Prefer that over the constraint name. Naming the constraint only works
    // for our generated `x_column_uq` singles, and everything else — a
    // plain unique INDEX, a composite, the primary key — used to fall back to
    // reporting `name`, blaming a field that was not the problem. That cost
    // real debugging time on `translation_lang_src` (issue #42).
    const detailCols = /^Key \(([^)]+)\)=/.exec(e.detail ?? '')?.[1]
    const prefix = `${tableName(meta.name)}_`
    const fields = detailCols
      ? detailCols.split(', ').map((c) => c.replace(/^"|"$/g, ''))
      : e.constraint_name?.startsWith(prefix) && e.constraint_name.endsWith('_uq')
        ? [e.constraint_name.slice(prefix.length, -'_uq'.length)]
        : ['name']
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
// target Table. Runs inside the save transaction alongside validation.
async function validateLinks(
  tx: typeof sql,
  meta: TableMeta,
  fieldValues: RowValues,
  prefix = '',
) {
  const errors: Record<string, string> = {}
  for (const f of meta.columns) {
    if (f.column_type !== 'Reference') continue
    const value = fieldValues[f.column_name]
    if (value == null || value === '') continue
    const target = f.reference_table
    if (!target) continue
    const [targetMeta] = await tx`select 1 from table_def where name = ${target}`
    if (!targetMeta) {
      errors[prefix + f.column_name] = `Reference target Table ${target} does not exist`
      continue
    }
    const [row] = await tx`
      select 1 from ${tx(tableName(target))} where name = ${String(value)}`
    if (!row)
      errors[prefix + f.column_name] = `${target} ${String(value)} does not exist`
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', `Invalid links for ${meta.name}`, errors)
}

// PERM-005: gate a concrete row against the user's Data Scopes.
async function assertUserPermissions(
  user: string,
  meta: TableMeta,
  row: RowValues,
) {
  if (await isBypassUser(user)) return
  const map = await getUserPermissionMap(user)
  if (!map.size) return
  const linkFields = meta.columns
    .filter((f) => f.column_type === 'Reference')
    .map((f) => ({ column_name: f.column_name, reference_table: f.reference_table }))
  checkUserPermissions(user, meta.name, linkFields, row, map)
}

// META-007/DOC-005: extract Sub-table column arrays from the payload; they are
// saved as child rows in the same transaction as the parent.
function pickChildInputs(meta: TableMeta, values: RowValues) {
  const out: { columnName: string; childTable: string; rows: RowValues[] }[] = []
  for (const f of meta.columns) {
    if (f.column_type !== 'Sub-table') continue
    const raw = values[f.column_name]
    if (raw === undefined) continue
    if (!Array.isArray(raw))
      throw new AppError('ValidationError', 'Invalid child table payload', {
        [f.column_name]: `${f.column_name} must be an array of rows`,
      })
    out.push({ columnName: f.column_name, childTable: f.row_table!, rows: raw as RowValues[] })
  }
  return out
}

async function saveChildren(
  tx: typeof sql,
  parentMeta: TableMeta,
  parentName: string,
  input: { columnName: string; childTable: string; rows: RowValues[] },
  user: string,
) {
  const childMeta = await getMeta(input.childTable)
  const table = tableName(childMeta.name)
  const existing = await tx`
    select name from ${tx(table)}
    where parent = ${parentName} and parenttype = ${parentMeta.name}
      and parentfield = ${input.columnName}`
  const existingNames = new Set(existing.map((r) => r.name as string))
  const keep = new Set<string>()
  const errors: Record<string, string> = {}

  for (const [i, row] of input.rows.entries()) {
    const isExisting = row.name != null && existingNames.has(String(row.name))
    let fieldValues: RowValues
    try {
      fieldValues = validateValues(
        childMeta,
        applyDefaults(childMeta, pickFieldValues(childMeta, row)),
        isExisting ? 'update' : 'insert',
      )
    } catch (err) {
      if (err instanceof AppError && err.fields)
        for (const [k, v] of Object.entries(err.fields))
          errors[`${input.columnName}.${i}.${k}`] = v
      else throw err
      continue
    }
    await validateLinks(tx, childMeta, fieldValues, `${input.columnName}.${i}.`)
    const now = new Date()
    if (isExisting) {
      keep.add(String(row.name))
      await tx`update ${tx(table)} set ${tx({
        ...fieldValues,
        position: i + 1,
        updated_at: now,
        updated_by: user,
      })} where name = ${String(row.name)}`
    } else {
      await tx`insert into ${tx(table)} ${tx({
        name: hashName(),
        created_by: user,
        updated_by: user,
        created_at: now,
        updated_at: now,
        status: 'draft',
        position: i + 1,
        parent: parentName,
        parenttype: parentMeta.name,
        parentfield: input.columnName,
        ...fieldValues,
      })}`
    }
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', `Invalid child rows for ${input.columnName}`, errors)

  // Rows omitted from the payload are deleted — the payload is authoritative.
  const remove = [...existingNames].filter((n) => !keep.has(n))
  if (remove.length)
    await tx`delete from ${tx(table)} where name in ${tx(remove)}`
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
  for (const [k, v] of Object.entries(row))
    if (known.has(k) && !SENSITIVE_COLUMNS.has(k)) out[k] = v
  return out
}

async function loadChildren(meta: TableMeta, row: RowValues): Promise<RowValues> {
  for (const f of meta.columns) {
    if (f.column_type !== 'Sub-table') continue
    const childMeta = await getMeta(f.row_table!)
    const rows = await sql`
      select * from ${sql(tableName(f.row_table!))}
      where parent = ${String(row.name)} and parenttype = ${meta.name}
        and parentfield = ${f.column_name}
      order by position`
    row[f.column_name] = rows.map((r) => stripInternalColumns(childMeta, r as RowValues))
  }
  return stripInternalColumns(meta, row)
}

// Table/Column writes must go through the doctype engine (runs DDL);
// the generic row path would silently skip table changes.
const ENGINE_MANAGED = new Set(['Table', 'Column'])

// IMP-007: validation-only pass for dry-run imports — the same field
// filtering, defaults, and zod validation an insert runs, plus the checks a
// provided/required name would hit, with no writes. Automation triggers and
// tier stripping do not run here, so a trigger can still reject at real
// import time; the dry run catches everything schema-level.
export async function checkRowForInsert(meta: TableMeta, values: RowValues): Promise<void> {
  if (isBound(meta))
    throw new AppError(
      'ValidationError',
      `${meta.name} is bound to data source ${meta.data_source}; bulk import is not supported on bound Tables yet`,
    )
  validateValues(meta, applyDefaults(meta, pickFieldValues(meta, values)), 'insert')
  const name = String(values.name ?? '').trim()
  if (meta.id_pattern === 'prompt' && !name)
    throw new AppError('ValidationError', `${meta.name} requires a name`, {
      name: 'Name is required',
    })
  if (name) {
    const [exists] = await sql`
      select 1 from ${sql(tableName(meta.name))} where name = ${name}`
    if (exists) throw new AppError('ConflictError', `${meta.name} ${name} already exists`)
  }
}

export interface SaveOptions {
  // WEB-002/003: the web-form surface is server-controlled (whitelisted columns
  // on one configured Table), so it may insert on behalf of a session user
  // who holds no create Permission — the row still gets that user as
  // created_by, which is what makes own_rows_only portals work. Never expose
  // this to callers that pass through arbitrary client input.
  skipPermissions?: boolean
}

export async function saveDoc(
  table: string,
  values: RowValues,
  user = 'Administrator',
  mode: 'upsert' | 'insert' = 'upsert',
  opts: SaveOptions = {},
): Promise<RowValues> {
  const meta = await getMeta(table)
  if (ENGINE_MANAGED.has(table))
    throw new AppError(
      'ValidationError',
      `${table} rows are managed via /api/table`,
    )
  if (isBound(meta)) return saveBoundDoc(meta, values, user, mode)
  if (meta.kind === 'settings') return saveSingle(table, values, user)
  if (meta.kind === 'sub_table')
    throw new AppError(
      'ValidationError',
      `${table} is a child Table; save it through its parent`,
    )
  if (values.name != null && values.name !== '') {
    const [exists] = await sql`
      select 1 from ${sql(tableName(table))} where name = ${String(values.name)}`
    if (exists) {
      if (mode === 'insert')
        throw new AppError('ConflictError', `${table} ${values.name} already exists`)
      return updateDoc(meta, String(values.name), values, user)
    }
    if (meta.id_pattern !== 'prompt' && values.amended_from == null)
      throw new AppError('NotFoundError', `${table} ${values.name} not found`)
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
  const tbl = tableName(table)
  const [saved] = await sql
    .begin(async (tx) => {
      const stx = tx as unknown as typeof sql
      const name = await resolveName(stx, meta, values)
      const now = new Date()
      const row: RowValues = {
        name,
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
      const dbRow = {
        ...columnValues(meta, row),
        name: String(row.name),
        created_by: row.created_by,
        updated_by: row.updated_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        status: row.status,
        position: row.position,
      }
      await validateLinks(stx, meta, dbRow)
      const inserted = await tx`insert into ${tx(tbl)} ${tx(dbRow as unknown as Record<string, never>)} returning *`
      for (const input of childInputs)
        await saveChildren(stx, meta, name, input, user)
      ctx.row = { ...(inserted[0] as RowValues) }
      await runHooks('after_insert', ctx)
      await runHooks('after_save', ctx)
      await runHooks('on_update', ctx)
      await runDocEventScripts('after_save', meta.name, ctx.row, ctx.tx)
      return inserted
    })
    .catch((err) => mapDbError(meta, err))
  const insertResult = await loadChildren(meta, { table, ...(saved as RowValues) })
  // EML-004: fire matching email rules post-commit. Frappe's Save event covers
  // inserts too, so both on_create and on_save rules are evaluated here.
  await evaluateEmailRules('on_create', meta.name, insertResult)
  await evaluateEmailRules('on_save', meta.name, insertResult)
  // Auto-assignment: apply any Assignment Rules for this Table (post-commit).
  await evaluateAssignmentRules(meta.name, insertResult)
  // PLAT-005: fire webhooks post-commit for the create event.
  await evaluateWebhooks('after_insert', meta.name, insertResult)
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
    values.name == null || values.name === '' ? null : String(values.name)
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
  const row: RowValues = { name: providedName, status: 'draft', ...fieldValues }
  const hctx: HookContext = { row, meta, user, isNew: true, tx: sql }
  await runHooks('before_insert', hctx)
  await runHooks('before_validate', hctx)
  await runHooks('validate', hctx)
  await runHooks('before_save', hctx)
  const inserted = await ctx.driver
    .insert(ctx.bind, mapValuesIn(ctx.bind, columnValues(meta, hctx.row)), providedName)
    .catch((err) => mapDbError(meta, err))
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

// EDS-8, 'modified' mode: when the source has a mapped modified column the
// client must echo the updated_at it loaded, exactly like native updates.
// Without one, updates are last-write-wins (the Desk shows that state).
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
  // write (finding 1), and Data Scopes judge the row being changed.
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
  // actually changed — so CLI-owned columns the Desk never touched survive.
  const toWrite: RowValues = {}
  const norm = (v: unknown) => JSON.stringify(v instanceof Date ? v.toISOString() : (v ?? null))
  for (const f of meta.columns) {
    if (NO_COLUMN_TYPES.has(f.column_type)) continue
    const k = f.column_name
    if (k in fieldValues) toWrite[k] = k in hctx.row ? hctx.row[k] : fieldValues[k]
    else if (k in hctx.row && norm(hctx.row[k]) !== norm(current[k])) toWrite[k] = hctx.row[k]
  }
  const sourceValues = mapValuesIn(ctx.bind, toWrite)
  const expect = ctx.bind.modified ? String(values.updated_at) : null
  const updated = await ctx.driver
    .update(ctx.bind, name, sourceValues, expect)
    .catch((err) => mapDbError(meta, err))
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
): Promise<RowValues> {
  const table = tableName(meta.name)
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
  // WF-003: the workflow-bound state field only changes through workflow
  // actions (apply_workflow_action) — a direct save changing it would bypass
  // the role-gated transitions.
  {
    const wf = await getActiveWorkflow(meta.name)
    if (wf) {
      const sf = stateField(wf)
      if (sf in fieldValues) {
        const [current] = await sql`
          select ${sql(sf)} as v from ${sql(table)} where name = ${name}`
        if (current && String(fieldValues[sf] ?? '') !== String(current.v ?? ''))
          throw new AppError(
            'ValidationError',
            `${sf} is controlled by workflow "${wf.name}" — use a workflow action to change it`,
          )
      }
    }
  }

  // Snapshot of the row before this save, for post-commit transition checks.
  let previous: RowValues | undefined
  const saved = await sql
    .begin(async (tx) => {
      const stx = tx as unknown as typeof sql
      const [existing] = await tx`
        select * from ${tx(table)} where name = ${name} for update`
      if (!existing)
        throw new AppError('NotFoundError', `${meta.name} ${name} not found`)
      previous = { ...(existing as RowValues) }
      // PERM-008: a share with write grants update even without role write.
      if (!sharedWrite) {
        await assertDocPermission(user, meta.name, 'write', String(existing.created_by))
        await assertUserPermissions(user, meta, existing as RowValues)
      }
      const dbModified = (existing.updated_at as Date).getTime()
      const sentModified = new Date(String(values.updated_at)).getTime()
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
      const dbRow = {
        ...columnValues(meta, row),
        updated_at: new Date(),
        updated_by: user,
      }
      await validateLinks(stx, meta, dbRow)
      const [updated] = await tx`
        update ${tx(table)} set ${tx(dbRow)} where name = ${name} returning *`
      for (const input of pickChildInputs(meta, values))
        await saveChildren(stx, meta, name, input, user)
      await recordVersion(stx, meta, name, existing as RowValues, updated as RowValues, user)
      ctx.row = { ...(updated as RowValues) }
      await runHooks('after_save', ctx)
      await runHooks('on_update', ctx)
      await runDocEventScripts('after_save', meta.name, ctx.row, ctx.tx)
      return updated
    })
    .catch((err) => mapDbError(meta, err))
  const updateResult = await loadChildren(meta, { table: meta.name, ...(saved as RowValues) })
  // EML-004: on_save rules fire post-commit; the pre-save snapshot lets a
  // conditional rule fire only when the value transitions into the match.
  await evaluateEmailRules('on_save', meta.name, updateResult, previous)
  // PLAT-005: fire webhooks post-commit for the update event.
  await evaluateWebhooks('on_update', meta.name, updateResult)
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
    const b = norm(before[f.column_name])
    const a = norm(after[f.column_name])
    if (JSON.stringify(b) !== JSON.stringify(a)) changed.push([f.column_name, b, a])
  }
  if (!changed.length) return
  const now = new Date()
  await tx`insert into version ${tx({
    name: hashName(),
    created_by: user,
    updated_by: user,
    created_at: now,
    updated_at: now,
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
  if (!meta.is_submittable)
    throw new AppError('ValidationError', `${table} is not submittable`)
  const tbl = tableName(table)
  const [saved] = await sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    const [existing] = await tx`
      select * from ${tx(tbl)} where name = ${name} for update`
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
    // Frappe order: before_submit/before_cancel run BEFORE the write and may
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
      where name = ${name} returning *`
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
  })
  const result = await loadChildren(meta, { table, ...(saved as RowValues) })
  // EML-004: fire matching email rules for this lifecycle event (post-commit).
  await evaluateEmailRules(event as LifecycleEvent, table, saved as RowValues)
  // PLAT-005: fire webhooks for submit/cancel (post-commit).
  await evaluateWebhooks(event === 'on_submit' ? 'on_submit' : 'on_cancel', table, result)
  return result
}

export function submitDoc(table: string, name: string, user = 'Administrator') {
  return setStatus(table, name, 'draft', 'submitted', 'on_submit', user)
}

export function cancelDoc(table: string, name: string, user = 'Administrator') {
  return setStatus(table, name, 'submitted', 'cancelled', 'on_cancel', user)
}

// DOC-008: create a fresh draft from a cancelled row. The copy carries
// amended_from and a derived NAME-n; children are copied as new rows.
export async function amendDoc(
  table: string,
  name: string,
  user = 'Administrator',
): Promise<RowValues> {
  const meta = await getMeta(table)
  if (!meta.is_submittable)
    throw new AppError('ValidationError', `${table} is not submittable`)
  const source = await getDoc(table, name, user)
  if ((source.status as string) !== 'cancelled')
    throw new AppError('ValidationError', `${table} ${name} must be cancelled before amending`)
  await assertDocPermission(user, table, 'amend', String(source.created_by))

  const [{ count }] = await sql`
    select count(*)::int as count from ${sql(tableName(table))}
    where amended_from = ${name}`
  const newName = `${name}-${(count as number) + 1}`

  const values: RowValues = { name: newName, amended_from: name }
  for (const f of meta.columns) {
    if (f.column_name === 'amended_from') continue
    if (f.column_type === 'Section Break' || f.column_type === 'Column Break') continue
    if (f.column_type === 'Sub-table') {
      const rows = (source[f.column_name] as RowValues[] | undefined) ?? []
      values[f.column_name] = rows.map((r) => {
        const copy: RowValues = {}
        for (const [k, v] of Object.entries(r))
          if (!(STANDARD_COLUMNS as readonly string[]).includes(k)) copy[k] = v
        return copy
      })
    } else {
      values[f.column_name] = source[f.column_name]
    }
  }
  return saveDoc(table, values, user)
}

// DOC-006: a row referenced by Reference columns anywhere cannot be deleted.
export async function deleteDoc(
  table: string,
  name: string,
  user = 'Administrator',
  opts: { expectUpdatedAt?: string | null } = {},
): Promise<void> {
  const meta = await getMeta(table)
  if (meta.kind === 'settings' || meta.kind === 'sub_table' || ENGINE_MANAGED.has(table))
    throw new AppError('ValidationError', `${table} rows cannot be deleted directly`)
  if (isBound(meta)) return deleteBoundDoc(meta, name, user, opts.expectUpdatedAt ?? null)
  await sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    const [existing] = await tx`
      select * from ${tx(tableName(table))} where name = ${name} for update`
    if (!existing)
      throw new AppError('NotFoundError', `${table} ${name} not found`)
    await assertDocPermission(user, table, 'delete', String(existing.created_by))
    await assertUserPermissions(user, meta, existing as RowValues)
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
      const refCols = parentMeta.kind === 'sub_table'
        ? ['name', 'parent', 'parenttype']
        : ['name']
      const [ref] = await tx`
        select ${tx(refCols)} from ${tx(tableName(parentTable))}
        where ${tx(lf.column_name as string)} = ${name} limit 1`
      if (ref) {
        const holder = parentMeta.kind === 'sub_table'
          ? `${ref.parenttype as string} ${ref.parent as string}`
          : `${parentTable} ${ref.name as string}`
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
    for (const f of meta.columns) {
      if (f.column_type !== 'Sub-table') continue
      await tx`
        delete from ${tx(tableName(f.row_table!))}
        where parent = ${name} and parenttype = ${table}`
    }
    await tx`delete from ${tx(tableName(table))} where name = ${name}`
  })
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
    const [ref] = await sql`
      select name from ${sql(tableName(parentTable))}
      where ${sql(lf.column_name as string)} = ${name} limit 1`
    if (ref)
      throw new AppError(
        'ValidationError',
        `Cannot delete ${meta.name} ${name}: it is linked from ${parentTable} ${ref.name as string}`,
      )
  }
  const hctx: HookContext = {
    row: mapRowOut(ctx.bind, existing),
    meta,
    user,
    isNew: false,
    tx: sql,
  }
  await runHooks('on_trash', hctx)
  const outcome = await ctx.driver.remove(ctx.bind, name, expectUpdatedAt)
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
// transaction. The row keeps all its other data and children.
export async function renameDoc(
  table: string,
  oldName: string,
  newName: string,
  user = 'Administrator',
): Promise<RowValues> {
  const meta = await getMeta(table)
  if (meta.kind === 'settings' || meta.kind === 'sub_table' || ENGINE_MANAGED.has(table))
    throw new AppError('ValidationError', `${table} rows cannot be renamed`)
  if (isBound(meta))
    throw new AppError(
      'ValidationError',
      `${table} is bound to data source ${meta.data_source}; its primary keys belong to the source and cannot be renamed here`,
    )
  const target = newName.trim()
  if (!target) throw new AppError('ValidationError', 'New name is required', { name: 'Required' })
  if (target === oldName) return getDoc(table, oldName, user)

  await sql.begin(async (tx) => {
    const tbl = tableName(table)
    const [existing] = await tx`
      select * from ${tx(tbl)} where name = ${oldName} for update`
    if (!existing) throw new AppError('NotFoundError', `${table} ${oldName} not found`)
    await assertDocPermission(user, table, 'write', String(existing.created_by))
    await assertUserPermissions(user, meta, existing as RowValues)
    const [clash] = await tx`select 1 from ${tx(tbl)} where name = ${target}`
    if (clash) throw new AppError('ConflictError', `${table} ${target} already exists`)

    // Rename the row itself.
    await tx`update ${tx(tbl)} set name = ${target}, updated_at = now() where name = ${oldName}`

    // Re-point this row's own child rows to the new parent name.
    for (const f of meta.columns) {
      if (f.column_type !== 'Sub-table') continue
      await tx`
        update ${tx(tableName(f.row_table!))} set parent = ${target}
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
        update ${tx(tableName(parentTable))} set ${tx(col)} = ${target}
        where ${tx(col)} = ${oldName}`
    }
  })
  return getDoc(table, target, user)
}

export async function getDoc(
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
    const boundShared = await isSharedWith(user, table, name, 'read')
    if (!boundShared) await assertPermission(user, table, 'read')
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
    select * from ${sql(tableName(table))} where name = ${name}`
  if (!row) throw new AppError('NotFoundError', `${table} ${name} not found`)
  // PERM-008: a direct share grants read even without role permission.
  const shared = await isSharedWith(user, table, name, 'read')
  if (!shared) {
    await assertPermission(user, table, 'read')
    await assertDocPermission(user, table, 'read', String(row.created_by))
    await assertUserPermissions(user, meta, row as RowValues)
  }
  // A share grants full field visibility; otherwise honor tiers.
  const readTiers = shared
    ? new Set<'basic' | 'restricted'>(['basic', 'restricted'])
    : await permittedTiers(user, table, 'read')
  const visible = filterReadFields(meta.columns, readTiers, row as RowValues)
  return loadChildren(meta, { table, ...visible })
}

// SET-001: read a Settings Table's one instance from the EAV store, applying
// column defaults for any value not yet set. Its name is the Table name.
async function getSingle(meta: TableMeta, user: string): Promise<RowValues> {
  await assertPermission(user, meta.name, 'read')
  const rows = await sql`select field, value from single_value where table_name = ${meta.name}`
  const stored = new Map(rows.map((r) => [r.field as string, r.value as string | null]))
  const row: RowValues = { table: meta.name, name: meta.name, created_by: 'Administrator', status: 'draft' }
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
export async function saveSingle(
  table: string,
  values: RowValues,
  user = 'Administrator',
): Promise<RowValues> {
  const meta = await getMeta(table)
  if (meta.kind !== 'settings') throw new AppError('ValidationError', `${table} is not a Settings Table`)
  await assertPermission(user, table, 'write')
  const writeTiers = await permittedTiers(user, table, 'write')
  const clean = validateValues(
    meta,
    stripUnwritableFields(meta.columns, writeTiers, pickFieldValues(meta, values)),
    'update',
  )
  for (const [field, value] of Object.entries(clean)) {
    const text = value == null ? null : typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
    await sql`
      insert into single_value ${sql({ table_name: table, field, value: text })}
      on conflict (table_name, field) do update set value = excluded.value`
  }
  return getDoc(table, table, user)
}
