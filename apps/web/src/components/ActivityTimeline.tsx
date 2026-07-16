import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listResource } from '../lib/api'

interface CommentRow {
  content: string
  owner: string
  creation: string
}
interface VersionRow {
  owner: string
  creation: string
  data: { changed?: [string, unknown, unknown][] } | null
}

type Entry =
  | { kind: 'comment'; at: string; who: string; content: string }
  | { kind: 'version'; at: string; who: string; changes: [string, unknown, unknown][] }

// UI-019: activity timeline interleaving comments and versions (edits with
// their field diff) chronologically. Workflow actions join here once WF
// lands — they are recorded as versions/comments too.
export function ActivityTimeline({ doctype, name }: { doctype: string; name: string }) {
  const comments = useQuery({
    queryKey: ['comments', doctype, name],
    queryFn: () =>
      listResource<CommentRow>('Comment', {
        filters: [
          ['ref_doctype', '=', doctype],
          ['ref_name', '=', name],
        ],
        fields: ['content', 'owner', 'creation'],
        order_by: 'creation asc',
        limit_page_length: 200,
      }),
  })
  const versions = useQuery({
    queryKey: ['versions', doctype, name],
    queryFn: () =>
      listResource<VersionRow>('Version', {
        filters: [
          ['ref_doctype', '=', doctype],
          ['ref_name', '=', name],
        ],
        fields: ['owner', 'creation', 'data'],
        order_by: 'creation asc',
        limit_page_length: 200,
      }),
  })

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    for (const c of comments.data?.data ?? [])
      out.push({ kind: 'comment', at: c.creation, who: c.owner, content: c.content })
    for (const v of versions.data?.data ?? [])
      out.push({
        kind: 'version',
        at: v.creation,
        who: v.owner,
        changes: v.data?.changed ?? [],
      })
    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [comments.data, versions.data])

  const fmt = (v: unknown) => (v == null || v === '' ? '∅' : String(v))

  return (
    <div className="fc-card p-4" data-testid="activity-timeline">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        Activity
      </div>
      {entries.length === 0 && (
        <p className="text-xs text-[var(--color-ink-faint)]">No activity yet</p>
      )}
      <ol className="space-y-3">
        {entries.map((e, i) => (
          <li key={i} className="flex gap-2 text-sm" data-testid={`activity-${e.kind}`}>
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                e.kind === 'comment' ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-ink-faint)]'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--color-ink-muted)]">
                <span className="font-medium text-[var(--color-ink)]">{e.who}</span>{' '}
                {e.kind === 'comment' ? 'commented' : 'edited'} ·{' '}
                <span data-testid="activity-time">{new Date(e.at).toLocaleString()}</span>
              </div>
              {e.kind === 'comment' ? (
                <div className="whitespace-pre-wrap break-words text-[var(--color-ink)]">
                  {e.content}
                </div>
              ) : (
                <ul className="text-xs text-[var(--color-ink-muted)]" data-testid="activity-diff">
                  {e.changes.length === 0 && <li>document updated</li>}
                  {e.changes.map(([field, from, to], j) => (
                    <li key={j}>
                      <span className="font-medium text-[var(--color-ink)]">{field}</span>:{' '}
                      {fmt(from)} → {fmt(to)}
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
