import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type DocTypeMeta } from './meta'
import { STANDARD_COLUMNS, tableName } from './doctype-engine'

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
// fail loudly instead of silently dropping data.
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
    out[key] = value ?? null
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', 'Unknown fields', errors)
  return out
}

export async function saveDoc(
  doctype: string,
  values: DocValues,
  user = 'Administrator',
): Promise<DocValues> {
  const meta = await getMeta(doctype)
  if (meta.issingle)
    throw new AppError('ValidationError', `${doctype} is a single DocType`)
  if (values.name != null && values.name !== '') {
    const [exists] = await sql`
      select 1 from ${sql(tableName(doctype))} where name = ${String(values.name)}`
    if (exists) return updateDoc(meta, String(values.name), values, user)
    if (meta.autoname !== 'prompt')
      throw new AppError('NotFoundError', `${doctype} ${values.name} not found`)
  }
  const fieldValues = pickFieldValues(meta, values)

  const table = tableName(doctype)
  const [saved] = await sql.begin(async (tx) => {
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
    return tx`insert into ${tx(table)} ${tx(row)} returning *`
  })
  return { doctype, ...(saved as DocValues) }
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
  const fieldValues = pickFieldValues(meta, values)

  const saved = await sql.begin(async (tx) => {
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
    return updated
  })
  return { doctype: meta.name, ...(saved as DocValues) }
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
  return { doctype, ...(row as DocValues) }
}
