import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { listResource } from '../lib/api'
import { listColumns, useMeta } from '../lib/meta'
import { formatValue, useSettings } from '../lib/settings'
import { connectionLabel, useConnections, type Connection, type Filter } from '../lib/connections'
import { usePeek } from './Peek'
import { useQuery } from '@tanstack/react-query'

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
    <div className="fc-card" data-testid="connections-panel">
      <div className="border-b border-[var(--color-border)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        Connections
      </div>
      {cnx.data.connections.map((c) => (
        <div
          key={`${c.table}:${c.column}:${c.via ?? ''}`}
          className="flex items-center border-b border-[var(--color-border)] last:border-0"
        >
          <Link
            to="/admin/$table"
            params={{ table: c.table }}
            search={{ filters: JSON.stringify(c.filters) }}
            data-testid={`connection-${c.table}`}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-[var(--color-subtle)]"
          >
            <span
              className={`truncate ${c.count ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]'}`}
            >
              {connectionLabel(c)}
            </span>
            <span
              className={`fc-pill ${c.count ? 'bg-[var(--color-brand-tint)] text-[var(--color-brand)]' : 'bg-[var(--color-subtle)] text-[var(--color-ink-faint)]'}`}
              data-testid={`connection-count-${c.table}`}
            >
              {c.count}
            </span>
          </Link>
          {peek.available && (
            <button
              onClick={() =>
                peek.push({ kind: 'list', table: c.table, filters: c.filters, title: connectionLabel(c) })
              }
              title={`Peek at ${c.table}`}
              data-testid={`connection-peek-${c.table}`}
              className="px-1.5 py-2 text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"
            >
              ◎
            </button>
          )}
          {!c.via && (
            <Link
              to="/admin/$table/$name"
              params={{ table: c.table, name: 'new' }}
              search={{ prefill: JSON.stringify({ [c.column]: name }) }}
              title={`New ${c.table} with ${c.column} = ${name}`}
              data-testid={`connection-new-${c.table}`}
              className="pr-3 text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"
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
                ? 'border-[var(--color-brand)] bg-[var(--color-brand-tint)]'
                : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] hover:border-[var(--color-brand)]'
            }`}
          >
            <span
              className={`text-base font-semibold leading-tight ${
                open === key(c)
                  ? 'text-[var(--color-brand)]'
                  : c.count
                    ? 'text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-faint)]'
              }`}
              data-testid={`related-count-${c.table}`}
            >
              {c.count}
            </span>
            <span className="text-[11px] font-medium text-[var(--color-ink-muted)]">
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
    return <p className="mt-2 text-sm text-[var(--color-ink-faint)]">Loading…</p>
  if (meta.isError || list.isError)
    return <p className="mt-2 text-sm text-[var(--color-danger)]">Cannot load {connection.table}</p>
  const rows = list.data!.data
  return (
    <div className="fc-card mt-2 overflow-x-auto" data-testid="embedded-list">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-subtle)]">
          <tr>
            {columns.map((c) => (
              <th
                key={c.column_name}
                className="border-b border-[var(--color-border)] px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.row_id)} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-subtle)]">
              {columns.map((c, i) => (
                <td key={c.column_name} className="px-3 py-1.5">
                  {i === 0 ? (
                    <Link
                      to="/admin/$table/$name"
                      search={{ prefill: undefined }}
                      params={{ table: connection.table, name: String(r.row_id) }}
                      className="font-medium text-[var(--color-brand)] hover:underline"
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
              <td colSpan={columns.length} className="px-3 py-5 text-center text-sm text-[var(--color-ink-faint)]">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="flex items-center gap-4 border-t border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-1.5 text-xs">
        {list.data!.total > rows.length && (
          <span className="text-[var(--color-ink-muted)]">
            Showing {rows.length} of {list.data!.total}
          </span>
        )}
        <Link
          to="/admin/$table"
          params={{ table: connection.table }}
          search={{ filters: JSON.stringify(connection.filters) }}
          data-testid="embedded-open-list"
          className="font-medium text-[var(--color-brand)] hover:underline"
        >
          Open as filtered list ↗
        </Link>
        {!connection.via && (
          <Link
            to="/admin/$table/$name"
            params={{ table: connection.table, name: 'new' }}
            search={{ prefill: JSON.stringify({ [connection.column]: owner }) }}
            data-testid="embedded-new"
            className="font-medium text-[var(--color-brand)] hover:underline"
          >
            + New {connection.table}
          </Link>
        )}
      </div>
    </div>
  )
}

export type { Filter }
