// #772 checklist 10–11: the sidebar's Data sources group, for System Managers
// only — each source, and under a MotherDuck source the databases it reads, each
// opening the browser there. Styled like SidebarGroup (AdminLayout).
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { RailFold, RailMenuItem, useSidebarRail } from './SidebarRail'
import { useQuery } from '@tanstack/react-query'
import { Cable, Database, Plus, useRecordHref } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { touchRowClasses } from '@featherbase/shop-floor'

interface SourceRow { row_id: string; engine: string; databases: { name: string }[] | null }

const FIELDS = encodeURIComponent(JSON.stringify(['row_id', 'engine', 'databases']))

/** A data source in the rail's menu: its record, through the RecordLink family. */
function SourceMenuItem({ source, close }: { source: string; close: () => void }) {
  const href = useRecordHref('Data Source', source)
  const router = useRouter()
  return (
    <RailMenuItem close={close} onSelect={() => router.history.push(href)}>
      <span className="truncate">{source}</span>
    </RailMenuItem>
  )
}

export function DataSourcesSidebar() {
  const sources = useQuery({
    queryKey: ['warehouse-sources'],
    queryFn: () => api.get<{ data: SourceRow[] }>(`/api/table/Data%20Source?fields=${FIELDS}&order_by=row_id asc&limit=50`),
  })
  const base = touchRowClasses('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm')
  const link = `${base} text-ink-muted hover:bg-subtle hover:text-ink`
  const rail = useSidebarRail()
  const navigate = useNavigate()
  // #1248: in the rail, the sources and their databases fold into one icon.
  if (rail) return (
    <RailFold label="Data sources" icon={Database} testid="sidebar-group-sources">
      {(close) => [
        ...(sources.data?.data ?? []).flatMap((s) => [
          <SourceMenuItem key={s.row_id} source={s.row_id} close={close} />,
          ...(s.engine === 'motherduck' ? (s.databases ?? []) : []).map((d) => (
            <RailMenuItem key={`${s.row_id}/${d.name}`} close={close} onSelect={() => void navigate({ to: '/featherbase/admin/source/$name', params: { name: s.row_id }, search: { database: d.name, schema: undefined } })}>
              <span className="truncate pl-3 font-mono text-xs">{d.name}</span>
            </RailMenuItem>
          )),
        ]),
        <RailMenuItem key="connect" close={close} onSelect={() => void navigate({ to: '/featherbase/admin/table/$table/new', params: { table: 'data-source' }, search: { prefill: undefined } })}>
          <span>Connect a source</span>
        </RailMenuItem>,
      ]}
    </RailFold>
  )
  return (
    <div className="border-t border-border px-2 py-2" data-testid="sidebar-group-sources">
      <h2 className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-xs font-medium text-ink-subtle" data-testid="sidebar-group-heading">
        <Database aria-hidden size={12} />
        Data sources
      </h2>
      {(sources.data?.data ?? []).map((s) => (
        <div key={s.row_id} data-testid="sidebar-source">
          <Link
            to="/featherbase/admin/table/$table/row/$name"
            params={{ table: 'data-source', name: s.row_id }}
            search={{ prefill: undefined }}
            className={link}
            data-testid="sidebar-source-link"
          >
            <Cable aria-hidden size={14} className="shrink-0 text-ink-subtle" data-testid="sidebar-item-icon" />
            <span className="min-w-0 flex-1 truncate">{s.row_id}</span>
          </Link>
          {s.engine === 'motherduck' && (s.databases ?? []).map((d) => (
            <Link
              key={d.name}
              to="/featherbase/admin/source/$name"
              params={{ name: s.row_id }}
              search={{ database: d.name, schema: undefined }}
              className={`${link} pl-6`}
              activeOptions={{ includeSearch: true }}
              activeProps={{ className: `${base} pl-6 font-medium text-action bg-action-tint` }}
              data-testid="sidebar-source-database"
            >
              <Database aria-hidden size={14} className="shrink-0 text-ink-subtle" data-testid="sidebar-item-icon" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{d.name}</span>
            </Link>
          ))}
        </div>
      ))}
      <Link
        to="/featherbase/admin/table/$table/new"
        params={{ table: 'data-source' }}
        search={{ prefill: undefined }}
        className={link}
        data-testid="sidebar-connect-source"
      >
        <Plus aria-hidden size={14} className="shrink-0 text-ink-subtle" data-testid="sidebar-item-icon" />
        <span className="min-w-0 flex-1 truncate">Connect a source</span>
      </Link>
    </div>
  )
}
