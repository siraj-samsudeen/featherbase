import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { listResource } from '../lib/api'
import { listColumns, useMeta } from '../lib/meta'
import { formatValue, useSettings } from '../lib/settings'
import { connectionLabel, useConnections, type Connection, type Filter } from '../lib/connections'
import { usePeek } from './Peek'
import { useQuery } from '@tanstack/react-query'
import { cardClasses, pillClasses } from './ui'
import { fmtCount } from '../lib/inr'

// Relational navigation (#100, patterns 1 + 2):
//
// ConnectionsPanel — Frappe's "Connections" dashboard section, derived
// entirely from metadata (every Reference column pointing at this table),
// with live permission-scoped counts. Click → the target's filtered list;
// ◎ → peek without leaving; + → a new row pre-filled with this reference.
//
// RelatedTabs — Odoo's smart buttons + Salesforce's related lists: the same
// connection groups as count tiles above an embedded read-only list, so hub
// records (Employee, Customer) read as a 360° page. Zero configuration —
// tabs appear for whatever points at the table.

export function ConnectionsPanel({ table, name }: { table: string; name: string }) {
  const cnx = useConnections(table, name)
  const peek = usePeek()
  if (!cnx.data?.connections.length) return null
  return (
    <div className={cardClasses()} data-testid="connections-panel">
      <div className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Connections
      </div>
      {cnx.data.connections.map((c) => (
        <div
          key={`${c.table}:${c.column}:${c.via ?? ''}`}
          className="flex items-center border-b border-border last:border-0"
        >
          <Link
            to="/featherbase/admin/$table"
            params={{ table: c.table }}
            search={{ filters: JSON.stringify(c.filters) }}
            data-testid={`connection-${c.table}`}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-subtle"
          >
            <span
              className={`truncate ${c.count ? 'text-ink' : 'text-ink-subtle'}`}
            >
              {connectionLabel(c)}
            </span>
            <span
              className={pillClasses(`${c.count ? 'bg-action-tint text-action' : 'bg-subtle text-ink-subtle'}`)}
              data-testid={`connection-count-${c.table}`}
            >
              {fmtCount(c.count)}
            </span>
          </Link>
          {peek.available && (
            <button
              onClick={() =>
                peek.push({ kind: 'list', table: c.table, filters: c.filters, title: connectionLabel(c) })
              }
              title={`Peek at ${c.table}`}
              data-testid={`connection-peek-${c.table}`}
              className="px-1.5 py-2 text-ink-subtle hover:text-action"
            >
              ◎
            </button>
          )}
          {!c.via && (
            <Link
              to="/featherbase/admin/$table/$name"
              params={{ table: c.table, name: 'new' }}
              search={{ prefill: JSON.stringify({ [c.column]: name }) }}
              title={`New ${c.table} with ${c.column} = ${name}`}
              data-testid={`connection-new-${c.table}`}
              className="pr-3 text-ink-subtle hover:text-action"
            >
              +
            </Link>
          )}
        </div>
      ))}
    </div>
  )
}

export function RelatedTabs({ table, name }: { table: string; name: string }) {
  const cnx = useConnections(table, name)
  const [open, setOpen] = useState<string | null>(null)
  const connections = cnx.data?.connections ?? []
  if (!connections.length) return null
  const key = (c: Connection) => `${c.table}:${c.column}:${c.via ?? ''}`
  const active = connections.find((c) => key(c) === open)
  return (
    <div className="mt-2 max-w-3xl" data-testid="related-tabs">
      <div className="flex flex-wrap gap-2">
        {connections.map((c) => (
          <button
            key={key(c)}
            onClick={() => setOpen(open === key(c) ? null : key(c))}
            data-testid={`related-tab-${c.table}`}
            className={`flex flex-col items-start rounded-[var(--radius-control)] border px-3.5 py-1.5 text-left ${
              open === key(c)
                ? 'border-action bg-action-tint'
                : 'border-border-control bg-surface hover:border-action'
            }`}
          >
            <span
              className={`text-base font-semibold leading-tight ${
                open === key(c)
                  ? 'text-action'
                  : c.count
                    ? 'text-ink'
                    : 'text-ink-subtle'
              }`}
              data-testid={`related-count-${c.table}`}
            >
              {fmtCount(c.count)}
            </span>
            <span className="text-xs font-medium text-ink-muted">
              {connectionLabel(c)}
            </span>
          </button>
        ))}
      </div>
      {active && <EmbeddedList key={key(active)} connection={active} owner={name} />}
    </div>
  )
}

// A compact read-only slice of the related table, fixed to the connection's
// filter. Rows link to their forms; the footer escapes to the full filtered
// list and to a pre-filled new row.
function EmbeddedList({ connection, owner }: { connection: Connection; owner: string }) {
  const meta = useMeta(connection.table)
  const settings = useSettings()
  const columns = meta.data ? listColumns(meta.data) : []
  const list = useQuery({
    queryKey: ['embedded-list', connection.table, JSON.stringify(connection.filters)],
    enabled: columns.length > 0,
    queryFn: () =>
      listResource(connection.table, {
        filters: connection.filters,
        fields: columns.map((c) => c.column_name),
        limit_page_length: 8,
      }),
  })
  if (meta.isLoading || list.isLoading)
    return <p className="mt-2 text-sm text-ink-subtle">Loading…</p>
  if (meta.isError || list.isError)
    return <p className="mt-2 text-sm text-negative">Cannot load {connection.table}</p>
  const rows = list.data!.data
  return (
    <div className={cardClasses('mt-2 overflow-x-auto')} data-testid="embedded-list">
      <table className="w-full text-sm">
        <thead className="bg-subtle">
          <tr>
            {columns.map((c) => (
              <th
                key={c.column_name}
                className="border-b border-border px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.row_id)} className="border-b border-border last:border-0 hover:bg-subtle">
              {columns.map((c, i) => (
                <td key={c.column_name} className="px-3 py-1.5">
                  {i === 0 ? (
                    <Link
                      to="/featherbase/admin/$table/$name"
                      search={{ prefill: undefined }}
                      params={{ table: connection.table, name: String(r.row_id) }}
                      className="font-medium text-action hover:underline"
                    >
                      {formatValue(c.column_type, r[c.column_name], settings) || String(r.row_id)}
                    </Link>
                  ) : (
                    formatValue(c.column_type, r[c.column_name], settings) || '—'
                  )}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-5 text-center text-sm text-ink-subtle">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="flex items-center gap-4 border-t border-border bg-subtle px-3 py-1.5 text-xs">
        {list.data!.total > rows.length && (
          <span className="text-ink-muted">
            Showing {fmtCount(rows.length)} of {fmtCount(list.data!.total)}
          </span>
        )}
        <Link
          to="/featherbase/admin/$table"
          params={{ table: connection.table }}
          search={{ filters: JSON.stringify(connection.filters) }}
          data-testid="embedded-open-list"
          className="font-medium text-action hover:underline"
        >
          Open as filtered list ↗
        </Link>
        {!connection.via && (
          <Link
            to="/featherbase/admin/$table/$name"
            params={{ table: connection.table, name: 'new' }}
            search={{ prefill: JSON.stringify({ [connection.column]: owner }) }}
            data-testid="embedded-new"
            className="font-medium text-action hover:underline"
          >
            + New {connection.table}
          </Link>
        )}
      </div>
    </div>
  )
}

export type { Filter }
