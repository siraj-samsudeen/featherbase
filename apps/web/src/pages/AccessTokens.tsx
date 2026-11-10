import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getSessionUser, listResource } from '../lib/api'
import { adminPageTitle } from 'shared'
import { useIsSystemManager, useWhoAmI } from '../lib/session'
import {
  Button,
  DataList,
  Field,
  Notice,
  Select,
  StatusPill,
  TextInput,
  buttonClasses,
  cardClasses,
  pillClasses,
  type DataColumn,
} from '@featherbase/shop-floor'
import { fmtInstantIST } from '@featherbase/shop-floor'

interface Token {
  id: string
  label: string
  owner: string
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  owner_enabled?: boolean
  owner_name?: string | null
}

interface ServiceAccount {
  row_id: string
  label: string
  enabled: boolean
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

// #852: what a token for an owner would reach, from GET /api/access_tokens/reach.
interface TableReach {
  table: string
  own_rows: boolean
}

interface Reach {
  every_table: boolean
  own_roles: boolean
  own_reach: boolean
  read: TableReach[]
  change: TableReach[]
}

const SHOWN_TABLES = 6

function tableList(tables: TableReach[]): string {
  if (tables.length === 0) return 'nothing'
  const names = tables.map((t) => (t.own_rows ? `${t.table} (own rows only)` : t.table))
  const shown = names.slice(0, SHOWN_TABLES).join(', ')
  return names.length > SHOWN_TABLES ? `${shown} and ${names.length - SHOWN_TABLES} more` : shown
}

// Keep these states aligned with credential resolution, not just revocation.
function tokenState(t: Token): 'active' | 'revoked' | 'expired' | 'owner disabled' {
  if (t.revoked_at) return 'revoked'
  if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now()) return 'expired'
  if (t.owner_enabled === false) return 'owner disabled'
  return 'active'
}

