// #209 (issue #197): change a Table's columns after the rows are in it.
//
// "After importing I want to add a certain column but today it is not
// possible" — the Table Builder only ever built new Tables — and "in one of
// the things floor was spelled with a G, Glor", which is a rename, not a new
// column beside the old one.
//
// Three operations, deliberately separated, because they carry different
// risk:
//
//   - **Add** a column. Empty on every existing row; nothing to lose.
//   - **Relabel** a column. The display name only; the data never moves.
//   - **Rename** a column's machine name. Its own server operation, because
//     PUT /api/table_def matches columns BY name — a changed name there reads
//     as delete-plus-add, which the server refuses (#250).
//
// Type changes and deletions are not offered, with one exception (#911): a
// text column whose values are codes of another Table's rows becomes a link to
// it, and a link becomes text again. Both store the same text, so the column
// keeps its name, values and history; the server refuses the link while any
// value names no row. Dropping a column is destructive in a way that belongs
// with Table deletion rather than beside a rename.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { COLUMN_TYPES, NO_COLUMN_TYPES, type TableMeta } from '../lib/meta'
import { RESERVED, SNAKE, TARGET_REQUIRED_TYPES, slugify } from '../lib/column-rules'
import { buttonClasses, cardClasses, inputClasses, labelClasses, touchLinkClasses } from '@featherbase/shop-floor'
import { tableOptionLabel, usePickableTables } from '../lib/session'

// #1024: what can be chosen as a title. A link's value is the other row's id, so
// a row headed by one reads as a bare id. A title already stored stays shown,
// whatever its type or if hidden, so the page always says what the title is.
const TITLE_CHOICE_TYPES = new Set(['Data', 'Text', 'Choice', 'Int'])

interface NewColumn {
  label: string
  column_name: string
  column_type: string
  target: string
  nameTouched: boolean
}

const blank = (): NewColumn => ({
  label: '',
  column_name: '',
  column_type: 'Data',
  target: '',
  nameTouched: false,
})

/** #881: not a column type of its own, but a pair of columns made together:
 *  `<name>_table`, a link to Table, and `<name>`, the row of that Table. */
export const ANY_TABLE_LINK = 'Link to a row of any Table'

/** The columns one new column adds: two for a link to a row of any Table. */
export function columnsToAdd(adding: NewColumn): Record<string, unknown>[] {
  const name = adding.column_name.trim()
  const label = adding.label.trim() || name
  if (adding.column_type === ANY_TABLE_LINK)
    return [
      { column_name: `${name}_table`, label: `${label} Table`, column_type: 'Reference', reference_table: 'Table' },
      { column_name: name, label, column_type: 'Reference', table_column: `${name}_table`,
        choices: adding.target.split(/[\n,]/).map((t) => t.trim()).filter(Boolean).join('\n') || undefined },
    ]
  return [{
    column_name: name,
    label,
    column_type: adding.column_type,
    choices: adding.column_type === 'Choice' ? adding.target.trim() : undefined,
    reference_table: adding.column_type === 'Reference' ? adding.target.trim() : undefined,
    row_table: adding.column_type === 'Sub-table' ? adding.target.trim() : undefined,
  }]
}

/** The advisory mirror of the server's rule, so a typo costs no round trip. */
function newColumnProblem(col: NewColumn, meta: TableMeta): string | null {
  const name = col.column_name.trim()
  if (!name) return 'Give the column a name'
  if (!SNAKE.test(name)) return 'Use lower_snake_case, starting with a letter'
  if (RESERVED.includes(name)) return `${name} is a standard column name`
  if (meta.columns.some((c) => c.column_name === name)) return `${meta.name} already has ${name}`
  if (col.column_type === ANY_TABLE_LINK && meta.columns.some((c) => c.column_name === `${name}_table`))
    return `${meta.name} already has ${name}_table`
  if (TARGET_REQUIRED_TYPES.includes(col.column_type) && !col.target.trim())
    return `A ${col.column_type} column needs its ${col.column_type === 'Choice' ? 'choices' : 'target Table'}`
  return null
}

