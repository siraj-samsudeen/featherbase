import { useState } from 'react'
import { usePageNavigation } from '../lib/navigation'
import { backlinkGroups, rowNameText, useRowName } from '../lib/relations'
import { useConnections } from '../lib/connections'
import { RowRelationTree, defaultExpansion } from './RelationTree'

/**
 * #910 checklist 18: the row page's Tree tab — "Links to" above the row,
 * "Linked from" groups below, unfolding in place, two levels deep to begin
 * with. What is unfolded is part of the path, so a step (and the Form tab and
 * back) brings it back. A line opens in the drill pane; Focus here re-centres.
 */
export function RowTree({ table, name }: { table: string; name: string }) {
  const nav = usePageNavigation()
  const rowNav = nav?.step.screen === 'row' && nav.step.table === table && nav.step.row === name ? nav : null
  const centre = useRowName(table, name)
  const cnx = useConnections(table, name)
  const [local, setLocal] = useState<Set<string> | null>(null)
  if (!cnx.data || centre.state === 'loading') return <p className="text-sm text-ink-subtle">Loading…</p>
  const stored = rowNav?.step.expanded
  const expanded = stored ? new Set(stored) : local ?? new Set(defaultExpansion('c', backlinkGroups(cnx.data.connections)))
  return (
    <RowRelationTree table={table} row={name}
      label={centre.state === 'read' ? centre.title : rowNameText(centre)}
      code={centre.state === 'read' ? centre.code : undefined}
      expanded={expanded}
      onExpandedChange={(next) => {
        setLocal(next)
        if (rowNav) rowNav.setExpanded([...next])
      }}
      onOpen={(pane) => nav?.push({ ...nav.step, pane })}
      onFocus={nav ? (pane) => nav.push({ screen: 'row', table: pane.table, row: pane.row, view: 'tree' }) : undefined} />
  )
}
