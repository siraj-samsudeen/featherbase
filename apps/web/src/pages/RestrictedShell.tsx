import { Navigate, Outlet, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api, clearSession, getSessionUser } from '../lib/api'
import { Logo } from '../components/Logo'
import { Button, Card, EmptyState, Skeleton, buttonClasses } from '../components/ui'
import { useCapabilities, useIsPreview } from '../lib/session'

// #410: the shell shows only what the person can use. The server already
// refuses everything else; this is the chrome. `useShellKind` reads the
// capabilities the server computed for this session.
//
//   admin        a System Manager, or anyone holding a Table grant -> the Admin
//   report-only  the Sales Target report and nothing else        -> bare shell
//   no-access    no role of use yet                               -> a plain page

export const SIGN_IN_METHODS_PATH = '/featherbase/admin/sign-in-methods'
export const REPORT_PATH = '/featherbase/sales-target'

function useSignOut() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return async () => {
    // Expire the cookie before local state goes, then leave the screen before
    // the cache is cleared so no live observer refetches token-less.
    await api.post('/api/logout', {}).catch(() => {})
    clearSession()
    await navigate({ to: '/featherbase/login' })
    queryClient.clear()
  }
}

// person-rename: a person's id is opaque (`psn_…`) — never shown as a name.
function personName(): string | null {
  const user = getSessionUser()
  return user?.full_name || user?.email || null
}

function PersonName() {
  return <span data-testid="shell-person">{personName()}</span>
}

// A dev-preview deployment announces itself. The link is shareable and the
// data is disposable; a visitor who does not know that may mistake it for the
// real thing, or be surprised when it is reset.
export function PreviewBanner() {
  if (!useIsPreview()) return null
  return (
    <div
      data-testid="preview-banner"
      className="flex shrink-0 items-center justify-center gap-2 bg-caution-tint px-3 py-1 text-xs font-medium text-caution"
    >
      Preview deployment — data here is disposable and may be reset at any time.
    </div>
  )
}

export function Waiting({ label, children }: { label?: string; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
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

export function ReportOnlyShell() {
  const signOut = useSignOut()
  return (
    <div className="flex min-h-screen flex-col bg-canvas" data-testid="report-only-shell">
      <PreviewBanner />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="flex items-center gap-3">
          <Logo className="h-7 w-7 rounded-md" />
          <span className="text-sm font-semibold text-ink"><PersonName /></span>
        </div>
        <div className="flex items-center gap-2">
          <a href={REPORT_PATH} className={buttonClasses()}>Back to your report</a>
          <Button variant="secondary" data-testid="logout" onClick={() => void signOut()}>Log out</Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  )
}

export function NoAccessPage() {
  const signOut = useSignOut()
  const name = personName()
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
    <PreviewBanner />
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm" data-testid="no-access">
        <EmptyState
          title="You don't have access to anything here yet"
          body={`Ask your administrator to give ${name ? `you (${name})` : 'you'} access, then sign in again.`}
          action={
            <Button variant="secondary" data-testid="logout" onClick={() => void signOut()}>
              Log out
            </Button>
          }
        />
      </Card>
    </main>
    </div>
  )
}
