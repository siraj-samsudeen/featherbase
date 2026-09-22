import { useEffect, useState } from 'react'
import { api, ApiError, getSessionUser, setSession, type SessionUser } from '../lib/api'

interface AccountMethods {
  identities: { id: string; provider_id: string; kind: string; enabled: boolean; display_name: string | null; email: string | null }[]
  providers: { id: string; label: string; kind: string }[]
  nativeAvailable: boolean
  recentAuthentication: boolean
  manager: boolean
}
interface Administration {
  users: { row_id: string; full_name: string | null; enabled: boolean; identity_enrolled: boolean }[]
  providers: { id: string; kind: string; client_id: string; enabled: boolean }[]
  recoveries: { id: string; user_id: string; provider_id: string; issuer: string; subject: string; display_name: string | null; email: string | null }[]
}

export function AccountMethodsPage() {
  const [account, setAccount] = useState<AccountMethods | null>(null)
  const [administration, setAdministration] = useState<Administration | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [invitation, setInvitation] = useState('')
  const [selectedUser, setSelectedUser] = useState('')

  async function refresh() {
    const current = await api.get<AccountMethods>('/api/auth/account')
    setAccount(current)
    setAdministration(current.manager && current.recentAuthentication
      ? await api.get<Administration>('/api/auth/administration') : null)
  }
  useEffect(() => { refresh().catch(() => setError('Could not load login methods. Reload to try again.')) }, [])

  async function act(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try { await action(); await refresh() }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not complete this operation') }
    finally { setBusy(false) }
  }
  async function hosted(path: string, input: object) {
    const result = await api.post<{ authorizationUrl: string }>(path, input)
    window.location.assign(result.authorizationUrl)
  }

  return <main className="min-h-screen bg-[var(--color-canvas)] px-4 py-8 text-[var(--color-ink)]">
    <div className="mx-auto max-w-2xl space-y-5">
      <a href="/featherbase" className="text-sm text-[var(--color-brand)]">← Back to apps</a>
      <header><h1 className="text-xl font-semibold">Login methods</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{getSessionUser()?.full_name ?? getSessionUser()?.row_id}. Linked identities share this account’s roles, preferences and app data.</p></header>
      {error && <p role="alert" className="fc-card p-4 text-sm text-[var(--color-danger)]">{error}</p>}
      {!account ? <p>Loading login methods…</p> : <>
        <section className="fc-card space-y-3 p-5" aria-label="Authentication verification">
          <h2 className="font-semibold">Verify before changing methods</h2>
          {account.recentAuthentication ? <p className="text-sm">Recent authentication verified.</p>
            : <p className="text-sm">Recent authentication is required. Google account selection alone is not reauthentication. Missing or stale signed authentication time blocks linking and unlinking; use another linked method or administrator recovery.</p>}
          {account.nativeAvailable && <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault()
            const password = String(new FormData(event.currentTarget).get('password'))
            event.currentTarget.reset()
            void act(async () => {
              const session = await api.post<{ token: string; user: SessionUser }>('/api/auth/reauthenticate/native', { password })
              setSession(session.token, { ...session.user, landing: getSessionUser()?.landing })
            })
          }}>
            <label className="fc-label" htmlFor="native-step-up">Current Featherbase password</label>
            <input id="native-step-up" name="password" type="password" autoComplete="current-password" required className="fc-input" />
            <button className="fc-btn" disabled={busy}>Verify native login</button>
          </form>}
          <p className="text-xs text-[var(--color-ink-muted)]">Verification must still be within five minutes when an operation completes. Provider passwords never belong in this form.</p>
        </section>
        <section className="fc-card space-y-3 p-5" aria-label="Linked identities">
          <h2 className="font-semibold">Your linked identities</h2>
          {account.nativeAvailable && <p className="text-sm">Native Featherbase login is available.</p>}
          {account.identities.length === 0 && <p className="text-sm text-[var(--color-ink-muted)]">No external identities linked.</p>}
          {account.identities.map((identity) => <div key={identity.id} className="space-y-2 border-t border-[var(--color-border)] pt-3">
            <p className="text-sm"><strong className="capitalize">{identity.kind}</strong> · {identity.display_name ?? identity.email ?? 'Linked identity'}{identity.enabled ? '' : ' · Provider disabled'}</p>
            {identity.email && identity.display_name && <p className="text-xs text-[var(--color-ink-muted)]">{identity.email}</p>}
            <div className="flex flex-wrap gap-2">
              <button className="fc-btn" disabled={busy || !identity.enabled} onClick={() => void act(() => hosted('/api/auth/reauthenticate/identity', { identityId: identity.id }))}>Check authentication with this identity</button>
              <button className="fc-btn" disabled={busy || !account.recentAuthentication} onClick={() => void act(async () => {
                await api.post('/api/auth/unlink', { identityId: identity.id })
              })}>Unlink</button>
            </div>
          </div>)}
          <p className="text-xs text-[var(--color-ink-muted)]">Unlink revokes sessions using that identity. Your last available method cannot be removed. Email and domain never merge accounts.</p>
          <div className="flex flex-wrap gap-2">{account.providers.map((provider) =>
            <button key={provider.id} className="fc-btn" disabled={busy || !account.recentAuthentication}
              onClick={() => void act(() => hosted('/api/auth/link', { providerId: provider.id }))}>Link another {provider.label} identity</button>)}</div>
          <p className="text-xs text-[var(--color-ink-muted)]">StyleHR is unavailable until its identity and eligibility contract is confirmed.</p>
        </section>
        {account.manager && !administration && <p className="text-sm">Administrator enrollment and recovery controls require recent authentication.</p>}
        {administration && <section className="fc-card space-y-5 p-5" aria-label="Identity administration">
          <h2 className="font-semibold">Administrator enrollment and recovery</h2>
          <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            void act(async () => {
              const result = await api.post<{ userId: string }>('/api/auth/users', { fullName: String(form.get('fullName')), email: String(form.get('email')) })
              setSelectedUser(result.userId)
            })
          }}>
            <p className="text-sm">Create a new external-only User. App roles and grants are assigned separately.</p>
            <label className="fc-label" htmlFor="person-name">Person name</label><input id="person-name" name="fullName" required className="fc-input" />
            <label className="fc-label" htmlFor="contact-email">Contact email (optional)</label><input id="contact-email" name="email" type="email" className="fc-input" />
            <button className="fc-btn" disabled={busy}>Create external User</button>
          </form>
          <form className="space-y-2 border-t border-[var(--color-border)] pt-4" onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            void act(async () => {
              const result = await api.post<{ invitation: string }>('/api/auth/invitations', {
                userId: selectedUser, providerId: String(form.get('provider')), purpose: String(form.get('purpose')),
              })
              setInvitation(result.invitation)
            })
          }}>
            <label className="fc-label" htmlFor="invited-user">Destination User</label>
            <select id="invited-user" required value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)} className="fc-input">
              <option value="">Choose a User</option>{administration.users.map((user) => <option key={user.row_id} value={user.row_id} disabled={!user.enabled}>{user.full_name ?? user.row_id} · {user.row_id}{user.enabled ? '' : ' · disabled'}</option>)}
            </select>
            <label className="fc-label" htmlFor="invited-provider">Target provider</label>
            <select id="invited-provider" name="provider" required className="fc-input"><option value="">Choose a provider</option>{account.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select>
            <label className="fc-label" htmlFor="invitation-purpose">Purpose</label>
            <select id="invitation-purpose" name="purpose" className="fc-input"><option value="enroll">First enrollment (new User only)</option><option value="recover">Controlled recovery (requires exact-target approval)</option></select>
            <button className="fc-btn" disabled={busy}>Issue one-use code</button>
          </form>
          {invitation && <div className="space-y-2"><p className="text-sm">Share this code privately with the verified claimant. It expires in fifteen minutes and grants no app permissions.</p>
            <label className="fc-label" htmlFor="issued-code">Issued code</label><input id="issued-code" type="password" readOnly value={invitation} className="fc-input" />
            <button className="fc-btn" onClick={() => void navigator.clipboard.writeText(invitation).catch(() => setError('Clipboard unavailable. Select and copy the code field.'))}>Copy code</button></div>}
          {administration.recoveries.map((candidate) => <form key={candidate.id} className="space-y-2 border-t border-[var(--color-border)] pt-4" onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            void act(async () => { await api.post('/api/auth/recoveries/approve', {
              recoveryId: candidate.id, userId: candidate.user_id, providerId: candidate.provider_id, issuer: candidate.issuer, subject: candidate.subject,
              verificationMethod: String(form.get('verificationMethod')), caseReference: String(form.get('caseReference')),
            }) })
          }}>
            <h3 className="font-semibold">Pending recovery</h3>
            <dl className="break-all text-sm"><dt>User</dt><dd>{candidate.user_id}</dd><dt>Provider namespace</dt><dd>{candidate.provider_id}</dd><dt>Issuer</dt><dd>{candidate.issuer}</dd><dt>Subject</dt><dd>{candidate.subject}</dd></dl>
            <p className="text-sm">{candidate.display_name} {candidate.email}. Display claims alone are not independent claimant verification.</p>
            <label className="fc-label" htmlFor={`method-${candidate.id}`}>Independent verification method</label>
            <select id={`method-${candidate.id}`} name="verificationMethod" className="fc-input"><option value="in-person">In person</option><option value="organizational-record">Organizational record</option><option value="video-call">Video call</option></select>
            <label className="fc-label" htmlFor={`case-${candidate.id}`}>Verification case reference</label><input id={`case-${candidate.id}`} name="caseReference" required maxLength={100} className="fc-input" />
            <label className="flex gap-2 text-sm"><input type="checkbox" required />I independently verified the claimant and this exact User, issuer and subject.</label>
            <p className="text-xs text-[var(--color-ink-muted)]">Approval revokes the User’s old sessions. It does not re-enable a disabled User or grant reusable step-up authority.</p>
            <button className="fc-btn" disabled={busy}>Approve this exact recovery</button>
          </form>)}
          <h3 className="border-t border-[var(--color-border)] pt-4 font-semibold">Hosted provider configuration</h3>
          <p className="text-xs text-[var(--color-ink-muted)]">Configure GOOGLE_CLIENT_SECRET or MICROSOFT_CLIENT_SECRET in the server environment first. Register /api/auth/callback at this site’s public HTTPS origin. Provider namespaces cannot be edited.</p>
          {administration.providers.map((provider) => <div key={provider.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="break-all">{provider.kind} · {provider.client_id || 'not configured'}</span>
            <button className="fc-btn" disabled={busy || provider.kind === 'stylehr'} onClick={() => void act(async () => {
              await api.post('/api/auth/providers/enabled', { id: provider.id, enabled: !provider.enabled })
            })}>{provider.enabled ? 'Disable provider and its sessions' : 'Enable provider'}</button>
          </div>)}
          <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            void act(async () => { await api.post('/api/auth/providers', { kind: String(form.get('kind')), clientId: String(form.get('clientId')) }) })
          }}>
            <label className="fc-label" htmlFor="provider-kind">Provider</label><select id="provider-kind" name="kind" className="fc-input"><option value="google">Google</option><option value="microsoft">Microsoft</option></select>
            <label className="fc-label" htmlFor="provider-client">OAuth client ID</label><input id="provider-client" name="clientId" required className="fc-input" />
            <button className="fc-btn" disabled={busy}>Add hosted provider</button>
          </form>
        </section>}
      </>}
    </div>
  </main>
}
