import { useQuery } from '@tanstack/react-query'
import { tableHref } from 'shared'
import { Route } from 'lucide-react'
import { Bookmark, Clock, touchRowClasses } from '@featherbase/shop-floor'
import { GROUP_TONE, RailFold, RailMenuItem, SIDEBAR_HEADING, TableTile, useSidebarRail } from './SidebarRail'
import { RecentSub } from './RecentSub'
import { useSidebarWalkLabels } from './NavPathBar'
import { useGoTo } from './go-to'
import { api, getSessionUser } from '../lib/api'
import { ago, displayEntry, frequentActions, recentActions, sharedNames, uniqueByDisplay, type RecentEntry } from '../lib/recents'
import { SIDEBAR_VIEWS_KEY, useNavigationSettings } from '../lib/nav-settings'
import { pathHref } from '../lib/navigation'
import { encodePath, type NavPath } from '../lib/nav-path'
import { useNavigationHistory } from '../lib/navigation-history'
import { EntryLabel, useLiveDestinations } from '../lib/row-titles'
import { tableLabel, useMeta } from '../lib/meta'
import { setSidebarDrawerOpen } from '../lib/sidebar-collapsed'
import { walkShortLabel } from '../lib/step-labels'

// #1385 (slice 2): the platform's sidebar defaults, the same components in the
// Admin's sidebar and in every app's. Recently Opened and Frequent recall the
// person's history (the command bar starts its read; these wait for it), Saved
// Views their own and starred views. Each row opens by address (useGoTo).

/** #1253 (style A): a one-line sidebar item: its tile, its name, its detail on the right. */
const SIDEBAR_LINE = 'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm'

/** Recently opened holds at most this many items, Frequent included. */
const SIDEBAR_RECENT_CAP = 5

/** #1288: Recently Opened holds recent pages and records, and the person's remembered walks. */
type SidebarRecentItem =
  | { kind: 'entry'; entry: RecentEntry; at: number }
  | { kind: 'walk'; path: NavPath; label: string; at: number }

/** #101 Phase 2: the sidebar's zero-keystroke recall — Recently Opened, then
 *  Frequent — from the same per-user buffer the command bar reads. Destinations
 *  only (searches stay in the command bar, where they can be re-run). */
export function SidebarRecall() {
  const user = getSessionUser()
  const go = useGoTo()
  const rail = useSidebarRail()
  const historyReady = useNavigationHistory(user?.row_id)
  // #898: the command bar and the sidebar offer only rows that still exist.
  const remembered = historyReady && user ? [...recentActions(user.row_id, 20), ...frequentActions(user.row_id, 12)] : []
  const live = useLiveDestinations(remembered)
  const offered = (entries: RecentEntry[]) => entries.filter((e) => live?.has(e.key))

  const sidebarCandidates = historyReady && user
    ? uniqueByDisplay(offered(recentActions(user.row_id, 20)).filter((e) => e.kind !== 'search')).slice(0, SIDEBAR_RECENT_CAP)
    : []
  const recentSlots = sidebarCandidates.slice(0, SIDEBAR_RECENT_CAP)
  const sidebarFrequent = historyReady && user
    ? uniqueByDisplay([...recentSlots, ...offered(frequentActions(user.row_id, 12))]).slice(recentSlots.length, recentSlots.length + 2)
    : []
  const sidebarEntries = sidebarFrequent.length ? recentSlots : sidebarCandidates
  // #1288: a remembered walk is one entry among the recent pages and records, in time order, in the same slots.
  const navSettings = useNavigationSettings()
  const walkLabels = useSidebarWalkLabels(navSettings.walks.map((w) => w.path))
  const sidebarRecent: SidebarRecentItem[] = (historyReady && user
    ? [
        ...sidebarEntries.map((entry) => ({ kind: 'entry' as const, entry, at: entry.visits[entry.visits.length - 1] ?? 0 })),
        ...navSettings.walks.map((walk, i) => ({ kind: 'walk' as const, path: walk.path, label: walkLabels[i], at: walk.at })),
      ].sort((a, b) => b.at - a.at).slice(0, sidebarFrequent.length ? recentSlots.length : SIDEBAR_RECENT_CAP)
    : [])
  const openWalk = (path: NavPath) => go(pathHref(path))
  // The rail's one menu lists the recents, then Frequent.
  const railRecents: SidebarRecentItem[] = [...sidebarRecent, ...sidebarFrequent.map((entry) => ({ kind: 'entry' as const, entry, at: 0 }))]
  // Two rows of one name (a list under two filters) each say what sets them apart.
  const sharedRecentNames = sharedNames([...sidebarEntries, ...sidebarFrequent])
  const openRecent = (entry: RecentEntry) => go(entry.path)

  if (sidebarRecent.length === 0 && sidebarFrequent.length === 0) return null
  if (rail) return (
    <RailFold label="Recently Opened" icon={Clock} testid="sidebar-recents" tone="slate">
      {(close) => railRecents.map((item) => item.kind === 'walk' ? (
        <RailMenuItem key={`walk:${encodePath(item.path)}`} close={close} onSelect={() => openWalk(item.path)}>
          <span className="truncate" data-testid="sidebar-walk" title={item.label}>{walkShortLabel(item.label)}</span>
        </RailMenuItem>
      ) : (
        <RailMenuItem key={item.entry.key} close={close} onSelect={() => openRecent(item.entry)}>
          <span className="truncate"><EntryLabel entry={item.entry} /><RecentDiffers entry={item.entry} shared={sharedRecentNames} /></span>
        </RailMenuItem>
      ))}
    </RailFold>
  )
  return (
    <div className="px-2 pt-3" data-testid="sidebar-recents">
      {/* A heading, not a link: small, grey, regular weight (#1253). */}
      <h2 className={SIDEBAR_HEADING} data-testid="sidebar-recents-heading">Recently Opened</h2>
      {sidebarRecent.map((item) => item.kind === 'walk' ? (
        <SidebarWalkRow key={`walk:${encodePath(item.path)}`} label={item.label} at={item.at} href={pathHref(item.path)} onOpen={() => { setSidebarDrawerOpen(false); openWalk(item.path) }} />
      ) : (
        <SidebarRecentRow key={item.entry.key} entry={item.entry} shared={sharedRecentNames} onOpen={(e) => { setSidebarDrawerOpen(false); openRecent(e) }} />
      ))}
      {sidebarFrequent.length > 0 && (
        <h2 className="px-2 pb-0.5 pt-2 text-xs text-ink-subtle">
          Frequent
        </h2>
      )}
      {sidebarFrequent.map((r) => (
        <SidebarRecentRow key={r.key} entry={r} shared={sharedRecentNames} frequent onOpen={(e) => { setSidebarDrawerOpen(false); openRecent(e) }} />
      ))}
    </div>
  )
}

