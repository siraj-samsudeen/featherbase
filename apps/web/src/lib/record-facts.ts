import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { recordFactsSchema, type RecordFacts, type RecordFactsAnswer } from 'shared'
import { api } from './api'

// #1340: an installed app's facts about rows of its Table, as the server checked and scrubbed them: the list's extra
// columns and Record actions, a record page's header line and Links groups. None (null) when no app describes the
// Table, the viewer is not one the app describes to, or its answer was not the one shape: the page draws as it did.

export type Described = (RecordFactsAnswer & { facts: RecordFacts }) | null

export const recordFactsKey = (table: string, rows: string[], page: boolean) => ['record-facts', table, page, rows] as const

async function describe(table: string, rows: string[], page: boolean): Promise<Described> {
  const answer = await api.post<RecordFactsAnswer | { facts: null }>(`/api/records/${encodeURIComponent(table)}/describe`, { rows, page })
  // Checked here too, against the same shape: nothing the server did not pass is ever half drawn.
  if (!answer.facts || !('app' in answer)) return null
  const facts = recordFactsSchema.safeParse(answer.facts)
  return facts.success ? { ...answer, facts: facts.data } : null
}

/** The reads a save on the generic pages refreshes: a record, a link group, the links of a record, a list. */
const SAVES_REFRESH = new Set(['doc', 'group-rows', 'connections', 'list'])

/**
 * Codex round 2: the app's facts are worked out from rows the generic pages change (a permission edited, a report
 * ticked, rows on linked Tables), and their keys hold only row ids. When one of those reads is read again after a
 * save, the facts are read again too. A first load is not a save, so it asks nothing more.
 */
function useFactsFollowSaves() {
  const queryClient = useQueryClient()
  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || event.query.state.dataUpdateCount < 2) return
    const key = event.query.queryKey[0]
    if (typeof key === 'string' && SAVES_REFRESH.has(key)) void queryClient.invalidateQueries({ queryKey: ['record-facts'] })
  }), [queryClient])
}

/** The facts about the rows a list shows (columns and actions), asked once per page of rows. */
export function useListFacts(table: string, rows: string[], enabled = true) {
  useFactsFollowSaves()
  return useQuery({
    queryKey: recordFactsKey(table, rows, false),
    queryFn: () => describe(table, rows, false),
    enabled,
    retry: false,
    staleTime: 30_000,
  })
}

/** The facts about one record: its header line and Links groups. */
export function useRecordFacts(table: string, row: string, enabled = true) {
  useFactsFollowSaves()
  return useQuery({
    queryKey: recordFactsKey(table, [row], true),
    queryFn: () => describe(table, [row], true),
    enabled,
    retry: false,
    staleTime: 30_000,
  })
}

/** Runs one of the app's actions from a Record actions menu or a preview page, with a fresh key per press. The
 *  platform client pins the installed app versions itself; a refusal is the app's own words. */
export async function runAppAction(app: string, action: string): Promise<unknown> {
  const answer = await api.post<{ result?: unknown }>(`/api/app_actions/${encodeURIComponent(app)}/${encodeURIComponent(action)}`,
    { idempotencyKey: crypto.randomUUID(), payload: {} })
  return answer.result
}
