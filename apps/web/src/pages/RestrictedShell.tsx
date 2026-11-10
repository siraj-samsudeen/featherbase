import { useEffect } from 'react'
import { Navigate } from '@tanstack/react-router'
import { getSessionUser } from '../lib/api'
import { TopBar } from '../components/TopBar'
import { Card, EmptyState, Skeleton } from '@featherbase/shop-floor'
import { useCapabilities } from '../lib/session'
import { useAccessRequest } from '../lib/access-request'

// #410: the shell shows only what the person can use. The server already
// refuses everything else; this is the chrome. `useShellKind` reads the
// capabilities the server computed for this session.
//
//   admin        a System Manager, or anyone holding a Table grant -> the Admin
//                outside the Tables of apps with pages of their own (#659)
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

/** Found on staging (10-Nov-2026): someone who belongs in an app is sent there, never told "no access". */
export function GoingToApp({ path }: { path: string }) {
  useEffect(() => { window.location.assign(path) }, [path])
  return (
    <div className="flex min-h-screen flex-col bg-canvas" data-testid="going-to-app" data-path={path}>
      <Waiting label="Opening your app" />
    </div>
  )
}

export function NoAccessPage() {
  const name = personName()
  // #955: opening Featherbase with no access is the request for it, unless they belong in an app.
  const asked = useAccessRequest('featherbase')
  if (asked?.state === 'elsewhere' && asked.home) return <GoingToApp path={asked.home} />
  if (asked?.state === 'apps' && asked.apps?.length)
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
        <TopBar forPerson />
        <main className="flex flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-sm" data-testid="app-list">
            <EmptyState title="Your apps" body="Open one of these. For anything else, ask your administrator." />
            <ul className="mt-2 flex flex-col gap-1">
              {asked.apps.map((app) => (
                <li key={app.name}>
                  <a href={app.href} className="text-action underline">{app.title}</a>
                </li>
              ))}
            </ul>
          </Card>
        </main>
      </div>
    )
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TopBar forPerson />
      <main className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm" data-testid="no-access">
          {asked?.state === 'waiting' ? (
            <EmptyState
              title={`You don't have access to ${asked.title} yet`}
              body="An admin has been told. Once they give you access, sign in again."
            />
          ) : (
            <EmptyState
              title="You don't have access to anything here yet"
              body={`Ask your administrator to give ${name ? `you (${name})` : 'you'} access, then sign in again.`}
            />
          )}
        </Card>
      </main>
    </div>
  )
}
