import { useState } from 'react'
import { PersonIdentifiers } from '../components/PersonIdentifiers'
import { RowMenu } from '../components/RowMenu'
import { ChangePasswordModal } from '../components/ChangePasswordModal'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, getSessionUser } from '../lib/api'
import { fmtInstantIST } from '@featherbase/shop-floor'
import { useI18n } from '../lib/i18n'
import { Button, Card, Notice, buttonClasses } from '@featherbase/shop-floor'
import { NotWhileViewing } from '../components/ViewAs'
import { viewedPerson } from '../lib/viewing-as'
import { usePageTitle } from '../lib/page-title'

// person-identities (#275): the ways the signed-in person can get in — their
// password and each linked outside account — with linking Google or Microsoft and removing
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

// A link attempt comes back as `?link=<code>`, with `&via=microsoft` when it
// was Microsoft's; each text names the provider by its label.
const LINK_OUTCOMES: Record<string, { tone: 'positive' | 'negative' | 'caution'; text: (p: string) => string }> = {
  linked: { tone: 'positive', text: (p) => `Your ${p} account is linked. You can sign in with it from now on.` },
  taken: { tone: 'negative', text: (p) => `That ${p} account belongs to another account. Contact your administrator.` },
  reserved: { tone: 'negative', text: (p) => `That ${p} address is reserved for another account. Contact your administrator.` },
  google_failed: { tone: 'negative', text: (p) => `${p} did not confirm the account. Try again.` },
  microsoft_failed: { tone: 'negative', text: (p) => `${p} did not confirm the account. Try again.` },
  expired: { tone: 'caution', text: () => 'That link attempt expired or was started in another browser. Start it again from here.' },
  sign_in_again: { tone: 'caution', text: () => 'Sign in again first, then link within a few minutes.' },
  not_allowed: { tone: 'negative', text: (p) => `Linking ${p} is not available for this sign-in.` },
  domain_not_allowed: {
    tone: 'negative',
    text: (p) => `That ${p} account is not on a domain this site allows, so it was not linked. Link your work ${p} account instead.`,
  },
  wrong_session: { tone: 'caution', text: () => 'That link was started by a different sign-in. Try again.' },
  failed: { tone: 'negative', text: () => 'Linking did not work. Try again.' },
}

const when = (iso: string | null) => (iso ? fmtInstantIST(iso) : 'never')

export function SignInMethods() {
  usePageTitle('Sign-in methods')
  // #1222: these are the signed-in account's own; never the tester's while the page is someone else's.
  return viewedPerson() ? <NotWhileViewing what="Sign-in methods" /> : <OwnSignInMethods />
}

function OwnSignInMethods() {
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
  const query = new URLSearchParams(window.location.search)
  const outcome = LINK_OUTCOMES[query.get('link') ?? '']
  const labelOf = (key: string) => data?.methods.find((m) => m.key === key)?.label ?? key
  const google = data?.methods.find((m) => m.kind === 'google' && m.self_link)
  const hasGoogle = data?.identities.some((i) => i.linked && i.method === google?.key)
  const microsoft = data?.methods.find((m) => m.kind === 'microsoft' && m.self_link)
  const hasMicrosoft = data?.identities.some((i) => i.linked && i.method === microsoft?.key)
  const outcomeProvider = query.get('via') === 'microsoft'
    ? (data?.methods.find((m) => m.kind === 'microsoft')?.label || 'Microsoft')
    : (data?.methods.find((m) => m.kind === 'google')?.label || 'Google')
  const { t } = useI18n()
  // #72: changing one's own password. #489 moved it here from the Account
  // menu, which holds only the name, Sign-in methods and Log out.
  const [changingPassword, setChangingPassword] = useState(false)
  // #1235 item 9: removing a way in is destructive, so it asks first, by name.
  const removeAfterAsking = (what: string, path: string) => {
    if (window.confirm(`Remove ${what} as a way to sign in?`)) remove.mutate(path)
  }
  const locked = Boolean(data?.test_mode) || remove.isPending

  return (
    <div className="space-y-4" data-testid="sign-in-methods">
      {/* UI standard: 24px from the page header to the first content. */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <h1 className="text-2xl font-semibold text-ink">{t('Sign-in methods')}</h1>
        <Button onClick={() => setChangingPassword(true)} data-testid="account-change-password">
          {t('Change password')}
        </Button>
      </div>
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
      {outcome && (
        <div data-testid="link-outcome">
          <Notice tone={outcome.tone}>{outcome.text(outcomeProvider)}</Notice>
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
            <RowMenu
              name="Password"
              items={[{ label: 'Remove', tone: 'negative', disabled: locked, onSelect: () => removeAfterAsking('Password', '/api/me/password') }]}
            />
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
            <RowMenu
              name={labelOf(i.method)}
              items={[{
                label: 'Remove',
                tone: 'negative',
                disabled: locked,
                onSelect: () => removeAfterAsking(
                  [labelOf(i.method), i.sign_in_name ?? i.email].filter(Boolean).join(' '),
                  `/api/me/identities/${encodeURIComponent(i.id)}`,
                ),
              }]}
            />
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
        <a href="/api/oauth/google/link" className={buttonClasses()} data-testid="link-google">
          Link a Google account
        </a>
      )}
      {microsoft && !hasMicrosoft && !data?.test_mode && (
        <a href="/api/oauth/microsoft/link" className={buttonClasses({ className: google && !hasGoogle ? 'ml-2' : '' })} data-testid="link-microsoft">
          Link a Microsoft account
        </a>
      )}
      {/* person-resolution D9: a person keeps their own contact details here
          (unverified until the roster confirms them). */}
      {me && <PersonIdentifiers person={me} />}
    </div>
  )
}
