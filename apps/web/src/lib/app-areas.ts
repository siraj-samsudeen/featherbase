import { useQuery } from '@tanstack/react-query'
import type { AreaAxis, AreaRow } from '@featherbase/shop-floor'
import { api, listResource } from './api'
import { useWhoAmI } from './session'

// #1282 G1–G6: the areas the installed apps declare (Location, Merchandise …), as the
// Admin's area picker shows them: an admin screen's words (a Site is "Site", G6).
// Each column is the platform's own list read, as the viewer may see it, and each
// count is how many rows of the next level they may see under a row.

interface DeclaredLevel {
  table: string
  title: string
  parent?: string
  label: string
  plural: string
  adminLabel?: string
  adminPlural?: string
  filters?: [string, '=', string | number | boolean][]
}

interface DeclaredArea {
  name: string
  whole: string
  levels: DeclaredLevel[]
}

/** The most rows one column lists. */
const COLUMN_ROWS = 500

/** The declared areas, for an admin screen, and how to read each of their levels. */
export function useAppAreas(): { axes: AreaAxis[]; levels: Map<string, DeclaredLevel> } {
  const whoami = useWhoAmI().data
  const catalog = useQuery({
    queryKey: ['app-catalog'],
    queryFn: () => api.get<{ areas?: DeclaredArea[] }[]>('/api/app_catalog'),
    enabled: Boolean(whoami),
  })
  const declared = (catalog.data ?? []).flatMap((app) => app.areas ?? [])
  return {
    axes: declared.map((area) => ({
      name: area.name,
      whole: area.whole,
      levels: area.levels.map((l) => ({ table: l.table, label: l.adminLabel ?? l.label, plural: l.adminPlural ?? l.plural })),
    })),
    levels: new Map(declared.flatMap((area) => area.levels.map((l) => [l.table, l] as const))),
  }
}

const narrowed = (level: DeclaredLevel, parent: string | null) => [...(level.filters ?? []), ...(parent && level.parent ? [[level.parent, '=', parent]] : [])]

/** A column of the area picker: the level's rows under the row picked before it, each counting the next level's under it. */
export function areaLoader(levels: Map<string, DeclaredLevel>) {
  return async (axis: AreaAxis, level: number, parent: AreaRow | null): Promise<AreaRow[]> => {
    const here = levels.get(axis.levels[level]!.table)!
    const { data } = await listResource(here.table, {
      filters: narrowed(here, parent?.id ?? null), fields: ['row_id', here.title], order_by: `${here.title} asc`, limit_page_length: COLUMN_ROWS,
    })
    const next = axis.levels[level + 1] ? levels.get(axis.levels[level + 1]!.table)! : undefined
    return Promise.all((data as Record<string, unknown>[]).map(async (row) => {
      const id = String(row.row_id)
      const name = String(row[here.title] ?? '').trim() || id
      if (!next) return { id, name }
      // A count the viewer may not read is left off, and its row stays to pick (Codex standard round 2).
      const total = await listResource(next.table, { filters: narrowed(next, id), fields: ['row_id'], limit_page_length: 1 }).then((r) => r.total, () => undefined)
      return total === undefined ? { id, name } : { id, name, count: total }
    }))
  }
}
