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
  if (values.name != null && values.name !== '')
    return updateDoc(meta, String(values.name), values, user)
  const fieldValues = pickFieldValues(meta, values)

  const name = hashName()
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

  const table = tableName(doctype)
  const [saved] = await sql.begin(async (tx) => {
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
