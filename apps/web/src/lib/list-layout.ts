import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LIST_LAYOUTS, type ListLayout } from 'shared'
import { useMediaQuery } from '@featherbase/shop-floor'
import { api } from './api'
import { useMeta } from './meta'
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

export function useListLayout(table: string, asked?: ListLayout) {
  const queryClient = useQueryClient()
  const meta = useMeta(table)
  const phone = useMediaQuery(SIDEBAR_DRAWER_QUERY)
  const stored = useQuery({
    queryKey: layoutKey(table),
    queryFn: async () => {
      const res = await api.get<{ settings: { layout?: unknown } | null }>(`/api/user_settings/${encodeURIComponent(table)}`)
      return isListLayout(res.settings?.layout) ? res.settings.layout : null
    },
  })
  const layout: ListLayout = phone ? 'table' : asked ?? stored.data ?? (meta.data?.queue ? 'split' : 'panel')
  /** The person chooses: remembered for them on this Table (the server merges it
   *  beside their sort and columns, never over them). */
  const choose = (next: ListLayout) => {
    queryClient.setQueryData(layoutKey(table), next)
    void api.put(`/api/user_settings/${encodeURIComponent(table)}`, { layout: next }).catch(() => {})
  }
  return { layout, choose, phone, ready: !stored.isPending && Boolean(meta.data) }
}
