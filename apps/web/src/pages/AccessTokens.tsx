import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getSessionUser, listResource } from '../lib/api'
import { useIsSystemManager } from '../lib/session'

// #131: automation credentials in one place — named access tokens (show-once
// secret, optional expiry, one-click revoke) and the service accounts that
// own them. Everyone manages their own tokens; the service-account section
// and other people's tokens are System Manager territory.

interface Token {
  id: string
  label: string
  owner: string
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  owner_enabled?: boolean
}

interface ServiceAccount {
  row_id: string
  full_name: string | null
  enabled: boolean
  created_at: string
  roles: string[]
  token_count: number
}

const EXPIRY_CHOICES = [
  { label: 'Never expires', days: 0 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
]

// #137: every state here means what the server does with the token. A token
// whose owner is disabled authenticates no better than a revoked one, so it
// must not read as "active" just because it has not been revoked.
function tokenState(t: Token): 'active' | 'revoked' | 'expired' | 'owner disabled' {
  if (t.revoked_at) return 'revoked'
  if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now()) return 'expired'
  if (t.owner_enabled === false) return 'owner disabled'
  return 'active'
}

const STATE_STYLE: Record<string, string> = {
  active: 'text-[var(--color-good)]',
  revoked: 'text-[var(--color-danger)]',
  expired: 'text-[var(--color-ink-faint)]',
  'owner disabled': 'text-[var(--color-ink-faint)]',
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—'
}

