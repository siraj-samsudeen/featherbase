import { useMeta } from './meta'
import { formatValue, useSettings } from './settings'

/** One recorded change to a row, as `version.data` stores it. */
export interface ChangeData {
  changed?: [string, unknown, unknown][]
  import_run?: string
  import_revert?: string
  resolution?: { field: string; decision: 'keep' | 'source'; incoming: unknown }
  agent?: { token_id: string; token_label: string }
}

// #421, #825: a changed value reads the way the rest of the Admin shows it (a
// Date as DD-Mon-YYYY, a checkbox as ✓ / ✗, money the Indian way), by the
// changed Table's own column labels and types. The row's Activity card and a
// Version record share this, so one change reads the same in both places.
export function useChangeFormat(table: string, empty: string) {
  const meta = useMeta(table)
  const settings = useSettings()
  const column = (name: string) => meta.data?.columns.find((c) => c.column_name === name)
  const label = (name: string) => column(name)?.label || name
  const type = (name: string) => column(name)?.column_type ?? 'Data'
  // A Settings Table records its values as stored text, so a checkbox is '1'/'0'.
  const asStored = (t: string, v: unknown) => (t === 'Check' && typeof v === 'string' ? v === '1' || v === 'true' : v)
  const value = (name: string, v: unknown) => {
    if (v == null || v === '') return empty
    const t = type(name)
    return formatValue(t, asStored(t, v), settings) || String(v)
  }
  return { label, type, value }
}
