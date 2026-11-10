import { useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Notice, Segmented, SplitWithPane } from '@featherbase/shop-floor'
import { AccessRequestDrawer } from '../components/AccessRequestDrawer'
import { api } from '../lib/api'
import { Link } from '@tanstack/react-router'
import { adminPageTitle } from 'shared'
import { ListView } from '../components/ListView'
import type { Filter } from '../components/ListFilters'

// #429, #835, #955: who is waiting for access, per app. Someone who opens an
// app (or Featherbase itself) without access asks for it, and each request is
// an Access Request row; the page is that Table's standard list, so it sorts,
// filters by App, searches and picks columns like any list. The server drops
// a request once its person can open that app, before it counts the menu
// badge; the page asks for that count first so it never lists one that went.
// #1173: a click on a line opens the request in a drawer beside the list, to
// approve, decline or dismiss it; declined requests have a view of their own.

export type WaitingView = 'waiting' | 'declined'
const NOT_DECLINED: Filter[] = [['declined_at', '=', null]]
const DECLINED: Filter[] = [['declined_at', '!=', null]]
const DECLINED_COLUMNS = ['declined_at', 'declined_by', 'declined_reason']

export const WAITING_COUNT_QUERY_KEY = ['waiting-for-access-count'] as const

/** Saving or deleting a person or a role assignment can change who is
 *  waiting, so the Person list and the menu count are asked again. */
export async function refreshWaitingAfterSave(queryClient: QueryClient, table: string): Promise<void> {
  if (table !== 'Person' && table !== 'Has Role') return
  await queryClient.invalidateQueries({ queryKey: ['list', 'Access Request'] })
  await queryClient.invalidateQueries({ queryKey: WAITING_COUNT_QUERY_KEY })
}

export function WaitingForAccess({ filters, onFiltersChange, view = 'waiting', onViewChange }: {
  filters: Filter[]
  onFiltersChange: (next: Filter[]) => void
  view?: WaitingView
  onViewChange?: (next: WaitingView) => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // The count settles the requests whose person got access since; until it
  // answers, no list (a cached one could still hold them).
  const settled = useQuery({
    queryKey: ['waiting-for-access-settled'],
    gcTime: 0,
    queryFn: async () => {
      const answer = await api.get<{ count: number }>('/api/people/waiting_for_access/count')
      queryClient.setQueryData(WAITING_COUNT_QUERY_KEY, answer)
      queryClient.removeQueries({ queryKey: ['list', 'Access Request'] })
      return answer
    },
  })
  if (settled.isPending) return <div data-testid="waiting-for-access" />
  const declined = view === 'declined'
  return (
    <div data-testid="waiting-for-access" className="h-full">
      <SplitWithPane place="right" pane={open ? (
        <AccessRequestDrawer key={open} id={open} onClose={() => setOpen(null)}
          onDone={(message) => { setOpen(null); setDone(message) }} />
      ) : null}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label="Which requests" value={view} onChange={(next) => { setOpen(null); setDone(null); onViewChange?.(next) }}
              options={[{ value: 'waiting', label: 'Waiting' }, { value: 'declined', label: 'Declined' }]} />
            {done && <Notice tone="positive"><span data-testid="waiting-done">{done}</span></Notice>}
          </div>
          <ListView
            table="Access Request"
            filters={filters}
            onFiltersChange={onFiltersChange}
            baseFilters={declined ? DECLINED : NOT_DECLINED}
            onRowOpen={(row) => { setDone(null); setOpen(row) }}
            openRow={open ?? undefined}
            extraColumns={declined ? DECLINED_COLUMNS : undefined}
            defaultOrderBy={declined ? 'declined_at desc' : 'created_at desc'}
            title={adminPageTitle('waiting-for-access')}
            breadcrumb={
              <div className="text-xs text-ink-subtle">
                <Link to="/featherbase/admin" className="hover:text-ink">Home</Link>
                {' / People and access'}
              </div>
            }
            subtitle={declined
              ? 'Requests a System Manager declined, newest first. A request goes once its person can open that app.'
              : 'Each row is someone who opened an app without access to it, newest first. Click a row to approve, decline or dismiss it. Once they can open that app, the row goes.'}
            empty={declined
              ? <span data-testid="declined-empty">Nothing declined.</span>
              : <span data-testid="waiting-empty">Nobody is waiting. Someone who opens an app they have no access to shows up here.</span>}
          />
        </div>
      </SplitWithPane>
    </div>
  )
}
