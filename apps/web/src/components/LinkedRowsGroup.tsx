import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { choiceLabel, rowDisplayTitle, tableHref } from 'shared'
import type { ReactNode } from 'react'
import { RecordLink, fmtCount } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { GROUP_ROWS, farSideCode, farSides, groupFacts, groupRowFields, type FarSide } from '../lib/far-side'
import { useMeta, type TableMeta } from '../lib/meta'
import type { NavPane } from '../lib/nav-path'
import { UNSEEN_ROW, forwardLinks, groupOrder, shownCode, useGroupRows, useRowName, type BacklinkGroup } from '../lib/relations'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { useI18n } from '../lib/i18n'

type Row = Record<string, unknown>

/**
 * Relational navigation slice 1 (#1218): one group of rows that point at a
 * record, as a quiet list. Each row is one line, named by its far side (the
 * employee of a job assignment, the subcategory of a section subcategory) as a
 * RecordLink, with at most two of its own facts small beneath; the first
 * `maxRows`, then "Show all N" to the filtered list. A far side the viewer may
 * not open is plain words; a row the viewer may not read is never listed (the
 * list read is permission-scoped). The record panel draws it; later slices
 * (the Links tab, a person's linked records, tick editing) reuse it.
 */
export function LinkedRowsGroup({ table, record, group, maxRows = GROUP_ROWS, showAllHref, onOpen, editable: _editable = false, heading = true }: {
  /** The record's Table and id: what the group's rows point at. */
  table: string
  record: string
  group: BacklinkGroup
  maxRows?: number
  /** Where "Show all N" goes; by default the group's Table filtered to the record. */
  showAllHref?: string
  /** Opens a row in place (the record panel's drill); otherwise each link goes to its page. */
  onOpen?: (pane: NavPane) => void
  /** Reserved for tick editing (a later slice); not used yet. */
  editable?: boolean
  /** Draws the group's name and count above the rows. */
  heading?: boolean
}) {
  const { connection } = group
  const meta = useMeta(connection.table)
  const recordMeta = useMeta(table)
  const doc = useQuery({
    queryKey: ['doc', table, record],
    retry: false,
    queryFn: () => api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(record)}`),
  })
  const rows = useGroupRows(connection, {
    fields: meta.data ? groupRowFields(meta.data) : [],
    limit: maxRows,
    enabled: Boolean(meta.data),
    orderBy: meta.data ? groupOrder(meta.data) : undefined,
  })
  const own = recordMeta.data && doc.data ? forwardLinks(recordMeta.data, doc.data) : []
  const data = rows.data?.data ?? []
  const total = rows.data?.total ?? group.count
  const href = showAllHref ?? `${tableHref(connection.table)}?filters=${encodeURIComponent(JSON.stringify(connection.filters))}`
  // A group linked through a sub-table has no column of its own pointing back.
  const backLink = connection.via ? undefined : connection.column
  return (
    <section aria-label={group.label} data-testid="linked-rows-group" className="flex min-w-0 flex-col gap-3">
      {heading && (
        <h4 className={total ? 'text-sm font-semibold text-ink' : 'text-sm font-semibold text-ink-muted'}>
          {group.label} <span className="font-normal text-ink-muted">{fmtCount(total)}</span>
        </h4>
      )}
      {!total ? <p className="text-sm text-ink-muted">No rows</p>
        : rows.isPending || !meta.data || doc.isPending ? <p className="text-sm text-ink-subtle">Loading…</p>
        : (
          <ul className="flex min-w-0 flex-col gap-0.5">
            {data.map((r) => (
              <LinkedRowLine key={String(r.row_id)} meta={meta.data!} row={r} onOpen={onOpen}
                far={farSides(meta.data!, r, { backLink, record: { table, row_id: record }, own })} />
            ))}
          </ul>
        )}
      {/* More than shown: Show all N. Otherwise a quieter way to the group as a
          list, where a new row starts linked to the record. */}
      {total > data.length && data.length > 0 ? <ListLink href={href} quiet={false}>Show all {fmtCount(total)}</ListLink>
        : total > 0 && <ListLink href={href} quiet>Open as list</ListLink>}
    </section>
  )
}

/** One row of a group: its far side by name, or the row itself; its facts beneath. */
function LinkedRowLine({ meta, row, far, onOpen }: { meta: TableMeta; row: Row; far: FarSide[]; onOpen?: (pane: NavPane) => void }) {
  const settings = useSettings()
  const rowId = String(row.row_id)
  const facts = groupFacts(meta, row)
  return (
    <li className="flex min-w-0 flex-col rounded-control px-2 py-1.5 text-[13px] hover:bg-subtle" data-testid="linked-row">
      {far.length === 1 ? <FarSideLink far={far[0]!} onOpen={onOpen} withCode />
        // Two far sides: each name its own link, "Sarees › Silk sarees"; no codes, no row id.
        : far.length === 2 ? <span className="min-w-0">
          <FarSideLink far={far[0]!} onOpen={onOpen} /><span className="text-ink-muted"> › </span><FarSideLink far={far[1]!} onOpen={onOpen} />
        </span> : (() => {
        const title = rowDisplayTitle(meta, row, rowId)
        return <NameThenCode code={shownCode(meta, rowId, title)}>
          <RecordLink table={meta.name} rowId={rowId} name={title}
            onNavigate={onOpen ? () => onOpen({ table: meta.name, row: rowId }) : undefined} />
        </NameThenCode>
      })()}
      {facts.length > 0 && (
        <span className="text-xs text-ink-muted" data-testid="linked-row-facts">
          {facts.map((c, i) => <span key={c.column_name}>{i > 0 && ' · '}<Fact type={c.column_type} value={row[c.column_name]} labels={c.choice_labels} settings={settings} /></span>)}
        </span>
      )}
    </li>
  )
}

function FarSideLink({ far, onOpen, withCode = false }: { far: FarSide; onOpen?: (pane: NavPane) => void; withCode?: boolean }) {
  const name = useRowName(far.table, far.row_id)
  if (name.state === 'loading') return <span className="text-ink-subtle">…</span>
  // The row is listed; what it points to the viewer may not open: plain words, no id.
  if (name.state === 'unreadable') return <RecordLink table={far.table} rowId={far.row_id} name={UNSEEN_ROW} canOpen={false} />
  // The far-side record's own code (an employee's 2001), never a composed key.
  return <NameThenCode code={withCode ? farSideCode(name.title, name.code) : undefined}>
    <RecordLink table={far.table} rowId={far.row_id} name={name.title}
      onNavigate={onOpen ? () => onOpen({ table: far.table, row: far.row_id }) : undefined} />
  </NameThenCode>
}

/** The name alone is the link; the code people use follows it, muted, as in a list ("Lakeside · LKS"). */
function NameThenCode({ code, children }: { code?: string; children: ReactNode }) {
  return <span className="min-w-0">{children}{code && <>{' '}<span className="text-ink-muted">· {code}</span></>}</span>
}

function Fact({ type, value, labels, settings }: { type: string; value: unknown; labels?: Record<string, string> | null; settings: Settings }) {
  const { t } = useI18n()
  if (type === 'Choice') return <>{choiceLabel(String(value), labels, t)}</>
  return <>{formatValue(type, value, settings) || String(value)}</>
}

/** The group's Table filtered to the record: "Show all N", or a quieter "Open as list". */
function ListLink({ href, quiet, children }: { href: string; quiet: boolean; children: ReactNode }) {
  const navigate = useNavigate()
  return (
    <a href={href} className={quiet
      ? 'self-start px-2 text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus'
      : 'self-start px-2 text-sm font-medium text-action underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus'}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        void navigate({ href })
      }}>
      {children}
    </a>
  )
}
