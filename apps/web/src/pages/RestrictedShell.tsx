import { Navigate } from '@tanstack/react-router'
import { getSessionUser } from '../lib/api'
import { TopBar } from '../components/TopBar'
import { Card, EmptyState, Skeleton } from '../components/ui'
import { useCapabilities } from '../lib/session'

// #410: the shell shows only what the person can use. The server already
// refuses everything else; this is the chrome. `useShellKind` reads the
// capabilities the server computed for this session.
//
//   admin        a System Manager, or anyone holding a Table grant -> the Admin
//   report-only  the Sales Target report and nothing else        -> the report
//   no-access    no role of use yet                               -> a plain page
//
// #489: every one of them wears the shared top bar; signing out and the
// person's sign-in methods live in its Account menu, nowhere else.

export const REPORT_PATH = '/featherbase/sales-target'

// person-rename: a person's id is opaque (`psn_…`) — never shown as a name.
function personName(): string | null {
  const user = getSessionUser()
  return user?.full_name || user?.email || null
}

export function Waiting({ label, children }: { label?: string; children?: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-canvas p-4">
      {children ?? <Skeleton label={label ?? 'Loading'} className="w-full max-w-sm" />}
    </main>
  )
}

/** Wraps a management-only Admin page: anyone else is sent to the admin home. */
export function ManageOnly({ children }: { children: React.ReactNode }) {
  const caps = useCapabilities()
  if (!caps) return null
  return caps.manage ? <>{children}</> : <Navigate to="/featherbase/admin" replace />
}

export function NoAccessPage() {
  const name = personName()
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TopBar />
      <main className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm" data-testid="no-access">
          <EmptyState
            title="You don't have access to anything here yet"
            body={`Ask your administrator to give ${name ? `you (${name})` : 'you'} access, then sign in again.`}
          />
        </Card>
      </main>
    </div>
  )
}
