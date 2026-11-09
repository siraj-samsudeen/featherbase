import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
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

export const WAITING_COUNT_QUERY_KEY = ['waiting-for-access-count'] as const

/** Saving or deleting a person or a role assignment can change who is
 *  waiting, so the Person list and the menu count are asked again. */
export async function refreshWaitingAfterSave(queryClient: QueryClient, table: string): Promise<void> {
  if (table !== 'Person' && table !== 'Has Role') return
  await queryClient.invalidateQueries({ queryKey: ['list', 'Access Request'] })
  await queryClient.invalidateQueries({ queryKey: WAITING_COUNT_QUERY_KEY })
}

export function WaitingForAccess({ filters, onFiltersChange }: { filters: Filter[]; onFiltersChange: (next: Filter[]) => void }) {
  const queryClient = useQueryClient()
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
  return (
    <div data-testid="waiting-for-access">
      <ListView
        table="Access Request"
        filters={filters}
        onFiltersChange={onFiltersChange}
        defaultOrderBy="created_at desc"
        title={adminPageTitle('waiting-for-access')}
        breadcrumb={
          <div className="text-xs text-ink-subtle">
            <Link to="/featherbase/admin" className="hover:text-ink">Home</Link>
            {' / People and access'}
          </div>
        }
        subtitle="Each row is someone who opened an app without access to it, newest first. Once they can open that app, from a role on their Person page, the row goes."
        empty={<span data-testid="waiting-empty">Nobody is waiting. Someone who opens an app they have no access to shows up here.</span>}
      />
    </div>
  )
}
