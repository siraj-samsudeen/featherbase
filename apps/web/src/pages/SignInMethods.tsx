import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'

// person-identities (#275): the ways the signed-in person can get in — their
// password and each linked outside account — with linking Google and removing
// a method. The server refuses removing the last way in and anything from a
// test-mode sign-in; this page shows its message.

interface MyIdentity {
  id: string
  method: string
  linked: boolean
  sign_in_name: string | null
  email: string | null
  display_name: string | null
  linked_at: string
  last_used_at: string | null
}

interface MyMethods {
  identities: MyIdentity[]
  has_password: boolean
  methods: { key: string; kind: string; label: string; self_link: boolean }[]
  test_mode: boolean
}

const LINK_OUTCOMES: Record<string, string> = {
  linked: 'Your Google account is linked. You can sign in with it from now on.',
  taken: 'That Google account belongs to another account. Contact your administrator.',
  reserved: 'That Google address is reserved for another account. Contact your administrator.',
  google_failed: 'Google did not confirm the account. Try again.',
  sign_in_again: 'Sign in again first, then link within a few minutes.',
  not_allowed: 'Linking Google is not available for this sign-in.',
  wrong_session: 'That link was started by a different sign-in. Try again.',
  failed: 'Linking did not work. Try again.',
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never')

export function SignInMethods() {
  const qc = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ['me', 'sign_in_methods'],
    queryFn: () => api.get<MyMethods>('/api/me/sign_in_methods'),
  })
  const remove = useMutation({
    mutationFn: (path: string) => api.delete(path),
    onSettled: () => qc.invalidateQueries({ queryKey: ['me', 'sign_in_methods'] }),
  })
  const outcome = new URLSearchParams(window.location.search).get('link')
  const labelOf = (key: string) => data?.methods.find((m) => m.key === key)?.label ?? key
  const google = data?.methods.find((m) => m.kind === 'google' && m.self_link)
  const hasGoogle = data?.identities.some((i) => i.linked && i.method === google?.key)

  return (
    <div className="space-y-4" data-testid="sign-in-methods">
      <h1 className="text-lg font-semibold text-[var(--color-ink)]">Sign-in methods</h1>
      {outcome && LINK_OUTCOMES[outcome] && (
        <p role="status" data-testid="link-outcome" className="fc-card px-4 py-3 text-sm">
          {LINK_OUTCOMES[outcome]}
        </p>
      )}
      {data?.test_mode && (
        <p role="status" className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You signed in through test mode, so sign-in methods cannot be changed.
        </p>
      )}
      {error && <p className="text-sm text-[var(--color-danger)]">{(error as Error).message}</p>}
      <div className="fc-card divide-y divide-[var(--color-border)]">
        {data?.has_password && (
          <div className="flex items-center justify-between gap-3 px-4 py-3" data-testid="method-password">
            <div>
              <p className="text-sm font-medium text-[var(--color-ink)]">Password</p>
              <p className="text-xs text-[var(--color-ink-muted)]">Your Featherbase username and password</p>
            </div>
            <button type="button" className="fc-btn" disabled={data.test_mode || remove.isPending}
              onClick={() => remove.mutate('/api/me/password')}>
              Remove
            </button>
          </div>
        )}
        {data?.identities.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`method-${i.id}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-ink)]">
                {labelOf(i.method)}{i.linked ? '' : ' (invited — links at first sign-in)'}
              </p>
              <p className="truncate text-xs text-[var(--color-ink-muted)]">
                {[i.sign_in_name, i.email, i.display_name].filter(Boolean).join(' · ') || '—'} · last used {when(i.last_used_at)}
              </p>
            </div>
            <button type="button" className="fc-btn" disabled={data.test_mode || remove.isPending}
              onClick={() => remove.mutate(`/api/me/identities/${encodeURIComponent(i.id)}`)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      {remove.error && (
        <p className="text-sm text-[var(--color-danger)]" data-testid="method-error">
          {remove.error instanceof ApiError ? remove.error.message : 'Could not remove it'}
        </p>
      )}
      {google && !hasGoogle && !data?.test_mode && (
        // A full-page navigation: the server's OAuth redirects drive the browser.
        <a href="/api/oauth/google/link" className="fc-btn-primary inline-flex" data-testid="link-google">
          Link a Google account
        </a>
      )}
    </div>
  )
}
