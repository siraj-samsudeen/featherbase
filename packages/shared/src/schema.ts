import { z } from 'zod'

// META-013: one zod schema generated from DocType metadata, used by the
// server's Document engine and (later) the Desk form views.

export interface SchemaField {
  fieldname: string
  fieldtype: string
  options?: string | null
  reqd?: boolean
  label?: string | null
}

const NO_VALUE_TYPES = new Set(['Table', 'Section Break', 'Column Break'])

const emptyToUndefined = (v: unknown) =>
  v == null || v === '' ? undefined : v

function baseSchema(f: SchemaField): z.ZodTypeAny {
  switch (f.fieldtype) {
    case 'Data':
    case 'Link':
      return z.string().max(140)
    case 'Text':
    case 'Long Text':
    case 'Attach':
      return z.string()
    case 'Int':
      return z.coerce
        .number()
        .int()
        .gte(Number.MIN_SAFE_INTEGER, 'integer out of range')
        .lte(Number.MAX_SAFE_INTEGER, 'integer out of range')
    case 'Float':
    case 'Currency':
      return z.coerce.number()
    case 'Check':
      return z.boolean()
    case 'Select': {
      const options = (f.options ?? '')
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean)
      return options.length
        ? z.enum(options as [string, ...string[]])
        : z.string()
    }
    case 'Date':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')
    case 'Datetime':
      return z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
        message: 'must be a valid datetime',
      })
    case 'JSON':
      return z.unknown()
    default:
      return z.unknown()
  }
}

export function metaToZod(fields: SchemaField[]) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) {
    if (NO_VALUE_TYPES.has(f.fieldtype)) continue
    const base = baseSchema(f)
    shape[f.fieldname] = z.preprocess(
      emptyToUndefined,
      f.reqd
        ? base
        : base.optional().nullable(),
    )
  }
  return z.object(shape)
}

// Flatten zod issues into a {fieldname: message} map for the error envelope.
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_')
    if (!(key in fields)) fields[key] = issue.message
  }
  return fields
}
