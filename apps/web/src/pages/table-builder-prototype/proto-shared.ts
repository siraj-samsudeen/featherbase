// PROTOTYPE — THROWAWAY. Three UX variants for /admin/new-table (#151).
// Switch with ?variant=A|B|C; absent = the real TableBuilder. Shared helpers
// for the variants only — nothing here is production code. The validation
// rules are a deliberate local COPY of apps/server/src/doctype-engine.ts
// (columnSchema + validateDef); the real fix would export them from
// packages/shared instead.

export const SNAKE = /^[a-z][a-z0-9_]{0,63}$/

export const RESERVED = [
  'name', 'created_by', 'created_at', 'updated_at', 'updated_by',
  'status', 'position', 'parent', 'parenttype', 'parentfield',
]

export const TARGET_REQUIRED = ['Choice', 'Reference', 'Sub-table']

// "Date of Birth" -> "date_of_birth". The core move every variant shares.
export function slugify(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return /^[0-9]/.test(s) ? `col_${s}` : s
}

export interface ProtoColumn {
  column_name: string
  label: string
  column_type: string
  target: string
  reqd: boolean
  in_list_view: boolean
  // A/C: has the user detached column_name from the label?
  name_touched: boolean
}

export const blankCol = (): ProtoColumn => ({
  column_name: '',
  label: '',
  column_type: 'Data',
  target: '',
  reqd: false,
  in_list_view: false,
  name_touched: false,
})

// One column's client-side verdict, mirroring the server's rules. `fix` is a
// value that would make it pass, offered as a one-click correction.
export function checkColumn(
  c: ProtoColumn,
  siblings: ProtoColumn[],
): { error: string; fix?: string } | null {
  const name = c.column_name.trim()
  if (!name) return null // blank rows are dropped, never sent
  if (RESERVED.includes(name))
    return { error: `“${name}” is reserved — every table already has it` }
  if (!SNAKE.test(name)) {
    const fix = slugify(name)
    return {
      error: 'Needs to be a database name: lowercase letters, digits and _',
      fix: fix && SNAKE.test(fix) && !RESERVED.includes(fix) ? fix : undefined,
    }
  }
  const dupes = siblings.filter((s) => s !== c && s.column_name.trim() === name)
  if (dupes.length) return { error: `“${name}” is used by another column` }
  if (TARGET_REQUIRED.includes(c.column_type) && !c.target.trim())
    return {
      error:
        c.column_type === 'Choice'
          ? 'List the choices, e.g. Small, Medium, Large'
          : 'Name the table this points at',
    }
  return null
}

// The payload shape POST /api/doctype expects (same mapping the real
// TableBuilder does on submit).
export function toPayload(name: string, module: string, idPattern: string, cols: ProtoColumn[]) {
  return {
    name,
    module: module.trim() || 'Custom',
    id_pattern: idPattern,
    columns: cols
      .filter((c) => c.column_name.trim())
      .map((c) => {
        const target = c.target.trim()
          ? c.target.split(/[\n,]/).map((o) => o.trim()).filter(Boolean).join('\n')
          : undefined
        return {
          column_name: c.column_name.trim(),
          label: c.label.trim() || undefined,
          column_type: c.column_type,
          reference_table: c.column_type === 'Reference' ? target : undefined,
          choices: c.column_type === 'Choice' ? target : undefined,
          row_table: c.column_type === 'Sub-table' ? target : undefined,
          reqd: c.reqd,
          in_list_view: c.in_list_view,
        }
      }),
  }
}