/** #1288: a remembered walk in Recently Opened: a path mark in the sidebar's muted tone, the walk by its steps'
 *  names, and when it was taken. It opens the whole walk, its path bar and every step with it. */
function SidebarWalkRow({ label, at, href, onOpen }: { label: string; at: number; href: string; onOpen: () => void }) {
  const when = at ? ago(at) : ''
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        onOpen()
      }}
      data-testid="sidebar-walk"
      title={`${label} · opens the whole walk`}
      className={touchRowClasses(`${SIDEBAR_LINE} text-ink hover:bg-border/50`)}
    >
      <span aria-hidden data-testid="walk-tile" className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-current/15 ${GROUP_TONE.slate}`}>
        <Route size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate">{walkShortLabel(label)}</span>
      {when && <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{when}</span>}
    </a>
  )
}

interface SidebarView {
  row_id: string
  table: string
  label: string
  filters: unknown
  mine: boolean
  /** #1259: the view it was saved in. */
  layout?: string
}

/** #1229: "Saved views" — the person's own views on every Table and the shared
 *  ones they starred, each opening its Table's list with the view's filters. A
 *  person with none sees no group. */
export function SidebarSavedViews() {
  const go = useGoTo()
  const onOpen = (href: string) => { setSidebarDrawerOpen(false); go(href) }
  const views = useQuery({
    queryKey: SIDEBAR_VIEWS_KEY,
    queryFn: () => api.get<{ views: SidebarView[] }>('/api/saved_views/sidebar'),
  })
  const list = views.data?.views ?? []
  const rail = useSidebarRail()
  if (list.length === 0) return null
  const hrefOf = (view: SidebarView) => `${tableHref(view.table)}?filters=${encodeURIComponent(JSON.stringify(view.filters))}${view.layout ? `&layout=${view.layout}` : ''}`
  if (rail) return (
    <RailFold label="Saved Views" icon={Bookmark} testid="sidebar-saved-views" tone="amber">
      {(close) => list.map((view) => (
        <RailMenuItem key={view.row_id} close={close} onSelect={() => onOpen(hrefOf(view))}>
          <span className="truncate">{view.label}</span>
          <span className="truncate text-xs text-ink-subtle">{view.table}{view.mine ? '' : ' · shared'}</span>
        </RailMenuItem>
      ))}
    </RailFold>
  )
  return (
    <div className="px-2 pt-3" data-testid="sidebar-saved-views">
      <h2 className={SIDEBAR_HEADING}>Saved Views</h2>
      {list.map((view) => {
        const href = hrefOf(view)
        return (
          <a
            key={view.row_id}
            href={href}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
              e.preventDefault()
              onOpen(href)
            }}
            data-testid="sidebar-saved-view"
            // #1253 (style A): one line; the table and who it is shared with live in the tooltip.
            title={`${view.table} table${view.mine ? '' : ' · Shared with you'}`}
            className={touchRowClasses(`${SIDEBAR_LINE} text-ink hover:bg-border/50`)}
          >
            <TableTile name={view.table} />
            <span className="min-w-0 flex-1 truncate">{view.label}</span>
          </a>
        )
      })}
    </div>
  )
}

/** Whether this entry shares its name with another and has something of its own to say. */
function differs(entry: RecentEntry, shared: Set<string>): boolean {
  const shown = displayEntry(entry)
  return !shown.row && Boolean(shown.sub) && shared.has(shown.label)
}

/** " · Site = Head Office" after a recent entry whose name another one shares
 *  (the rail's menu, which has no tile to name the Table). */
function RecentDiffers({ entry, shared }: { entry: RecentEntry; shared: Set<string> }) {
  if (!differs(entry, shared)) return null
  return <span className="text-ink-subtle" data-testid="recent-differs">{'\u00a0· '}<RecentSub entry={entry} /></span>
}

// #101 Phase 2: one sidebar recall row — label over sub-label, truncated to
// the rail's width, ★-marked when it comes from the Frequent ranking.
//
// It is an anchor, not a button, and that is a correctness fix rather than a
// style choice (#228). Every sidebar row is a *destination* — the searches
// that merely refill the command bar are filtered out before they get here —
// so `link` is the honest role, and it buys real href behaviour
// (middle-click, open-in-new-tab) for free. As a button it also sat in the
// same role/name space as the page's own buttons, and its name is whatever
// row the operator last visited: a chip reading "Checklist Run — checklist"
// collided with the import wizard's Check button and broke an unrelated
// journey depending only on which spec had run before it. A link cannot
// collide with a button however the trail is worded.
function SidebarRecentRow({
  entry,
  shared,
  frequent,
  onOpen,
}: {
  entry: RecentEntry
  shared: Set<string>
  frequent?: boolean
  onOpen: (entry: RecentEntry) => void
}) {
  const shown = displayEntry(entry)
  // #1253 (Siraj's style A): one line. The table's tile and the row's name; the
  // time (Recently Opened) or the count (Frequent) on the right; the table in the tooltip.
  // A row's Table comes from its key (row:<Table>/<id>); a list or a page is its own name.
  const tableName = shown.row?.table ?? (entry.key.startsWith('row:') ? entry.key.slice(4, entry.key.indexOf('/')) : shown.label)
  // #1241: a row's or a list's Table by its label (a page is its own title).
  const ofTable = Boolean(shown.row) || entry.key.startsWith('row:') || shown.kind === 'list'
  const table = tableLabel(tableName, useMeta(tableName, ofTable).data)
  // A filtered list says its filter in the tooltip (the second line it had before).
  const what = !shown.row && shown.sub ? `${table} · ${shown.sub}` : table
  const last = entry.visits[entry.visits.length - 1] ?? 0
  const when = ago(last)
  const meta = frequent ? `${entry.visits.length}×` : when
  const title = frequent
    ? `${what} · opened ${entry.visits.length} times`
    : `${what} · opened ${when === 'now' ? 'just now' : `${when} ago`}`
  return (
    <a
      href={entry.path}
      onClick={(e) => {
        // Let the browser handle the modified clicks it handles better.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        onOpen(entry)
      }}
      data-testid={frequent ? 'sidebar-frequent' : 'sidebar-recent'}
      title={title}
      className={touchRowClasses(`${SIDEBAR_LINE} text-ink hover:bg-border/50`)}
    >
      <TableTile name={table} />
      {/* A row whose name another shares reads as what sets it apart (one-app-chrome, 17-Nov):
          the tile names the Table, the tooltip says it all. */}
      <span className="min-w-0 flex-1 truncate">
        {differs(entry, shared)
          ? <span data-testid="recent-differs"><RecentSub entry={entry} /></span>
          : <EntryLabel entry={entry} />}
      </span>
      {frequent && <span aria-hidden className={`text-xs ${GROUP_TONE.amber}`}>★</span>}
      <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{meta}</span>
    </a>
  )
}

