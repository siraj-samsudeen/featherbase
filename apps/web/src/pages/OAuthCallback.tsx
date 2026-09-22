import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { safeLoginDestination } from 'shared'
import { api, setSession, landingPath, type SessionUser } from '../lib/api'

// PLAT-006: the OAuth callback landing. The server redirects here with a
// one-time handoff code — never the session token itself (#150), which used to
// sit in this URL and therefore in browser history, referrers and proxy logs.
// We POST the code back, get the session, and land in the Admin.

// The redemption is memoised per code, module-side, out of reach of a remount.
// A handoff code is good for exactly one POST, and React StrictMode runs the
// effect below twice in development: the second attempt would 401, and a 401
// clears the very session the first attempt just stored.
type Handoff = { token: string; user: SessionUser; returnTo: string | null; landing?: string }
let redemption: { code: string; session: Promise<Handoff> } | null = null
function redeemOnce(code: string) {
  if (redemption?.code !== code)
    redemption = { code, session: api.post<Handoff>('/api/auth/session', { code }) }
  return redemption.session
}

export function OAuthCallbackPage({ code }: { code?: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!code) {
      navigate({ to: '/featherbase/login' })
      return
    }
    window.history.replaceState(null, '', '/featherbase/oauth-callback')
    redeemOnce(code)
      .then(({ token, user, returnTo, landing }) => {
        setSession(token, { ...user, landing })
        const destination = safeLoginDestination(returnTo ?? undefined)
        if (destination) window.location.assign(destination)
        else navigate({ to: landingPath({ ...user, landing }) })
      })
      .catch(() => navigate({ to: '/featherbase/login' }))
  }, [code, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[var(--color-ink-muted)]" data-testid="oauth-callback">
      Signing you in…
    </div>
  )
}
