import { useQuery } from '@tanstack/react-query'
import { api, getSessionUser, listResource } from './api'

// Current session identity + roles, resolved from the server (whoami) and
// cached. Used to gate role-only UI like the SET-003 permission manager.
// #410: what the shell may draw, computed by the server from current roles and
// grants. Display only — the server still refuses what the person cannot do.
export interface Capabilities {
  manage: boolean // System Manager: build Tables, import, issue access tokens
  report: boolean // the Sales Target report
  table_access: boolean // holds any Table grant of their own, or a shared row
  own_grant: boolean // holds a Table grant of their own (not only a shared row)
  tables: string[] // Tables the person can read (empty for a System Manager: they read the Table list)
  creatable: string[] // Tables the person can add rows to
}

interface WhoAmI {
  capabilities: Capabilities
  name: string
  email: string | null
  full_name: string | null
  roles: string[]
  theme?: 'light' | 'dark'
  palette?: 'classic' | 'ivory' | 'graphite' | 'indigo'
  language?: string
  // True on a dev-preview deployment. The shell says so out loud: anyone
  // handed the link should know the data is disposable.
  preview?: boolean
}

export function useWhoAmI() {
  return useQuery({
    queryKey: ['whoami'],
    queryFn: () => api.get<WhoAmI>('/api/whoami'),
    staleTime: 5 * 60_000,
    // Signed out there is nothing to ask — and an anonymous whoami would ride
    // the sid cookie (if one survives) and answer as the previous user.
    enabled: Boolean(getSessionUser()),
  })
}

export function useIsPreview(): boolean {
  return useWhoAmI().data?.preview ?? false
}

export function useIsSystemManager(): boolean {
  const q = useWhoAmI()
  return q.data?.roles?.includes('System Manager') ?? false
}

export type ShellKind = 'loading' | 'failed' | 'admin' | 'report-only' | 'no-access'

/**
 * Which layout the person gets (#410). Pure so the rule is testable: an error
 * only blocks a shell that has no answer yet — a failed background refresh must
 * not take away the Admin the person is already using.
 */
export function shellKindOf(q: { isError: boolean; data?: { capabilities?: Capabilities } }): ShellKind {
  const caps = q.data?.capabilities
  if (!caps) return q.isError ? 'failed' : 'loading'
  if (caps.manage || caps.table_access) return 'admin'
  return caps.report ? 'report-only' : 'no-access'
}

export function useShellKind(): ShellKind {
  const q = useWhoAmI()
  return shellKindOf({ isError: q.isError, data: q.data })
}

export function useCapabilities(): Capabilities | undefined {
  return useWhoAmI().data?.capabilities
}

export interface TableSummary {
  row_id: string
  module: string
  system: boolean
}

/**
 * The Tables the shell lists. A System Manager reads the Table list (module and
 * system flags included); anyone else gets the names they can read from
 * whoami and never asks for the list, which the server refuses them.
 */
export function useShellTables(): TableSummary[] | undefined {
  const caps = useCapabilities()
  const manage = caps?.manage === true
  const list = useQuery({
    queryKey: ['tables'],
    enabled: manage,
    queryFn: () =>
      listResource<TableSummary>('Table', {
        filters: [['kind', '!=', 'sub_table']],
        fields: ['row_id', 'module', 'system'],
        order_by: 'row_id asc',
        limit_page_length: 200,
      }),
  })
  if (!caps) return undefined
  if (manage) return list.data?.data
  return caps.tables.map((row_id) => ({ row_id, module: '', system: false }))
}
