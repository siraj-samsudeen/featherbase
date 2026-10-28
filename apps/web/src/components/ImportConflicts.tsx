import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError, api } from '../lib/api'
import type { TableMeta } from '../lib/meta'
import { PrincipalName } from '../lib/people'
import { RowTitle } from '../lib/row-titles'
import { formatDateTime, formatValue, useSettings } from '../lib/settings'
import { Button, Notice, cardClasses, touchLinkClasses } from './ui'

interface ImportConflict {
  id: string
  row_id: string
  field: string
  label: string
  kept: unknown
  incoming: unknown
  editor: string
  edited_at: string
  run_id: string
  can_resolve: boolean
}

/** A Table's import conflicts follow its ordinary row and field permissions. */
export function ImportConflicts({ table, meta }: { table: string; meta: TableMeta }) {
  const settings = useSettings()
  const client = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const conflicts = useQuery({
    queryKey: ['import-conflicts', table],
    queryFn: () => api.get<{ conflicts: ImportConflict[] }>(`/api/table/${encodeURIComponent(table)}:import-conflicts`),
    refetchOnMount: 'always',
  })
  async function resolve(id: string, decision: 'keep' | 'source') {
    setBusy(id)
    setError(null)
    try {
      await api.post(`/api/table/${encodeURIComponent(table)}:resolve-import-conflict`, { conflict_id: id, decision })
      await Promise.all([
        client.invalidateQueries({ queryKey: ['import-conflicts', table] }),
        client.invalidateQueries({ queryKey: ['list', table] }),
        client.invalidateQueries({ queryKey: ['doc', table] }),
      ])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resolve this conflict. Try again.')
    } finally {
      setBusy(null)
    }
  }
  function display(field: string, value: unknown) {
    if (value == null || value === '') return 'Empty'
    if (typeof value === 'object') return JSON.stringify(value)
    return formatValue(meta.columns.find((c) => c.column_name === field)?.column_type ?? 'Data', value, settings)
  }
  return (
    <section aria-label="Import conflicts" id="import-conflicts" className="mb-4 min-w-0" data-testid="import-conflicts">
      <h2 className="mb-1 text-lg font-semibold text-ink">Import conflicts</h2>
      <p className="mb-3 text-sm text-ink-muted">Saved corrections were kept when incoming values differed.</p>
      {error && <Notice tone="negative" className="mb-3">{error}</Notice>}
      {conflicts.isPending && <p className="text-sm text-ink-muted" role="status">Loading conflicts…</p>}
      {conflicts.isError && <Notice tone="negative">Could not load import conflicts. <Button variant="quiet" onClick={() => void conflicts.refetch()}>Try again</Button></Notice>}
      {conflicts.data?.conflicts.length === 0 && <Notice>No open import conflicts.</Notice>}
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {conflicts.data?.conflicts.map((conflict) => (
          <article key={conflict.id} className={cardClasses('min-w-0 p-4')} data-testid="import-conflict">
            <div className="mb-3 min-w-0">
              <Link
                to="/featherbase/admin/$table/$name"
                params={{ table, name: conflict.row_id }}
                search={{ prefill: undefined }}
                className={touchLinkClasses('max-w-full break-words font-semibold')}
              ><RowTitle table={table} rowId={conflict.row_id} /></Link>
              <h3 className="text-sm font-semibold text-ink">{conflict.label}</h3>
            </div>
            <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
              <div className="min-w-0"><dt className="text-ink-muted">Kept value</dt><dd className="whitespace-pre-wrap break-words text-ink">{display(conflict.field, conflict.kept)}</dd></div>
              <div className="min-w-0"><dt className="text-ink-muted">Incoming value</dt><dd className="whitespace-pre-wrap break-words text-ink">{display(conflict.field, conflict.incoming)}</dd></div>
              <div className="min-w-0"><dt className="text-ink-muted">Last edited by</dt><dd className="break-words text-ink"><PrincipalName id={conflict.editor} /></dd><dd className="text-ink-muted">{formatDateTime(conflict.edited_at)}</dd></div>
              <div className="min-w-0"><dt className="text-ink-muted">Import</dt><dd className="break-all text-ink">{conflict.run_id}</dd></div>
            </dl>
            {conflict.can_resolve ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={busy !== null} loading={busy === conflict.id} onClick={() => void resolve(conflict.id, 'keep')}>Keep mine</Button>
                <Button disabled={busy !== null} onClick={() => void resolve(conflict.id, 'source')}>Take the source</Button>
              </div>
            ) : <p className="mt-3 text-sm text-ink-muted">You can read this conflict, but you cannot edit this field.</p>}
          </article>
        ))}
      </div>
    </section>
  )
}
