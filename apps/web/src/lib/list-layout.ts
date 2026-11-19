import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LIST_LAYOUTS, type ListLayout } from 'shared'
import { useMediaQuery } from '@featherbase/shop-floor'
import { api, getToken } from './api'
import { useMeta } from './meta'
import { tableViewDefaultQuery } from './table-view-default'
import { SIDEBAR_DRAWER_QUERY } from './sidebar-collapsed'

// #1259: which of the three views a Table's list shows. In order: a phone
// always reads a Table; then a view the address asks for (a saved view opened
// from the sidebar); then the person's own choice for the Table, kept with
// their other list settings; then the Table's default: a queue opens on cards
// (List And Record), every other Table on Table With Panel.

export function isListLayout(value: unknown): value is ListLayout {
  return typeof value === 'string' && (LIST_LAYOUTS as readonly string[]).includes(value)
}

const layoutKey = (table: string) => ['list-layout', table]
/** Each Table's layout saves, in the order the person chose (Codex review):
 *  a slower earlier save never lands over a later choice. */
const saves = new Map<string, Promise<unknown>>()
/** How many choices each Table has had here: a read waits for the saves
 *  already queued, and one made while it is on its way wins over its answer. */
const choices = new Map<string, number>()
/** The keys above: one per sign-in per Table (remembered-filters.ts does the same). */
const savesKey = (table: string) => `${getToken() ?? ''}\u0000${table}`

/** #1282 A4: resolves once every layout save already queued for this Table has landed, so a reset after it is final. */
export function layoutSavesSettled(table: string): Promise<unknown> {
  // Each save already catches its own failure (choose), so this never rejects.
  return saves.get(savesKey(table)) ?? Promise.resolve()
}

export function useListLayout(table: string, asked?: ListLayout) {
  const queryClient = useQueryClient()
  const meta = useMeta(table)
  const phone = useMediaQuery(SIDEBAR_DRAWER_QUERY)
  const stored = useQuery({
    queryKey: layoutKey(table),
    queryFn: async () => {
      const key = savesKey(table)
      const before = choices.get(key)
      // The server is read only once every save queued so far has landed.
      let landed: Promise<unknown> | undefined
      while (saves.get(key) !== landed) { landed = saves.get(key); await landed }
      const res = await api.get<{ settings: { layout?: unknown } | null }>(`/api/user_settings/${encodeURIComponent(table)}`)
      if (choices.get(key) !== before) return queryClient.getQueryData<ListLayout>(layoutKey(table)) ?? null
      return isListLayout(res.settings?.layout) ? res.settings.layout : null
    },
  })
  // #1282 A4: the Table's default comes after the person's own choice and before the built-in.
  const tableDefault = useQuery(tableViewDefaultQuery(table))
  const layout: ListLayout = phone ? 'table' : asked ?? stored.data ?? tableDefault.data?.settings.layout ?? (meta.data?.queue ? 'split' : 'panel')
  /** The person chooses: remembered for them on this Table (the server merges it
   *  beside their sort and columns, never over them). */
  const choose = (next: ListLayout) => {
    const key = savesKey(table)
    choices.set(key, (choices.get(key) ?? 0) + 1)
    queryClient.setQueryData(layoutKey(table), next)
    // A queued choice belongs to the sign-in that made it; api.put sends the
    // token of the moment, so it is dropped if that sign-in has ended.
    const token = getToken()
    const saved = (saves.get(key) ?? Promise.resolve())
      .then(() => getToken() === token ? api.put(`/api/user_settings/${encodeURIComponent(table)}`, { layout: next }) : undefined)
      .catch(() => {})
    saves.set(key, saved)
  }
  return { layout, choose, phone, ready: !stored.isPending && Boolean(meta.data) }
}
