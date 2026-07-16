import { randomBytes } from 'node:crypto'
import { metaToZod, zodFieldErrors } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type DocTypeMeta } from './meta'
import { STANDARD_COLUMNS, tableName } from './doctype-engine'
import { runHooks, type HookContext } from './controllers'
import { evaluateEmailRules, type LifecycleEvent } from './email-rules'
import {
  assertDocPermission,
  assertPermission,
  checkUserPermissions,
  filterReadFields,
  getUserPermissionMap,
  isBypassUser,
  isSharedWith,
  permittedLevels,
  stripUnwritableFields,
} from './permissions'

// Hooks may set any writable column; re-filter after they run so a hook
// can't inject unknown keys into SQL.
function columnValues(meta: DocTypeMeta, doc: DocValues): DocValues {
  const out: DocValues = {}
  for (const f of meta.fields) {
    if (NO_COLUMN_TYPES.has(f.fieldtype)) continue
    if (f.fieldname in doc) out[f.fieldname] = doc[f.fieldname]
  }
  return out
}

// DOC-011 + META-009: validate field values against the metadata-generated
// zod schema. Inserts validate the whole doc (missing reqd fields fail);
// updates validate only the fields being changed.
function validateValues(
  meta: DocTypeMeta,
  values: DocValues,
  mode: 'insert' | 'update',
): DocValues {
  const schema = metaToZod(meta.fields)
  const result = (mode === 'update' ? schema.partial() : schema).safeParse(values)
  if (!result.success)
    throw new AppError(
      'ValidationError',
      `Invalid values for ${meta.name}`,
      zodFieldErrors(result.error),
    )
  const parsed = result.data as DocValues
  // zod's empty-preprocess turns provided-but-empty optionals into
  // undefined; write them back as explicit nulls so updates can clear values.
  for (const key of Object.keys(values))
    if (parsed[key] === undefined) parsed[key] = null
  return parsed
}

export type DocValues = Record<string, unknown>

const NO_COLUMN_TYPES = new Set(['Table', 'Section Break', 'Column Break'])

function hashName(): string {
  return randomBytes(5).toString('hex')
}

