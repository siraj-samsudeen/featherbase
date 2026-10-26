import { useEffect } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { openReturnPath, takeLoginNext } from './Login'
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
  const router = useRouter()
  useEffect(() => {
    if (!code) {
      navigate({ to: '/featherbase/login' })
      return
    }
    redeemOnce(code)
      .then(({ token, user, landing }) => {
        const withLanding = landing ? { ...user, landing } : user
        setSession(token, withLanding)
        // A deep link the person was headed to before Google (see Login).
        const returnTo = takeLoginNext()
        if (returnTo) openReturnPath(returnTo, (path) => router.history.push(path))
        else navigate({ to: landingPath(withLanding) })
      })
      .catch(() => navigate({ to: '/featherbase/login' }))
  }, [code, navigate, router])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-ink-muted" data-testid="oauth-callback">
      Signing you in…
    </div>
  )
}
