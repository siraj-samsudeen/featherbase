import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PrincipalName } from '../lib/people'
import { cardClasses, fmtInstant } from '@featherbase/shop-floor'
import { activityQuery, AuthorInitials, type VersionRow } from './Comments'
import { useChangeFormat } from '../lib/change-format'

type Entry =
  | { kind: 'comment'; at: string; who: string; content: string }
  | { kind: 'version'; at: string; who: string; whoName?: string; changes: [string, unknown, unknown][]; created?: boolean; importRun?: string; resolution?: NonNullable<VersionRow['data']>['resolution']; retirement?: NonNullable<VersionRow['data']>['retirement']; approvedBy?: { id: string; name: string }[] }

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
        whoName: v.author_name,
        changes: v.data?.changed ?? [],
        created: v.data?.created,
        importRun: v.data?.import_run,
        resolution: v.data?.resolution,
        retirement: v.data?.retirement,
        approvedBy: v.data?.approved_by,
      })
    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [activity.data])

  // #421: a changed value reads the way the rest of the Admin shows it.
  const format = useChangeFormat(table, '∅')
  const columnLabel = format.label
  const columnType = format.type
  const fmt = format.value

  return (
    <div className={cardClasses('p-4')} data-testid="activity-timeline">
      <div className="mb-3 text-xs font-semibold text-ink-subtle">
        Activity
      </div>
      {activity.isError && <p role="alert" className="text-sm text-negative">Activity could not be read.</p>}
      {activity.isSuccess && entries.length === 0 && !activity.data?.created?.created_at && (
        <p className="text-xs text-ink-subtle">No activity yet</p>
      )}
      <ol className="space-y-3">
        {/* #829: who made the row opens its activity, e.g. "Google sign-in created this". */}
        {activity.data?.created?.created_at && (
          <li className="flex gap-2 text-sm" data-testid="activity-created">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-ink-subtle" />
            <div className="min-w-0 flex-1 text-xs text-ink-muted">
              <span className="font-medium text-ink"><PrincipalName id={String(activity.data.created.created_by)} /></span>{' '}
              created this ·{' '}
              <span className="whitespace-nowrap" data-testid="activity-created-time">{fmtInstant(activity.data.created.created_at)}</span>
            </div>
          </li>
        )}
        {entries.map((e, i) => (
          <li key={i} className="flex gap-2 text-sm" data-testid={`activity-${e.kind}`}>
            {e.kind === 'comment' ? <AuthorInitials id={e.who} /> : <span
              className="mt-1 h-2 w-2 shrink-0 rounded-full bg-ink-subtle"
            />}
            <div className="min-w-0 flex-1">
              <div className="text-xs text-ink-muted">
                <span className="font-medium text-ink" data-testid={e.kind === 'comment' ? 'comment-author' : undefined}>{e.kind === 'version' && e.whoName ? e.whoName : <PrincipalName id={e.who} />}</span>{' '}
                {e.kind === 'comment' ? 'commented' : e.retirement ? (e.retirement.action === 'retired' ? 'retired this' : 'reactivated this') : e.resolution ? (e.resolution.decision === 'keep' ? 'kept their correction' : 'adopted the import value') : e.importRun ? 'imported' : e.created ? 'created' : 'edited'} ·{' '}
                <span className="whitespace-nowrap" data-testid="activity-time">{fmtInstant(e.at)}</span>
                {e.kind === 'version' && e.approvedBy?.length ? (
                  <span data-testid="activity-approved-by">
                    {' '}· approved by {e.approvedBy.map((a, j) => <span key={a.id}>{j > 0 && ', '}<span className="font-medium text-ink">{a.name}</span></span>)}
                  </span>
                ) : null}
              </div>
              {e.kind === 'comment' ? (
                <div className="whitespace-pre-wrap break-words text-ink" data-testid="comment-content">
                  {e.content.split(/((?<![\w.@-])@\[[^\]\n]{1,140}\]|(?<![\w.@-])@[\w.-]+)/g).map((part, i) => (
                    <span key={i} className={part.startsWith('@') ? 'font-medium text-action' : undefined}>{part}</span>
                  ))}
                </div>
              ) : (
                <ul className="text-xs text-ink-muted" data-testid="activity-diff">
                  {e.importRun && <li className="break-all">Import: {e.importRun}</li>}
                  {e.resolution && <li className="break-words">{columnLabel(e.resolution.field)}: {e.resolution.decision === 'keep' ? `kept the current value instead of ${fmt(e.resolution.field, e.resolution.incoming)}` : 'accepted the source; future imports can update this field'}</li>}
                  {e.retirement?.reason && <li className="whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="activity-retired-reason">Reason: {e.retirement.reason}</li>}
                  {e.changes.length === 0 && !e.importRun && !e.resolution && !e.retirement && <li>row updated</li>}
                  {e.changes.map(([column, from, to], j) => (
                    <li key={j} className="[overflow-wrap:anywhere]">
                      <span className="font-medium text-ink">{columnLabel(column)}</span>:{' '}
                      <span className={columnType(column) === 'JSON' ? 'break-all' : 'whitespace-pre-wrap [overflow-wrap:anywhere]'}>{fmt(column, from)}</span> →{' '}
                      <span className={columnType(column) === 'JSON' ? 'break-all' : 'whitespace-pre-wrap [overflow-wrap:anywhere]'}>{fmt(column, to)}</span>
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
