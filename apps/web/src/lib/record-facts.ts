import { useQuery } from '@tanstack/react-query'
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

/** The facts about the rows a list shows (columns and actions), asked once per page of rows. */
export function useListFacts(table: string, rows: string[], enabled = true) {
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
