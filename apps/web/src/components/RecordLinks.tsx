import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { tableHref, type ListFilter } from 'shared'
import { GroupChip, NoneFold } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { tableLabel, useMeta } from '../lib/meta'
import { useNavigation } from '../lib/navigation'
import { push, type LinksLayout, type NavPane, type NavStep } from '../lib/nav-path'
import { useBacklinkGroups, type BacklinkGroup } from '../lib/relations'
import { useConnections } from '../lib/connections'
import { LinkedRowsGroup } from './LinkedRowsGroup'
import { useGroupPlans } from './LinkTickList'
import { NothingPointsAt, PaneFields } from './RowPane'
import { RowTree } from './RowTree'
import { MenuChoices, MenuShell, userSettingsQuery } from './FormArrangement'
import { WorkedOutSections } from './WorkedOut'
import { tableViewDefaultQuery } from '../lib/table-view-default'

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
  // A choice made here holds until the person's settings are read again (Codex adversarial round 2): after a Reset
  // the refreshed settings and the Table's default decide, not a choice the reset cleared. A choice saved here is in
  // those settings already (update writes it into them), so nothing is lost.
  useEffect(() => setChosen({}), [stored.dataUpdatedAt])
  // #1282 A4: the person's own choice, else the Table's default, else sections with the fields beside.
  const fallback = useQuery(tableViewDefaultQuery(table)).data?.settings.links ?? {}
  const saved = (stored.data?.settings?.links ?? {}) as StoredLinks
  const own = saved.as === 'tree' || saved.as === 'sections' ? saved.as : undefined
  const as: LinksLayout = fromPath ?? chosen.as ?? own ?? (fallback.as === 'tree' ? 'tree' : 'sections')
  const fields = chosen.fields ?? saved.fields ?? fallback.fields ?? true
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
export function RecordLinks({ table, name, values, pref }: {
  table: string
  name: string
  values: Row | undefined
  pref: LinksPreference
}) {
  const nav = useNavigation()
  const meta = useMeta(table)
  const cnx = useConnections(table, name, Boolean(values))
  const all = useBacklinkGroups(cnx.data?.connections)
  // Tick lists first, then groups with rows, then the empty ones, greyed.
  const plans = useGroupPlans(table, name, all)
  const rank = (g: BacklinkGroup) => (plans.get(g.key)?.tick ? 0 : g.count ? 1 : 2)
  const groups = [...all].sort((a, b) => rank(a) - rank(b))
  // C4 (verifier): empty groups are one compact row of greyed chips; opening one offers + New.
  const sections = groups.filter((g) => rank(g) < 2)
  const empties = groups.filter((g) => rank(g) === 2)
  const [openEmpty, setOpenEmpty] = useState<string | null>(null)
  // #1349 item 3: the empty groups fold behind one "+ N tables with none".
  const [showEmpty, setShowEmpty] = useState(false)
  const chosenEmpty = empties.find((g) => g.key === openEmpty)
  if (pref.as === 'tree') return <RowTree table={table} name={name} />
  const open = (pane: NavPane) => nav?.push({ ...nav.step, pane })
  const listHref = (g: BacklinkGroup) => {
    const listStep: NavStep = { screen: 'list', table: g.connection.table, filters: g.connection.filters as ListFilter[] }
    return nav?.addressed ? nav.href(push(nav.path, listStep)) : `${tableHref(g.connection.table)}?filters=${encodeURIComponent(JSON.stringify(g.connection.filters))}`
  }
  return (
    <div className="@container" data-testid="record-links">
      <div className={pref.fields ? 'grid gap-7 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]' : 'grid gap-7'}>
        {pref.fields && (meta.data && values ? <div data-testid="links-fields"><PaneFields meta={meta.data} row={values} onOpen={open} stacked={false} /></div> : <span />)}
        <div className="flex min-w-0 flex-col gap-7">
          {sections.map((g) => (
            <div key={g.key} id={linksSectionId(g)} tabIndex={-1} className="scroll-mt-4 rounded-lg focus:outline-none focus-visible:outline-2 focus-visible:outline-focus">
              <LinkedRowsGroup table={table} record={name} group={g} onOpen={open} showAllHref={listHref(g)} editable />
            </div>
          ))}
          {/* #1282 C10–C11 (UI owner): what an installed app works out about this record, in the Lens's order, so a
              phone and Open Full Page show them too. */}
          <WorkedOutSections table={table} row={name} onOpen={open} />
          {empties.length > 0 && (
            <section aria-label="Pointed At By" data-testid="links-empty-groups" className="flex min-w-0 flex-col gap-2">
              <h4 className="text-[15px] font-semibold text-ink">Pointed At By</h4>
              <div className="flex flex-wrap items-center gap-2">
                {!sections.length && <NothingPointsAt kind={tableLabel(table, meta.data)} />}
                <NoneFold count={empties.length} open={showEmpty} onToggle={() => setShowEmpty((was) => !was)} />
                {showEmpty && empties.map((g) => (
                  <span key={g.key} id={linksSectionId(g)} tabIndex={-1} className="scroll-mt-4 rounded-full focus:outline-none focus-visible:outline-2 focus-visible:outline-focus">
                    <GroupChip label={g.label} count={0} selected={openEmpty === g.key} onSelect={() => setOpenEmpty(openEmpty === g.key ? null : g.key)} />
                  </span>
                ))}
              </div>
              {showEmpty && chosenEmpty && <LinkedRowsGroup key={chosenEmpty.key} table={table} record={name} group={chosenEmpty} onOpen={open} showAllHref={listHref(chosenEmpty)} heading={false} />}
            </section>
          )}
          {cnx.isPending && <p className="text-sm text-ink-subtle">Loading…</p>}
          {cnx.data && !groups.length && <p><NothingPointsAt kind={tableLabel(table, meta.data)} /></p>}
        </div>
      </div>
    </div>
  )
}
