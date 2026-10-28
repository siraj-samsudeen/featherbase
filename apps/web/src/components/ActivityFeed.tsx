import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { api, getSessionUser } from '../lib/api'
import { fmtClockTime, fmtTimelineDay, timelineDayKey } from '../lib/inr'
import { KindIcon } from '../lib/kind-icons'
import { useRealtime } from '../lib/realtime'
import { useIsSystemManager } from '../lib/session'
import { cardClasses, touchRowClasses } from './ui'

interface FeedItem {
  /** Display name (#440). The feed carries no person id, by design. */
  who_name: string
  /** Their main role, absent when they hold none. */
  who_role?: string
  /** Lists only: was a filter actually applied? */
  filtered?: boolean
  kind: string
  label: string
  /** A row's display title for this viewer, when the server could read it. */
  title?: string
  sub?: string
  path: string
  at: string
  /** Back-to-back repeats collapsed into this row (server-side); 1 = single. */
  count?: number
}

// #101 Phase 4: the homepage activity feed. Two tabs with a deliberate
// asymmetry: "Mine" is this user's full trail (views and searches included —
// visible to them alone); "Team" shows changes and logins only, never what a
// colleague merely viewed, and only exists for System Managers. Data always
// comes from the role-gated endpoint; the websocket 'feed' channel is just
// an invalidation ping.

const KIND_VERB: Record<string, string> = {
  row: 'opened',
  list: 'opened', // 'filtered' only when a filter was applied — see feedVerb
  page: 'opened',
  search: 'searched',
  change: 'changed',
  login: 'signed in',
}

/** The verb for a row: a list open says "filtered" only if a filter existed. */
export function feedVerb(item: Pick<FeedItem, 'kind' | 'filtered'>): string {
  if (item.kind === 'list' && item.filtered) return 'filtered'
  return KIND_VERB[item.kind] ?? ''
}

/** Newest-first feed rows under one heading per day: Today, Yesterday,
 *  then "Tue, 13-Oct-2026". */
export function groupByDay<T extends { at: string }>(items: T[], now = new Date()) {
  const groups: Array<{ key: string; heading: string; items: T[] }> = []
  for (const item of items) {
    const at = new Date(item.at)
    const key = timelineDayKey(at)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.items.push(item)
    else groups.push({ key, heading: fmtTimelineDay(at, now), items: [item] })
  }
  return groups
}

export function ActivityFeed() {
  const isSystemManager = useIsSystemManager()
  const [scope, setScope] = useState<'mine' | 'team'>('mine')
  const router = useRouter()
  const queryClient = useQueryClient()

  const feed = useQuery({
    queryKey: ['activity-feed', scope],
    queryFn: () => api.get<{ items: FeedItem[] }>(`/api/activity_feed?scope=${scope}&limit=20`),
    refetchInterval: 30_000,
  })
  // Live invalidation: 'feed' is the payload-free team ping (the server only
  // grants that channel to System Managers); 'feed_mine' arrives on the
  // caller's own channel when one of their event batches lands.
  const user = getSessionUser()
  useRealtime(
    [...(isSystemManager ? ['feed'] : []), ...(user ? [`user:${user.row_id}`] : [])],
    (e) => {
      if (e.event === 'changed' || e.event === 'feed_mine')
        void queryClient.invalidateQueries({ queryKey: ['activity-feed'] })
    },
  )

  const items = feed.data?.items ?? []

  return (
    <div className={cardClasses('overflow-hidden')} data-testid="activity-feed">
      <div className="flex items-center gap-1 border-b border-border px-3 pt-1.5">
        <FeedTab label="My activity" on={scope === 'mine'} onClick={() => setScope('mine')} testid="feed-tab-mine" />
        {isSystemManager && (
          <FeedTab label="Team" on={scope === 'team'} onClick={() => setScope('team')} testid="feed-tab-team" />
        )}
      </div>
      {items.length === 0 && (
        <p className="px-4 py-3 text-sm text-ink-subtle" data-testid="feed-empty">
          {feed.isLoading ? 'Loading…' : 'Nothing here yet — activity shows up as you work.'}
        </p>
      )}
      {groupByDay(items).map((group) => (
        <section key={group.key} data-testid="feed-day-group">
          <h3 className="bg-subtle px-3 py-1 text-xs font-semibold text-ink-muted" data-testid="feed-day">
            {group.heading}
          </h3>
          {group.items.map((item, i) => (
            // One sentence on both tabs — subject, action, object — led by the
            // kind's icon, with the clock time trailing.
            <div
              key={`${item.at}-${i}`}
              className={touchRowClasses('relative flex items-center gap-2.5 border-t border-border px-3 py-1.5 text-sm')}
              data-testid="feed-item"
            >
              <KindIcon kind={item.kind} />
              {/* One line that keeps its shape when narrow: who, the verb and
                  the count never shrink; only the object's text truncates (it
                  keeps its first few letters), and the Table name gives way
                  first, hidden on a phone. */}
              <span className="flex min-w-0 flex-1 items-baseline gap-x-1 whitespace-nowrap" data-testid="feed-sentence">
                <span className="max-w-[45%] shrink-0 truncate font-medium" data-testid="feed-who">
                  {scope === 'team' ? item.who_name : 'You'}
                </span>
                {scope === 'team' && item.who_role && (
                  <span className="hidden shrink-0 text-xs text-ink-subtle sm:inline" data-testid="feed-role">
                    {item.who_role}
                  </span>
                )}{' '}
                <span className="shrink-0 text-ink-muted" data-testid="feed-verb">{feedVerb(item)}</span>{' '}
                {item.path ? (
                  <button
                    type="button"
                    onClick={() => router.history.push(item.path)}
                    title={item.title ? item.label : undefined}
                    // On a touch screen the object's tap area is the whole row
                    // (the row is `relative`), not its few letters of text.
                    className="min-w-[4ch] truncate text-left font-medium text-action hover:underline pointer-coarse:before:absolute pointer-coarse:before:inset-0 pointer-coarse:before:content-['']"
                    data-testid="feed-object"
                  >
                    {item.title ?? item.label}
                  </button>
                ) : (
                  (item.title ?? item.label) && (
                    <span className="min-w-[4ch] truncate font-medium" data-testid="feed-object">{item.title ?? item.label}</span>
                  )
                )}
                {item.sub && (
                  <span className="hidden min-w-0 shrink-[4] truncate text-xs text-ink-subtle sm:inline">{item.sub}</span>
                )}
                {(item.count ?? 1) > 1 && (
                  <span className="shrink-0 text-xs text-ink-subtle" data-testid="feed-count">
                    · {item.count}×
                  </span>
                )}
              </span>
              <time
                dateTime={item.at}
                className="shrink-0 text-xs tabular-nums text-ink-subtle"
                data-testid="feed-time"
              >
                {fmtClockTime(new Date(item.at))}
              </time>
            </div>
          ))}
        </section>
      ))}
      <div className="bg-subtle px-3 py-1.5 text-xs text-ink-muted">
        {scope === 'mine'
          ? 'Your full trail — visible to you alone.'
          : 'Changes and sign-ins only — what colleagues viewed is never shown.'}
      </div>
    </div>
  )
}

function FeedTab({
  label,
  on,
  onClick,
  testid,
}: {
  label: string
  on: boolean
  onClick: () => void
  testid: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      aria-pressed={on}
      className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${touchRowClasses()} ${
        on
          ? 'border-action text-action'
          : 'border-transparent text-ink-muted hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}
