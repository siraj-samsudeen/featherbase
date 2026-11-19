import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { tableHref, type ListFilter } from 'shared'
import { GroupChip } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { useMeta } from '../lib/meta'
import { useNavigation } from '../lib/navigation'
import { push, type LinksLayout, type NavPane, type NavStep } from '../lib/nav-path'
import { useBacklinkGroups, type BacklinkGroup } from '../lib/relations'
import { useConnections } from '../lib/connections'
import { LinkedRowsGroup } from './LinkedRowsGroup'
import type { RecordGroup } from 'shared'
import { AppLinkGroup, appGroupFor, appGroupKey, inAppOrder } from './AppLinkGroup'
import { useGroupPlans } from './LinkTickList'
import { PaneFields } from './RowPane'
import { RowTree } from './RowTree'
import { MenuChoices, MenuShell, userSettingsQuery } from './FormArrangement'

type Row = Record<string, unknown>

interface StoredLinks { as?: LinksLayout; fields?: boolean }

/** #1273 (A3, A4): how this person reads one Table's Links tab, remembered in
 *  their settings beside the form's arrangement: as sections or as the tree,
 *  and with the fields beside them or not. A walk's own choice comes first. */
export function useLinksPreference(table: string, fromPath?: LinksLayout) {
  const queryClient = useQueryClient()
  const { queryKey: key } = userSettingsQuery(table)
  const stored = useQuery(userSettingsQuery(table))
  const [chosen, setChosen] = useState<StoredLinks>({})
  const saved = (stored.data?.settings?.links ?? {}) as StoredLinks
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
export function RecordLinks({ table, name, values, pref, focusGroup, onFocused, appGroups }: {
  table: string
  name: string
  values: Row | undefined
  pref: LinksPreference
  /** The group whose chip was chosen: its section scrolls into view and takes focus. */
  focusGroup?: string | null
  onFocused?: () => void
  /** #1340: the groups the app describing the record gives: its own, and what it says of the link groups. */
  appGroups?: RecordGroup[]
}) {
  const nav = useNavigation()
  const meta = useMeta(table)
  const cnx = useConnections(table, name, Boolean(values))
  const all = useBacklinkGroups(cnx.data?.connections)
  // Tick lists first, then groups with rows, then the empty ones, greyed.
  const plans = useGroupPlans(table, name, all)
  // An app's order wins (#1340): the groups it names first, as it orders them; a group it names is never greyed away.
  const named = (g: BacklinkGroup) => Boolean(appGroupFor(appGroups, g.connection.table))
  const rank = (g: BacklinkGroup) => (named(g) ? 0 : plans.get(g.key)?.tick ? 1 : g.count ? 2 : 3)
  const groups = inAppOrder([...all].sort((a, b) => rank(a) - rank(b)), appGroups)
  const own = (appGroups ?? []).filter((g) => !g.table)
  // C4 (verifier): empty groups are one compact row of greyed chips; opening one offers + New.
  const sections = groups.filter((g) => rank(g) < 3)
  const empties = groups.filter((g) => rank(g) === 3)
  const [openEmpty, setOpenEmpty] = useState<string | null>(null)
  const chosenEmpty = empties.find((g) => g.key === openEmpty)
  useEffect(() => {
    if (!focusGroup || !groups.length) return
    // An empty group's chip opens, so its + New is at hand.
    if (empties.some((g) => g.key === focusGroup)) setOpenEmpty(focusGroup)
    const el = document.getElementById(linksSectionId({ key: focusGroup }))
    el?.scrollIntoView?.({ block: 'start' })
    el?.focus({ preventScroll: true })
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
        {pref.fields && (meta.data && values ? <div data-testid="links-fields"><PaneFields meta={meta.data} row={values} onOpen={open} stacked={false} /></div> : <span />)}
        <div className="flex min-w-0 flex-col gap-6">
          {/* #1340: the app's groups in its order, its own among the link groups it names; then the rest. */}
          {[...(appGroups ?? []).flatMap((a): (BacklinkGroup | RecordGroup)[] => a.table ? sections.filter((g) => g.connection.table === a.table) : [a]),
            ...sections.filter((g) => !appGroupFor(appGroups, g.connection.table))].map((g) => 'heading' in g
            ? <AppLinkGroup key={appGroupKey(g)} group={g} id={linksSectionId({ key: appGroupKey(g) })} />
            : (
              <div key={g.key} id={linksSectionId(g)} tabIndex={-1} className="scroll-mt-4 rounded-lg focus:outline-none focus-visible:outline-2 focus-visible:outline-focus">
                <LinkedRowsGroup table={table} record={name} group={g} onOpen={open} showAllHref={listHref(g)} editable app={appGroupFor(appGroups, g.connection.table)} />
              </div>
            ))}
          {empties.length > 0 && (
            <section aria-label="Pointed At By" data-testid="links-empty-groups" className="flex min-w-0 flex-col gap-2">
              <h4 className="text-sm font-semibold text-ink">Pointed At By</h4>
              <div className="flex flex-wrap gap-2">
                {empties.map((g) => (
                  <span key={g.key} id={linksSectionId(g)} tabIndex={-1} className="scroll-mt-4 rounded-full focus:outline-none focus-visible:outline-2 focus-visible:outline-focus">
                    <GroupChip label={g.label} count={0} selected={openEmpty === g.key} onSelect={() => setOpenEmpty(openEmpty === g.key ? null : g.key)} />
                  </span>
                ))}
              </div>
              {chosenEmpty && <LinkedRowsGroup key={chosenEmpty.key} table={table} record={name} group={chosenEmpty} onOpen={open} showAllHref={listHref(chosenEmpty)} heading={false} />}
            </section>
          )}
          {cnx.isPending && <p className="text-sm text-ink-subtle">Loading…</p>}
          {cnx.data && !groups.length && !own.length && <p className="text-sm text-ink-muted">No rows point at it</p>}
        </div>
      </div>
    </div>
  )
}
