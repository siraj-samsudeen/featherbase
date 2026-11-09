import { useQuery } from '@tanstack/react-query'
import type { CoercedRow } from 'shared'
import { analyzeImportKeys, sendImportRun } from '../lib/import-run'
import type { SheetPlan } from '../lib/import-plan'
import { Notice } from '@featherbase/shop-floor'
import { fmtCount } from '@featherbase/shop-floor'

export function ImportPreviewFacts({ report }: {
  report: Omit<NonNullable<SheetPlan['check']>, 'failed'> & { failed: { message: string }[] }
}) {
  return (
    <>
      <p>
        {fmtCount(report.changed)} {report.changed === 1 ? 'row changes' : 'rows change'} ·{' '}
        {fmtCount(report.unchanged)} unchanged · {fmtCount(report.inserted)} added ·{' '}
        {fmtCount(report.skipped)} skipped · {fmtCount(report.failed.length)} refused
      </p>
      <p>
        {fmtCount(report.fields_updated ?? 0)} {report.fields_updated === 1 ? 'value changes' : 'values change'} ·{' '}
        {fmtCount(report.rows_kept)} {report.rows_kept === 1 ? 'row keeps' : 'rows keep'} your corrections ·{' '}
        {fmtCount(report.fields_kept ?? 0)} {report.fields_kept === 1 ? 'value' : 'values'} retained ·{' '}
        {fmtCount(report.conflicts)} new {report.conflicts === 1 ? 'conflict' : 'conflicts'}
      </p>
      {(report.retired ?? 0) > 0 && (
        <p data-testid="iw-preview-retired">
          {fmtCount(report.retired ?? 0)} matched {report.retired === 1 ? 'row is' : 'rows are'} retired and {report.retired === 1 ? 'stays' : 'stay'} retired
        </p>
      )}
      <p className="text-xs text-ink-muted">
        Rows keeping corrections may also have other values change. Counts describe mapped values; import automation still runs.
      </p>
      {report.tracks_changes === false && (
        <Notice tone="caution" className="mt-2">This Table does not keep change history. Imports overwrite existing values, including hand edits.</Notice>
      )}
    </>
  )
}

export function KeySuggestions({ i, table, rows, columns, suggested, label, onAccept }: {
  i: number
  table: string
  rows: CoercedRow[]
  columns: string[]
  suggested: SheetPlan['suggested']
  label: (column: string) => string
  onAccept: (key: string, emptyCells: 'keep' | 'clear') => void
}) {
  const analysis = useQuery({
    queryKey: ['iw-key-analysis', table, columns, rows],
    queryFn: () => analyzeImportKeys({ table, columns, rows }),
  })
  if (analysis.isError) return (
    <Notice tone="caution" className="mt-2">
      Could not check matching columns. This does not mean that no rows overlap.{' '}
      <button type="button" onClick={() => void analysis.refetch()} className="underline">Try again</button>
    </Notice>
  )
  if (!analysis.data) return <p className="mt-1 text-xs text-ink-muted">Checking matching columns…</p>
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {analysis.data.filter((c) => c.can_match && (c.complete || c.column === suggested?.key)).map((candidate) => {
        const remembered = candidate.column === suggested?.key
        return (
          <span key={candidate.column} data-testid={remembered ? `iw-key-suggested-${i}` : undefined} className="text-xs text-action">
            <button type="button" className="underline" onClick={() => onAccept(candidate.column, remembered ? suggested!.empty_cells : 'keep')}>
              Match on {label(candidate.column)}
            </button>
            {remembered ? ', as last time' : ` — all ${fmtCount(candidate.matched)} rows match one-to-one`}
          </span>
        )
      })}
    </div>
  )
}

// UPS-J1.3: real counts BEFORE anything commits — a dry run over the whole
// (deduplicated) file the moment a match key is chosen, so marking a key is
// never a silent mode switch. Include the values in the cache identity:
// another file can have the same row count but different changes.
export function UpsertPreview({
  i,
  table,
  keyColumn,
  emptyCells,
  columns,
  rows,
  skipped,
}: {
  i: number
  table: string
  keyColumn: string
  emptyCells: 'keep' | 'clear'
  columns: string[]
  rows: CoercedRow[]
  skipped: number
}) {
  const preview = useQuery({
    queryKey: ['iw-upsert-preview', table, keyColumn, emptyCells, columns, rows],
    enabled: rows.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const report = await sendImportRun({
        table,
        rows,
        dryRun: true,
        upsert: { key_column: keyColumn, empty_cells: emptyCells, columns },
      })
      return report
    },
  })
  if (preview.isError) return null // e.g. no permission — rehearse/import will say so
  if (!preview.data)
    return (
      <p className="mt-1 text-xs text-ink-subtle" data-testid={`iw-preview-pending-${i}`}>
        Counting matches…
      </p>
    )
  return (
    <div className="mt-1 text-sm text-ink" data-testid={`iw-preview-${i}`}>
      <ImportPreviewFacts report={{ ...preview.data, skipped }} />
    </div>
  )
}
