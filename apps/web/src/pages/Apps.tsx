import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tableHref } from 'shared'
import { api } from '../lib/api'
import { Button, Card, EmptyState, Notice, Skeleton, StatusPill, buttonClasses, cx, fmtInstant } from '@featherbase/shop-floor'

interface CatalogApp {
  name: string
  title: string
  version: string
  platformVersion: string
  installed: boolean
  preparation: { state: 'needed' | 'preparing' | 'ready' | 'failed' | 'unavailable'; error?: string }
  declarations: {
    tables: { name: string; label: string }[]
    permissions: { table: string; role: string; scope_mode?: 'all' | 'creator'; operations: Record<string, string[] | string | true> }[]
    roles: string[]
    settings: { name: string; required: boolean }[]
    roleDefaults?: Record<string, string[]>
    datasets?: { name: string; source: string }[]
    // #1132: version 1 names its actions and the Tables they write; version 2 declares operations.
    actions?: { version: 1; names: string[]; tables: string[] } | { version: 2; operations: Record<string, unknown> }
    reads?: { operations: Record<string, unknown> }
    jobs?: { name: string }[]
    scopeProvider?: { name: string; identifiers?: string[] }
    frameOrigins?: string[]
  }
  secrets: { name: string; optional: boolean; present: boolean }[]
  releaseNotes: { version: string; changes: string[] }[]
}

// #938: what this instance runs, from the server's build (null = unknown).
interface BuildInfo {
  commit: string | null
  message: string | null
  repositoryUrl: string | null
  commitUrl: string | null
  historyUrl: string | null
  startedAt: string
}

const linkClasses = 'font-medium text-action hover:underline'

