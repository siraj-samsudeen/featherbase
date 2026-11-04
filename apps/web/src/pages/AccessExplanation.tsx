import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api, getSessionUser } from '../lib/api'
import { ShownName } from '../lib/people'
import { Card, Notice, fmtInstantIST } from '@featherbase/shop-floor'

// #628: "What can this person see, and why". The platform's own reasons, from
// GET /api/access_explanation/:person: roles, the Tables they reach, the Data
// Scope rows that limit the person and the rows shared with them. The page
// says that access exists and why, never the data: a row shows its title only
// when the viewer can read it, else its Table and id.

interface TableReach { table: string; own_rows: boolean; roles: string[] }
interface Explanation {
  person: string
  every_table: boolean
  roles: { role: string; app: string | null; through: string | null; given_by: string | null; given_at: string | null }[]
  read: TableReach[]
  change: TableReach[]
  limits: { table: string; value: string; title: string | null; set_by: string; set_at: string }[]
  shares: { table: string; row_id: string; title: string | null; write: boolean; reshare: boolean; shared_by: string; shared_at: string }[]
}

/** The built-in All role is every account's: it reads as that. */
const roleName = (role: string) => (role === 'All' ? 'every account' : role)

function Section({ title, testid, empty, children }: { title: string; testid: string; empty: string | null; children: ReactNode }) {
  return (
    <Card className="p-4" data-testid={testid}>
      <h2 className="mb-2 text-sm font-semibold text-ink">{title}</h2>
      {empty ? <p className="text-sm text-ink-muted" data-testid={`${testid}-empty`}>{empty}</p> : children}
    </Card>
  )
}

function By({ who, when, verb }: { who: string; when: string; verb: string }) {
  return (
    <span className="text-ink-muted">
      {' — '}{verb} by <ShownName id={who} />, {fmtInstantIST(when)}
    </span>
  )
}

function TableList({ label, tables, testid }: { label: string; tables: TableReach[]; testid: string }) {
  return (
    <div className="mt-2" data-testid={testid}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</h3>
      {tables.length === 0 ? (
        <p className="text-sm text-ink-muted">No Tables.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {tables.map((t) => (
            <li key={t.table} data-testid={`${testid}-item`}>
              <span className="font-medium text-ink">{t.table}</span>
              {t.own_rows && <span className="text-ink"> (own rows only)</span>}
              <span className="text-ink-muted"> — through {t.roles.map(roleName).join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AccessExplanation({ person }: { person: string }) {
  const self = getSessionUser()?.row_id === person
  const { data, error } = useQuery({
    queryKey: ['access-explanation', person],
    queryFn: () => api.get<Explanation>(`/api/access_explanation/${encodeURIComponent(person)}`),
    retry: false,
  })

  const refused = error instanceof ApiError && error.status === 403
  const missing = error instanceof ApiError && error.status === 404
  return (
    <div className="space-y-4" data-testid="access-explanation">
      <div>
        <h1 className="text-lg font-semibold text-ink" data-testid="access-explanation-heading">
          {self ? 'What you can see' : <>What <ShownName id={person} /> can see</>}
        </h1>
        <p className="text-sm text-ink-muted">As of today. This page says what access exists and why; it never shows the data itself.</p>
      </div>
      {refused && (
        <div data-testid="access-explanation-refused">
          <Notice tone="negative">You can open only your own page. A System Manager can open anyone's.</Notice>
        </div>
      )}
      {missing && <Notice tone="negative">There is no such person.</Notice>}
      {error && !refused && !missing && <Notice tone="negative">{(error as Error).message}</Notice>}
      {data && (
        <>
          <Section title="Roles" testid="access-roles" empty={data.roles.length ? null : 'No roles of their own: only what every account can see.'}>
            <ul className="space-y-1 text-sm">
              {data.roles.map((r) => (
                <li key={`${r.app ?? ''}/${r.role}/${r.through ?? ''}`} data-testid="access-role">
                  <span className="font-medium text-ink">{r.role}</span>
                  {r.app
                    ? <span className="text-ink-muted"> — from app {r.app}, through {r.through}</span>
                    : r.given_by && r.given_at && <By who={r.given_by} when={r.given_at} verb="given" />}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Tables they reach" testid="access-tables" empty={null}>
            {data.every_table ? (
              <p className="text-sm text-ink" data-testid="access-every-table">Every Table, to read and to change: they are a System Manager.</p>
            ) : (
              <>
                <TableList label="Can read" tables={data.read} testid="access-read" />
                <TableList label="Can change" tables={data.change} testid="access-change" />
              </>
            )}
          </Section>
          <Section title="Limited to" testid="access-limits" empty={data.limits.length ? null : 'No Data Scope rows: no limit to particular rows.'}>
            <ul className="space-y-1 text-sm">
              {data.limits.map((l) => (
                <li key={`${l.table}/${l.value}`} data-testid="access-limit">
                  <span className="font-medium text-ink">{l.table}: {l.title ?? l.value}</span>
                  <By who={l.set_by} when={l.set_at} verb="set" />
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Shared with them" testid="access-shares" empty={data.shares.length ? null : 'No rows are shared directly with them.'}>
            <ul className="space-y-1 text-sm">
              {data.shares.map((s) => (
                <li key={`${s.table}/${s.row_id}`} data-testid="access-share">
                  <span className="font-medium text-ink">{s.table}: {s.title ?? s.row_id}</span>
                  <span className="text-ink"> ({s.write ? 'can change' : 'read only'}{s.reshare ? ', can share on' : ''})</span>
                  <By who={s.shared_by} when={s.shared_at} verb="shared" />
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  )
}
