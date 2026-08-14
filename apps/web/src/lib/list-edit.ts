// The grid-editing seam shared by the Grid and Datasheet list views (list
// editing, owner-ratified 2026-08-14: all three prototype variants ship as
// view-level toggles). Two pure decisions live here so both views agree:
// when selection movement means "the user left this row" (the per-row
// autosave moment), and which fields an edited row actually changed (the
// PATCH body — autosave sends only what was touched).

export type CellSel = { r: number; c: number }

export function moveSelection(
  sel: CellSel,
  delta: { dr?: number; dc?: number },
  rowCount: number,
  colCount: number,
): { sel: CellSel; leftRow: boolean } {
  const r = Math.min(Math.max(sel.r + (delta.dr ?? 0), 0), rowCount - 1)
  const c = Math.min(Math.max(sel.c + (delta.dc ?? 0), 0), colCount - 1)
  return { sel: { r, c }, leftRow: r !== sel.r }
}

const NUMBER_TYPES = new Set(['Int', 'Float', 'Currency'])

// Inputs hand back strings; compare and send values in the column's own
// type so "3" typed over 3 is not a change and numbers PATCH as numbers.
function coerce(value: unknown, columnType: string): unknown {
  // Check is boolean at every stage — an unchecked box is false, never null.
  if (columnType === 'Check') return value !== 'false' && Boolean(value)
  if (value === '' || value == null) return null
  if (NUMBER_TYPES.has(columnType)) {
    const n = Number(value)
    return Number.isNaN(n) ? value : n
  }
  return value
}

export function changedFields(
  original: Record<string, unknown>,
  edited: Record<string, unknown>,
  columns: { column_name: string; column_type: string }[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const col of columns) {
    const before = coerce(original[col.column_name], col.column_type)
    const after = coerce(edited[col.column_name], col.column_type)
    if (before !== after) out[col.column_name] = after
  }
  return out
}