/** Text with each issue reference (a hash and its number) linked to that issue, when the repository is known. */
function WithIssueLinks({ text, repositoryUrl }: { text: string; repositoryUrl: string | null }) {
  if (!repositoryUrl) return <>{text}</>
  return <>{text.split(/(#\d+)/).map((part, i) => /^#\d+$/.test(part)
    ? <a key={i} href={`${repositoryUrl}/issues/${part.slice(1)}`} target="_blank" rel="noreferrer" className={linkClasses}>{part}</a>
    : part)}</>
}

/** A merge commit says what it merged on its next line: show that, and the PR. */
function commitTitle(message: string): string {
  const lines = message.split('\n').map(line => line.trim()).filter(Boolean)
  const merged = /^Merge pull request (#\d+)/.exec(lines[0])
  return merged && lines[1] ? `${lines[1]} (${merged[1]})` : lines[0]
}

function ThisBuild({ build }: { build: BuildInfo }) {
  return (
    <Card className="p-4">
      <section aria-labelledby="this-build" className="space-y-1 text-sm">
        <h2 id="this-build" className="font-semibold text-ink">This build</h2>
        <p className="text-ink-muted">Commit{' '}
          {build.commit
            ? build.commitUrl
              ? <a href={build.commitUrl} target="_blank" rel="noreferrer" className={cx(linkClasses, 'font-mono')}>{build.commit.slice(0, 7)}</a>
              : <span className="font-mono text-ink">{build.commit.slice(0, 7)}</span>
            : <span className="text-ink">unknown: this server was not told which commit it was built from</span>}
          {build.message && <> · <span className="text-ink"><WithIssueLinks text={commitTitle(build.message)} repositoryUrl={build.repositoryUrl} /></span></>}
        </p>
        <p className="text-ink-muted">Running since {fmtInstant(build.startedAt)}
          {build.historyUrl && <> · <a href={build.historyUrl} target="_blank" rel="noreferrer" className={linkClasses}>Changes up to this build</a></>}
        </p>
      </section>
    </Card>
  )
}

const GRANTS = [
  ['read', 'read'], ['update', 'edit'], ['create', 'create'],
  ['delete', 'delete'], ['submit', 'submit'], ['cancel', 'cancel'], ['amend', 'amend'],
] as const

/** One declared grant in words: each operation, and which Columns it reaches
 *  when it is not every basic-level one. */
function describeGrant(operations: Record<string, string[] | string | true>): string {
  return GRANTS.filter(([key]) => operations[key] !== undefined).map(([key, label]) => {
    const selection = operations[key]
    if (selection === '*') return `${label} (every column)`
    return Array.isArray(selection) ? `${label} (${selection.join(', ')})` : label
  }).join(', ')
}

function configurationPath(table: string, app: string) {
  return `${tableHref(table)}?filters=${encodeURIComponent(JSON.stringify([['app', '=', app]]))}`
}

function AppDetails({ app, repositoryUrl }: { app: CatalogApp; repositoryUrl: string | null }) {
  const client = useQueryClient()
  const { tables, permissions, roles, settings, roleDefaults, datasets, actions, reads, jobs, scopeProvider, frameOrigins } = app.declarations
  const install = useMutation({
    mutationFn: () => api.post(app.preparation.state === 'ready' ? '/api/install_app' : '/api/apps/prepare-install', { name: app.name }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['apps'] }),
        client.invalidateQueries({ queryKey: ['app-catalog'] }),
        client.invalidateQueries({ queryKey: ['whoami'] }),
        client.invalidateQueries({ queryKey: ['instance-health'] }),
      ])
    },
    onError: () => { void client.invalidateQueries({ queryKey: ['apps'] }) },
  })
  const needsPreparation = app.preparation.state !== 'ready'
  const busy = install.isPending || app.preparation.state === 'preparing'
  const error = install.error?.message ?? app.preparation.error
  const broadGrants = permissions.some(p => p.role === 'All' && GRANTS.some(([key]) => p.operations[key] !== undefined))
  return (
    <Card className="min-w-0 space-y-6 p-5" aria-label={`${app.title} details`}>
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">{app.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">Version {app.version} · Requires platform {app.platformVersion}</p>
          </div>
          <StatusPill tone={app.installed ? 'positive' : 'neutral'}>{app.installed ? 'Installed' : 'Not installed'}</StatusPill>
        </div>
        {app.installed ? (
          app.preparation.state === 'unavailable'
            ? <Notice tone="caution">Installed on this instance, but its runtime package is unavailable. Ask the operator to restore the installed package.</Notice>
            : <Notice tone="positive">Installed on this instance. Review the setup below before using the app.</Notice>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">{needsPreparation
              ? 'Needs preparation. Preparing runs this trusted package’s build code on the server, then installs it on this instance.'
              : 'Ready to install. Nothing is installed until you choose to install it on this instance.'}</p>
            <Button variant="primary" loading={busy} onClick={() => install.mutate()}>
              {busy ? (needsPreparation ? 'Preparing and installing…' : 'Installing…') : (needsPreparation ? 'Prepare and install' : 'Install app')}
            </Button>
            {busy && <p role="status" className="text-sm text-ink-muted">{needsPreparation ? 'Preparing the package, then installing. This may take a few minutes. Keep this page open.' : 'Installing the app on this instance…'}</p>}
            {error && !busy && <Notice tone="negative"><p>{error}</p><p className="mt-1">Ask the operator to check the package and server logs, then try again.</p></Notice>}
          </div>
        )}
      </header>

      {app.releaseNotes.length > 0 && <section aria-labelledby="app-release-notes">
        <h3 id="app-release-notes" className="font-semibold text-ink">What's new</h3>
        <div className="mt-2 space-y-3 text-sm">
          {app.releaseNotes.slice(0, 3).map(note => <div key={note.version}>
            <h4 className="font-medium text-ink">{note.version}</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">
              {note.changes.map((change, i) => <li key={i}><WithIssueLinks text={change} repositoryUrl={repositoryUrl} /></li>)}
            </ul>
          </div>)}
        </div>
      </section>}

      <section aria-labelledby="app-additions">
        <h3 id="app-additions" className="font-semibold text-ink">What it adds</h3>
        <p className="mt-1 text-sm text-ink-muted">{tables.length} {tables.length === 1 ? 'Table' : 'Tables'}</p>
        <ul className="mt-2 flex flex-wrap gap-2 text-sm text-ink">
          {tables.map(table => <li key={table.name} className="rounded-control bg-subtle px-2 py-1">{table.label}</li>)}
        </ul>
        <dl className="mt-3 space-y-2 text-sm text-ink-muted">
          {actions && <div><dt className="font-medium text-ink">Actions</dt><dd>{(actions.version === 1 ? actions.names : Object.keys(actions.operations)).join(', ') || 'None'}</dd></div>}
          {actions?.version === 1 && <div><dt className="font-medium text-ink">Action Tables</dt><dd>{actions.tables.join(', ')}</dd></div>}
          {reads && <div><dt className="font-medium text-ink">Reads</dt><dd>{Object.keys(reads.operations).join(', ')}</dd></div>}
          {!!datasets?.length && <div><dt className="font-medium text-ink">Datasets and required data sources</dt><dd>{datasets.map(dataset => `${dataset.name} (source: ${dataset.source})`).join(', ')}</dd></div>}
          {!!jobs?.length && <div><dt className="font-medium text-ink">Scheduled jobs</dt><dd>{jobs.map(job => job.name).join(', ')}</dd></div>}
          {scopeProvider && <div><dt className="font-medium text-ink">Scope provider</dt><dd>{scopeProvider.name}{scopeProvider.identifiers?.length ? ` · Requires identifier systems: ${scopeProvider.identifiers.join(', ')}` : ''}</dd></div>}
          {!!frameOrigins?.length && <div><dt className="font-medium text-ink">Embedded sites</dt><dd>{frameOrigins.join(', ')}</dd></div>}
        </dl>
      </section>

      <section aria-labelledby="app-permissions" className="space-y-2">
        <h3 id="app-permissions" className="font-semibold text-ink">Permissions</h3>
        {broadGrants && <Notice tone="caution">This app grants access to the All role. These grants apply to everyone with that role, not just people assigned an app role. Review them before installing.</Notice>}
        {permissions.length === 0 ? <p className="text-sm text-ink-muted">No Table permissions declared.</p> : (
          <details className="text-sm text-ink">
            <summary className="cursor-pointer py-2 font-medium">View {permissions.length} permission grants</summary>
            <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink-muted"><tr><th className="py-2 pr-3 font-medium">Table</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 font-medium">Access</th></tr></thead>
              <tbody className="divide-y divide-border text-ink">{permissions.map((permission, i) => (
                <tr key={i}>
                  <td className="py-2 pr-3">{tables.find(t => t.name === permission.table)?.label ?? permission.table}</td>
                  <td className="py-2 pr-3">{permission.role}</td>
                  <td className="py-2">{describeGrant(permission.operations)}{permission.scope_mode === 'creator' ? ' · Own rows only' : ''}</td>
                </tr>
              ))}</tbody>
            </table>
            </div>
          </details>
        )}
      </section>

      <section aria-labelledby="app-setup" className="space-y-4">
        <div>
          <h3 id="app-setup" className="font-semibold text-ink">Instance setup</h3>
          <p className="mt-1 text-sm text-ink-muted">The packaged declarations are read-only. Configure this instance after installation; values managed by its settings file stay locked in the forms.</p>
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-ink">Settings</h4>
          {settings.length === 0 ? <p className="text-sm text-ink-muted">No settings declared.</p> : <ul className="space-y-1 text-sm text-ink">{settings.map(setting => <li key={setting.name}><code>{setting.name}</code> · {setting.required ? 'Required' : 'Optional'}</li>)}</ul>}
          {app.installed && <a className={buttonClasses({ variant: 'secondary' })} href={configurationPath('App Setting', app.name)}>Configure settings</a>}
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-ink">Roles</h4>
          <p className="text-sm text-ink-muted">{roles.length ? roles.join(', ') : 'No app roles declared.'}</p>
          {!!roleDefaults && Object.entries(roleDefaults).map(([role, bound]) => <p key={role} className="text-sm text-ink-muted">Default mapping: {role} → {bound.join(', ')}</p>)}
          {app.installed && <a className={buttonClasses({ variant: 'secondary' })} href={configurationPath('App Role Binding', app.name)}>Configure role mappings</a>}
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-ink">Secrets</h4>
          {app.secrets.length === 0 ? <p className="text-sm text-ink-muted">No secrets declared.</p> : <>
            <ul className="space-y-1 text-sm text-ink">{app.secrets.map(secret => <li key={secret.name}><code>{secret.name}</code> · {secret.optional ? 'Optional' : 'Required'} · <span className={secret.present ? 'text-positive' : 'text-caution'}>{secret.present ? 'Present' : 'Missing'}</span></li>)}</ul>
            <p className="text-sm text-ink-muted">Ask the operator to supply missing secrets through the host environment. Secret values are never shown here.</p>
          </>}
        </div>
      </section>
      <details className="text-sm text-ink-muted">
        <summary className="cursor-pointer py-2 font-medium">Technical declarations (read-only)</summary>
        <pre className="max-h-80 overflow-auto rounded-control bg-subtle p-3 text-xs">{JSON.stringify(app.declarations, null, 2)}</pre>
      </details>
    </Card>
  )
}

