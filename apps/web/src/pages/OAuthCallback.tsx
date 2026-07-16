import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api, setToken } from '../lib/api'

// PLAT-006: the OAuth callback landing. The server redirects here with a signed
// session token in the query; we store it, hydrate the user profile via whoami,
// and land in the Desk.
export function OAuthCallbackPage({ token }: { token?: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!token) {
      navigate({ to: '/login' })
      return
    }
    setToken(token)
    // Hydrate the session user, then enter the Desk.
    api
      .get<{ name: string; email: string; full_name: string | null }>('/api/whoami')
      .then((u) => {
        localStorage.setItem('fc_user', JSON.stringify({ name: u.name, email: u.email, full_name: u.full_name }))
        navigate({ to: '/desk' })
      })
      .catch(() => navigate({ to: '/login' }))
  }, [token, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[var(--color-ink-muted)]" data-testid="oauth-callback">
      Signing you in…
    </div>
  )
}
