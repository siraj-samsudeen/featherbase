// #1218 (option A): the business roles in shadow, on three pages beside Report access: Business
// Roles (each permission as a sentence, and the Title Map), Explain A Person, and Who Would Gain Or
// Lose Access. One quiet line per item, a link per name, small muted facts and a source chip (the
// Lens tab of issue_1218_relational_navigation.html). The rules are the server's.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, EmptyState, Field, Notice, Select, TextInput, fmtDate, pillClasses } from '@featherbase/shop-floor'
import { act, read } from './api'
import { LoadFailed, Loading, Shell } from './sections-page'
import { RecordLink } from './record-link'
import { PersonPicker, type Found } from './access-page'
import { PersonName, type Who } from './person-identity'

export const ROLES_ADDRESS = '?view=roles'
export const EXPLAIN_ADDRESS = '?view=explain'
export const CHANGES_ADDRESS = '?view=changes'
export const explainAddress = (person: string) => `${EXPLAIN_ADDRESS}&person=${encodeURIComponent(person)}`
export const ROLE_TABLE = 'dash.business_role'
const SHADOW_NOTE = 'Worked out beside today\'s access: nothing here changes what anyone sees until the switch-over.'

interface Part { name: string; table?: string; id?: string }
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That did not go through. Try again.')
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

/** A name, linked when it names a record. */
function Named({ part }: { part: Part }) {
  return part.table ? <RecordLink table={part.table} id={part.id}>{part.name}</RecordLink> : <>{part.name}</>
}
export function Parts({ parts }: { parts: Part[] }) {
  return <>{parts.map((part, i) => <span key={`${part.name}-${i}`}>{i ? ' · ' : ''}<Named part={part} /></span>)}</>
}

/** A small chip: where a role came from, or a permission's reach. */
export function Chip({ children, tone = 'quiet', testid }: { children: ReactNode; tone?: 'quiet' | 'hand'; testid?: string }) {
  return <span className={pillClasses(tone === 'hand' ? 'bg-caution-tint text-caution' : 'bg-subtle text-ink-muted')} data-testid={testid}>{children}</span>
}

/** One quiet line: the name, its muted facts below, and chips or actions on the right. */
function Line({ name, meta, side, testid, children }: { name: ReactNode; meta?: ReactNode; side?: ReactNode; testid?: string; children?: ReactNode }) {
  return (
    <li className="rounded-control px-2 py-1.5 hover:bg-subtle" data-testid={testid}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="text-sm">{name}</div>
          {meta && <div className="text-[13px] text-ink-muted">{meta}</div>}
        </div>
        {side && <div className="flex flex-wrap items-center gap-2">{side}</div>}
      </div>
      {children}
    </li>
  )
}