function RenameRow({ table, column }: { table: string; column: { column_name: string } }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState(column.column_name)

  const rename = useMutation({
    mutationFn: () =>
      api.post<TableMeta>(`/api/table_def/${encodeURIComponent(table)}/rename_column`, {
        from: column.column_name,
        to: to.trim(),
      }),
    onSuccess: async () => {
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['meta', table] })
      await queryClient.invalidateQueries({ queryKey: ['import-targets'] })
    },
  })

  if (!open)
    return (
      <button
        type="button"
        className={touchLinkClasses('underline')}
        aria-label={`Rename ${column.column_name}`}
        data-testid={`ce-rename-${column.column_name}`}
        onClick={() => {
          setTo(column.column_name)
          setOpen(true)
        }}
      >
        Rename
      </button>
    )

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        className={inputClasses('w-40 py-0.5')}
        value={to}
        aria-label={`New name for ${column.column_name}`}
        data-testid={`ce-rename-input-${column.column_name}`}
        onChange={(e) => setTo(e.target.value)}
      />
      <button
        type="button"
        className={buttonClasses({ variant: 'primary', className: 'py-0.5' })}
        data-testid={`ce-rename-go-${column.column_name}`}
        disabled={rename.isPending || !to.trim() || to.trim() === column.column_name}
        onClick={() => rename.mutate()}
      >
        {rename.isPending ? 'Renaming…' : 'Rename'}
      </button>
      <button type="button" className={buttonClasses({ className: 'py-0.5' })} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {rename.isError && (
        <span
          className="text-negative"
          data-testid={`ce-rename-error-${column.column_name}`}
        >
          {rename.error instanceof ApiError ? rename.error.message : 'Could not rename'}
        </span>
      )}
    </span>
  )
}

/** #911: turn a text column into a link to the Table its values name, or a
 *  link back into text. */