export function Apps() {
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const apps = useQuery({
    queryKey: ['apps'],
    queryFn: () => api.get<{ catalog: CatalogApp[]; build: BuildInfo }>('/api/apps'),
    refetchInterval: query => query.state.data?.catalog.some(app => app.preparation.state === 'preparing') ? 2000 : false,
  })
  const catalog = apps.data?.catalog ?? []
  const selected = catalog.find(app => app.name === selectedName) ?? catalog[0]
  return (
    <div className="space-y-4" data-testid="apps-page">
      <header><h1 className="text-lg font-semibold text-ink">Apps</h1><p className="mt-1 text-sm text-ink-muted">Inspect what an app adds and needs, then choose what to install on this instance.</p></header>
      {apps.data?.build && <ThisBuild build={apps.data.build} />}
      {apps.isPending && <Skeleton label="Loading available apps" />}
      {apps.isError && <Notice tone="negative"><p>Available apps could not be loaded. {apps.error.message}</p><Button variant="secondary" className="mt-2" onClick={() => void apps.refetch()}>Try again</Button></Notice>}
      {apps.isSuccess && catalog.length === 0 && <Card><EmptyState title="No apps available" body="Ask the operator to supply a trusted app package on this server. Discovering a package does not install it." /></Card>}
      {selected && <div className="grid items-start gap-4 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <Card className="overflow-hidden p-2">
          <nav aria-label="Available apps" className="space-y-1">{catalog.map(app => <button
            key={app.name}
            type="button"
            aria-current={app.name === selected.name ? 'true' : undefined}
            onClick={() => setSelectedName(app.name)}
            className={cx('w-full rounded-control border p-3 text-left focus-visible:outline-2 focus-visible:outline-focus', app.name === selected.name ? 'border-action bg-action-tint' : 'border-transparent hover:bg-subtle')}
          >
            <span className="block font-semibold text-ink">{app.title}</span>
            <span className="mt-1 block text-xs text-ink-muted">{app.installed ? 'Installed' : app.preparation.state === 'preparing' ? 'Preparing and installing…' : app.preparation.state === 'failed' ? 'Not installed · Preparation failed' : app.preparation.state === 'needed' ? 'Not installed · Needs preparation' : 'Not installed · Ready to install'}</span>
          </button>)}</nav>
        </Card>
        <AppDetails key={selected.name} app={selected} repositoryUrl={apps.data?.build.repositoryUrl ?? null} />
      </div>}
    </div>
  )
}