export function AccessTokens() {
  const isSM = useIsSystemManager()
  const identity = useWhoAmI()
  const me = getSessionUser()?.row_id ?? ''
  const qc = useQueryClient()
  const [tab, setTab] = useState<'tokens' | 'accounts'>('tokens')
  const tokens = useQuery({
    queryKey: ['access-tokens'],
    queryFn: () => api.get<{ tokens: Token[] }>('/api/access_tokens'),
  })
  const accounts = useQuery({
    queryKey: ['service-accounts'],
    queryFn: () => api.get<{ service_accounts: ServiceAccount[] }>('/api/service_accounts'),
    enabled: isSM,
  })
  const rows = tokens.data?.tokens ?? []
  const accountRows = accounts.data?.service_accounts ?? []
  const ownerName = (id: string) =>
    id === me
      ? identity.data?.full_name || getSessionUser()?.full_name || 'My token'
      : (accountRows.find((a) => a.row_id === id)?.label ?? 'Service account')
  const suggestion = (id: string) => `${ownerName(id)}-${rows.filter((t) => t.owner === id).length + 1}`
  const ownerChoices = [me, ...accountRows.map((a) => a.row_id)]
  const readyToIssue =
    identity.isSuccess &&
    tokens.isSuccess &&
    !tokens.isFetching &&
    (!isSM || (accounts.isSuccess && !accounts.isFetching))

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['access-tokens'] }),
      qc.invalidateQueries({ queryKey: ['service-accounts'] }),
    ])
  }

  const [issuing, setIssuing] = useState(false)
  const [label, setLabel] = useState('')
  const [labelEdited, setLabelEdited] = useState(false)
  const [owner, setOwner] = useState('')
  const [expiryDays, setExpiryDays] = useState(0)
  // #852: a token that never expires is issued only on a second, deliberate press.
  const [askedNoExpiry, setAskedNoExpiry] = useState(false)
  const [issued, setIssued] = useState<{ token: string; label: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  function openIssue(forOwner = me) {
    issue.reset()
    setLabel(suggestion(forOwner))
    setLabelEdited(false)
    setOwner(forOwner)
    setExpiryDays(0)
    setAskedNoExpiry(false)
    setIssuing(true)
  }

  const reach = useQuery({
    queryKey: ['token-reach', owner],
    enabled: issuing && Boolean(owner),
    queryFn: () => api.get<Reach>(`/api/access_tokens/reach?owner=${encodeURIComponent(owner)}`),
  })

  const issue = useMutation({
    mutationFn: () =>
      api.post<Token & { token: string }>('/api/access_tokens', {
        label,
        owner,
        ...(expiryDays ? { expires_at: new Date(Date.now() + expiryDays * 86_400_000).toISOString() } : {}),
      }),
    onSuccess: async (res) => {
      setIssuing(false)
      setIssued({ token: res.token, label: res.label })
      setCopied(false)
      setCopyError(false)
      await refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api/access_tokens/${id}`),
    onSuccess: refresh,
  })
  const setEnabled = useMutation({
    mutationFn: (account: ServiceAccount) =>
      api.patch(`/api/service_accounts/${account.row_id}`, { enabled: !account.enabled }),
    onSuccess: refresh,
  })

  const [renaming, setRenaming] = useState<{ kind: 'token' | 'account'; id: string; label: string } | null>(
    null,
  )
  const [name, setName] = useState('')
  function openRename(kind: 'token' | 'account', id: string, current: string) {
    rename.reset()
    setName(current)
    setRenaming({ kind, id, label: current })
  }
  const rename = useMutation({
    mutationFn: () =>
      api.patch(`/api/${renaming!.kind === 'token' ? 'access_tokens' : 'service_accounts'}/${renaming!.id}`, {
        label: name,
      }),
    onSuccess: async () => {
      if (renaming?.kind === 'account')
        await qc.invalidateQueries({ queryKey: ['principal-name', renaming.id] })
      await refresh()
      setRenaming(null)
    },
  })

  const [creating, setCreating] = useState(false)
  const [accountName, setAccountName] = useState('')
  const [roles, setRoles] = useState<string[]>([])
  const roleList = useQuery({
    queryKey: ['roles-all'],
    queryFn: () => listResource<{ row_id: string }>('Role', { fields: ['row_id'], order_by: 'row_id asc' }),
    enabled: isSM && creating,
  })
  const create = useMutation({
    mutationFn: () => api.post('/api/service_accounts', { label: accountName.trim(), roles }),
    onSuccess: async () => {
      setCreating(false)
      await refresh()
    },
  })

  const tokenColumns: DataColumn<Token>[] = [
    { key: 'label', header: 'Label', phone: 'title', cell: (t) => t.label },
    ...(isSM
      ? [
          {
            key: 'owner',
            header: 'Owner',
            phone: 'meta' as const,
            cell: (t: Token) => (
              <span data-testid={`token-owner-${t.id}`}>
                {t.owner === me ? `${ownerName(me)} (you)` : (t.owner_name ?? 'Unnamed person')}
              </span>
            ),
          },
        ]
      : []),
    { key: 'created', header: 'Created', cell: (t) => fmtInstantIST(t.created_at) },
    {
      key: 'used',
      header: 'Last used',
      cell: (t) => (t.last_used_at ? fmtInstantIST(t.last_used_at) : 'never'),
    },
    {
      key: 'expires',
      header: 'Expires',
      cell: (t) => (t.expires_at ? fmtInstantIST(t.expires_at) : 'never'),
    },
    {
      key: 'status',
      header: 'Status',
      phone: 'status',
      cell: (t) => {
        const state = tokenState(t)
        return (
          <span data-testid={`token-state-${t.id}`}>
            <StatusPill tone={state === 'active' ? 'positive' : state === 'revoked' ? 'negative' : 'missing'}>
              {state}
            </StatusPill>
          </span>
        )
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (t) => (
        <div className="flex justify-end gap-1 whitespace-nowrap">
          <Button
            variant="quiet"
            data-testid={`token-rename-${t.id}`}
            onClick={() => openRename('token', t.id, t.label)}
          >
            Rename
          </Button>
          {!t.revoked_at && (
            <Button
              variant="quiet"
              data-testid={`revoke-${t.id}`}
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(t.id)}
            >
              Revoke
            </Button>
          )}
        </div>
      ),
    },
  ]
  const accountColumns: DataColumn<ServiceAccount>[] = [
    { key: 'name', header: 'Name', phone: 'title', cell: (a) => a.label },
    {
      key: 'roles',
      header: 'Roles',
      phone: 'meta',
      cell: (a) => (
        <span className="flex flex-wrap gap-1">
          {a.roles
            .filter((r) => r !== 'All')
            .map((r) => (
              <span key={r} className={pillClasses()}>
                {r}
              </span>
            ))}
        </span>
      ),
    },
    { key: 'tokens', header: 'Active tokens', align: 'end', cell: (a) => a.token_count },
    {
      key: 'status',
      header: 'Status',
      phone: 'status',
      cell: (a) => (
        <span data-testid={`sa-status-${a.row_id}`}>
          <StatusPill tone={a.enabled ? 'positive' : 'negative'}>
            {a.enabled ? 'enabled' : 'disabled'}
          </StatusPill>
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (a) => (
        <div className="flex justify-end gap-1 whitespace-nowrap">
          <Button
            variant="quiet"
            data-testid={`sa-rename-${a.row_id}`}
            onClick={() => openRename('account', a.row_id, a.label)}
          >
            Rename
          </Button>
          {a.enabled && (
            <Button
              variant="quiet"
              data-testid={`sa-issue-${a.row_id}`}
              disabled={!readyToIssue}
              onClick={() => openIssue(a.row_id)}
            >
              Issue token
            </Button>
          )}
          <Button
            variant="quiet"
            data-testid={`sa-toggle-${a.row_id}`}
            disabled={setEnabled.isPending}
            onClick={() => setEnabled.mutate(a)}
          >
            {a.enabled ? 'Disable' : 'Enable'}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div data-testid="access-tokens" className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">{adminPageTitle('access-tokens')}</h1>
        <p className="text-sm text-ink-muted">
          Bearer credentials for the API. The secret is shown once, at creation.
        </p>
      </div>
      {isSM && (
        <div role="tablist" aria-label="Credentials" className="flex gap-1 border-b border-border pb-2">
          {(['tokens', 'accounts'] as const).map((value) => (
            <button
              key={value}
              id={`credentials-${value}`}
              role="tab"
              aria-selected={tab === value}
              aria-controls={`panel-${value}`}
              tabIndex={tab === value ? 0 : -1}
              className={buttonClasses({ variant: tab === value ? 'secondary' : 'quiet' })}
              onClick={() => setTab(value)}
              onKeyDown={(e) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
                e.preventDefault()
                const next =
                  e.key === 'Home'
                    ? 'tokens'
                    : e.key === 'End'
                      ? 'accounts'
                      : tab === 'tokens'
                        ? 'accounts'
                        : 'tokens'
                setTab(next)
                document.getElementById(`credentials-${next}`)?.focus()
              }}
            >
              {value === 'tokens' ? 'Tokens' : 'Service accounts'}
            </button>
          ))}
        </div>
      )}
      {!isSM || tab === 'tokens' ? (
        <section
          id="panel-tokens"
          role={isSM ? 'tabpanel' : undefined}
          aria-labelledby={isSM ? 'credentials-tokens' : undefined}
          className="space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">Tokens</h2>
            <Button
              variant="primary"
              data-testid="issue-token"
              disabled={!readyToIssue}
              onClick={() => openIssue()}
            >
              Issue token
            </Button>
          </div>
          {revoke.isError && <Notice tone="negative">{revoke.error.message}</Notice>}
          <div data-testid="token-rows">
            <DataList
              caption="Access tokens"
              rows={rows}
              columns={tokenColumns}
              rowKey={(t) => t.id}
              rowTestId={(t) => `token-${t.id}`}
              state={tokens.isPending ? 'loading' : tokens.isError ? 'error' : 'ready'}
              error={tokens.error?.message}
              onRetry={() => void tokens.refetch()}
              empty={{ title: 'No tokens yet', body: 'Issue one to authenticate scripts and integrations.' }}
            />
          </div>
          {isSM && accounts.isError && (
            <Notice tone="negative">
              <p>{accounts.error.message}</p>
              <Button onClick={() => void accounts.refetch()}>Try again</Button>
            </Notice>
          )}
        </section>
      ) : (
        <section
          id="panel-accounts"
          role="tabpanel"
          aria-labelledby="credentials-accounts"
          data-testid="service-accounts"
          className="space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Service accounts</h2>
              <p className="text-sm text-ink-muted">
                Non-human accounts for automation. Disabling one stops every token it owns.
              </p>
            </div>
            <Button
              variant="primary"
              data-testid="sa-create-open"
              onClick={() => {
                create.reset()
                setAccountName('')
                setRoles([])
                setCreating(true)
              }}
            >
              Create service account
            </Button>
          </div>
          {setEnabled.isError && <Notice tone="negative">{setEnabled.error.message}</Notice>}
          <div data-testid="sa-rows">
            <DataList
              caption="Service accounts"
              rows={accountRows}
              columns={accountColumns}
              rowKey={(a) => a.row_id}
              rowTestId={(a) => `sa-${a.row_id}`}
              state={accounts.isPending ? 'loading' : accounts.isError ? 'error' : 'ready'}
              error={accounts.error?.message}
              onRetry={() => void accounts.refetch()}
              empty={{
                title: 'No service accounts yet',
                body: 'Create an account for scripts that are not tied to a person.',
              }}
            />
          </div>
          {tokens.isError && (
            <Notice tone="negative">
              <p>{tokens.error.message}</p>
              <Button onClick={() => void tokens.refetch()}>Try again</Button>
            </Notice>
          )}
        </section>
      )}

      {issuing && (
        <CredentialDialog
          title="Issue access token"
          testId="issue-dialog"
          busy={issue.isPending}
          onClose={() => setIssuing(false)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (expiryDays === 0 && !askedNoExpiry) setAskedNoExpiry(true)
              else issue.mutate()
            }}
          >
            <fieldset disabled={issue.isPending} className="space-y-4">
              <Field label="Label">
                <TextInput
                  data-testid="token-label"
                  value={label}
                  onChange={(e) => {
                    setLabel(e.target.value)
                    setLabelEdited(true)
                  }}
                />
              </Field>
              {isSM && ownerChoices.length > 1 && (
                <Field label="Owner">
                  <Select
                    data-testid="token-owner"
                    value={owner}
                    onChange={(e) => {
                      setOwner(e.target.value)
                      if (!labelEdited) setLabel(suggestion(e.target.value))
                    }}
                  >
                    {ownerChoices.map((id) => (
                      <option key={id} value={id}>
                        {ownerName(id)}
                        {id === me ? ' (you)' : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Expiry">
                <Select
                  data-testid="token-expiry"
                  value={expiryDays}
                  onChange={(e) => {
                    setExpiryDays(Number(e.target.value))
                    setAskedNoExpiry(false)
                  }}
                >
                  {EXPIRY_CHOICES.map((c) => (
                    <option key={c.days} value={c.days}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </fieldset>
            {reach.data && (
              <div className="space-y-1 rounded border border-border bg-subtle px-3 py-2 text-sm" data-testid="token-reach">
                {reach.data.every_table ? (
                  <p>This token can read and change every Table: its owner is a System Manager.</p>
                ) : (
                  <>
                    <p>Can read: {tableList(reach.data.read)}</p>
                    <p>Can change: {tableList(reach.data.change)}</p>
                  </>
                )}
              </div>
            )}
            {reach.data && !reach.data.every_table && !reach.data.own_reach && (
              <Notice tone="caution">
                <p data-testid="token-reach-warning">
                  {reach.data.own_roles
                    ? `${ownerName(owner)}'s roles grant nothing beyond what every account can, so this token reaches only that. Give it a role with the access it needs before using the token.`
                    : `${ownerName(owner)} has no role of its own, so this token reaches only what every account can. Give it a role before using the token.`}
                </p>
              </Notice>
            )}
            {askedNoExpiry && expiryDays === 0 && (
              <Notice tone="caution">
                <p data-testid="token-no-expiry">
                  This token never expires: it keeps working until someone revokes it. Press Issue without expiry to go
                  ahead, or choose an expiry.
                </p>
              </Notice>
            )}
            {issue.isError && (
              <Notice tone="negative">
                <p data-testid="issue-error">{issue.error.message}</p>
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <Button disabled={issue.isPending} onClick={() => setIssuing(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                data-testid="issue-confirm"
                loading={issue.isPending}
                disabled={!label.trim()}
              >
                {askedNoExpiry && expiryDays === 0 ? 'Issue without expiry' : 'Issue token'}
              </Button>
            </div>
          </form>
        </CredentialDialog>
      )}

      {creating && (
        <CredentialDialog
          title="Create service account"
          testId="sa-dialog"
          busy={create.isPending}
          onClose={() => setCreating(false)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              create.mutate()
            }}
          >
            <fieldset disabled={create.isPending} className="space-y-4">
              <Field label="Name" hint="Lowercase letters, digits, hyphens and underscores; 2–64 characters.">
                <TextInput
                  data-testid="sa-name"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="svc-rama-installer"
                />
              </Field>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-semibold text-ink">Roles</legend>
                {roleList.isPending ? (
                  <p role="status" className="text-sm text-ink-muted">
                    Loading roles…
                  </p>
                ) : roleList.isError ? (
                  <Notice tone="negative">
                    <p>{roleList.error.message}</p>
                    <Button onClick={() => void roleList.refetch()}>Try again</Button>
                  </Notice>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {roleList.data.data
                      .filter((r) => r.row_id !== 'All')
                      .map((r) => (
                        <label key={r.row_id} className="flex items-center gap-2 text-sm text-ink">
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
                )}
              </fieldset>
            </fieldset>
            {create.isError && (
              <Notice tone="negative">
                <p data-testid="sa-error">{create.error.message}</p>
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <Button disabled={create.isPending} onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                data-testid="sa-create"
                loading={create.isPending}
                disabled={!accountName.trim() || !roleList.isSuccess}
              >
                Create service account
              </Button>
            </div>
          </form>
        </CredentialDialog>
      )}

      {renaming && (
        <CredentialDialog
          title={renaming.kind === 'token' ? 'Rename token' : 'Rename service account'}
          testId="rename-dialog"
          busy={rename.isPending}
          onClose={() => setRenaming(null)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              rename.mutate()
            }}
          >
            <Field
              label={renaming.kind === 'token' ? 'Label' : 'Name'}
              hint={
                renaming.kind === 'account'
                  ? 'Lowercase letters, digits, hyphens and underscores; 2–64 characters.'
                  : undefined
              }
            >
              <TextInput
                data-testid="rename-name"
                value={name}
                disabled={rename.isPending}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {rename.isError && (
              <Notice tone="negative">
                <p data-testid="rename-error">{rename.error.message}</p>
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <Button disabled={rename.isPending} onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                data-testid="rename-save"
                loading={rename.isPending}
                disabled={!name.trim()}
              >
                Save name
              </Button>
            </div>
          </form>
        </CredentialDialog>
      )}

      {issued && (
        <CredentialDialog
          title={`Token “${issued.label}” created`}
          testId="secret-dialog"
          onClose={() => setIssued(null)}
        >
          <p className="text-sm text-ink-muted">Copy it now — this is the only time the secret is shown.</p>
          <code
            className="block break-all rounded border border-border bg-subtle px-3 py-2 text-sm text-ink"
            data-testid="secret-value"
          >
            {issued.token}
          </code>
          {copyError && (
            <Notice tone="negative">Could not copy. Select and copy the secret above before closing.</Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button
              data-testid="copy-secret"
              onClick={() =>
                void navigator.clipboard.writeText(issued.token).then(
                  () => {
                    setCopied(true)
                    setCopyError(false)
                  },
                  () => setCopyError(true),
                )
              }
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </Button>
            <Button variant="primary" data-testid="secret-done" onClick={() => setIssued(null)}>
              Done
            </Button>
          </div>
        </CredentialDialog>
      )}
    </div>
  )
}

// One dialog shell for this page's create, issue, rename and show-once flows.
// The platform's recipes supply its appearance; focus stays inside until dismissal.
function CredentialDialog({
  title,
  testId,
  busy = false,
  onClose,
  children,
}: {
  title: string
  testId: string
  busy?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const heading = useId()
  const panel = useRef<HTMLDivElement>(null)
  const dismiss = useRef(onClose)
  dismiss.current = () => {
    if (!busy) onClose()
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const controls = () =>
      [
        ...panel.current!.querySelectorAll<HTMLElement>(
          'input:not(:disabled), select:not(:disabled), button:not(:disabled)',
        ),
      ].filter((el) => !el.closest('fieldset:disabled'))
    controls()[0]?.focus()
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        dismiss.current()
      }
      if (e.key !== 'Tab') return
      const all = controls()
      const first = all[0]
      const last = all.at(-1)
      if (
        e.shiftKey &&
        (document.activeElement === first || !panel.current?.contains(document.activeElement))
      ) {
        e.preventDefault()
        last?.focus()
      }
      if (
        !e.shiftKey &&
        (document.activeElement === last || !panel.current?.contains(document.activeElement))
      ) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss.current()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        aria-busy={busy || undefined}
        data-testid={testId}
        className={cardClasses('max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-6')}
      >
        <h2 id={heading} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
