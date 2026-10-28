import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PrincipalName } from '../lib/people'
import { cardClasses } from './ui'
import { activityQuery, type VersionRow } from './Comments'
import { fmtInstantIST } from '../lib/inr'
import { useMeta } from '../lib/meta'
import { formatValue, useSettings } from '../lib/settings'

type Entry =
  | { kind: 'comment'; at: string; who: string; content: string }
  | { kind: 'version'; at: string; who: string; changes: [string, unknown, unknown][]; importRun?: string; resolution?: NonNullable<VersionRow['data']>['resolution'] }

// UI-019: activity timeline interleaving comments and versions (edits with
// their column diff) chronologically. Workflow actions join here once WF
// lands — they are recorded as versions/comments too.
export function ActivityTimeline({ table, name }: { table: string; name: string }) {
  const activity = useQuery(activityQuery(table, name))

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    for (const c of activity.data?.comments ?? [])
      out.push({ kind: 'comment', at: c.created_at, who: c.created_by, content: c.content })
    for (const v of activity.data?.versions ?? [])
      out.push({
        kind: 'version',
        at: v.created_at,
        who: v.created_by,
        changes: v.data?.changed ?? [],
        importRun: v.data?.import_run,
        resolution: v.data?.resolution,
      })
    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [activity.data])

  // #421: a changed value reads the way the rest of the Admin shows it (a Date
  // as DD-Mon-YYYY, money the Indian way), by its column's type.
  const meta = useMeta(table)
  const settings = useSettings()
  const columnLabel = (column: string) => meta.data?.columns.find((c) => c.column_name === column)?.label ?? column
  const columnType = (column: string) => meta.data?.columns.find((c) => c.column_name === column)?.column_type ?? 'Data'
  // A Settings Table records its values as stored text, so a checkbox is '1'/'0'.
  const asStored = (type: string, v: unknown) =>
    type === 'Check' && typeof v === 'string' ? v === '1' || v === 'true' : v
  const fmt = (column: string, v: unknown) => {
    if (v == null || v === '') return '∅'
    const type = columnType(column)
    return formatValue(type, asStored(type, v), settings) || String(v)
  }

  return (
    <div className={cardClasses('p-4')} data-testid="activity-timeline">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
        Activity
      </div>
      {entries.length === 0 && (
        <p className="text-xs text-ink-subtle">No activity yet</p>
      )}
      <ol className="space-y-3">
        {entries.map((e, i) => (
          <li key={i} className="flex gap-2 text-sm" data-testid={`activity-${e.kind}`}>
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                e.kind === 'comment' ? 'bg-action' : 'bg-ink-subtle'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-ink-muted">
                <span className="font-medium text-ink"><PrincipalName id={e.who} /></span>{' '}
                {e.kind === 'comment' ? 'commented' : e.resolution ? (e.resolution.decision === 'keep' ? 'kept their correction' : 'adopted the import value') : e.importRun ? 'imported' : 'edited'} ·{' '}
                <span className="whitespace-nowrap" data-testid="activity-time">{fmtInstantIST(e.at)}</span>
              </div>
              {e.kind === 'comment' ? (
                <div className="whitespace-pre-wrap break-words text-ink">
                  {e.content}
                </div>
              ) : (
                <ul className="text-xs text-ink-muted" data-testid="activity-diff">
                  {e.importRun && <li className="break-all">Import: {e.importRun}</li>}
                  {e.resolution && <li className="break-words">{columnLabel(e.resolution.field)}: {e.resolution.decision === 'keep' ? `kept the current value instead of ${fmt(e.resolution.field, e.resolution.incoming)}` : 'accepted the source; future imports can update this field'}</li>}
                  {e.changes.length === 0 && !e.importRun && !e.resolution && <li>row updated</li>}
                  {e.changes.map(([column, from, to], j) => (
                    <li key={j}>
                      <span className="font-medium text-ink">{column}</span>:{' '}
                      <span className="whitespace-nowrap">{fmt(column, from)}</span> →{' '}
                      <span className="whitespace-nowrap">{fmt(column, to)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
