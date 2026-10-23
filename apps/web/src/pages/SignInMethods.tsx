import { PersonIdentifiers } from '../components/PersonIdentifiers'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, getSessionUser } from '../lib/api'
import { fmtInstantIST } from '../lib/inr'
import { Button, Card, Notice, buttonClasses } from '../components/ui'

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

const LINK_OUTCOMES: Record<string, { tone: 'positive' | 'negative' | 'caution'; text: string }> = {
  linked: { tone: 'positive', text: 'Your Google account is linked. You can sign in with it from now on.' },
  taken: { tone: 'negative', text: 'That Google account belongs to another account. Contact your administrator.' },
  reserved: { tone: 'negative', text: 'That Google address is reserved for another account. Contact your administrator.' },
  google_failed: { tone: 'negative', text: 'Google did not confirm the account. Try again.' },
  expired: { tone: 'caution', text: 'That link attempt expired or was started in another browser. Start it again from here.' },
  sign_in_again: { tone: 'caution', text: 'Sign in again first, then link within a few minutes.' },
  not_allowed: { tone: 'negative', text: 'Linking Google is not available for this sign-in.' },
  wrong_session: { tone: 'caution', text: 'That link was started by a different sign-in. Try again.' },
  failed: { tone: 'negative', text: 'Linking did not work. Try again.' },
}

const when = (iso: string | null) => (iso ? fmtInstantIST(iso) : 'never')

export function SignInMethods() {
  const qc = useQueryClient()
  const me = getSessionUser()?.row_id
  const { data, error } = useQuery({
    queryKey: ['me', 'sign_in_methods'],
    queryFn: () => api.get<MyMethods>('/api/me/sign_in_methods'),
  })
  const remove = useMutation({
    mutationFn: (path: string) => api.delete(path),
    onSettled: () => qc.invalidateQueries({ queryKey: ['me', 'sign_in_methods'] }),
  })
  const outcome = LINK_OUTCOMES[new URLSearchParams(window.location.search).get('link') ?? '']
  const labelOf = (key: string) => data?.methods.find((m) => m.key === key)?.label ?? key
  const google = data?.methods.find((m) => m.kind === 'google' && m.self_link)
  const hasGoogle = data?.identities.some((i) => i.linked && i.method === google?.key)

  return (
    <div className="space-y-4" data-testid="sign-in-methods">
      <h1 className="text-lg font-semibold text-ink">Sign-in methods</h1>
      {outcome && (
        <div data-testid="link-outcome">
          <Notice tone={outcome.tone}>{outcome.text}</Notice>
        </div>
      )}
      {data?.test_mode && <Notice tone="caution">You signed in through test mode, so sign-in methods cannot be changed.</Notice>}
      {error && <Notice tone="negative">{(error as Error).message}</Notice>}
      <Card className="divide-y divide-border">
        {data?.has_password && (
          <div className="flex items-center justify-between gap-3 px-4 py-3" data-testid="method-password">
            <div>
              <p className="text-sm font-medium text-ink">Password</p>
              <p className="text-sm text-ink-muted">Your Featherbase username and password</p>
            </div>
            <Button disabled={data.test_mode || remove.isPending} onClick={() => remove.mutate('/api/me/password')}>
              Remove
            </Button>
          </div>
        )}
        {data?.identities.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`method-${i.id}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                {labelOf(i.method)}
                {i.linked ? '' : ' (invited — links at first sign-in)'}
              </p>
              <p className="truncate text-sm text-ink-muted">
                {[i.sign_in_name, i.email, i.display_name].filter(Boolean).join(' · ') || '—'} · last used {when(i.last_used_at)}
              </p>
            </div>
            <Button
              disabled={data.test_mode || remove.isPending}
              onClick={() => remove.mutate(`/api/me/identities/${encodeURIComponent(i.id)}`)}
            >
              Remove
            </Button>
          </div>
        ))}
      </Card>
      {remove.error && (
        <p className="text-sm text-negative" data-testid="method-error">
          {remove.error instanceof ApiError ? remove.error.message : 'Could not remove it'}
        </p>
      )}
      {google && !hasGoogle && !data?.test_mode && (
        // A full-page navigation: the server's OAuth redirects drive the browser.
        <a href="/api/oauth/google/link" className={buttonClasses({ variant: 'primary' })} data-testid="link-google">
          Link a Google account
        </a>
      )}
      {/* person-resolution D9: a person keeps their own contact details here
          (unverified until the roster confirms them). */}
      {me && <PersonIdentifiers person={me} />}
    </div>
  )
}
