import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api, landingPath, setSession, type SessionUser } from '../lib/api'

// PLAT-006: the OAuth callback landing. The server redirects here with a
// one-time handoff code — never the session token itself (#150), which used to
// sit in this URL and therefore in browser history, referrers and proxy logs.
// We POST the code back, get the session, and land where the server says —
// the Admin, or a report viewer's report (#3783), exactly as password login does.

// The redemption is memoised per code, module-side, out of reach of a remount.
// A handoff code is good for exactly one POST, and React StrictMode runs the
// effect below twice in development: the second attempt would 401, and a 401
// clears the very session the first attempt just stored.
type Redeemed = { token: string; user: SessionUser; landing?: string }
let redemption: { code: string; session: Promise<Redeemed> } | null = null
function redeemOnce(code: string) {
  if (redemption?.code !== code)
    redemption = { code, session: api.post<Redeemed>('/api/oauth/session', { code }) }
  return redemption.session
}

export function OAuthCallbackPage({ code }: { code?: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!code) {
      navigate({ to: '/featherbase/login' })
      return
    }
    redeemOnce(code)
      .then(({ token, user, landing }) => {
        const withLanding = landing ? { ...user, landing } : user
        setSession(token, withLanding)
        navigate({ to: landingPath(withLanding) })
      })
      .catch(() => navigate({ to: '/featherbase/login' }))
  }, [code, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[var(--color-ink-muted)]" data-testid="oauth-callback">
      Signing you in…
    </div>
  )
}