function Group({ title, count, note, testid, children }: { title: string; count?: ReactNode; note?: ReactNode; testid?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1" data-testid={testid}>
      <div className="flex flex-wrap items-baseline gap-2 px-2">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {count !== undefined && <span className="text-[13px] text-ink-muted" data-testid={testid ? `${testid}-count` : undefined}>{count}</span>}
      </div>
      {note && <p className="px-2 text-[13px] text-ink-muted">{note}</p>}
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

function useRead<T>(name: string, payload: Record<string, unknown> | null) {
  const [answer, setAnswer] = useState<T | undefined>()
  const [failed, setFailed] = useState<string | null>(null)
  const key = JSON.stringify(payload)
  const load = useCallback(() => {
    if (payload === null) return Promise.resolve()
    setFailed(null)
    return read<T>(name, payload).then(setAnswer, error => setFailed(messageOf(error)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key])
  useEffect(() => { void load() }, [load])
  return { answer, failed, load }
}

// ---------- Business Roles ----------

interface RolesAnswer {
  roles: { id: string; name: string; description: string | null; by_hand_only: boolean; permissions: { app: string; level: string; reach: string; sentence: string }[] }[]
  titles: { title: string; role: string | null; role_name: string | null; people: number; falls_back_to?: string }[]
}

export function BusinessRolesPage() {
  const { answer, failed, load } = useRead<RolesAnswer>('business_roles', {})
  const [open, setOpen] = useState<string | null>(new URLSearchParams(window.location.search).get('role'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = async () => {
    setBusy(true); setError(null)
    try { await act('add_starting_roles', {}); await load() } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }
  return (
    <Shell current="roles" testid="business-roles" title="Business Roles">
      <p className="fd-muted">{SHADOW_NOTE}</p>
      {!answer && !failed && <Loading />}
      {failed && <LoadFailed onRetry={load} />}
      {answer && answer.roles.length === 0 && (
        <Card data-testid="no-roles">
          <EmptyState title="No business roles yet" body="Start from Jeyarama's twelve roles and the Title Map for today's jobs; edit them afterwards."
            action={<Button variant="primary" loading={busy} onClick={start} data-testid="add-starting-roles">Add The Starting Roles</Button>} />
          {error && <Notice tone="negative">{error}</Notice>}
        </Card>
      )}
      {answer && answer.roles.length > 0 && (
        <>
          <Group title="Business Roles" count={answer.roles.length} testid="role-list">
            {answer.roles.map(role => (
              <Line key={role.id} testid="role-line"
                name={<RecordLink table={ROLE_TABLE} id={role.id}>{role.name}</RecordLink>}
                meta={role.description}
                side={<>
                  {role.by_hand_only && <Chip tone="hand">Given by hand only</Chip>}
                  <button type="button" className="text-[13px] font-medium text-action hover:underline" aria-expanded={open === role.id}
                    onClick={() => setOpen(open === role.id ? null : role.id)} data-testid="role-open">
                    {open === role.id ? 'Hide permissions' : plural(role.permissions.length, 'permission')}
                  </button>
                </>}>
                {open === role.id && (
                  <ul className="ml-4 mt-1 flex flex-col border-l border-border pl-3" data-testid="role-permissions">
                    {role.permissions.map((p, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-2 py-1 text-sm" data-testid="permission-line">
                        <span className="text-[13px] text-ink-muted">{p.app} · {p.level}</span>
                        <span className="min-w-0 flex-1">{p.sentence}</span>
                        <Chip testid="reach-chip">{p.reach}</Chip>
                      </li>
                    ))}
                    {role.permissions.length === 0 && <li className="py-1 text-sm text-ink-muted">No permissions yet.</li>}
                  </ul>
                )}
              </Line>
            ))}
          </Group>
          <TitleMap titles={answer.titles} roles={answer.roles} onSaved={load} />
        </>
      )}
    </Shell>
  )
}

function TitleMap({ titles, roles, onSaved }: { titles: RolesAnswer['titles']; roles: RolesAnswer['roles']; onSaved: () => Promise<unknown> }) {
  const unmapped = titles.filter(t => !t.role)
  const mapped = titles.filter(t => t.role)
  return (
    <>
      <Group title="Not Mapped Yet" count={unmapped.length} testid="unmapped-titles"
        note="Titles in use that no row maps to a business role. Nobody guesses them: map each, or correct a person by hand.">
        {unmapped.map(t => <UnmappedTitle key={t.title} title={t} roles={roles} onSaved={onSaved} />)}
        {unmapped.length === 0 && <li className="px-2 py-1.5 text-sm text-ink-muted">Every title in use is mapped.</li>}
      </Group>
      <Group title="Title Map" count={mapped.length} testid="mapped-titles" note="A person's designation is looked up first, then their job.">
        {mapped.map(t => (
          <Line key={t.title} testid="title-line" name={<>{t.title} <span className="text-ink-muted">→</span> <RecordLink table={ROLE_TABLE} id={t.role}>{t.role_name ?? 'A role no longer listed'}</RecordLink></>}
            meta={t.people ? `Held by ${plural(t.people, 'person', 'people')}` : 'Held by no one today'} />
        ))}
      </Group>
    </>
  )
}

function UnmappedTitle({ title, roles, onSaved }: { title: RolesAnswer['titles'][number]; roles: RolesAnswer['roles']; onSaved: () => Promise<unknown> }) {
  const [role, setRole] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true); setError(null)
    try { await act('map_title', { title: title.title, role }); await onSaved() } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }
  return (
    <Line testid="unmapped-line" name={<span className="font-medium">{title.title}</span>}
      meta={<>Held by {plural(title.people, 'person', 'people')}{title.falls_back_to ? ` · uses their job's role meanwhile: ${title.falls_back_to}` : ''}</>}
      side={<>
        <Select aria-label={`Business role for ${title.title}`} value={role} onChange={e => setRole(e.target.value)} data-testid="map-role">
          <option value="">Map to…</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Button variant="secondary" disabled={!role} loading={busy} onClick={save} data-testid="map-save">Map</Button>
      </>}>
      {error && <Notice tone="negative">{error}</Notice>}
    </Line>
  )
}

// ---------- Explain A Person ----------

interface Explained {
  person: string; name: string; who?: Who; employee: string | null
  roles: { role: string; name: string; source: string; from: string | null; area: { parts: Part[]; stores: number; subcategories: number | null }; until: string | null; reason: string | null; hand: string | null; hand_updated_at: string | null }[]
  unmapped: { title: string; job: string }[]
  apps: { app: string; level: string; via: string[] }[]
  reports: { key: string; name: string; why: string[] }[]
  today: { opens: boolean; reports: number; stores: number }
  next: { opens: boolean }
  decisions: { key: string; name: string }[]
  choices: { id: string; name: string }[]
}

/** "1 store, whole" or "2 stores · 14 subcategories". */
function reachWords(area: Explained['roles'][number]['area']): string {
  if (!area.stores) return 'Reaches no store'
  return `${plural(area.stores, 'store')}${area.subcategories === null ? ', whole' : ` · ${plural(area.subcategories, 'subcategory', 'subcategories')}`}`
}

export function ExplainPersonPage() {
  const person = new URLSearchParams(window.location.search).get('person')
  const { answer, failed, load } = useRead<Explained>('explain_person', person ? { person } : null)
  const choose = (found: Found | null) => { if (found) window.location.search = explainAddress(found.person).slice(1) }
  return (
    <Shell current="explain" testid="explain-person" title={answer ? <>Explain <PersonLink answer={answer} /></> : 'Explain A Person'}>
      <PersonPicker chosen={null} onChoose={choose} label="Find a person" />
      {!person && <p className="fd-muted">Choose someone to see their business roles, the apps they would open and the reports they would get. {SHADOW_NOTE}</p>}
      {person && !answer && !failed && <Loading />}
      {failed && <Card><EmptyState title="This person couldn't be explained" body={failed} action={<Button onClick={load}>Try again</Button>} /></Card>}
      {answer && <Explanation answer={answer} onChanged={load} />}
    </Shell>
  )
}

function PersonLink({ answer }: { answer: Explained }) {
  return answer.employee ? <RecordLink table="Employee" id={answer.employee}>{answer.name}</RecordLink> : <>{answer.name}</>
}

function Explanation({ answer, onChanged }: { answer: Explained; onChanged: () => Promise<unknown> }) {
  const [form, setForm] = useState<'Correct' | 'Also give' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const remove = async (role: Explained['roles'][number]) => {
    setError(null)
    try { await act('remove_role', { id: role.hand, updated_at: role.hand_updated_at }); await onChanged() } catch (e) { setError(messageOf(e)) }
  }
  const sameAsToday = answer.today.opens === answer.next.opens && answer.today.reports === answer.reports.length
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-muted" data-testid="explain-who"><PersonName name={answer.name} who={answer.who} /></p>
      <p className="text-[13px] text-ink-muted" data-testid="explain-today">
        Today: {answer.today.opens ? 'Dash opens' : 'Dash does not open'} · {plural(answer.today.reports, 'report')} · {plural(answer.today.stores, 'store')}.
        {' '}{sameAsToday ? 'The new model gives the same.' : <>The new model differs: <a className="font-medium text-action hover:underline" href={CHANGES_ADDRESS}>see who would gain or lose access</a>.</>}
      </p>
      {error && <Notice tone="negative">{error}</Notice>}
      <Group title="Business Roles" count={answer.roles.length} testid="explain-roles">
        {answer.roles.map((role, i) => (
          <Line key={`${role.role}-${i}`} testid="explain-role"
            name={<><RecordLink table={ROLE_TABLE} id={role.role}>{role.name}</RecordLink><span className="text-ink-muted"> · </span><span data-testid="role-area"><Parts parts={role.area.parts} /></span></>}
            meta={[reachWords(role.area), role.from ? `HR title "${role.from}"` : null, role.until ? `until ${fmtDate(role.until)}` : null, role.reason].filter(Boolean).join(' · ')}
            side={<>
              <Chip tone={role.hand ? 'hand' : 'quiet'} testid="source-chip">{role.source}</Chip>
              {role.hand && <button type="button" className="text-[13px] font-medium text-action hover:underline" onClick={() => remove(role)} data-testid="remove-role">Remove</button>}
            </>} />
        ))}
        {answer.unmapped.map(t => (
          <Line key={t.title} testid="explain-unmapped" name={<span className="text-ink-muted">HR title "{t.title}"</span>}
            meta={<>Not mapped yet: <a className="font-medium text-action hover:underline" href={ROLES_ADDRESS}>map it on Business Roles</a>, or correct this person.</>} />
        ))}
        {answer.roles.length === 0 && answer.unmapped.length === 0 && <li className="px-2 py-1.5 text-sm text-ink-muted">No business role: no current job, merchandise assignment or hand change.</li>}
        <li className="flex flex-wrap gap-3 px-2 pt-2">
          <Button variant="secondary" onClick={() => setForm('Correct')} data-testid="correct-button">Correct</Button>
          <Button variant="secondary" onClick={() => setForm('Also give')} data-testid="also-give-button">Also Give</Button>
        </li>
        {form && <HandForm change={form} person={answer.person} choices={answer.choices} onDone={async () => { setForm(null); await onChanged() }} onCancel={() => setForm(null)} />}
      </Group>
      <Group title="Apps They Would Open" count={answer.apps.length} testid="explain-apps">
        {answer.apps.map(app => (
          <Line key={`${app.app}-${app.level}`} testid="explain-app" name={<span className="font-medium">{app.app} · {app.level}</span>}
            side={<Chip>via {app.via.join(', ')}</Chip>} />
        ))}
        {answer.apps.length === 0 && <li className="px-2 py-1.5 text-sm text-ink-muted">No app.</li>}
      </Group>
      <Group title="Reports They Would Get" count={answer.reports.length} testid="explain-reports">
        {answer.reports.map(report => (
          <Line key={report.key} testid="explain-report" name={<RecordLink table="dash.report" id={report.key}>{report.name}</RecordLink>}
            meta={<span data-testid="why-line">Why: {report.why.join('; ')}</span>} />
        ))}
        {answer.reports.length === 0 && <li className="px-2 py-1.5 text-sm text-ink-muted">No report.</li>}
      </Group>
      {answer.decisions.length > 0 && (
        <Group title="Needs A Decision" count={answer.decisions.length} testid="explain-decisions"
          note="Given today only through a role such as Dash Reader. The new model gives reports to business roles, so someone decides which roles get these.">
          {answer.decisions.map(report => <Line key={report.key} testid="explain-decision" name={<RecordLink table="dash.report" id={report.key}>{report.name}</RecordLink>} />)}
        </Group>
      )}
    </div>
  )
}

function HandForm({ change, person, choices, onDone, onCancel }: { change: 'Correct' | 'Also give'; person: string; choices: Explained['choices']; onDone: () => Promise<void>; onCancel: () => void }) {
  const [role, setRole] = useState('')
  const [ends, setEnds] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true); setError(null)
    try { await act('give_role', { person, change, role, ends_on: ends || null, reason }); await onDone() } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }
  return (
    <li className="mx-2 mt-2 flex flex-col gap-3 rounded-control bg-subtle p-3" data-testid="hand-form">
      <p className="text-sm">{change === 'Correct' ? 'Correct replaces the role their HR title gives, until someone removes it.' : 'Also give adds a role, at the place of their job.'}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Business role" className="min-w-48">
          <Select value={role} onChange={e => setRole(e.target.value)} data-testid="hand-role">
            <option value="">Choose a role</option>
            {choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Ends on (optional)">
          <TextInput type="date" value={ends} onChange={e => setEnds(e.target.value)} data-testid="hand-ends" />
        </Field>
        <Field label="Reason" className="min-w-56 flex-1">
          <TextInput value={reason} onChange={e => setReason(e.target.value)} placeholder="Why, in a few words" data-testid="hand-reason" />
        </Field>
      </div>
      {error && <Notice tone="negative">{error}</Notice>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!role} loading={busy} onClick={save} data-testid="hand-save">{change === 'Correct' ? 'Correct' : 'Also Give'}</Button>
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
    </li>
  )
}

// ---------- Who Would Gain Or Lose Access ----------

interface Changed {
  person: string; name: string; who: Who | null; kind: Kind; roles: string[]
  stores_gained: Part[]; stores_lost: Part[]; stores_changed: Part[]; gained: Part[]; lost: Part[]; decisions: Part[]
}
type Kind = 'loses_dash' | 'gains_dash' | 'stores' | 'reports' | 'decision'
interface ChangesAnswer { people: number; groups: { kind: Kind; people: Changed[] }[] }
const GROUP_TITLES: Record<Kind, string> = {
  loses_dash: 'Would Lose Dash', gains_dash: 'Would Gain Dash', stores: 'Different Stores', reports: 'Different Reports', decision: 'Needs A Decision',
}
const GROUP_NOTES: Partial<Record<Kind, string>> = {
  stores: 'Dash opens either way, but reaches other stores or other subcategories.',
  decision: 'Their only difference: reports given today through a role such as Dash Reader. The owner decides which business roles get them.',
}
const SHOWN = 10

export function AccessChangesPage() {
  const { answer, failed, load } = useRead<ChangesAnswer>('access_changes', {})
  const changed = answer ? answer.groups.reduce((n, g) => n + g.people.length, 0) : 0
  return (
    <Shell current="changes" testid="access-changes" title="Who Would Gain Or Lose Access">
      <p className="fd-muted">{SHADOW_NOTE}</p>
      {!answer && !failed && <Loading />}
      {failed && <LoadFailed onRetry={load} />}
      {answer && (
        <>
          <p className="text-sm" data-testid="changes-summary">
            {changed === 0 ? `All ${plural(answer.people, 'current person', 'current people')} would keep exactly what they have.`
              : `${plural(changed, 'person', 'people')} of ${answer.people.toLocaleString('en-IN')} would see something different. Everyone else keeps exactly what they have.`}
          </p>
          <ul className="flex flex-wrap gap-2" data-testid="changes-counts">
            {answer.groups.map(g => (
              <li key={g.kind}><a href={`#${g.kind}`} className={pillClasses('bg-subtle text-ink')}>{GROUP_TITLES[g.kind]} · {g.people.length.toLocaleString('en-IN')}</a></li>
            ))}
          </ul>
          {answer.groups.filter(g => g.people.length).map(g => <ChangeGroup key={g.kind} kind={g.kind} people={g.people} />)}
        </>
      )}
    </Shell>
  )
}

function ChangeGroup({ kind, people }: { kind: Kind; people: Changed[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? people : people.slice(0, SHOWN)
  return (
    <div id={kind}>
      <Group title={GROUP_TITLES[kind]} count={people.length.toLocaleString('en-IN')} note={GROUP_NOTES[kind]} testid={`group-${kind}`}>
        {shown.map(p => (
          <Line key={p.person} testid="changed-person"
            name={<a href={explainAddress(p.person)} className="font-medium text-action hover:underline" data-testid="changed-name">{p.name}</a>}
            meta={<Facts person={p} />}
            side={p.roles.length ? <Chip>{p.roles.join(', ')}</Chip> : <Chip>No business role</Chip>} />
        ))}
        {people.length > SHOWN && !all && <li className="px-2"><button type="button" className="text-[13px] font-medium text-action hover:underline" onClick={() => setAll(true)}>Show all {people.length.toLocaleString('en-IN')}</button></li>}
      </Group>
    </div>
  )
}

function Facts({ person }: { person: Changed }) {
  const facts: ReactNode[] = []
  const list = (label: string, parts: Part[]) => { if (parts.length) facts.push(<span key={label}>{label} <Parts parts={parts} /></span>) }
  list('Would reach', person.stores_gained)
  list('Would stop reaching', person.stores_lost)
  list('Other subcategories at', person.stores_changed)
  list('Would get', person.gained)
  list('Would lose', person.lost)
  list('Needs a decision:', person.decisions)
  const detail = person.who ? [person.who.code, ...(person.who.jobs ?? [])].filter(Boolean).join(' · ') : ''
  return <>{detail && <span>{detail}</span>}{facts.map((f, i) => <span key={i}>{detail || i ? ' · ' : ''}{f}</span>)}</>
}