export function AccessTokens() {
  const isSM = useIsSystemManager()
  const me = getSessionUser()?.row_id
  const qc = useQueryClient()

  const tokens = useQuery({
    queryKey: ['access-tokens'],
    queryFn: () => api.get<{ tokens: Token[] }>('/api/access_tokens'),
  })
  const accounts = useQuery({
    queryKey: ['service-accounts'],
    queryFn: () => api.get<{ service_accounts: ServiceAccount[] }>('/api/service_accounts'),
    enabled: isSM,
  })

  // ---- issue dialog -------------------------------------------------------
  const [issueFor, setIssueFor] = useState<string | null>(null) // owner preselect, null = closed
  const [label, setLabel] = useState('')
  const [owner, setOwner] = useState('')
  const [expiryDays, setExpiryDays] = useState(0)
  const [issued, setIssued] = useState<{ token: string; label: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openIssue(forOwner?: string) {
    setLabel('')
    setOwner(forOwner ?? me ?? '')
    setExpiryDays(0)
    setError(null)
    setIssueFor(forOwner ?? me ?? '')
  }

  const issue = useMutation({
    mutationFn: () =>
      api.post<Token & { token: string }>('/api/access_tokens', {
        label,
        owner,
        ...(expiryDays
          ? { expires_at: new Date(Date.now() + expiryDays * 86_400_000).toISOString() }
          : {}),
      }),
    onSuccess: (res) => {
      setIssueFor(null)
      setIssued({ token: res.token, label: res.label })
      setCopied(false)
      void qc.invalidateQueries({ queryKey: ['access-tokens'] })
      void qc.invalidateQueries({ queryKey: ['service-accounts'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api/access_tokens/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['access-tokens'] })
      void qc.invalidateQueries({ queryKey: ['service-accounts'] })
    },
  })

  async function copyToken() {
    if (!issued) return
    await navigator.clipboard.writeText(issued.token)
    setCopied(true)
  }

  // Owner choices for System Managers: yourself plus every service account.
  const ownerChoices = [
    ...(me ? [me] : []),
    ...(accounts.data?.service_accounts.map((a) => a.row_id) ?? []),
  ]

  const rows = tokens.data?.tokens ?? []

  return (
    <div data-testid="access-tokens" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-ink)]">Access tokens</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            Bearer credentials for the API. The secret is shown once, at creation.
          </p>
        </div>
        <button className="fc-btn fc-btn-primary" data-testid="issue-token" onClick={() => openIssue()}>
          Issue token
        </button>
      </div>

      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-ink-muted)]">
              <th className="px-3 py-2 font-medium">Label</th>
              {isSM && <th className="px-3 py-2 font-medium">Owner</th>}
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Last used</th>
              <th className="px-3 py-2 font-medium">Expires</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody data-testid="token-rows">
            {rows.map((t) => {
              const state = tokenState(t)
              return (
                <tr key={t.id} className="border-b border-[var(--color-border)] last:border-0" data-testid={`token-${t.id}`}>
                  <td className="px-3 py-2 font-medium text-[var(--color-ink)]">{t.label}</td>
                  {isSM && <td className="px-3 py-2 text-[var(--color-ink-muted)]">{t.owner}</td>}
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">{when(t.created_at)}</td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">
                    {t.last_used_at ? when(t.last_used_at) : 'never'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">
                    {t.expires_at ? when(t.expires_at) : 'never'}
                  </td>
                  <td className={`px-3 py-2 ${STATE_STYLE[state]}`} data-testid={`token-state-${t.id}`}>
                    {state}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {/* Revocable until actually revoked — an expired token or
                        one whose owner is disabled must still be killable. */}
                    {!t.revoked_at && (
                      <button
                        className="fc-btn"
                        data-testid={`revoke-${t.id}`}
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(t.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={isSM ? 7 : 6} className="px-3 py-8 text-center text-[var(--color-ink-faint)]">
                  No tokens yet — issue one to authenticate scripts and integrations.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isSM && (
        <ServiceAccounts
          accounts={accounts.data?.service_accounts ?? []}
          onIssueToken={(name) => openIssue(name)}
        />
      )}

      {/* Issue dialog */}
      {issueFor !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !issue.isPending && setIssueFor(null)}
          onKeyDown={(e) => e.key === 'Escape' && !issue.isPending && setIssueFor(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="fc-card w-full max-w-md space-y-3 p-4"
            data-testid="issue-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-[var(--color-ink)]">Issue access token</h2>
            <div>
              <label className="fc-label" htmlFor="token-label">Label</label>
              <input
                id="token-label"
                className="fc-input w-full"
                data-testid="token-label"
                placeholder="e.g. rama installer"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
              />
            </div>
            {isSM && ownerChoices.length > 1 && (
              <div>
                <label className="fc-label" htmlFor="token-owner">Owner</label>
                <select
                  id="token-owner"
                  className="fc-input w-full"
                  data-testid="token-owner"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  {ownerChoices.map((o) => (
                    <option key={o} value={o}>
                      {o === me ? `${o} (you)` : o}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="fc-label" htmlFor="token-expiry">Expiry</label>
              <select
                id="token-expiry"
                className="fc-input w-full"
                data-testid="token-expiry"
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
              >
                {EXPIRY_CHOICES.map((c) => (
                  <option key={c.days} value={c.days}>{c.label}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-[var(--color-danger)]" data-testid="issue-error">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className="fc-btn" onClick={() => setIssueFor(null)} disabled={issue.isPending}>
                Cancel
              </button>
              <button
                className="fc-btn fc-btn-primary"
                data-testid="issue-confirm"
                disabled={issue.isPending || !label.trim()}
                onClick={() => issue.mutate()}
              >
                {issue.isPending ? 'Issuing…' : 'Issue token'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Show-once secret */}
      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            className="fc-card w-full max-w-lg space-y-3 p-4"
            data-testid="secret-dialog"
          >
            <h2 className="text-base font-semibold text-[var(--color-ink)]">
              Token “{issued.label}” created
            </h2>
            <p className="text-sm text-[var(--color-ink-muted)]">
              Copy it now — this is the only time the secret is shown.
            </p>
            <code
              className="block break-all rounded border border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-2 text-sm text-[var(--color-ink)]"
              data-testid="secret-value"
            >
              {issued.token}
            </code>
            <div className="flex justify-end gap-2">
              <button className="fc-btn" data-testid="copy-secret" onClick={() => void copyToken()}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
              <button className="fc-btn fc-btn-primary" data-testid="secret-done" onClick={() => setIssued(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ServiceAccounts({
  accounts,
  onIssueToken,
}: {
  accounts: ServiceAccount[]
  onIssueToken: (name: string) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [roles, setRoles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const roleList = useQuery({
    queryKey: ['roles-all'],
    queryFn: () => listResource<{ row_id: string }>('Role', { fields: ['name'], order_by: 'name asc' }),
  })

  const create = useMutation({
    mutationFn: () => api.post('/api/service_accounts', { name: name.trim(), roles }),
    onSuccess: () => {
      setName('')
      setRoles([])
      setError(null)
      void qc.invalidateQueries({ queryKey: ['service-accounts'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const setEnabled = useMutation({
    mutationFn: ({ account, enabled }: { account: string; enabled: boolean }) =>
      api.patch(`/api/service_accounts/${account}`, { enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['service-accounts'] }),
  })

  return (
    <div className="space-y-3" data-testid="service-accounts">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-ink)]">Service accounts</h2>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Non-human principals for automation — no password, no sign-in, authenticate only by token.
          Disabling one dead-ends every token it owns.
        </p>
      </div>

      <div className="fc-card space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <label className="fc-label" htmlFor="sa-name">Name</label>
            <input
              id="sa-name"
              className="fc-input w-full"
              data-testid="sa-name"
              placeholder="svc-rama-installer"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            className="fc-btn fc-btn-primary"
            data-testid="sa-create"
            disabled={create.isPending || !name.trim()}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Create service account'}
          </button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(roleList.data?.data ?? [])
            .filter((r) => r.row_id !== 'All')
            .map((r) => (
              <label key={r.row_id} className="flex items-center gap-1.5 text-sm text-[var(--color-ink)]">
                <input
                  type="checkbox"
                  checked={roles.includes(r.row_id)}
                  data-testid={`sa-role-${r.row_id}`}
                  onChange={(e) =>
                    setRoles((prev) =>
                      e.target.checked ? [...prev, r.row_id] : prev.filter((x) => x !== r.row_id),
                    )
                  }
                />
                {r.row_id}
              </label>
            ))}
        </div>
        {error && <p className="text-sm text-[var(--color-danger)]" data-testid="sa-error">{error}</p>}
      </div>

      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-ink-muted)]">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Roles</th>
              <th className="px-3 py-2 font-medium">Active tokens</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody data-testid="sa-rows">
            {accounts.map((a) => (
              <tr key={a.row_id} className="border-b border-[var(--color-border)] last:border-0" data-testid={`sa-${a.row_id}`}>
                <td className="px-3 py-2 font-medium text-[var(--color-ink)]">{a.row_id}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {a.roles.filter((r) => r !== 'All').map((r) => (
                      <span key={r} className="fc-pill">{r}</span>
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2 text-[var(--color-ink-muted)]">{a.token_count}</td>
                <td
                  className={`px-3 py-2 ${a.enabled ? 'text-[var(--color-good)]' : 'text-[var(--color-danger)]'}`}
                  data-testid={`sa-status-${a.row_id}`}
                >
                  {a.enabled ? 'enabled' : 'disabled'}
                </td>
                <td className="space-x-2 px-3 py-2 text-right whitespace-nowrap">
                  {a.enabled && (
                    <button className="fc-btn" data-testid={`sa-issue-${a.row_id}`} onClick={() => onIssueToken(a.row_id)}>
                      Issue token
                    </button>
                  )}
                  <button
                    className="fc-btn"
                    data-testid={`sa-toggle-${a.row_id}`}
                    disabled={setEnabled.isPending}
                    onClick={() => setEnabled.mutate({ account: a.row_id, enabled: !a.enabled })}
                  >
                    {a.enabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
            {!accounts.length && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[var(--color-ink-faint)]">
                  No service accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
