import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { tableHref, type ListFilter } from 'shared'
import { api } from '../lib/api'
import { useMeta } from '../lib/meta'
import { useNavigation } from '../lib/navigation'
import { push, type LinksLayout, type NavPane, type NavStep } from '../lib/nav-path'
import { useBacklinkGroups, type BacklinkGroup } from '../lib/relations'
import { useConnections } from '../lib/connections'
import { LinkedRowsGroup } from './LinkedRowsGroup'
import { PaneFields } from './RowPane'
import { RowTree } from './RowTree'
import { MenuChoices, MenuShell } from './FormArrangement'

type Row = Record<string, unknown>

interface StoredLinks { as?: LinksLayout; fields?: boolean }

/** #1273 (A3, A4): how this person reads one Table's Links tab, remembered in
 *  their settings beside the form's arrangement: as sections or as the tree,
 *  and with the fields beside them or not. A walk's own choice comes first. */
export function useLinksPreference(table: string, fromPath?: LinksLayout) {
  const queryClient = useQueryClient()
  const key = ['user-settings', table]
  const stored = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ settings: { links?: StoredLinks } | null }>(`/api/user_settings/${encodeURIComponent(table)}`),
    retry: false,
    staleTime: Infinity,
  })
  const [chosen, setChosen] = useState<StoredLinks>({})
  const saved = stored.data?.settings?.links ?? {}
  const as: LinksLayout = fromPath ?? chosen.as ?? (saved.as === 'tree' ? 'tree' : 'sections')
  const fields = chosen.fields ?? saved.fields ?? true
  const update = (next: StoredLinks) => {
    const links = { as, fields, ...next }
    setChosen(links)
    queryClient.setQueryData(key, { settings: { ...(stored.data?.settings ?? {}), links } })
    // A save merges into the person's record; a failed one keeps the choice for this visit.
    api.put(`/api/user_settings/${encodeURIComponent(table)}`, { links }).catch(() => {})
  }
  return { ready: !stored.isPending, as, fields, setAs: (v: LinksLayout) => update({ as: v }), setFields: (v: boolean) => update({ fields: v }) }
}

export type LinksPreference = ReturnType<typeof useLinksPreference>

/** #1273 A3: the Links tab's View ▾: as sections or the tree, fields beside or not. */
export function LinksViewMenu({ pref, onAs }: { pref: LinksPreference; onAs: (v: LinksLayout) => void }) {
  return (
    <MenuShell>
      {(close) => <>
        <MenuChoices label="Show Links As" value={pref.as} close={close} onChange={onAs}
          options={[['sections', 'Sections'], ['tree', 'Tree']] as const} />
        {pref.as === 'sections' && (
          <MenuChoices label="Fields Beside Links" value={pref.fields ? 'show' : 'hide'} close={close}
            onChange={(v) => pref.setFields(v === 'show')} options={[['show', 'Show'], ['hide', 'Hide']] as const} />
        )}
      </>}
    </MenuShell>
  )
}

/** The id a group's section answers to, so a chip under the title can jump to it (D3). */
export const linksSectionId = (group: Pick<BacklinkGroup, 'key'>) => `links-${group.key.replace(/[^A-Za-z0-9_-]/g, '_')}`

/**
 * #1273 D2: the record page's Links tab. As sections (the default): the record's
 * fields beside one section per group that points at it, each the tick list
 * where the viewer may change it (C5–C9), else its rows by what they point to,
 * the first 10 then Show all, an empty one greyed with + New, and Open as grid
 * where both sides are small. As the tree: the Tree's unfolding.
 */
export function RecordLinks({ table, name, values, pref, focusGroup, onFocused }: {
  table: string
  name: string
  values: Row | undefined
  pref: LinksPreference
  /** The group whose chip was chosen: its section scrolls into view and takes focus. */
  focusGroup?: string | null
  onFocused?: () => void
}) {
  const nav = useNavigation()
  const meta = useMeta(table)
  const cnx = useConnections(table, name, Boolean(values))
  const groups = useBacklinkGroups(cnx.data?.connections)
  useEffect(() => {
    if (!focusGroup || !groups.length) return
    const el = document.getElementById(linksSectionId({ key: focusGroup }))
    if (!el) return
    el.scrollIntoView?.({ block: 'start' })
    el.focus({ preventScroll: true })
    onFocused?.()
  }, [focusGroup, groups.length, onFocused])
  if (pref.as === 'tree') return <RowTree table={table} name={name} />
  const open = (pane: NavPane) => nav?.push({ ...nav.step, pane })
  const listHref = (g: BacklinkGroup) => {
    const listStep: NavStep = { screen: 'list', table: g.connection.table, filters: g.connection.filters as ListFilter[] }
    return nav?.addressed ? nav.href(push(nav.path, listStep)) : `${tableHref(g.connection.table)}?filters=${encodeURIComponent(JSON.stringify(g.connection.filters))}`
  }
  return (
    <div className="@container" data-testid="record-links">
      <div className={pref.fields ? 'grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]' : 'grid gap-6'}>
        {pref.fields && (meta.data && values ? <div data-testid="links-fields"><PaneFields meta={meta.data} row={values} onOpen={open} /></div> : <span />)}
        <div className="flex min-w-0 flex-col gap-6">
          {groups.map((g) => (
            <div key={g.key} id={linksSectionId(g)} tabIndex={-1} className="scroll-mt-4 rounded-lg focus:outline-none focus-visible:outline-2 focus-visible:outline-focus">
              <LinkedRowsGroup table={table} record={name} group={g} onOpen={open} showAllHref={listHref(g)} editable />
            </div>
          ))}
          {cnx.isPending && <p className="text-sm text-ink-subtle">Loading…</p>}
          {cnx.data && !groups.length && <p className="text-sm text-ink-muted">No rows point at it</p>}
        </div>
      </div>
    </div>
  )
}
