import { useRef } from 'react'
import { NO_COLUMN_TYPES, useMeta, type ColumnDef } from '../lib/meta'
import { useI18n } from '../lib/i18n'
import type { Row } from './form-row'
import { LinkControl, anyTableFilters } from './LinkControl'

const CHILD_CELL_CLASSES = 'w-full rounded border border-transparent px-1 py-0.5 hover:border-border focus:border-border-control'

// Minimal child grid: renders child rows with editable cells. Full add/
// delete/reorder verification is UI-007.
/** A Sub-table cell that links to a row: of its fixed Table, or (#881) of the
 *  Table the row's own Table cell names. A Table cell that row cells take
 *  their Table from offers only the Tables they allow, and changing it clears
 *  them. */
function ChildLinkCell({ column, columns, row, setCell, common }: {
  column: ColumnDef
  columns: ColumnDef[]
  row: Row
  setCell: (changes: Record<string, unknown>) => void
  common: Record<string, unknown>
}) {
  const value = row[column.column_name]
  if (column.table_column) {
    const chosen = row[column.table_column]
    if (chosen == null || chosen === '')
      return <input type="text" className={CHILD_CELL_CLASSES} {...common} disabled value="" placeholder="Choose its Table first" />
    return (
      <LinkControl key={String(chosen)} field={{ ...column, reference_table: String(chosen) }} value={value}
        onChange={(next) => setCell({ [column.column_name]: next })} className={CHILD_CELL_CLASSES} common={common} floating anyTable />
    )
  }
  const bound = column.reference_table === 'Table' ? columns.filter((c) => c.table_column === column.column_name) : []
  return (
    <LinkControl field={column} value={value}
      onChange={(next) => setCell({
        [column.column_name]: next,
        ...(next !== value ? Object.fromEntries(bound.map((c) => [c.column_name, null])) : {}),
      })}
      className={CHILD_CELL_CLASSES} common={common} floating
      extraFilters={bound.length ? anyTableFilters(bound) : undefined} />
  )
}

export function ChildGrid({
  id,
  labelledBy,
  field,
  rows,
  onChange,
  errors,
}: {
  id: string
  labelledBy: string
  field: ColumnDef
  rows: Row[]
  onChange: (rows: Row[]) => void
  errors: Record<string, string>
}) {
  const childMeta = useMeta(field.row_table ?? '')
  const { t } = useI18n()
  const draftKeys = useRef(new WeakMap<Row, string>())
  const nextDraftKey = useRef(0)
  // Keep UI identity out of row data sent to the server. Edits transfer the
  // draft key; movement/removal retains row objects. Persisted IDs already
  // provide identity, scoped by this grid's React instance ID.
  function rowKey(row: Row): string {
    if (row.row_id != null) return `saved-${row.row_id}`
    let key = draftKeys.current.get(row)
    if (!key) {
      key = `draft-${nextDraftKey.current++}`
      draftKeys.current.set(row, key)
    }
    return key
  }
  if (!childMeta.data) return <p className="text-xs text-ink-subtle">Loading rows…</p>
  const cols = childMeta.data.columns.filter(
    (f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden,
  )
  function setCell(i: number, columnName: string | Record<string, unknown>, value?: unknown) {
    const changes = typeof columnName === 'string' ? { [columnName]: value } : columnName
    onChange(rows.map((row, j) => {
      if (j !== i) return row
      const edited = { ...row, ...changes }
      if (row.row_id == null) draftKeys.current.set(edited, rowKey(row))
      return edited
    }))
  }
  function cellInvalid(i: number, row: Row, c: ColumnDef) {
    return errors[`${field.column_name}.${i}.${c.column_name}`]
      ? { 'aria-invalid': true, 'aria-describedby': `${id}-${rowKey(row)}-${c.column_name}-error` }
      : {}
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div id={id} role="group" aria-labelledby={labelledBy} className="overflow-x-auto rounded-md border border-border" data-testid={`table-${field.column_name}`}>
      <table className="w-full text-sm">
        <thead className="bg-subtle text-left">
          <tr>
            {cols.map((c) => (
              <th key={c.column_name} className={`border-b border-border px-2 py-1 text-xs font-medium text-ink-muted${c.column_type === 'Check' ? ' whitespace-nowrap' : ''}`}>
                {c.label ?? c.column_name}
              </th>
            ))}
            <th className="w-20 border-b border-border" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row)} className="border-b border-border last:border-0">
              {cols.map((c) => (
                <td key={c.column_name} className="px-1 py-1">
                  {c.column_type === 'Reference' ? (
                    // #832: a link cell is picked from the linked Table's rows,
                    // with the form's own link picker; its list floats above
                    // the grid's scrolling frame instead of being cut by it.
                    // #881: a link to a row of any Table waits for its row's
                    // Table, as on the form.
                    <ChildLinkCell
                      column={c}
                      columns={cols}
                      row={row}
                      setCell={(changes) => setCell(i, changes)}
                      common={{
                        id: `${id}-${rowKey(row)}-${c.column_name}`,
                        'aria-label': `${t(field.label ?? field.column_name)}, ${t(c.label ?? c.column_name)}, row ${i + 1}`,
                        'data-childfield': c.column_name,
                        ...cellInvalid(i, row, c),
                      }}
                    />
                  ) : (
                  <label className={c.column_type === 'Check' ? 'inline-flex size-control cursor-pointer items-center justify-center' : 'block'}>
                  <input
                    id={`${id}-${rowKey(row)}-${c.column_name}`}
                    aria-label={`${t(field.label ?? field.column_name)}, ${t(c.label ?? c.column_name)}, row ${i + 1}`}
                    type={c.column_type === 'Check' ? 'checkbox' : 'text'}
                    checked={c.column_type === 'Check' ? Boolean(row[c.column_name]) : undefined}
                    value={c.column_type === 'Check' ? undefined : String(row[c.column_name] ?? '')}
                    onChange={(e) => setCell(i, c.column_name, c.column_type === 'Check' ? e.target.checked : e.target.value)}
                    className={c.column_type === 'Check' ? 'size-4 pointer-coarse:size-5' : CHILD_CELL_CLASSES}
                    data-childfield={c.column_name}
                    {...cellInvalid(i, row, c)}
                  />
                  </label>
                  )}
                  {errors[`${field.column_name}.${i}.${c.column_name}`] && (
                    <p id={`${id}-${rowKey(row)}-${c.column_name}-error`} className="mt-0.5 px-1 text-xs text-negative" data-testid={`error-${field.column_name}-${i}-${c.column_name}`}>
                      {errors[`${field.column_name}.${i}.${c.column_name}`]}
                    </p>
                  )}
                </td>
              ))}
              <td className="whitespace-nowrap px-1 text-center">
                <button
                  aria-label="Move row up"
                  onClick={() => move(i, -1)}
                  className="px-0.5 text-ink-subtle hover:text-ink"
                >
                  ↑
                </button>
                <button
                  aria-label="Move row down"
                  onClick={() => move(i, 1)}
                  className="px-0.5 text-ink-subtle hover:text-ink"
                >
                  ↓
                </button>
                <button
                  aria-label="Remove row"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  className="px-0.5 text-ink-subtle hover:text-negative"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() => onChange([...rows, {}])}
        data-testid={`add-row-${field.column_name}`}
        className="w-full border-t border-border px-2 py-1 text-left text-xs text-ink-muted hover:bg-subtle"
      >
        + Add row
      </button>
    </div>
  )
}
