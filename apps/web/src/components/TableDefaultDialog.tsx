import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { TableViewDefault, TableViewSettings } from 'shared'
import { buttonClasses, cardClasses, touchLinkClasses, useToast } from '@featherbase/shop-floor'
import { api } from '../lib/api'

// #1282 A4 (UI owner): "Make This the Table's Default…" opens this short confirm. It names, in words, each
// setting that will be saved, and says that people who've changed these keep their own. Saved, a toast offers
// Undo, which puts the earlier default back (the team Activity feed offers it too, while the save is in force).

/** Undo one save of a Table's default; the list then opens on the earlier one. */
export async function undoTableDefault(queryClient: ReturnType<typeof useQueryClient>, table: string, id: string) {
  await api.post(`/api/table_view_default/${encodeURIComponent(table)}/undo`, { id })
  await queryClient.invalidateQueries({ queryKey: ['table-view-default', table] })
}

export function TableDefaultDialog({ table, view, words, onClose }: { table: string; view: TableViewSettings; words: string[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  async function save() {
    setBusy(true)
    setError(false)
    try {
      const saved = await api.put<TableViewDefault>(`/api/table_view_default/${encodeURIComponent(table)}`, { settings: view })
      await queryClient.invalidateQueries({ queryKey: ['table-view-default', table] })
      onClose()
      toast({ tone: 'positive', message: <SavedToast table={table} id={saved.id} /> })
    } catch {
      setError(true)
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4" onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="table-default-title" className={cardClasses('w-full max-w-md p-4')}
        data-testid="table-default-dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void save() }}>
        <h2 id="table-default-title" className="mb-2 text-base font-semibold text-ink">Make this the {table} default?</h2>
        <p className="mb-2 text-sm text-ink-muted">Everyone opens {table} like this:</p>
        <ul className="mb-3 list-disc pl-5 text-sm text-ink" data-testid="table-default-words">
          {words.map((w) => <li key={w}>{w}</li>)}
        </ul>
        <p className="mb-3 text-sm text-ink-muted">People who've changed these keep their own choices.</p>
        {error && <p className="mb-3 text-sm text-negative" data-testid="table-default-error">Couldn't save the default. {table} opens as it did.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={buttonClasses()} data-testid="table-default-cancel">Cancel</button>
          <button type="submit" autoFocus disabled={busy} className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })} data-testid="table-default-confirm">
            {busy ? 'Saving…' : 'Make Default'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** "Saved as the Table's default · Undo". */
function SavedToast({ table, id }: { table: string; id: string }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<'saved' | 'undone' | 'failed'>('saved')
  if (state === 'undone') return <span data-testid="table-default-toast">Put the earlier default back.</span>
  return (
    <span data-testid="table-default-toast">
      Saved as the Table's default ·{' '}
      <button type="button" className={touchLinkClasses('text-action hover:underline')} data-testid="table-default-undo"
        onClick={() => undoTableDefault(queryClient, table, id).then(() => setState('undone'), () => setState('failed'))}>Undo</button>
      {state === 'failed' && <span className="text-negative"> Couldn't undo: it is no longer the default.</span>}
    </span>
  )
}
