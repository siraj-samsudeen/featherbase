import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { buttonClasses, cardClasses, inputClasses } from '@featherbase/shop-floor'
import { tableSlug } from 'shared'
import { ApiError, api, getSessionUser } from '../lib/api'
import { renameTableInRecents } from '../lib/recents'

// #871: rename a custom Table. The server carries its rows, history, links,
// permissions and saved views; the list reopens under the new name.
export function RenameTable({ table, noun }: { table: string; noun: 'Table' | 'view' }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(table)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (busy) return
    setOpen(false)
    setError(null)
  }

  async function rename() {
    setBusy(true)
    setError(null)
    try {
      const meta = await api.post<{ name: string }>(`/api/table_def/${encodeURIComponent(table)}/rename`, { to: name })
      const user = getSessionUser()?.row_id
      if (user)
        renameTableInRecents(user, table, meta.name, `/featherbase/admin/table/${tableSlug(table)}`, `/featherbase/admin/table/${tableSlug(meta.name)}`)
      for (const key of ['meta', 'list', 'doc'])
        queryClient.removeQueries({ queryKey: [key, table] })
      await navigate({ to: '/featherbase/admin/table/$table', params: { table: meta.name }, search: { filters: undefined } })
      void queryClient.invalidateQueries()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setName(table)
          setOpen(true)
        }}
        className={buttonClasses()}
        data-testid="rename-table"
      >
        Rename {noun}
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
            aria-labelledby="rename-table-title"
            className={cardClasses('w-full max-w-md p-4')}
            data-testid="rename-table-dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              void rename()
            }}
          >
            <h2 id="rename-table-title" className="mb-2 text-base font-semibold text-ink">
              Rename {table}
            </h2>
            <p className="mb-3 text-sm text-ink-muted">
              Its rows, history, comments, permissions and links from other Tables move to the new name. Its address changes too.
            </p>
            <label className="mb-1 block text-sm text-ink" htmlFor="rename-table-input">
              New name
            </label>
            <input
              id="rename-table-input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClasses('mb-3 w-full')}
              data-testid="rename-table-input"
            />
            {error && (
              <p className="mb-3 text-sm text-negative" data-testid="rename-table-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className={buttonClasses()} data-testid="rename-table-cancel">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !name.trim() || name.trim() === table}
                className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })}
                data-testid="rename-table-confirm"
              >
                {busy ? 'Renaming…' : 'Rename'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