// META-006: resolve a new document's name from the DocType's autoname rule.
// Series counters use INSERT ... ON CONFLICT DO UPDATE inside the save
// transaction: concurrent savers serialize on the counter row, so names are
// unique and sequential; a rolled-back save also rolls back the increment.
async function resolveName(
  tx: typeof sql,
  meta: DocTypeMeta,
  values: DocValues,
): Promise<string> {
  // DOC-008: amended documents carry a pre-derived NAME-n.
  if (values.amended_from != null && values.name)
    return String(values.name)
  const rule = meta.autoname || 'hash'
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
    const fieldname = rule.slice('field:'.length)
    const value = String(values[fieldname] ?? '').trim()
    if (!value)
      throw new AppError('ValidationError', `Naming field ${fieldname} is required`, {
        [fieldname]: `${fieldname} is required for naming`,
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
  throw new AppError('ValidationError', `Unsupported autoname rule ${rule}`)
}

// Filter incoming values to real data fields; reject unknown keys so typos
// fail loudly instead of silently dropping data. read_only fields are
// system-managed (META-010): client-sent values for them are ignored.
function pickFieldValues(meta: DocTypeMeta, values: DocValues): DocValues {
  const known = new Map(meta.fields.map((f) => [f.fieldname, f]))
  const out: DocValues = {}
  const errors: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (key === 'doctype') continue
    if ((STANDARD_COLUMNS as readonly string[]).includes(key)) continue
    const field = known.get(key)
    if (!field) {
      errors[key] = `Unknown field ${key} on ${meta.name}`
      continue
    }
    if (NO_COLUMN_TYPES.has(field.fieldtype)) continue
    if (field.read_only) continue
    out[key] = value ?? null
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', 'Unknown fields', errors)
  return out
}

// META-010: fill defaults for fields absent on insert (read_only included —
// defaults are how system-managed fields get their values).
function applyDefaults(meta: DocTypeMeta, values: DocValues): DocValues {
  const out = { ...values }
  for (const f of meta.fields) {
    if (NO_COLUMN_TYPES.has(f.fieldtype)) continue
    if (out[f.fieldname] != null) continue
    if (f.default_value == null) continue
    if (f.fieldtype === 'Int' || f.fieldtype === 'Float' || f.fieldtype === 'Currency')
      out[f.fieldname] = Number(f.default_value)
    else if (f.fieldtype === 'Check')
      out[f.fieldname] = f.default_value === '1' || f.default_value === 'true'
    else out[f.fieldname] = f.default_value
  }
  return out
}

// META-010: translate Postgres constraint violations into field-wise
// ValidationErrors instead of opaque 500s.
function mapDbError(meta: DocTypeMeta, err: unknown): never {
  const e = err as { code?: string; constraint_name?: string; column_name?: string }
  if (e?.code === '23505') {
    const prefix = `${tableName(meta.name)}_`
    const field =
      e.constraint_name?.startsWith(prefix) && e.constraint_name.endsWith('_uq')
        ? e.constraint_name.slice(prefix.length, -'_uq'.length)
        : 'name'
    throw new AppError('ValidationError', `Duplicate value for ${field}`, {
      [field]: `${field} must be unique`,
    })
  }
  if (e?.code === '22003' || e?.code === '22001' || e?.code === '22P02')
    throw new AppError('ValidationError', 'Value out of range for a field')
  throw err as Error
}

// META-008: every Link value must reference an existing document of the
// target DocType. Runs inside the save transaction alongside validation.
async function validateLinks(
  tx: typeof sql,
  meta: DocTypeMeta,
  fieldValues: DocValues,
  prefix = '',
) {
  const errors: Record<string, string> = {}
  for (const f of meta.fields) {
    if (f.fieldtype !== 'Link') continue
    const value = fieldValues[f.fieldname]
    if (value == null || value === '') continue
    const target = f.options
    if (!target) continue
    const [targetMeta] = await tx`select 1 from tab_doctype where name = ${target}`
    if (!targetMeta) {
      errors[prefix + f.fieldname] = `Link target DocType ${target} does not exist`
      continue
    }
    const [row] = await tx`
      select 1 from ${tx(tableName(target))} where name = ${String(value)}`
    if (!row)
      errors[prefix + f.fieldname] = `${target} ${String(value)} does not exist`
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', `Invalid links for ${meta.name}`, errors)
}

// PERM-005: gate a concrete document against the user's User Permissions.
async function assertUserPermissions(
  user: string,
  meta: DocTypeMeta,
  doc: DocValues,
) {
  if (await isBypassUser(user)) return
  const map = await getUserPermissionMap(user)
  if (!map.size) return
  const linkFields = meta.fields
    .filter((f) => f.fieldtype === 'Link')
    .map((f) => ({ fieldname: f.fieldname, options: f.options }))
  checkUserPermissions(user, meta.name, linkFields, doc, map)
}

// META-007/DOC-005: extract Table-field arrays from the payload; they are
// saved as child rows in the same transaction as the parent.
function pickChildInputs(meta: DocTypeMeta, values: DocValues) {
  const out: { fieldname: string; childDoctype: string; rows: DocValues[] }[] = []
  for (const f of meta.fields) {
    if (f.fieldtype !== 'Table') continue
    const raw = values[f.fieldname]
    if (raw === undefined) continue
    if (!Array.isArray(raw))
      throw new AppError('ValidationError', 'Invalid child table payload', {
        [f.fieldname]: `${f.fieldname} must be an array of rows`,
      })
    out.push({ fieldname: f.fieldname, childDoctype: f.options!, rows: raw as DocValues[] })
  }
  return out
}

async function saveChildren(
  tx: typeof sql,
  parentMeta: DocTypeMeta,
  parentName: string,
  input: { fieldname: string; childDoctype: string; rows: DocValues[] },
  user: string,
) {
  const childMeta = await getMeta(input.childDoctype)
  const table = tableName(childMeta.name)
  const existing = await tx`
    select name from ${tx(table)}
    where parent = ${parentName} and parenttype = ${parentMeta.name}
      and parentfield = ${input.fieldname}`
  const existingNames = new Set(existing.map((r) => r.name as string))
  const keep = new Set<string>()
  const errors: Record<string, string> = {}

  for (const [i, row] of input.rows.entries()) {
    const isExisting = row.name != null && existingNames.has(String(row.name))
    let fieldValues: DocValues
    try {
      fieldValues = validateValues(
        childMeta,
        applyDefaults(childMeta, pickFieldValues(childMeta, row)),
        isExisting ? 'update' : 'insert',
      )
    } catch (err) {
      if (err instanceof AppError && err.fields)
        for (const [k, v] of Object.entries(err.fields))
          errors[`${input.fieldname}.${i}.${k}`] = v
      else throw err
      continue
    }
    await validateLinks(tx, childMeta, fieldValues, `${input.fieldname}.${i}.`)
    const now = new Date()
    if (isExisting) {
      keep.add(String(row.name))
      await tx`update ${tx(table)} set ${tx({
        ...fieldValues,
        idx: i + 1,
        modified: now,
        modified_by: user,
      })} where name = ${String(row.name)}`
    } else {
      await tx`insert into ${tx(table)} ${tx({
        name: hashName(),
        owner: user,
        modified_by: user,
        creation: now,
        modified: now,
        docstatus: 0,
        idx: i + 1,
        parent: parentName,
        parenttype: parentMeta.name,
        parentfield: input.fieldname,
        ...fieldValues,
      })}`
    }
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', `Invalid child rows for ${input.fieldname}`, errors)

  // Rows omitted from the payload are deleted — the payload is authoritative.
  const remove = [...existingNames].filter((n) => !keep.has(n))
  if (remove.length)
    await tx`delete from ${tx(table)} where name in ${tx(remove)}`
}

// Credential columns that must NEVER be serialized, even though some are
// declared as (hidden) DocFields for storage. Everything not listed here
// and not a standard column or DocField is dropped too.
const SENSITIVE_COLUMNS = new Set(['password_hash', 'api_secret_hash', 'api_key', 'new_password'])

// Raw table columns carry server-internal state. Only standard columns and
// declared (non-sensitive) DocFields leave through the API, regardless of
// the caller's permission level.
function stripInternalColumns(meta: DocTypeMeta, doc: DocValues): DocValues {
  const known = new Set<string>(['doctype', ...STANDARD_COLUMNS, ...meta.fields.map((f) => f.fieldname)])
  const out: DocValues = {}
  for (const [k, v] of Object.entries(doc))
    if (known.has(k) && !SENSITIVE_COLUMNS.has(k)) out[k] = v
  return out
}

async function loadChildren(meta: DocTypeMeta, doc: DocValues): Promise<DocValues> {
  for (const f of meta.fields) {
    if (f.fieldtype !== 'Table') continue
    const childMeta = await getMeta(f.options!)
    const rows = await sql`
      select * from ${sql(tableName(f.options!))}
      where parent = ${String(doc.name)} and parenttype = ${meta.name}
        and parentfield = ${f.fieldname}
      order by idx`
    doc[f.fieldname] = rows.map((r) => stripInternalColumns(childMeta, r as DocValues))
  }
  return stripInternalColumns(meta, doc)
}

// DocType/DocField writes must go through the doctype engine (runs DDL);
// the generic document path would silently skip table changes.
const ENGINE_MANAGED = new Set(['DocType', 'DocField'])

export async function saveDoc(
  doctype: string,
  values: DocValues,
  user = 'Administrator',
  mode: 'upsert' | 'insert' = 'upsert',
): Promise<DocValues> {
  const meta = await getMeta(doctype)
  if (ENGINE_MANAGED.has(doctype))
    throw new AppError(
      'ValidationError',
      `${doctype} documents are managed via /api/doctype`,
    )
  if (meta.issingle)
    throw new AppError('ValidationError', `${doctype} is a single DocType`)
  if (meta.istable)
    throw new AppError(
      'ValidationError',
      `${doctype} is a child DocType; save it through its parent`,
    )
  if (values.name != null && values.name !== '') {
    const [exists] = await sql`
      select 1 from ${sql(tableName(doctype))} where name = ${String(values.name)}`
    if (exists) {
      if (mode === 'insert')
        throw new AppError('ConflictError', `${doctype} ${values.name} already exists`)
      return updateDoc(meta, String(values.name), values, user)
    }
    if (meta.autoname !== 'prompt' && values.amended_from == null)
      throw new AppError('NotFoundError', `${doctype} ${values.name} not found`)
  }
  await assertPermission(user, doctype, 'create')
  await assertUserPermissions(user, meta, values)
  const writeLevels = await permittedLevels(user, doctype, 'write')
  const fieldValues = validateValues(
    meta,
    applyDefaults(meta, stripUnwritableFields(meta.fields, writeLevels, pickFieldValues(meta, values))),
    'insert',
  )

  const childInputs = pickChildInputs(meta, values)
  const table = tableName(doctype)
  const [saved] = await sql
    .begin(async (tx) => {
      const stx = tx as unknown as typeof sql
      const name = await resolveName(stx, meta, values)
      const now = new Date()
      const doc: DocValues = {
        name,
        owner: user,
        modified_by: user,
        creation: now,
        modified: now,
        docstatus: 0,
        idx: 0,
        ...fieldValues,
      }
      // Expose child rows to hooks (validate/before_save) under their
      // fieldnames; columnValues ignores non-scalar keys when building the row.
      for (const ci of childInputs) doc[ci.fieldname] = ci.rows
      const ctx: HookContext = { doc, meta, user, isNew: true, tx: stx }
      await runHooks('before_insert', ctx)
      await runHooks('validate', ctx)
      await runHooks('before_save', ctx)
      const row = {
        ...columnValues(meta, doc),
        name: String(doc.name),
        owner: doc.owner,
        modified_by: doc.modified_by,
        creation: doc.creation,
        modified: doc.modified,
        docstatus: doc.docstatus,
        idx: doc.idx,
      }
      await validateLinks(stx, meta, row)
      const inserted = await tx`insert into ${tx(table)} ${tx(row as unknown as Record<string, never>)} returning *`
      for (const input of childInputs)
        await saveChildren(stx, meta, name, input, user)
      ctx.doc = { ...(inserted[0] as DocValues) }
      await runHooks('after_insert', ctx)
      await runHooks('after_save', ctx)
      return inserted
    })
    .catch((err) => mapDbError(meta, err))
  return loadChildren(meta, { doctype, ...(saved as DocValues) })
}

// DOC-002: optimistic concurrency — the client must echo back the
// `modified` timestamp it loaded; a mismatch means someone else saved first.
async function updateDoc(
  meta: DocTypeMeta,
  name: string,
  values: DocValues,
  user: string,
): Promise<DocValues> {
  const table = tableName(meta.name)
  if (values.modified == null)
    throw new AppError(
      'ValidationError',
      'Updates must include the modified timestamp of the loaded document',
    )
  // A write-share grants full field access; otherwise honor permlevels.
  const sharedWrite = await isSharedWith(user, meta.name, name, 'write')
  const writeLevels = sharedWrite
    ? new Set([-1])
    : await permittedLevels(user, meta.name, 'write')
  const fieldValues = validateValues(
    meta,
    stripUnwritableFields(meta.fields, writeLevels, pickFieldValues(meta, values)),
    'update',
  )

  const saved = await sql
    .begin(async (tx) => {
      const stx = tx as unknown as typeof sql
      const [existing] = await tx`
        select * from ${tx(table)} where name = ${name} for update`
      if (!existing)
        throw new AppError('NotFoundError', `${meta.name} ${name} not found`)
      // PERM-008: a share with write grants update even without role write.
      if (!sharedWrite) {
        await assertDocPermission(user, meta.name, 'write', String(existing.owner))
        await assertUserPermissions(user, meta, existing as DocValues)
      }
      const dbModified = (existing.modified as Date).getTime()
      const sentModified = new Date(String(values.modified)).getTime()
      if (Number.isNaN(sentModified) || dbModified !== sentModified)
        throw new AppError(
          'ConflictError',
          `${meta.name} ${name} has been modified after you loaded it`,
        )
      if ((existing.docstatus as number) === 1)
        throw new AppError(
          'ValidationError',
          `${meta.name} ${name} is submitted and cannot be modified (cancel it first)`,
        )
      if ((existing.docstatus as number) === 2)
        throw new AppError(
          'ValidationError',
          `${meta.name} ${name} is cancelled and cannot be modified`,
        )
      const doc: DocValues = { ...(existing as DocValues), ...fieldValues }
      // Expose child rows to hooks under their fieldnames (see insert path).
      for (const ci of pickChildInputs(meta, values)) doc[ci.fieldname] = ci.rows
      const ctx: HookContext = {
        doc,
        old: existing as DocValues,
        meta,
        user,
        isNew: false,
        tx: stx,
      }
      await runHooks('validate', ctx)
      await runHooks('before_save', ctx)
      const row = {
        ...columnValues(meta, doc),
        modified: new Date(),
        modified_by: user,
      }
      await validateLinks(stx, meta, row)
      const [updated] = await tx`
        update ${tx(table)} set ${tx(row)} where name = ${name} returning *`
      for (const input of pickChildInputs(meta, values))
        await saveChildren(stx, meta, name, input, user)
      await recordVersion(stx, meta, name, existing as DocValues, updated as DocValues, user)
      ctx.doc = { ...(updated as DocValues) }
      await runHooks('after_save', ctx)
      return updated
    })
    .catch((err) => mapDbError(meta, err))
  return loadChildren(meta, { doctype: meta.name, ...(saved as DocValues) })
}

// DOC-009: record a field-level diff in the Version doctype on every
// tracked update. Runs inside the save transaction.
const UNVERSIONED = new Set(['Version', 'DocType', 'DocField'])

async function recordVersion(
  tx: typeof sql,
  meta: DocTypeMeta,
  name: string,
  before: DocValues,
  after: DocValues,
  user: string,
) {
  if (!meta.track_changes || UNVERSIONED.has(meta.name)) return
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null)
  const changed: [string, unknown, unknown][] = []
  for (const f of meta.fields) {
    if (NO_COLUMN_TYPES.has(f.fieldtype)) continue
    const b = norm(before[f.fieldname])
    const a = norm(after[f.fieldname])
    if (JSON.stringify(b) !== JSON.stringify(a)) changed.push([f.fieldname, b, a])
  }
  if (!changed.length) return
  const now = new Date()
  await tx`insert into tab_version ${tx({
    name: hashName(),
    owner: user,
    modified_by: user,
    creation: now,
    modified: now,
    docstatus: 0,
    idx: 0,
    ref_doctype: meta.name,
    ref_name: name,
    data: { changed } as unknown as string,
  })}`
}

// DOC-007: docstatus transitions. Draft(0) -> submit -> Submitted(1) ->
// cancel -> Cancelled(2). Submitted docs are immutable; cancelled docs are
// terminal (until amend, DOC-008).
async function setDocstatus(
  doctype: string,
  name: string,
  from: number,
  to: number,
  event: 'on_submit' | 'on_cancel',
  user: string,
): Promise<DocValues> {
  const meta = await getMeta(doctype)
  if (!meta.is_submittable)
    throw new AppError('ValidationError', `${doctype} is not submittable`)
  const table = tableName(doctype)
  const [saved] = await sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    const [existing] = await tx`
      select * from ${tx(table)} where name = ${name} for update`
    if (!existing)
      throw new AppError('NotFoundError', `${doctype} ${name} not found`)
    await assertDocPermission(
      user, doctype, event === 'on_submit' ? 'submit' : 'cancel', String(existing.owner))
    await assertUserPermissions(user, meta, existing as DocValues)
    if ((existing.docstatus as number) !== from)
      throw new AppError(
        'ValidationError',
        `${doctype} ${name} has docstatus ${existing.docstatus}; expected ${from}`,
      )
    const [updated] = await tx`
      update ${tx(table)} set docstatus = ${to}, modified = ${new Date()},
        modified_by = ${user}
      where name = ${name} returning *`
    const ctx: HookContext = {
      doc: updated as DocValues,
      old: existing as DocValues,
      meta,
      user,
      isNew: false,
      tx: stx,
    }
    await runHooks(event, ctx)
    return [updated]
  })
  const result = loadChildren(meta, { doctype, ...(saved as DocValues) })
  // EML-004: fire matching email rules for this lifecycle event (post-commit).
  await evaluateEmailRules(event as LifecycleEvent, doctype, saved as DocValues)
  return result
}

export function submitDoc(doctype: string, name: string, user = 'Administrator') {
  return setDocstatus(doctype, name, 0, 1, 'on_submit', user)
}

export function cancelDoc(doctype: string, name: string, user = 'Administrator') {
  return setDocstatus(doctype, name, 1, 2, 'on_cancel', user)
}

// DOC-008: create a fresh draft from a cancelled document. The copy carries
// amended_from and a derived NAME-n; children are copied as new rows.
export async function amendDoc(
  doctype: string,
  name: string,
  user = 'Administrator',
): Promise<DocValues> {
  const meta = await getMeta(doctype)
  if (!meta.is_submittable)
    throw new AppError('ValidationError', `${doctype} is not submittable`)
  const source = await getDoc(doctype, name, user)
  if ((source.docstatus as number) !== 2)
    throw new AppError('ValidationError', `${doctype} ${name} must be cancelled before amending`)
  await assertDocPermission(user, doctype, 'amend', String(source.owner))

  const [{ count }] = await sql`
    select count(*)::int as count from ${sql(tableName(doctype))}
    where amended_from = ${name}`
  const newName = `${name}-${(count as number) + 1}`

  const values: DocValues = { name: newName, amended_from: name }
  for (const f of meta.fields) {
    if (f.fieldname === 'amended_from') continue
    if (f.fieldtype === 'Section Break' || f.fieldtype === 'Column Break') continue
    if (f.fieldtype === 'Table') {
      const rows = (source[f.fieldname] as DocValues[] | undefined) ?? []
      values[f.fieldname] = rows.map((r) => {
        const copy: DocValues = {}
        for (const [k, v] of Object.entries(r))
          if (!(STANDARD_COLUMNS as readonly string[]).includes(k)) copy[k] = v
        return copy
      })
    } else {
      values[f.fieldname] = source[f.fieldname]
    }
  }
  return saveDoc(doctype, values, user)
}

// DOC-006: a document referenced by Link fields anywhere cannot be deleted.
export async function deleteDoc(
  doctype: string,
  name: string,
  user = 'Administrator',
): Promise<void> {
  const meta = await getMeta(doctype)
  if (meta.issingle || meta.istable || ENGINE_MANAGED.has(doctype))
    throw new AppError('ValidationError', `${doctype} documents cannot be deleted directly`)
  await sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    const [existing] = await tx`
      select * from ${tx(tableName(doctype))} where name = ${name} for update`
    if (!existing)
      throw new AppError('NotFoundError', `${doctype} ${name} not found`)
    await assertDocPermission(user, doctype, 'delete', String(existing.owner))
    await assertUserPermissions(user, meta, existing as DocValues)
    if ((existing.docstatus as number) === 1)
      throw new AppError(
        'ValidationError',
        `${doctype} ${name} is submitted and cannot be deleted (cancel it first)`,
      )

    // Any Link field in any DocType pointing at this doctype blocks deletion.
    const linkFields = await tx`
      select parent, fieldname from tab_docfield
      where fieldtype = 'Link' and options = ${doctype}`
    for (const lf of linkFields) {
      const parentDt = lf.parent as string
      const [parentMeta] = await tx`
        select issingle, istable from tab_doctype where name = ${parentDt}`
      if (!parentMeta || parentMeta.issingle) continue
      const refCols = parentMeta.istable
        ? ['name', 'parent', 'parenttype']
        : ['name']
      const [ref] = await tx`
        select ${tx(refCols)} from ${tx(tableName(parentDt))}
        where ${tx(lf.fieldname as string)} = ${name} limit 1`
      if (ref) {
        const holder = parentMeta.istable
          ? `${ref.parenttype as string} ${ref.parent as string}`
          : `${parentDt} ${ref.name as string}`
        throw new AppError(
          'ValidationError',
          `Cannot delete ${doctype} ${name}: it is linked from ${holder}`,
        )
      }
    }

    const ctx: HookContext = {
      doc: existing as DocValues,
      meta,
      user,
      isNew: false,
      tx: stx,
    }
    await runHooks('on_trash', ctx)

    // Remove this document's own child rows, then the document.
    for (const f of meta.fields) {
      if (f.fieldtype !== 'Table') continue
      await tx`
        delete from ${tx(tableName(f.options!))}
        where parent = ${name} and parenttype = ${doctype}`
    }
    await tx`delete from ${tx(tableName(doctype))} where name = ${name}`
  })
}

