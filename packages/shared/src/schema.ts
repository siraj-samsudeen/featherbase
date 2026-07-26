import { z } from 'zod'

// META-013: one zod schema generated from Table metadata, used by the
// server's row engine and the Desk form views.

export interface ColumnDef {
  column_name: string
  column_type: string
  reference_table?: string | null
  choices?: string | null
  row_table?: string | null
  reqd?: boolean
  label?: string | null
}

const NO_VALUE_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break'])

const emptyToUndefined = (v: unknown) =>
  v == null || v === '' ? undefined : v

function baseSchema(f: ColumnDef): z.ZodTypeAny {
  switch (f.column_type) {
    case 'Data':
    case 'Reference':
      return z.string().max(140)
    case 'Text':
    case 'Long Text':
    case 'Attach':
    case 'Attach Image':
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
    case 'Choice': {
      const choices = (f.choices ?? '')
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean)
      return choices.length
        ? z.enum(choices as [string, ...string[]])
        : z.string()
    }
    case 'Date':
      // Accept round-tripped values: DB date columns serialize as full ISO
      // timestamps; normalize them back to the date part.
      return z.preprocess(
        (v) => {
          if (v instanceof Date) return v.toISOString().slice(0, 10)
          if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10)
          return v
        },
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date'),
      )
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

export function tableSchemaToZod(columns: ColumnDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of columns) {
    if (NO_VALUE_TYPES.has(f.column_type)) continue
    const base = baseSchema(f)
    shape[f.column_name] = z.preprocess(
      emptyToUndefined,
      f.reqd
        ? base
        : base.optional().nullable(),
    )
  }
  return z.object(shape)
}

// Flatten zod issues into a {column_name: message} map for the error envelope.
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_')
    if (!(key in fields)) fields[key] = issue.message
  }
  return fields
}
