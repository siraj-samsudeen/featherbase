// #772: a MotherDuck source connected by a pasted token — the calls the
// connect page, the source page and the browser make, and where each person
// last browsed (a per-user localStorage entry, like recents).
import { api, getSessionUser } from './api'

const SOURCES = '/api/table/Data%20Source'
const enc = encodeURIComponent

export interface TokenReport { user: string; can_write: boolean; databases: { name: string; owner: string }[] }
export interface TableListing { listed_at: string; schemas: { schema: string; tables: { name: string; rows: number; columns: number }[] }[] }
export interface TablePreview { rows: number; columns: { name: string; type: string }[]; first_rows: Record<string, unknown>[] }
export interface WarehouseSource { row_id: string; engine: string; token_last_four: string | null; databases: { name: string; owner: string }[] | null }

export const testToken = (token: string) => api.post<TokenReport>(`${SOURCES}:motherduck_test`, { token })
export const connectWarehouse = (name: string, token: string, databases: string[]) =>
  api.post<{ name: string }>(`${SOURCES}:motherduck_connect`, { name, token, databases })
export const replaceToken = (name: string, token: string) =>
  api.post<{ token_last_four: string; can_write: boolean }>(`${SOURCES}/${enc(name)}:replace_token`, { token })
export const listTables = (name: string, database: string) =>
  api.get<TableListing>(`${SOURCES}/${enc(name)}:tables?database=${enc(database)}`)
export const refreshTables = (name: string, database: string) =>
  api.post<TableListing>(`${SOURCES}/${enc(name)}:refresh_tables`, { database })
export const previewTable = (name: string, database: string, schema: string, table: string) =>
  api.get<TablePreview>(`${SOURCES}/${enc(name)}:preview?database=${enc(database)}&schema=${enc(schema)}&table=${enc(table)}`)

export interface BrowsePlace { database?: string; schema?: string }
const placeKey = (source: string) => `fb-warehouse-place:${getSessionUser()?.row_id ?? ''}:${source}`

export interface BrowseContext extends BrowsePlace {
  table?: string
  tableSchema?: string
  tab?: string
  query?: string
  columnQuery?: string
  databaseQuery?: string
  schemaQuery?: string
}

export function browserHref(source: string, context: BrowseContext): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(context)) {
    if (value) search.set(key, value)
  }
  return `/featherbase/admin/source/${enc(source)}?${search}`
}

// Only copy setup drafts, never credentials. Scoped to this tab and signed-in person.
const draftKey = (identity: string) => `fb-warehouse-copy:${getSessionUser()?.row_id ?? ''}:${identity}`
export function readCopyDraft<T>(identity: string): T | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(draftKey(identity)) ?? 'null') ?? undefined
  } catch {
    return undefined
  }
}

export function writeCopyDraft(identity: string, draft: unknown): void {
  try {
    sessionStorage.setItem(draftKey(identity), JSON.stringify(draft))
  } catch {
    // The current form still works when storage is blocked or full.
  }
}

export function clearCopyDraft(identity: string): void {
  try {
    sessionStorage.removeItem(draftKey(identity))
  } catch {
    // Best effort, like saving a draft.
  }
}

export function lastPlace(source: string): BrowsePlace {
  try {
    const raw = localStorage.getItem(placeKey(source))
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as BrowsePlace) : {}
  } catch {
    return {}
  }
}

export function rememberPlace(source: string, place: BrowsePlace): void {
  try {
    localStorage.setItem(placeKey(source), JSON.stringify(place))
  } catch {
    // Best effort, like recents: a blocked store only loses the convenience.
  }
}
