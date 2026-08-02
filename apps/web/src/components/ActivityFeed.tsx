import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { api } from '../lib/api'
import { ago } from '../lib/recents'
import { useRealtime } from '../lib/realtime'
import { useIsSystemManager } from '../lib/session'

interface FeedItem {
  who: string
  kind: string
  label: string
  sub?: string
  path: string
  at: string
}

// #101 Phase 4: the homepage activity feed. Two tabs with a deliberate
// asymmetry: "Mine" is this user's full trail (views and searches included —
// visible to them alone); "Team" shows changes and logins only, never what a
// colleague merely viewed, and only exists for System Managers. Data always
// comes from the role-gated endpoint; the websocket 'feed' channel is just
// an invalidation ping.

const KIND_STYLE: Record<string, string> = {
  row: 'bg-[var(--color-subtle)] text-[var(--color-ink-muted)]',
  list: 'bg-[var(--color-brand-tint)] text-[var(--color-brand)]',
  page: 'bg-[var(--color-subtle)] text-[var(--color-ink-muted)]',
  search: 'bg-[var(--color-brand-tint)] text-[var(--color-brand)]',
  change: 'bg-[var(--color-warn-tint)] text-[var(--color-warn)]',
  login: 'bg-[var(--color-good-tint)] text-[var(--color-good)]',
}
const KIND_LABEL: Record<string, string> = {
  row: 'row',
  list: 'view',
  page: 'page',
  search: 'search',
  change: 'change',
  login: 'login',
}
const KIND_VERB: Record<string, string> = {
  row: 'opened',
  list: 'filtered',
  page: 'opened',
  search: 'searched',
  change: 'changed',
  login: '',
}

function initials(who: string): string {
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
  useRealtime(['feed'], () => {
    void queryClient.invalidateQueries({ queryKey: ['activity-feed'] })
  })

  const items = feed.data?.items ?? []

  return (
    <div className="fc-card overflow-hidden" data-testid="activity-feed">
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 pt-1.5">
        <FeedTab label="My activity" on={scope === 'mine'} onClick={() => setScope('mine')} testid="feed-tab-mine" />
        {isSystemManager && (
          <FeedTab label="Team" on={scope === 'team'} onClick={() => setScope('team')} testid="feed-tab-team" />
        )}
      </div>
      {items.length === 0 && (
        <p className="px-4 py-3 text-sm text-[var(--color-ink-faint)]" data-testid="feed-empty">
          {feed.isLoading ? 'Loading…' : 'Nothing here yet — activity shows up as you work.'}
        </p>
      )}
      {items.map((item, i) => (
        <div
          key={`${item.at}-${i}`}
          className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-3 py-1.5 text-sm last:border-b-0"
          data-testid="feed-item"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-tint)] text-[10px] font-bold text-[var(--color-brand)]">
            {initials(item.who)}
          </span>
          <span
            className={`w-14 shrink-0 rounded-full px-0 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide ${KIND_STYLE[item.kind] ?? KIND_STYLE.row}`}
          >
            {KIND_LABEL[item.kind] ?? item.kind}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {scope === 'team' && <span className="font-medium">{item.who}</span>}{' '}
            <span className="text-[var(--color-ink-muted)]">{KIND_VERB[item.kind] ?? ''}</span>{' '}
            {item.path ? (
              <button
                type="button"
                onClick={() => router.history.push(item.path)}
                className="font-medium text-[var(--color-brand)] hover:underline"
              >
                {item.label}
              </button>
            ) : (
              <span className="font-medium">{item.label}</span>
            )}
            {item.sub && <span className="ml-1.5 text-xs text-[var(--color-ink-faint)]">{item.sub}</span>}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-faint)]">
            {ago(new Date(item.at).getTime())}
          </span>
        </div>
      ))}
      <div className="bg-[var(--color-subtle)] px-3 py-1.5 text-[11px] text-[var(--color-ink-muted)]">
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
      className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
        on
          ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
          : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      {label}
    </button>
  )
}
