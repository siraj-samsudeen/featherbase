import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api, getSessionUser } from '../lib/api'
import { ShownName } from '../lib/people'
import { Card, EmptyState, Notice, ShieldLock, buttonClasses, fmtDate, fmtInstantIST } from '@featherbase/shop-floor'
import { AreasLayout, LayoutToggle, RolesLayout, SummaryLayout, reachedTables, useAccessLayout, withImplicitRoles, Actor, OpensContext, Rec, opensFrom, type RoleRow, type TableReach } from './AccessLayouts'

// #628: "What can this person see, and why". The platform's own reasons, from
// GET /api/access_explanation/:person: roles, the Tables they reach, the Data
// Scope rows that limit the person and the rows shared with them. The page
// says that access exists and why, never the data: a row shows its title only
// when the viewer can read it, else its Table and id.

interface Explanation {
  person: string
  person_name?: string | null
  apps?: { name: string; title: string; href: string }[]
  every_table: boolean
  viewer_opens?: string[]
  viewer_opens_rows?: { table: string; row_id: string }[]
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
      <h2 className="mb-2 text-base font-semibold text-ink">{title}</h2>
      {empty ? <p className="text-sm text-ink-muted" data-testid={`${testid}-empty`}>{empty}</p> : children}
    </Card>
  )
}

function By({ who, name, when, verb }: { who: string; name?: string | null; when: string; verb: string }) {
  return (
    <span className="text-ink-muted">
      {' — '}{verb} by <Actor id={who} name={name} />, {fmtInstantIST(when)}
    </span>
  )
}

export function AccessExplanation({ person }: { person: string }) {
  const me = getSessionUser()?.row_id
  const self = me === person
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
  // Empty sections get one muted line, not a card of their own (spec item 8).
  const notes = data && (data.limits.length === 0 || data.shares.length === 0) ? (
    <div className="mt-3 space-y-0.5 text-[13px] text-ink-muted">
      {data.limits.length === 0 && <p data-testid="access-limits-empty">Limited to: no row-by-row limits set by an administrator.</p>}
      {data.shares.length === 0 && <p data-testid="access-shares-empty">Shared with {them}: no rows are shared directly with {them}.</p>}
    </div>
  ) : null
  const roles = data ? withImplicitRoles(data.roles, tables) : []
  const refused = error instanceof ApiError && error.status === 403
  const missing = error instanceof ApiError && error.status === 404
  return (
    <div className="space-y-4" data-testid="access-explanation">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink" data-testid="access-explanation-heading">
            {self ? 'What you can see' : <>What {data?.person_name
              ? <OpensContext.Provider value={opensFrom(data)}><Rec table="Person" id={person}>{data.person_name}</Rec></OpensContext.Provider>
              : <ShownName id={person} />} can see</>}
          </h1>
          <p className="text-sm text-ink-muted">As of today: what access exists and why, never the data itself.</p>
        </div>
        {data && <LayoutToggle value={layout} onChange={setLayout} />}
      </div>
      {refused && (
        // Not a failure, so not a red box (spec item 9): who may open it, and the way to your own.
        <Card className="p-4" data-testid="access-explanation-refused">
          <EmptyState icon={ShieldLock} title="You can't open this page"
            body="It opens for the person themselves, System Managers, Access Auditors, and anyone whose places cover theirs."
            action={me ? <a className={buttonClasses({ variant: 'secondary' })} href={`/featherbase/account/access/${encodeURIComponent(me)}`}>See your own</a> : undefined} />
        </Card>
      )}
      {missing && <Notice tone="negative">There is no such person.</Notice>}
      {error && !refused && !missing && <Notice tone="negative">{(error as Error).message}</Notice>}
      {data && (
        <OpensContext.Provider value={opensFrom(data)}>
          {data.roles.every((r) => r.app || r.everyone) && (
            <p className="text-sm text-ink-muted" data-testid="access-roles-empty">No roles of {self ? 'your' : 'their'} own: only what every account can see{data.roles.length ? ', and the roles below' : ''}.</p>
          )}
          <div data-testid="access-tables">
            {layout === 'summary' && <SummaryLayout roles={roles} tables={tables} everyTable={data.every_table}
              limits={data.limits.length} shares={data.shares.length} self={self} notes={notes}
              apps={data.apps ?? []} placeLabels={(data.scope?.places ?? []).map((p) => p.label)}
              places={data.scope ? { title: data.scope.title, count: data.scope.places.length } : null} />}
            {layout === 'roles' && <RolesLayout roles={roles} tables={tables} everyTable={data.every_table} self={self} />}
            {layout === 'areas' && <AreasLayout tables={tables} everyTable={data.every_table} />}
          </div>
          {layout !== 'summary' && notes}
          {data.limits.length > 0 && <Section title="Limited to" testid="access-limits" empty={null}>
            <ul className="space-y-1 text-sm">
              {data.limits.map((l) => (
                <li key={`${l.table}/${l.value}`} data-testid="access-limit">
                  <span className="font-medium text-ink">{l.table}: <Rec table={l.table} id={l.value}>{l.title ?? l.value}</Rec></span>
                  <By who={l.set_by} name={l.set_by_name} when={l.set_at} verb="set" />
                </li>
              ))}
            </ul>
          </Section>}
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
          {data.shares.length > 0 && <Section title={`Shared with ${them}`} testid="access-shares" empty={null}>
            <ul className="space-y-1 text-sm">
              {data.shares.map((s) => (
                <li key={`${s.table}/${s.row_id}`} data-testid="access-share">
                  <span className="font-medium text-ink">{s.table}: <Rec table={s.table} id={s.row_id}>{s.title ?? s.row_id}</Rec></span>
                  <span className="text-ink"> ({s.write ? 'can change' : 'read only'}{s.reshare ? ', can share on' : ''})</span>
                  <By who={s.shared_by} name={s.shared_by_name} when={s.shared_at} verb="shared" />
                </li>
              ))}
            </ul>
          </Section>}
        </OpensContext.Provider>
      )}
    </div>
  )
}
