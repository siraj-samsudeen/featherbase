import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Notice, buttonClasses, cardClasses, fmtInstant, inputClasses } from '@featherbase/shop-floor'
import { ApiError, api } from '../lib/api'
import { PrincipalName } from '../lib/people'
import { isArchived, type TableMeta } from '../lib/meta'

// #905: archive a Table that something else replaced, or (#1041) an app's unused one. Its rows and
// history stay readable; it takes no new rows or edits, and leaves the menus
// and pickers until a System Manager un-archives it. Deleting stays separate.

/** A Table people write, custom or an app's. The server refuses the rest and
 *  has the last word: an app's entry Table, one that decides access. */
export function canArchive(meta: TableMeta | undefined): boolean {
  return Boolean(meta && meta.kind === 'table' && !meta.system && !meta.system_written)
}

async function refreshTable(queryClient: ReturnType<typeof useQueryClient>, table: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['meta', table] }),
    queryClient.invalidateQueries({ queryKey: ['whoami'] }),
    queryClient.invalidateQueries({ queryKey: ['home-pages'] }),
    queryClient.invalidateQueries({ queryKey: ['command-destinations'] }),
  ])
}

export function ArchiveTable({ table }: { table: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (busy) return
    setOpen(false)
    setError(null)
  }

  async function archive() {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/api/table_def/${encodeURIComponent(table)}/archive`, { note })
      await refreshTable(queryClient, table)
      setOpen(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Archive failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setNote('')
          setOpen(true)
        }}
        className={buttonClasses()}
        data-testid="archive-table"
      >
        Archive Table
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
            aria-labelledby="archive-table-title"
            className={cardClasses('w-full max-w-md p-4')}
            data-testid="archive-table-dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              void archive()
            }}
          >
            <h2 id="archive-table-title" className="mb-2 text-base font-semibold text-ink">
              Archive {table}?
            </h2>
            <p className="mb-3 text-sm text-ink-muted">
              Its rows and history stay readable, but nobody can add or change rows, here or through the API. It leaves the
              menus and the table pickers and is listed under Archived tables. You can un-archive it at any time.
            </p>
            <label className="mb-1 block text-sm text-ink" htmlFor="archive-table-note">
              What replaced it, or why isn't it in use? (optional)
            </label>
            <textarea
              id="archive-table-note"
              autoFocus
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClasses('mb-3 w-full')}
              data-testid="archive-table-note"
            />
            {error && (
              <p className="mb-3 text-sm text-negative" data-testid="archive-table-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className={buttonClasses()} data-testid="archive-table-cancel">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })}
                data-testid="archive-table-confirm"
              >
                {busy ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

/** Who archived the Table, when, and what replaced it; a System Manager can
 *  bring it back from here. Nothing for a Table that is not archived. */
export function ArchivedBanner({ table, meta, canUnarchive }: { table: string; meta: TableMeta | undefined; canUnarchive: boolean }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!meta || !isArchived(meta)) return null

  async function unarchive() {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/api/table_def/${encodeURIComponent(table)}/unarchive`, {})
      await refreshTable(queryClient, table)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Un-archive failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-3" data-testid="archived-banner">
      <Notice tone="caution">
        <p>
          <strong>{table} is archived.</strong> Archived on {fmtInstant(meta.archived_at)}
          {meta.archived_by && (
            <>
              {' '}by <PrincipalName id={meta.archived_by} />
            </>
          )}
          . Its rows are read only.
        </p>
        {meta.archived_note && (
          <p className="mt-1" data-testid="archived-note">
            {meta.archived_note}
          </p>
        )}
        {canUnarchive && (
          <button
            onClick={() => void unarchive()}
            disabled={busy}
            className={buttonClasses({ className: 'mt-2 disabled:opacity-40' })}
            data-testid="unarchive-table"
          >
            {busy ? 'Un-archiving…' : 'Un-archive'}
          </button>
        )}
        {error && (
          <p className="mt-1 text-sm text-negative" data-testid="unarchive-table-error">
            {error}
          </p>
        )}
      </Notice>
    </div>
  )
}