// DOC-012: rename a document's primary key and update every Link that
// referenced the old name — across all DocTypes and child tables — in one
// transaction. The document keeps all its other data and children.
export async function renameDoc(
  doctype: string,
  oldName: string,
  newName: string,
  user = 'Administrator',
): Promise<DocValues> {
  const meta = await getMeta(doctype)
  if (meta.issingle || meta.istable || ENGINE_MANAGED.has(doctype))
    throw new AppError('ValidationError', `${doctype} documents cannot be renamed`)
  const target = newName.trim()
  if (!target) throw new AppError('ValidationError', 'New name is required', { name: 'Required' })
  if (target === oldName) return getDoc(doctype, oldName, user)

  await sql.begin(async (tx) => {
    const table = tableName(doctype)
    const [existing] = await tx`
      select * from ${tx(table)} where name = ${oldName} for update`
    if (!existing) throw new AppError('NotFoundError', `${doctype} ${oldName} not found`)
    await assertDocPermission(user, doctype, 'write', String(existing.owner))
    await assertUserPermissions(user, meta, existing as DocValues)
    const [clash] = await tx`select 1 from ${tx(table)} where name = ${target}`
    if (clash) throw new AppError('ConflictError', `${doctype} ${target} already exists`)

    // Rename the row itself.
    await tx`update ${tx(table)} set name = ${target}, modified = now() where name = ${oldName}`

    // Re-point this document's own child rows to the new parent name.
    for (const f of meta.fields) {
      if (f.fieldtype !== 'Table') continue
      await tx`
        update ${tx(tableName(f.options!))} set parent = ${target}
        where parent = ${oldName} and parenttype = ${doctype}`
    }

    // Update every Link field, in any DocType, that points at this doctype.
    const linkFields = await tx`
      select parent, fieldname from tab_docfield
      where fieldtype = 'Link' and options = ${doctype}`
    for (const lf of linkFields) {
      const parentDt = lf.parent as string
      const [pm] = await tx`select issingle from tab_doctype where name = ${parentDt}`
      if (!pm || pm.issingle) continue
      const col = lf.fieldname as string
      await tx`
        update ${tx(tableName(parentDt))} set ${tx(col)} = ${target}
        where ${tx(col)} = ${oldName}`
    }
  })
  return getDoc(doctype, target, user)
}

export async function getDoc(
  doctype: string,
  name: string,
  user = 'Administrator',
): Promise<DocValues> {
  const meta = await getMeta(doctype)
  if (meta.issingle)
    throw new AppError('ValidationError', `${doctype} is a single DocType`)
  const [row] = await sql`
    select * from ${sql(tableName(doctype))} where name = ${name}`
  if (!row) throw new AppError('NotFoundError', `${doctype} ${name} not found`)
  // PERM-008: a direct share grants read even without role permission.
  const shared = await isSharedWith(user, doctype, name, 'read')
  if (!shared) {
    await assertPermission(user, doctype, 'read')
    await assertDocPermission(user, doctype, 'read', String(row.owner))
    await assertUserPermissions(user, meta, row as DocValues)
  }
  // A share grants full field visibility; otherwise honor permlevels.
  const readLevels = shared ? new Set([-1]) : await permittedLevels(user, doctype, 'read')
  const visible = filterReadFields(meta.fields, readLevels, row as DocValues)
  return loadChildren(meta, { doctype, ...visible })
}
