// #772 part 2 (first version): above a copied table's list — where it was copied
// from, when, and Copy again, with what the last copy did.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { fmtCount } from '@featherbase/shop-floor'
import { formatValue, useSettings } from '../lib/settings'
import { Button, Notice, cardClasses } from '@featherbase/shop-floor'

interface CopyInfo { data_source: string; database: string; source_schema: string; source_table: string; key_column: string; last_copied_at: string | null }
interface CopyResult { inserted: number; updated: number; failed: number; conflicts: number; deleted_at_source: number; back_at_source: number; first_errors: string[] }

export function CopyBar({ table }: { table: string }) {
  const queryClient = useQueryClient()
  const settings = useSettings()
  const info = useQuery({
    queryKey: ['copy-info', table],
    queryFn: () => api.get<CopyInfo>(`/api/table/${encodeURIComponent(table)}:copy_info`),
    retry: false,
  })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CopyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!info.data) return null
  const c = info.data

  async function copyAgain() {
    setBusy(true)
    setError(null)
    try {
      setResult(await api.post<CopyResult>(`/api/table/${encodeURIComponent(table)}:copy_again`, {}))
      await queryClient.invalidateQueries()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The copy could not be run')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 space-y-2" data-testid="copy-bar">
      <div className={cardClasses('flex flex-wrap items-center justify-between gap-3 px-4 py-3')}>
        <p className="text-sm text-ink-muted">
          Copied from <span className="font-semibold text-ink">{c.data_source}</span> · <span className="font-mono">{c.database}.{c.source_schema}.{c.source_table}</span>
          {' '}· matched on <span className="font-mono">{c.key_column}</span>
          {c.last_copied_at && <> · last copied {formatValue('Datetime', c.last_copied_at, settings)}</>}
        </p>
        <Button variant="secondary" loading={busy} onClick={copyAgain} data-testid="copy-again">Copy again</Button>
      </div>
      {result && (
        <div data-testid="copy-result">
          <Notice tone={result.conflicts || result.deleted_at_source || result.failed ? 'caution' : 'positive'}>
            Copied: {fmtCount(result.inserted)} added · {fmtCount(result.updated)} updated
            {result.conflicts > 0 && <> · <b>{fmtCount(result.conflicts)} conflict{result.conflicts === 1 ? '' : 's'}</b> where the source changed a value someone corrected (see Import conflicts)</>}
            {result.deleted_at_source > 0 && <> · <b>{fmtCount(result.deleted_at_source)} deleted at source</b></>}
            {result.back_at_source > 0 && <> · {fmtCount(result.back_at_source)} back at source</>}
            {result.failed > 0 && <> · {fmtCount(result.failed)} failed: {result.first_errors.join('; ')}</>}
          </Notice>
        </div>
      )}
      {error && <Notice tone="negative">{error}</Notice>}
    </div>
  )
}
