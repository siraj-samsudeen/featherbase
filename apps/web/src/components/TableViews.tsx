import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Notice, buttonClasses, cardClasses, inputClasses } from '@featherbase/shop-floor'
import { ApiError, api } from '../lib/api'
import { describeViewFilters, isView, type TableMeta } from '../lib/meta'

// #1021: a view is a named, filtered lens on one Table (its base). It holds
// no rows of its own: its list shows the base rows its filter matches, and
// those rows open and are changed as base rows, under the base's access.

type Filter = [string, string, unknown]

/** The operators a view's filter may use; the server refuses any other. */
const VIEW_OPERATORS = new Set(['=', '!=', '>', '<', '>=', '<=', 'in', 'not in', 'like', 'not like'])

/** The list's filters a view can keep, or why it cannot. */
export function viewFiltersFrom(filters: readonly unknown[]): { filters: Filter[] } | { why: string } {
  const plain = filters.filter((f): f is Filter => Array.isArray(f) && f.length === 3 && typeof f[0] === 'string')
  if (!plain.length) return { why: 'Filter the list first: the view keeps the rows the filter shows.' }
  if (plain.length !== filters.length || plain.some((f) => !VIEW_OPERATORS.has(f[1])))
    return { why: 'A view keeps plain filters on this Table’s own columns. Remove the filter that follows a link, then try again.' }
  return { filters: plain }
}

/** On a view's list: what it is a view of, and where its rows really live. */
export function ViewBanner({ meta }: { meta: TableMeta | undefined }) {
  if (!isView(meta)) return null
  return (
    <div className="mb-3" data-testid="view-banner">
      <Notice tone="info">
        <span>
          A view of{' '}
          <Link to="/featherbase/admin/table/$table" params={{ table: meta.view_of }} search={{ filters: undefined }}
            className="font-medium text-action hover:underline" data-testid="view-banner-base">
            {meta.view_of}
          </Link>
          : the rows of {meta.view_of} where <span data-testid="view-banner-filter">{describeViewFilters(meta)}</span>.
          {' '}Its rows open, and are changed, in {meta.view_of}.
        </span>
      </Notice>
    </div>
  )
}

/** On a Table's list, for a System Manager: keep the list's filters as a
 *  view, a name links and menus can use. */
export function SaveAsView({ table, filters }: { table: string; filters: readonly unknown[] }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kept = viewFiltersFrom(filters)

  function close() {
    if (busy) return
    setOpen(false)
    setError(null)
  }

  async function save() {
    // Only a list with filters to keep shows the name field and Create view,
    // so the form is never submitted without them.
    const { filters } = kept as { filters: Filter[] }
    setBusy(true)
    setError(null)
    try {
      const meta = await api.post<{ name: string }>('/api/table_def', {
        name: name.trim(), kind: 'view', view_of: table, view_filters: filters,
      })
      void queryClient.invalidateQueries({ queryKey: ['home-pages'] })
      void queryClient.invalidateQueries({ queryKey: ['command-destinations'] })
      await navigate({ to: '/featherbase/admin/table/$table', params: { table: meta.name }, search: { filters: undefined } })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setName('')
          setError(null)
          setOpen(true)
        }}
        className={buttonClasses()}
        data-testid="save-as-view"
      >
        New view…
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4"
          onClick={close}
          onKeyDown={(e) => e.key === 'Escape' && close()}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-as-view-title"
            className={cardClasses('w-full max-w-md p-4')}
            data-testid="save-as-view-dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <h2 id="save-as-view-title" className="mb-2 text-base font-semibold text-ink">
              New view of {table}
            </h2>
            {'why' in kept ? (
              <p className="mb-3 text-sm text-ink-muted" data-testid="save-as-view-why">{kept.why}</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-ink-muted">
                  A view is a named list of the rows of {table} this filter shows, now and later. Links can point at it, so
                  their pickers offer only these rows. It holds no rows of its own and gives nobody access: whoever can
                  read {table} can read it.
                </p>
                <label className="mb-1 block text-sm text-ink" htmlFor="save-as-view-name">
                  Name
                </label>
                <input
                  id="save-as-view-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClasses('mb-3 w-full')}
                  placeholder="For example, Store"
                  data-testid="save-as-view-name"
                />
              </>
            )}
            {error && (
              <p className="mb-3 text-sm text-negative" data-testid="save-as-view-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className={buttonClasses()} data-testid="save-as-view-cancel">
                Cancel
              </button>
              {'filters' in kept && (
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })}
                  data-testid="save-as-view-confirm"
                >
                  {busy ? 'Saving…' : 'Create view'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  )
}
