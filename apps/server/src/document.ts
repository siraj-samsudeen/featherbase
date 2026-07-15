import { randomBytes } from 'node:crypto'
import { metaToZod, zodFieldErrors } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type DocTypeMeta } from './meta'
import { STANDARD_COLUMNS, tableName } from './doctype-engine'

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

async function loadChildren(meta: DocTypeMeta, doc: DocValues): Promise<DocValues> {
  for (const f of meta.fields) {
    if (f.fieldtype !== 'Table') continue
    const rows = await sql`
      select * from ${sql(tableName(f.options!))}
      where parent = ${String(doc.name)} and parenttype = ${meta.name}
        and parentfield = ${f.fieldname}
      order by idx`
    doc[f.fieldname] = rows
  }
  return doc
}

export async function saveDoc(
  doctype: string,
  values: DocValues,
  user = 'Administrator',
): Promise<DocValues> {
  const meta = await getMeta(doctype)
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
    if (exists) return updateDoc(meta, String(values.name), values, user)
    if (meta.autoname !== 'prompt')
      throw new AppError('NotFoundError', `${doctype} ${values.name} not found`)
  }
  const fieldValues = validateValues(
    meta,
    applyDefaults(meta, pickFieldValues(meta, values)),
    'insert',
  )

  const childInputs = pickChildInputs(meta, values)
  const table = tableName(doctype)
  const [saved] = await sql
    .begin(async (tx) => {
      const name = await resolveName(tx as unknown as typeof sql, meta, values)
      const now = new Date()
      const row: DocValues = {
        name,
        owner: user,
        modified_by: user,
        creation: now,
        modified: now,
        docstatus: 0,
        idx: 0,
        ...fieldValues,
      }
      const inserted = await tx`insert into ${tx(table)} ${tx(row)} returning *`
      for (const input of childInputs)
        await saveChildren(tx as unknown as typeof sql, meta, name, input, user)
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
  const fieldValues = validateValues(meta, pickFieldValues(meta, values), 'update')

  const saved = await sql
    .begin(async (tx) => {
      const [existing] = await tx`
        select * from ${tx(table)} where name = ${name} for update`
      if (!existing)
        throw new AppError('NotFoundError', `${meta.name} ${name} not found`)
      const dbModified = (existing.modified as Date).getTime()
      const sentModified = new Date(String(values.modified)).getTime()
      if (Number.isNaN(sentModified) || dbModified !== sentModified)
        throw new AppError(
          'ConflictError',
          `${meta.name} ${name} has been modified after you loaded it`,
        )
      const row = { ...fieldValues, modified: new Date(), modified_by: user }
      const [updated] = await tx`
        update ${tx(table)} set ${tx(row)} where name = ${name} returning *`
      for (const input of pickChildInputs(meta, values))
        await saveChildren(tx as unknown as typeof sql, meta, name, input, user)
      return updated
    })
    .catch((err) => mapDbError(meta, err))
  return loadChildren(meta, { doctype: meta.name, ...(saved as DocValues) })
}

export async function getDoc(
  doctype: string,
  name: string,
): Promise<DocValues> {
  const meta = await getMeta(doctype)
  if (meta.issingle)
    throw new AppError('ValidationError', `${doctype} is a single DocType`)
  const [row] = await sql`
    select * from ${sql(tableName(doctype))} where name = ${name}`
  if (!row) throw new AppError('NotFoundError', `${doctype} ${name} not found`)
  return loadChildren(meta, { doctype, ...(row as DocValues) })
}
