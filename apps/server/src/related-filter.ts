import { AppError } from './errors'

export type Filter = [string, string, unknown]
export const MAX_RELATED_DEPTH = 3
export const MAX_RELATED_HOPS = 16

interface RelatedSpec {
  table: string
  via?: string
  column?: string
  parentfield?: string
  filters?: Filter[]
}

// Shared syntax and amplification limits for native and source predicates.
export function parseRelatedSpec(value: unknown): RelatedSpec {
  const bad = (message: string) => new AppError('ValidationError', message)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw bad(`'related' filter value must be an object { table, via?, column?, filters? }`)
  const v = value as Record<string, unknown>
  if (typeof v.table !== 'string' || !v.table)
    throw bad(`'related' filter needs a target { table }`)
  if (v.via !== undefined && (typeof v.via !== 'string' || !v.via))
    throw bad(`'related' via must be a sub-table name`)
  if (v.column !== undefined && (typeof v.column !== 'string' || !v.column))
    throw bad(`'related' column must be a column name`)
  if (v.column !== undefined && v.via === undefined)
    throw bad(`'related' column only applies together with via`)
  if (v.via !== undefined && v.column === undefined)
    throw bad(`'related' via needs the sub-table column that references the target`)
  if (v.parentfield !== undefined && (typeof v.parentfield !== 'string' || !v.parentfield))
    throw bad(`'related' parentfield must be a Sub-table column name`)
  if (v.parentfield !== undefined && v.via === undefined)
    throw bad(`'related' parentfield only applies together with via`)
  if (v.filters !== undefined && !Array.isArray(v.filters))
    throw bad(`'related' filters must be an array of [field, operator, value]`)
  return {
    table: v.table,
    via: v.via as string | undefined,
    column: v.column as string | undefined,
    parentfield: v.parentfield as string | undefined,
    filters: v.filters as Filter[] | undefined,
  }
}
