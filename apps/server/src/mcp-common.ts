// What every /mcp tool module shares (#1083, #1105): the inner request, the
// way a tool is registered, the three annotations a tool can carry, and how a
// column reads to an agent.
import type * as z from 'zod'

export type Json = Record<string, unknown>

/** One inner /api request with the caller's token, marked as the agent's; a refusal throws its envelope. */
export type Api = (method: string, path: string, body?: Json) => Promise<Json>

export const READS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
export const ADDS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
export const ALTERS = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
/** Alters, and a second call does it again (an import run twice adds twice). */
export const ALTERS_AGAIN = { ...ALTERS, idempotentHint: false }
export type Annotations = typeof READS

/** Registers one tool: its answer is the JSON `run` returns, a thrown envelope its refusal. */
export type RegisterTool = <A extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: A,
  annotations: Annotations,
  run: (args: z.infer<z.ZodObject<A>>) => Promise<Json>,
) => void

// Columns that only lay out a form; they hold no value.
export const LAYOUT_TYPES = new Set(['Section Break', 'Column Break'])
export const NESTED = 'Sub-table'

export interface ColumnMeta {
  column_name: string
  label: string | null
  column_type: string
  reqd: boolean
  read_only: boolean
  choices: string | null
  reference_table: string | null
  row_table: string | null
  description?: string | null
}

export const tablePath = (table: string) => `/api/table/${encodeURIComponent(table)}`

export function describeColumn(column: ColumnMeta) {
  return {
    name: column.column_name,
    label: column.label,
    type: column.column_type,
    required: column.reqd,
    read_only: column.read_only,
    ...(column.description ? { description: column.description } : {}),
    ...(column.choices ? { choices: column.choices.split('\n').filter(Boolean) } : {}),
    ...(column.reference_table ? { links_to: column.reference_table } : {}),
  }
}