function LinkRow({ def, column, onDone }: {
  def: TableMeta
  column: TableMeta['columns'][number]
  onDone: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const tables = usePickableTables()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('')
  const name = column.column_name
  const change = useMutation({
    mutationFn: (to: { column_type: string; reference_table: string | null }) =>
      api.put<TableMeta>(`/api/table_def/${encodeURIComponent(def.name)}`, {
        ...def,
        columns: def.columns.map((c) => (c.column_name === name ? { ...c, ...to } : c)),
      }),
    onSuccess: async (_meta, to) => {
      setOpen(false)
      onDone(to.column_type === 'Reference' ? `${name} now links to ${to.reference_table}` : `${name} is now text`)
      await queryClient.invalidateQueries({ queryKey: ['meta', def.name] })
      await queryClient.invalidateQueries({ queryKey: ['import-targets'] })
    },
  })
  const error = change.isError && (
    <span className="text-negative" data-testid={`ce-link-error-${name}`}>
      {change.error instanceof ApiError ? change.error.fields?.[name] ?? change.error.message : 'Could not change the column'}
    </span>
  )

  // #1021: a link moves between a Table and its views; the server keeps the
  // values only if each is a row of the new target, and says which are not.
  const base = column.reference_base ?? column.reference_table
  const family = (tables ?? []).filter((t) => t.row_id === base || (t.kind === 'view' && t.view_of === base))
  if (column.column_type === 'Reference' && column.reference_table && !column.table_column)
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {family.length > 1 && (
          <select
            className={inputClasses('w-48 py-0.5')}
            aria-label={`Table ${name} links to`}
            data-testid={`ce-link-target-${name}`}
            value={column.reference_table}
            disabled={change.isPending}
            onChange={(e) => change.mutate({ column_type: 'Reference', reference_table: e.target.value })}
          >
            {family.map((t) => <option key={t.row_id} value={t.row_id}>{tableOptionLabel(t)}</option>)}
          </select>
        )}
        <button
          type="button"
          className={touchLinkClasses('underline')}
          aria-label={`Turn ${name} into text`}
          disabled={change.isPending}
          onClick={() => change.mutate({ column_type: 'Data', reference_table: null })}
        >
          Make text
        </button>
        {error}
      </span>
    )
  if (column.column_type !== 'Data') return null
  if (!open)
    return (
      <button
        type="button"
        className={touchLinkClasses('underline')}
        aria-label={`Turn ${name} into a link`}
        onClick={() => {
          change.reset()
          setOpen(true)
        }}
      >
        Make link
      </button>
    )
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select
        className={inputClasses('w-44 py-0.5')}
        aria-label={`Table ${name} links to`}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      >
        <option value="">Choose a Table…</option>
        {(tables ?? []).map((t) => (
          <option key={t.row_id} value={t.row_id}>
            {tableOptionLabel(t)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={buttonClasses({ variant: 'primary', className: 'py-0.5' })}
        data-testid={`ce-link-go-${name}`}
        disabled={change.isPending || !target}
        onClick={() => change.mutate({ column_type: 'Reference', reference_table: target })}
      >
        {change.isPending ? 'Checking…' : 'Make link'}
      </button>
      <button type="button" className={buttonClasses({ className: 'py-0.5' })} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error}
    </span>
  )
}

export function ColumnEditor({ table }: { table: string }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState<NewColumn>(blank())
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)
  // The tick being saved shows its new state at once; it settles to the
  // Table's flag when the save returns (or back, if the save fails).
  const [inListSaving, setInListSaving] = useState<{ column: string; inList: boolean } | null>(null)

  const meta = useQuery({
    queryKey: ['meta', table],
    queryFn: () => api.get<TableMeta>(`/api/table/${encodeURIComponent(table)}:meta`),
  })

  // Read the Table, change one thing, send it back. The server accepts the
  // meta it handed out (nulls and all) so nothing has to be scrubbed here.
  const put = useMutation({
    mutationFn: (columns: unknown[]) =>
      api.put<TableMeta>(`/api/table_def/${encodeURIComponent(table)}`, {
        ...meta.data,
        columns,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['meta', table] })
      await queryClient.invalidateQueries({ queryKey: ['import-targets'] })
    },
  })

  // #1024: the column that names the Table's rows, saved at once. Row titles are
  // cached for minutes, and every link to this Table reads them.
  const setTitle = useMutation({
    mutationFn: (title_column: string | null) =>
      api.put<TableMeta>(`/api/table_def/${encodeURIComponent(table)}`, { title_column }),
    onSuccess: async (saved, title_column) => {
      const column = saved.columns.find((c) => c.column_name === title_column)
      setSaved(title_column ? `${column?.label ?? title_column} is now the title` : 'This Table has no title column now')
      await queryClient.invalidateQueries({ queryKey: ['meta', table] })
      await queryClient.invalidateQueries({ queryKey: ['row-title', table] })
    },
    // A refusal can mean the page is out of date: show what is true now.
    onError: async () => {
      setSaved(null)
      await queryClient.invalidateQueries({ queryKey: ['meta', table] })
    },
  })

  if (meta.isPending) return <p className="text-sm text-ink-muted">Loading…</p>
  if (meta.isError || !meta.data)
    return (
      <p className="text-sm text-negative" data-testid="ce-error">
        {meta.error instanceof ApiError ? meta.error.message : 'Could not load this Table'}
      </p>
    )

  const def = meta.data
  const problem = newColumnProblem(adding, def)

  function addColumn() {
    put.mutate(
      [...def.columns, ...columnsToAdd(adding)],
      {
        onSuccess: () => {
          setSaved(`Added ${adding.column_name.trim()}`)
          setAdding(blank())
        },
      },
    )
  }

  // Called only by a column's Save, which shows only once its label is edited.
  function saveLabel(columnName: string) {
    const label = labels[columnName].trim()
    if (!label) return
    put.mutate(
      def.columns.map((c) => (c.column_name === columnName ? { ...c, label } : c)),
      {
        onSuccess: () => {
          setSaved(`Renamed the label of ${columnName}`)
          setLabels((l) => {
            const rest = { ...l }
            delete rest[columnName]
            return rest
          })
        },
      },
    )
  }

  // #738 (point 9): the Table's list for everyone, saved at once. The server
  // clears the column's in_list_view override with it, so the tick always
  // does what it says.
  function saveInList(columnName: string, inList: boolean) {
    setInListSaving({ column: columnName, inList })
    put.mutate(
      def.columns.map((c) => (c.column_name === columnName ? { ...c, in_list_view: inList } : c)),
      {
        onSuccess: () =>
          setSaved(inList ? `Put ${columnName} in the list` : `Took ${columnName} out of the list`),
        onSettled: () => setInListSaving(null),
      },
    )
  }

  return (
    <div data-testid="column-editor" className="max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold text-ink">
        Columns of{' '}
        <Link
          to="/featherbase/admin/table/$table"
          params={{ table: def.name }}
          search={{ filters: undefined }}
          className="underline"
        >
          {def.name}
        </Link>
      </h1>
      <p className="mb-4 text-xs text-ink-muted">
        Add a column, change what it is called, or fix a misspelled name. Renaming keeps the rows
        that are already in it.
      </p>

      {def.system && (
        <p
          className={cardClasses('mb-3 p-2 text-sm text-negative')}
          data-testid="ce-system"
        >
          {def.name} is a system Table — its columns belong to the platform and cannot be changed
          here.
        </p>
      )}

      {saved && (
        <p className={cardClasses('mb-3 p-2 text-sm text-positive')} data-testid="ce-saved">
          {saved}.
        </p>
      )}
      {put.isError && (
        <p className={cardClasses('mb-3 p-2 text-sm text-negative')} data-testid="ce-put-error">
          {put.error instanceof ApiError ? put.error.message : 'Could not save'}
        </p>
      )}

      {setTitle.isError && (
        <p className={cardClasses('mb-3 p-2 text-sm text-negative')} data-testid="ce-title-error">
          {setTitle.error instanceof ApiError ? setTitle.error.message : 'Could not save the title'}
        </p>
      )}

      <div className={cardClasses('mb-4 p-3')}>
        <div className={labelClasses('mb-1')}>Columns</div>
        <div className="overflow-x-auto" data-testid="ce-columns-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-subtle">
                {/* #738: In list comes first, so a phone shows it without
                    scrolling the table sideways. */}
                <th className="whitespace-nowrap py-1 pr-2 text-center">In list</th>
                {def.kind !== 'settings' && (
                  <th className="whitespace-nowrap py-1 pr-2 text-center">
                    Title
                    {def.title_column && def.title_column !== 'row_id' && !def.system && (
                      <button
                        type="button"
                        className={touchLinkClasses('ml-1 font-normal normal-case underline')}
                        data-testid="ce-title-clear"
                        disabled={setTitle.isPending}
                        onClick={() => setTitle.mutate(null)}
                      >
                        Clear
                      </button>
                    )}
                  </th>
                )}
                <th className="py-1">Label</th>
                <th>Column name</th>
                <th>Type</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {def.columns.map((column) => (
                <tr
                  key={column.column_name}
                  className="border-t border-border"
                  data-testid={`ce-row-${column.column_name}`}
                >
                  <td className="pr-2 text-center">
                    {/* Only a column a list can show gets a tick. */}
                    {!NO_COLUMN_TYPES.has(column.column_type) && !column.hidden && (
                      // The box is small; the label around it is the thumb-sized target.
                      <label className="inline-flex size-control cursor-pointer items-center justify-center max-sm:size-touch">
                        <input
                          type="checkbox"
                          aria-label={`In list: ${column.label ?? column.column_name}`}
                          data-testid={`ce-in-list-${column.column_name}`}
                          checked={
                            inListSaving?.column === column.column_name
                              ? inListSaving.inList
                              : Boolean(column.in_list_view)
                          }
                          disabled={def.system || put.isPending}
                          onChange={(e) => saveInList(column.column_name, e.target.checked)}
                        />
                      </label>
                    )}
                  </td>
                  {def.kind !== 'settings' && (
                    <td className="pr-2 text-center">
                      {(def.title_column === column.column_name || (TITLE_CHOICE_TYPES.has(column.column_type) && !column.hidden)) && (
                        <label className="inline-flex size-control cursor-pointer items-center justify-center max-sm:size-touch">
                          <input
                            type="radio"
                            name="ce-title-column"
                            aria-label={`Title: ${column.label ?? column.column_name}`}
                            data-testid={`ce-title-${column.column_name}`}
                            checked={(setTitle.isPending ? setTitle.variables : def.title_column) === column.column_name}
                            disabled={def.system || setTitle.isPending}
                            onChange={() => setTitle.mutate(column.column_name)}
                          />
                        </label>
                      )}
                    </td>
                  )}
                  <td className="py-1 pr-2">
                    <input
                      className={inputClasses('w-48 py-0.5')}
                      aria-label={`Label for ${column.column_name}`}
                      data-testid={`ce-label-${column.column_name}`}
                      disabled={def.system}
                      value={labels[column.column_name] ?? column.label ?? column.column_name}
                      onChange={(e) =>
                        setLabels((l) => ({ ...l, [column.column_name]: e.target.value }))
                      }
                    />
                    {labels[column.column_name] != null &&
                      labels[column.column_name].trim() !== (column.label ?? '') && (
                        <button
                          type="button"
                          className={buttonClasses({ variant: 'primary', className: 'ml-1 py-0.5' })}
                          data-testid={`ce-label-save-${column.column_name}`}
                          disabled={put.isPending}
                          onClick={() => saveLabel(column.column_name)}
                        >
                          Save
                        </button>
                      )}
                  </td>
                  <td className="pr-2 font-mono text-xs text-ink-muted">{column.column_name}</td>
                  <td className="pr-2 text-xs text-ink-muted">{column.column_type}</td>
                  <td className="text-xs">
                    {!def.system && (
                      <span className="inline-flex flex-wrap items-center gap-3">
                        <RenameRow table={def.name} column={column} />
                        {!def.data_source && def.kind !== 'settings' && (
                          <LinkRow def={def} column={column} onDone={setSaved} />
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!def.system && (
        <div className={cardClasses('p-3')} data-testid="ce-add">
          <div className={labelClasses('mb-1')}>Add a column</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink-muted">
              Label
              <input
                className={inputClasses('mt-0.5 block w-48 py-1')}
                data-testid="ce-add-label"
                value={adding.label}
                onChange={(e) =>
                  setAdding((a) => ({
                    ...a,
                    label: e.target.value,
                    // The machine name follows the label until the user
                    // claims it, the same way the Table Builder does it.
                    column_name: a.nameTouched ? a.column_name : slugify(e.target.value),
                  }))
                }
              />
            </label>
            <label className="text-xs text-ink-muted">
              Column name
              <input
                className={inputClasses('mt-0.5 block w-48 py-1 font-mono')}
                data-testid="ce-add-name"
                value={adding.column_name}
                onChange={(e) =>
                  setAdding((a) => ({ ...a, column_name: e.target.value, nameTouched: true }))
                }
              />
            </label>
            <label className="text-xs text-ink-muted">
              Type
              <select
                className={inputClasses('mt-0.5 block w-56 py-1')}
                data-testid="ce-add-type"
                value={adding.column_type}
                onChange={(e) => setAdding((a) => ({ ...a, column_type: e.target.value }))}
              >
                {COLUMN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value={ANY_TABLE_LINK}>{ANY_TABLE_LINK}</option>
              </select>
            </label>
            {adding.column_type === ANY_TABLE_LINK && (
              <label className="text-xs text-ink-muted">
                Allowed Tables (one per line; none allows any)
                <textarea
                  rows={3}
                  className={inputClasses('mt-0.5 block w-56 py-1')}
                  data-testid="ce-add-allowed"
                  value={adding.target}
                  onChange={(e) => setAdding((a) => ({ ...a, target: e.target.value }))}
                />
              </label>
            )}
            {TARGET_REQUIRED_TYPES.includes(adding.column_type) && (
              <label className="text-xs text-ink-muted">
                {adding.column_type === 'Choice' ? 'Choices (one per line)' : 'Target Table'}
                <input
                  className={inputClasses('mt-0.5 block w-48 py-1')}
                  data-testid="ce-add-target"
                  value={adding.target}
                  onChange={(e) => setAdding((a) => ({ ...a, target: e.target.value }))}
                />
              </label>
            )}
            <button
              type="button"
              className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })}
              data-testid="ce-add-go"
              disabled={put.isPending || Boolean(problem)}
              onClick={addColumn}
            >
              {put.isPending ? 'Adding…' : 'Add column'}
            </button>
          </div>
          {/* Only once something has been typed — nobody is scolded for an
              empty form they have not started filling in. */}
          {problem && (adding.label || adding.column_name) && (
            <p className="mt-1 text-xs text-negative" data-testid="ce-add-problem">
              {problem}
            </p>
          )}
          <p className="mt-2 text-xs text-ink-muted">
            The new column is empty on every row that already exists. A column's type cannot be
            changed after it is made, except that a text column of codes can become a link to the
            Table they name, and back. Columns are not deleted here — delete the Table if that is
            what you mean.
          </p>
        </div>
      )}
    </div>
  )
}
