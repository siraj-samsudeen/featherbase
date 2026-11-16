import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api, getSessionUser } from '../lib/api'
import { ActorName, ShownName } from '../lib/people'
import { Card, Notice, fmtDate, fmtInstantIST } from '@featherbase/shop-floor'
import { AreasLayout, LayoutToggle, RolesLayout, SummaryLayout, reachedTables, useAccessLayout, type RoleRow, type TableReach } from './AccessLayouts'

// #628: "What can this person see, and why". The platform's own reasons, from
// GET /api/access_explanation/:person: roles, the Tables they reach, the Data
// Scope rows that limit the person and the rows shared with them. The page
// says that access exists and why, never the data: a row shows its title only
// when the viewer can read it, else its Table and id.

interface Explanation {
  person: string
  every_table: boolean
  roles: RoleRow[]
  read: TableReach[]
  change: TableReach[]
  limits: { table: string; value: string; title: string | null; set_by: string; set_by_name?: string | null; set_at: string }[]
  shares: { table: string; row_id: string; title: string | null; write: boolean; reshare: boolean; shared_by: string; shared_by_name?: string | null; shared_at: string }[]
  scope: {
    app: string
    title: string
    problem: 'configuration' | 'provider' | 'scope' | null
    places: { label: string; reasons: { text: string; since: string | null; until: string | null }[] }[]
  } | null
}

/** Why an app gives no places, in words. */
const noPlaces = (problem: 'configuration' | 'provider' | 'scope', them: string) => ({
  configuration: 'is not set up yet, so it gives no places.',
  provider: 'could not answer, so it gives no places.',
  scope: `gives ${them} no places.`,
})[problem]

function Reason({ text, since, until }: { text: string; since: string | null; until: string | null }) {
  return (
    <span className="text-ink-muted">
      {text}{since && ` from ${fmtDate(since)}`}{until && ` until ${fmtDate(until)}`}
    </span>
  )
}

function Section({ title, testid, empty, children }: { title: string; testid: string; empty: string | null; children: ReactNode }) {
  return (
    <Card className="p-4" data-testid={testid}>
      <h2 className="mb-2 text-sm font-semibold text-ink">{title}</h2>
      {empty ? <p className="text-sm text-ink-muted" data-testid={`${testid}-empty`}>{empty}</p> : children}
    </Card>
  )
}

function By({ who, name, when, verb }: { who: string; name?: string | null; when: string; verb: string }) {
  return (
    <span className="text-ink-muted">
      {' — '}{verb} by <ActorName id={who} name={name} />, {fmtInstantIST(when)}
    </span>
  )
}

export function AccessExplanation({ person }: { person: string }) {
  const self = getSessionUser()?.row_id === person
  // #1006: on your own page, every section says "you".
  const they = self ? 'you' : 'they'
  const them = self ? 'you' : 'them'
  const [layout, setLayout] = useAccessLayout()
  const { data, error } = useQuery({
    queryKey: ['access-explanation', person],
    queryFn: () => api.get<Explanation>(`/api/access_explanation/${encodeURIComponent(person)}`),
    retry: false,
  })

  const tables = data ? reachedTables(data.read, data.change) : []
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
          <Notice tone="negative">You can't open this page. It opens for the person themselves, System Managers, Access Auditors, and anyone whose places cover theirs.</Notice>
        </div>
      )}
      {missing && <Notice tone="negative">There is no such person.</Notice>}
      {error && !refused && !missing && <Notice tone="negative">{(error as Error).message}</Notice>}
      {data && (
        <>
          <LayoutToggle value={layout} onChange={setLayout} />
          {data.roles.every((r) => r.app || r.everyone) && (
            <p className="text-sm text-ink-muted" data-testid="access-roles-empty">No roles of {self ? 'your' : 'their'} own: only what every account can see{data.roles.length ? ', and the roles below' : ''}.</p>
          )}
          <div data-testid="access-tables">
            {layout === 'summary' && <SummaryLayout roles={data.roles} tables={tables} everyTable={data.every_table}
              limits={data.limits.length} shares={data.shares.length} self={self} />}
            {layout === 'roles' && <RolesLayout roles={data.roles} tables={tables} everyTable={data.every_table} self={self} />}
            {layout === 'areas' && <AreasLayout tables={tables} everyTable={data.every_table} roles={data.roles.length} />}
          </div>
          <Section title="Limited to" testid="access-limits" empty={data.limits.length ? null : 'No Data Scope rows: no limit to particular rows.'}>
            <ul className="space-y-1 text-sm">
              {data.limits.map((l) => (
                <li key={`${l.table}/${l.value}`} data-testid="access-limit">
                  <span className="font-medium text-ink">{l.table}: {l.title ?? l.value}</span>
                  <By who={l.set_by} name={l.set_by_name} when={l.set_at} verb="set" />
                </li>
              ))}
            </ul>
          </Section>
          {data.scope && (
            <Section title={`Places from ${data.scope.title}`} testid="access-places"
              empty={data.scope.problem ? `${data.scope.title} ${noPlaces(data.scope.problem, them)}` : null}>
              <ul className="space-y-1 text-sm">
                {data.scope.places.map((p) => (
                  <li key={p.label} data-testid="access-place">
                    <span className="font-medium text-ink">{p.label}</span>
                    {' — '}
                    {p.reasons.length
                      ? p.reasons.map((r, i) => <span key={i}>{i > 0 && '; '}<Reason {...r} /></span>)
                      : <span className="text-ink-muted">no reason given by {data.scope!.title}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title={`Shared with ${them}`} testid="access-shares" empty={data.shares.length ? null : `No rows are shared directly with ${them}.`}>
            <ul className="space-y-1 text-sm">
              {data.shares.map((s) => (
                <li key={`${s.table}/${s.row_id}`} data-testid="access-share">
                  <span className="font-medium text-ink">{s.table}: {s.title ?? s.row_id}</span>
                  <span className="text-ink"> ({s.write ? 'can change' : 'read only'}{s.reshare ? ', can share on' : ''})</span>
                  <By who={s.shared_by} name={s.shared_by_name} when={s.shared_at} verb="shared" />
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  )
}
