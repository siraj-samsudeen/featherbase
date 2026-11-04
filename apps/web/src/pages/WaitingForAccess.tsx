import type { QueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { adminPageTitle, WAITING_FOR_ACCESS_FILTERS } from 'shared'
import { ListView, type Filter } from '../components/ListView'

// #429, #835: people a sign-in rule let in who hold no role yet, and see only
// the no-access page. The page is the standard Person list behind one filter,
// so it sorts, filters, searches, picks columns and opens rows like any list;
// opening one goes to their Person form to give roles. The menu badge counts
// the same cohort on the server.

export const WAITING_COUNT_QUERY_KEY = ['waiting-for-access-count'] as const

/** Saving or deleting a person or a role assignment can change who is
 *  waiting, so the Person list and the menu count are asked again. */
export async function refreshWaitingAfterSave(queryClient: QueryClient, table: string): Promise<void> {
  if (table !== 'Person' && table !== 'Has Role') return
  await queryClient.invalidateQueries({ queryKey: ['list', 'Person'] })
  await queryClient.invalidateQueries({ queryKey: WAITING_COUNT_QUERY_KEY })
}

export function WaitingForAccess({ filters, onFiltersChange }: { filters: Filter[]; onFiltersChange: (next: Filter[]) => void }) {
  return (
    <div data-testid="waiting-for-access">
      <ListView
        table="Person"
        filters={filters}
        onFiltersChange={onFiltersChange}
        baseFilters={WAITING_FOR_ACCESS_FILTERS}
        defaultOrderBy="created_at desc"
        title={adminPageTitle('waiting-for-access')}
        breadcrumb={
          <div className="text-xs text-ink-subtle">
            <Link to="/featherbase/admin" className="hover:text-ink">Home</Link>
            {' / People and access'}
          </div>
        }
        subtitle="People who signed in but hold no role yet, newest first. Open one to give them roles."
        empty={<span data-testid="waiting-empty">Nobody is waiting. Someone who signs in without a role shows up here.</span>}
      />
    </div>
  )
}
