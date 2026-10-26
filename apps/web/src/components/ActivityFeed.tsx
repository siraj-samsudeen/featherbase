import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { api, getSessionUser } from '../lib/api'
import { ago } from '../lib/recents'
import { useRealtime } from '../lib/realtime'
import { useIsSystemManager } from '../lib/session'
import { cardClasses } from './ui'

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

// The kind is a quiet tag beside the time, not part of the sentence — so it
// carries no colour of its own (colour is for business meaning).
const KIND_LABEL: Record<string, string> = {
  row: 'Row',
  list: 'List',
  page: 'Page',
  search: 'Search',
  change: 'Change',
  login: 'Sign-in',
}
const KIND_VERB: Record<string, string> = {
  row: 'opened',
  list: 'opened', // 'filtered' only when a filter was applied — see feedVerb
  page: 'opened',
  search: 'searched',
  change: 'changed',
  login: '',
}

/** The verb for a row: a list open says "filtered" only if a filter existed. */
export function feedVerb(item: Pick<FeedItem, 'kind' | 'filtered'>): string {
  if (item.kind === 'list' && item.filtered) return 'filtered'
  return KIND_VERB[item.kind] ?? ''
}

export function initials(who: string): string {
  return who
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')
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
      {items.map((item, i) => (
        // One sentence on both tabs — subject, action, object — with the
        // kind and the time as quiet trailing metadata.
        <div
          key={`${item.at}-${i}`}
          className="flex items-center gap-2.5 border-b border-border px-3 py-1.5 text-sm last:border-b-0"
          data-testid="feed-item"
        >
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-action-tint text-xs font-bold text-action"
          >
            {initials(item.who_name)}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {scope === 'team' ? (
              <>
                <span className="font-medium" data-testid="feed-who">{item.who_name}</span>
                {item.who_role && (
                  <span className="ml-1 text-xs text-ink-subtle" data-testid="feed-role">
                    {item.who_role}
                  </span>
                )}
              </>
            ) : (
              <span className="font-medium" data-testid="feed-who">You</span>
            )}{' '}
            <span className="text-ink-muted">{feedVerb(item)}</span>{' '}
            {item.path ? (
              <button
                type="button"
                onClick={() => router.history.push(item.path)}
                title={item.title ? item.label : undefined}
                className="font-medium text-action hover:underline"
              >
                {item.title ?? item.label}
              </button>
            ) : (
              <span className="font-medium">{item.title ?? item.label}</span>
            )}
            {item.sub && <span className="ml-1.5 text-xs text-ink-subtle">{item.sub}</span>}
            {(item.count ?? 1) > 1 && (
              <span className="ml-1.5 text-xs text-ink-subtle" data-testid="feed-count">
                · {item.count}×
              </span>
            )}
          </span>
          <span
            className="shrink-0 rounded-full bg-subtle px-1.5 py-0.5 text-xs text-ink-muted"
            data-testid="feed-kind"
          >
            {KIND_LABEL[item.kind] ?? item.kind}
          </span>
          <span className="w-7 shrink-0 text-right text-xs tabular-nums text-ink-subtle">
            {ago(new Date(item.at).getTime())}
          </span>
        </div>
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
      className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
        on
          ? 'border-action text-action'
          : 'border-transparent text-ink-muted hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}
