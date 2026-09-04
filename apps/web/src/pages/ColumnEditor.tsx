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
//     as delete-plus-add and orphans the rows.
//
// Type changes and deletions are not offered. The server refuses a type
// change outright, and dropping a column is destructive in a way that
// belongs with Table deletion rather than beside a rename.
import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { COLUMN_TYPES, type TableMeta } from '../lib/meta'
import { RESERVED, SNAKE, TARGET_REQUIRED_TYPES, slugify } from '../lib/column-rules'

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

/** The advisory mirror of the server's rule, so a typo costs no round trip. */
function newColumnProblem(col: NewColumn, meta: TableMeta): string | null {
  const name = col.column_name.trim()
  if (!name) return 'Give the column a name'
  if (!SNAKE.test(name)) return 'Use lower_snake_case, starting with a letter'
  if (RESERVED.includes(name)) return `${name} is a standard column name`
  if (meta.columns.some((c) => c.column_name === name)) return `${meta.name} already has ${name}`
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
        className="underline"
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
        className="fc-input w-40 py-0.5"
        value={to}
        aria-label={`New name for ${column.column_name}`}
        data-testid={`ce-rename-input-${column.column_name}`}
        onChange={(e) => setTo(e.target.value)}
      />
      <button
        type="button"
        className="fc-btn-primary py-0.5"
        data-testid={`ce-rename-go-${column.column_name}`}
        disabled={rename.isPending || !to.trim() || to.trim() === column.column_name}
        onClick={() => rename.mutate()}
      >
        {rename.isPending ? 'Renaming…' : 'Rename'}
      </button>
      <button type="button" className="fc-btn py-0.5" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {rename.isError && (
        <span
          className="text-[var(--color-danger)]"
          data-testid={`ce-rename-error-${column.column_name}`}
        >
          {rename.error instanceof ApiError ? rename.error.message : 'Could not rename'}
        </span>
      )}
    </span>
  )
}

export function ColumnEditor() {
  const { table } = useParams({ strict: false }) as { table: string }
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState<NewColumn>(blank())
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)

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

  if (meta.isPending) return <p className="text-sm text-gray-500">Loading…</p>
  if (meta.isError || !meta.data)
    return (
      <p className="text-sm text-[var(--color-danger)]" data-testid="ce-error">
        {meta.error instanceof ApiError ? meta.error.message : 'Could not load this Table'}
      </p>
    )

  const def = meta.data
  const problem = newColumnProblem(adding, def)

  function addColumn() {
    if (problem) return
    put.mutate(
      [
        ...def.columns,
        {
          column_name: adding.column_name.trim(),
          label: adding.label.trim() || adding.column_name.trim(),
          column_type: adding.column_type,
          choices: adding.column_type === 'Choice' ? adding.target.trim() : undefined,
          reference_table:
            adding.column_type === 'Reference' ? adding.target.trim() : undefined,
          row_table: adding.column_type === 'Sub-table' ? adding.target.trim() : undefined,
        },
      ],
      {
        onSuccess: () => {
          setSaved(`Added ${adding.column_name.trim()}`)
          setAdding(blank())
        },
      },
    )
  }

  function saveLabel(columnName: string) {
    const label = (labels[columnName] ?? '').trim()
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

  return (
    <div data-testid="column-editor" className="max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold text-[var(--color-ink)]">
        Columns of{' '}
        <Link
          to="/admin/$table"
          params={{ table: def.name }}
          search={{ filters: undefined }}
          className="underline"
        >
          {def.name}
        </Link>
      </h1>
      <p className="mb-4 text-xs text-gray-500">
        Add a column, change what it is called, or fix a misspelled name. Renaming keeps the rows
        that are already in it.
      </p>

      {def.system && (
        <p
          className="fc-card mb-3 p-2 text-sm text-[var(--color-danger)]"
          data-testid="ce-system"
        >
          {def.name} is a system Table — its columns belong to the platform and cannot be changed
          here.
        </p>
      )}

      {saved && (
        <p className="fc-card mb-3 p-2 text-sm text-green-700" data-testid="ce-saved">
          {saved}.
        </p>
      )}
      {put.isError && (
        <p className="fc-card mb-3 p-2 text-sm text-[var(--color-danger)]" data-testid="ce-put-error">
          {put.error instanceof ApiError ? put.error.message : 'Could not save'}
        </p>
      )}

      <div className="fc-card mb-4 p-3">
        <div className="fc-label mb-1">Columns</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
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
                className="border-t border-[var(--color-border)]"
                data-testid={`ce-row-${column.column_name}`}
              >
                <td className="py-1 pr-2">
                  <input
                    className="fc-input w-48 py-0.5"
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
                        className="fc-btn-primary ml-1 py-0.5"
                        data-testid={`ce-label-save-${column.column_name}`}
                        disabled={put.isPending}
                        onClick={() => saveLabel(column.column_name)}
                      >
                        Save
                      </button>
                    )}
                </td>
                <td className="pr-2 font-mono text-xs text-gray-500">{column.column_name}</td>
                <td className="pr-2 text-xs text-gray-500">{column.column_type}</td>
                <td className="text-xs">
                  {!def.system && <RenameRow table={def.name} column={column} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!def.system && (
        <div className="fc-card p-3" data-testid="ce-add">
          <div className="fc-label mb-1">Add a column</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-500">
              Label
              <input
                className="fc-input mt-0.5 block w-48 py-1"
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
            <label className="text-xs text-gray-500">
              Column name
              <input
                className="fc-input mt-0.5 block w-48 py-1 font-mono"
                data-testid="ce-add-name"
                value={adding.column_name}
                onChange={(e) =>
                  setAdding((a) => ({ ...a, column_name: e.target.value, nameTouched: true }))
                }
              />
            </label>
            <label className="text-xs text-gray-500">
              Type
              <select
                className="fc-input mt-0.5 block w-40 py-1"
                data-testid="ce-add-type"
                value={adding.column_type}
                onChange={(e) => setAdding((a) => ({ ...a, column_type: e.target.value }))}
              >
                {COLUMN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {TARGET_REQUIRED_TYPES.includes(adding.column_type) && (
              <label className="text-xs text-gray-500">
                {adding.column_type === 'Choice' ? 'Choices (one per line)' : 'Target Table'}
                <input
                  className="fc-input mt-0.5 block w-48 py-1"
                  data-testid="ce-add-target"
                  value={adding.target}
                  onChange={(e) => setAdding((a) => ({ ...a, target: e.target.value }))}
                />
              </label>
            )}
            <button
              type="button"
              className="fc-btn-primary disabled:opacity-40"
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
            <p className="mt-1 text-xs text-[var(--color-danger)]" data-testid="ce-add-problem">
              {problem}
            </p>
          )}
          <p className="mt-2 text-xs text-gray-500">
            The new column is empty on every row that already exists. A column's type cannot be
            changed after it is made, and columns are not deleted here — delete the Table if that
            is what you mean.
          </p>
        </div>
      )}
    </div>
  )
}
