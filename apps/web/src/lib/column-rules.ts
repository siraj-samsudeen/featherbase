// #151: client-side column rules for the Table builder. These MIRROR the
// server's authority in apps/server/src/table-engine.ts (columnSchema's
// snake_case regex + STANDARD_COLUMNS + validateDef) — the server still
// validates everything; these exist so a fixable typo is caught at the
// field instead of costing a submit round-trip. If the server rules change,
// change them here in the same commit — this list last converged when
// #132's row_id rename (PR #174) freed 'name' and reserved 'row_id'.

export const SNAKE = /^[a-z][a-z0-9_]{0,63}$/

export const RESERVED = [
  'row_id',
  'created_by',
  'created_at',
  'updated_at',
  'updated_by',
  'status',
  'position',
  'parent',
  'parenttype',
  'parentfield',
]

export const TARGET_REQUIRED_TYPES = ['Choice', 'Reference', 'Sub-table']

// "Date of Birth" -> "date_of_birth": the label the user typed, made legal.
export function slugify(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return /^[0-9]/.test(s) ? `col_${s}` : s
}

export interface BuilderColumn {
  column_name: string
  label: string
  column_type: string
  target: string
  reqd: boolean
  in_list_view: boolean
  source_index: number | null
  // Has the user (or an import) claimed column_name? Until then it follows
  // the label via slugify().
  name_touched?: boolean
}

export const blankColumn = (): BuilderColumn => ({
  column_name: '',
  label: '',
  column_type: 'Data',
  target: '',
  reqd: false,
  in_list_view: false,
  source_index: null,
  name_touched: false,
})

export interface ColumnVerdict {
  error: string
  // A value that would make the column pass, offered as a one-click fix.
  fix?: string
}

// One column's verdict against the mirrored rules. Advisory only — the
// builder never blocks Create on these (the #128 server-error path stays
// the authority and its spec exercises it end-to-end).
export function checkColumn(
  c: BuilderColumn,
  siblings: BuilderColumn[],
  tableName = '',
): ColumnVerdict | null {
  const name = c.column_name.trim()
  if (!name) return null // blank rows are dropped from the payload, never sent
  if (RESERVED.includes(name)) {
    // The conventional dodge is prefixing with the table: employee_name,
    // task_status. Only offered while it actually resolves the collision.
    const prefixed = tableName.trim() ? `${slugify(tableName)}_${name}` : ''
    const fix =
      prefixed && SNAKE.test(prefixed) && !siblings.some((s) => s !== c && s.column_name.trim() === prefixed)
        ? prefixed
        : undefined
    return {
      error:
        name === 'row_id'
          ? 'Taken: every row already has a built-in Row ID'
          : `“${name}” is a built-in column every table gets`,
      fix,
    }
  }
  if (!SNAKE.test(name)) {
    const fix = slugify(name)
    return {
      error: 'Needs to be a database name: lowercase letters, digits and _',
      fix: fix && SNAKE.test(fix) && !RESERVED.includes(fix) ? fix : undefined,
    }
  }
  if (siblings.some((s) => s !== c && s.column_name.trim() === name))
    return { error: `“${name}” is used by another column` }
  if (TARGET_REQUIRED_TYPES.includes(c.column_type) && !c.target.trim())
    return {
      error:
        c.column_type === 'Choice'
          ? 'List the choices, e.g. Small, Medium, Large'
          : 'Name the table this points at',
    }
  return null
}
