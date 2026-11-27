import { keepPreviousData, useQueries, useQueryClient } from '@tanstack/react-query'
import type { PageSource, PageStateValue, PageTableSource } from 'shared'
import { ApiError, listResource } from '../lib/api'
import { sourceRequest } from './sources'
import type { SourceState } from './runtime'

// #1410: reading a page's data sources. A Table source goes through the normal
// list API as the signed-in person, so they see only the rows they may read;
// a sample source is the rows as written in the page.

/** Why something could not be done, in the server's own words when it gave any. */
export function problemWords(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The server didn’t answer. Try again in a moment.'
}

const isTable = (source: PageSource): source is PageTableSource => 'table' in source

/** How far each of the page's sources has come, and a way to read them all again. */
export function useSources(page: string, data: Record<string, PageSource>, state: Record<string, PageStateValue>, reads: Record<string, string[]>) {
  const queryClient = useQueryClient()
  const tables = Object.entries(data).filter((entry): entry is [string, PageTableSource] => isTable(entry[1]))
  const read = useQueries({
    queries: tables.map(([name, source]) => {
      const { table, ...params } = sourceRequest(source, state, reads[name])
      return {
        queryKey: ['page-source', page, name, table, params],
        queryFn: () => listResource(table, params),
        // While a filter on the page's state changes, the rows read before stay up.
        placeholderData: keepPreviousData,
      }
    }),
  })
  const sources: Record<string, SourceState> = {}
  for (const [name, source] of Object.entries(data)) if (!isTable(source)) sources[name] = { status: 'ready', rows: source.sample, total: source.sample.length }
  tables.forEach(([name], i) => {
    const query = read[i]!
    sources[name] = query.data ? { status: 'ready', rows: query.data.data, total: query.data.total }
      : query.isError ? { status: 'failed', message: problemWords(query.error) }
      : { status: 'loading' }
  })
  return { sources, refresh: () => queryClient.invalidateQueries({ queryKey: ['page-source', page] }) }
}
