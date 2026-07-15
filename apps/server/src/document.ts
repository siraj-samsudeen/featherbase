import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type DocTypeMeta } from './meta'
import { tableName } from './doctype-engine'

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
    if (key === 'doctype' || key === 'name') continue
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
