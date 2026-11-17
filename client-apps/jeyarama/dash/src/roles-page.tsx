// #1218 (option A): the business roles in shadow, on three pages beside Report access: Business
// Roles (each role's permissions as a grid of reach chips, and the Title Map), Explain A Person (the
// Lens tab of issue_1218_relational_navigation.html: header chips, fields beside links, a source chip
// and a Why? per item) and Who Would Gain Or Lose Access. The rules are the server's.
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, EmptyState, Field, Notice, Select, TextInput, fmtDate, pillClasses } from '@featherbase/shop-floor'
import { act, read } from './api'
import { LoadFailed, Loading, Shell } from './sections-page'
import { RecordLink } from './record-link'
import { PersonPicker, type Found } from './access-page'
import { type Who } from './person-identity'

export const ROLES_ADDRESS = '?view=roles'
export const EXPLAIN_ADDRESS = '?view=explain'
export const CHANGES_ADDRESS = '?view=changes'
export const explainAddress = (person: string) => `${EXPLAIN_ADDRESS}&person=${encodeURIComponent(person)}`
export const ROLE_TABLE = 'dash.business_role'
const SHADOW_NOTE = 'Worked out beside today\'s access: nothing here changes what anyone sees until the switch-over.'
const REFUSED = 'Only a Report Access Manager or System Manager can see this'

interface Part { name: string; table?: string; id?: string; code?: string }
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That did not go through. Try again.')
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
const linkClasses = 'text-[13px] font-medium text-action hover:underline'

/** A name, linked when it names a record; a staff code stays muted after the link, never inside it. */
function Named({ part }: { part: Part }) {
  const name = part.table ? <RecordLink table={part.table} id={part.id}>{part.name}</RecordLink> : <>{part.name}</>
  return part.code ? <>{name} <span className="text-ink-muted">{part.code}</span></> : name
}
export function Parts({ parts }: { parts: Part[] }) {
  return <>{parts.map((part, i) => <span key={`${part.name}-${i}`}>{i ? ' · ' : ''}<Named part={part} /></span>)}</>
}

/** The four reach words, each its own colour from the tokens, as the roles map draws them. */
const REACH_TONE: Record<string, string> = {
  Own: 'bg-subtle text-ink-muted', Team: 'bg-action-tint text-action', Area: 'bg-positive-tint text-positive', All: 'bg-negative-tint text-negative',
}
export function ReachChip({ reach }: { reach: string }) {
  return <span className={pillClasses(`font-mono ${REACH_TONE[reach] ?? REACH_TONE.Own}`)} data-testid="reach-chip" data-reach={reach}>{reach}</span>
}

/** A small chip: where a role came from (action tint; by hand in the caution tint), or a quiet fact. */
export function Chip({ children, tone = 'quiet', testid }: { children: ReactNode; tone?: 'quiet' | 'source' | 'hand'; testid?: string }) {
  const colour = tone === 'hand' ? 'bg-caution-tint text-caution' : tone === 'source' ? 'bg-action-tint text-action' : 'bg-subtle text-ink-muted'
  return <span className={pillClasses(colour)} data-testid={testid} data-tone={tone}>{children}</span>
}

/** #1267's words for whoIs()'s standing: a description only, never what grants access. */
export const STAFF_BADGE = { current: 'Employee', left: 'Former Employee', none: 'External' } as const
export function StaffBadge({ who }: { who: Who | null | undefined }) {
  return <Chip testid="staff-badge">{STAFF_BADGE[who?.staff ?? 'none']}</Chip>
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

/** A failed read: refused (said plainly), or a failure to retry. */
function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  if (message.startsWith('Only a Report Access Manager')) return <Card data-testid="refused"><EmptyState title={REFUSED} body="Ask a System Manager if you need it." /></Card>
  return <LoadFailed onRetry={onRetry} />
}

// ---------- Business Roles ----------

interface Permission { app: string; level: string; verb: string; thing: string; reach: string; sentence: string }
interface RolesAnswer {
  roles: { id: string; name: string; description: string | null; by_hand_only: boolean; reaches: string; permissions: Permission[] }[]
  titles: { title: string; role: string | null; role_name: string | null; people: number; falls_back_to?: string; holders: { person: string; name: string }[] }[]
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
    <Shell current="roles" testid="business-roles" title="Business Roles" wide>
      <p className="fd-muted">{SHADOW_NOTE}</p>
      {!answer && !failed && <Loading />}
      {failed && <Failed message={failed} onRetry={load} />}
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
                meta={<><span data-testid="role-reaches">Reaches: {role.reaches}</span>{role.description ? ` · ${role.description}` : ''}</>}
                side={<>
                  {role.by_hand_only && <Chip tone="hand">Given by hand only</Chip>}
                  <button type="button" className={linkClasses} aria-expanded={open === role.id}
                    onClick={() => setOpen(open === role.id ? null : role.id)} data-testid="role-open">
                    {open === role.id ? 'Hide what it can do' : 'What it can do'}
                  </button>
                </>}>
                {open === role.id && <PermissionGrid role={role.name} permissions={role.permissions} />}
              </Line>
            ))}
          </Group>
          <TitleMap titles={answer.titles} roles={answer.roles} onSaved={load} />
        </>
      )}
    </Shell>
  )
}

const CRUD = ['View', 'Add', 'Edit', 'Delete'] as const
/** The roles map's grid: each app's things as rows, View / Add / Edit / Delete as columns, a reach chip in each cell; other verbs on the row. */
function PermissionGrid({ role, permissions }: { role: string; permissions: Permission[] }) {
  if (!permissions.length) return <p className="ml-4 mt-1 text-sm text-ink-muted">No permissions yet.</p>
  const apps = [...new Set(permissions.map(p => p.app))]
  const th = 'px-2 py-1.5 text-start font-mono text-[11px] font-medium uppercase text-ink-muted'
  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="role-permissions">
      <ul className="ml-2 flex flex-col text-[13px] text-ink-muted" data-testid="permission-sentences">
        {permissions.map((p, i) => <li key={i} data-testid="permission-line">{p.sentence}</li>)}
      </ul>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm" data-testid="permission-grid" aria-label={`What ${role} can do`}>
          <thead><tr><th className={th}>Thing</th>{CRUD.map(v => <th key={v} className={th}>{v}</th>)}<th className={th}>Other</th></tr></thead>
          <tbody>
            {apps.map(app => (
              <Fragment key={app}>
                <tr><td colSpan={6} className="px-2 pt-2 font-semibold text-ink">{app}</td></tr>
                {[...new Set(permissions.filter(p => p.app === app).map(p => p.thing))].map(thing => {
                  const here = permissions.filter(p => p.app === app && p.thing === thing)
                  return (
                    <tr key={thing} data-testid="grid-row">
                      <td className="px-2 py-1">{thing} <span className="text-[12px] text-ink-muted">{[...new Set(here.map(p => p.level))].join(', ')}</span></td>
                      {CRUD.map(verb => {
                        const p = here.find(x => x.verb === verb)
                        return <td key={verb} className="px-2 py-1" data-testid={`cell-${verb}`}>{p ? <ReachChip reach={p.reach} /> : <span className="text-ink-muted">—</span>}</td>
                      })}
                      <td className="px-2 py-1">
                        <span className="inline-flex flex-wrap gap-1">{here.filter(p => !(CRUD as readonly string[]).includes(p.verb)).map(p => (
                          <span key={p.verb} className="inline-flex items-center gap-1"><span className={pillClasses('bg-subtle text-ink')}>{p.verb}</span><ReachChip reach={p.reach} /></span>))}</span>
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
            meta={<Holders title={t} />} />
        ))}
      </Group>
    </>
  )
}

/** "Held by 3 people", opening the list of them, each a link to Explain A Person. */
function Holders({ title }: { title: RolesAnswer['titles'][number] }) {
  const [open, setOpen] = useState(false)
  if (!title.people) return <>Held by no one today</>
  return (
    <>
      <button type="button" className={linkClasses} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="holders-toggle">Held by {plural(title.people, 'person', 'people')}</button>
      {open && (
        <span className="block" data-testid="holders">
          {title.holders.map((h, i) => <span key={h.person}>{i ? ', ' : ''}<a className="text-action hover:underline" href={explainAddress(h.person)}>{h.name}</a></span>)}
          {title.people > title.holders.length && ` and ${(title.people - title.holders.length).toLocaleString('en-IN')} more`}
        </span>
      )}
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
      meta={<><Holders title={title} />{title.falls_back_to ? ` · uses their job's role meanwhile: ${title.falls_back_to}` : ''}</>}
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

type Kind = 'loses_dash' | 'gains_dash' | 'stores' | 'reports' | 'decision'
interface Change { kinds: Kind[]; stores_gained: Part[]; stores_lost: Part[]; stores_changed: Part[]; gained: Part[]; lost: Part[]; decisions: Part[] }
interface Explained {
  person: string; name: string; who?: Who; employee: string | null
  header: { employee: Part[]; sites: Part[]; reports_to: Part[] }
  hr_titles: string[]
  roles: { role: string; name: string; source: string; from: string | null; area: { parts: Part[]; stores: number; subcategories: number | null }; until: string | null; reason: string | null; hand: string | null; hand_updated_at: string | null }[]
  unmapped: { title: string; job: string }[]
  apps: { app: string; level: string; via: string[] }[]
  reports: { key: string; name: string; why: string[] }[]
  today: { opens: boolean; reports: number; stores: number }
  next: { opens: boolean; reports: number; stores: number }
  change: Change
  choices: { id: string; name: string }[]
  places: { stores: { id: string; name: string }[]; default: string | null }
}

/** "1 store, whole" or "2 stores · 14 subcategories". */
function reachWords(area: Explained['roles'][number]['area']): string {
  if (!area.stores) return 'Reaches no store'
  return `${plural(area.stores, 'store')}${area.subcategories === null ? ', whole' : ` · ${plural(area.subcategories, 'subcategory', 'subcategories')}`}`
}
const accessWords = (side: Explained['today']) => `${side.opens ? 'Dash opens' : 'Dash does not open'} · ${plural(side.reports, 'report')} · ${plural(side.stores, 'store')}`

export function ExplainPersonPage() {
  const person = new URLSearchParams(window.location.search).get('person')
  const { answer, failed, load } = useRead<Explained>('explain_person', person ? { person } : null)
  const choose = (found: Found | null) => { if (found) window.location.search = explainAddress(found.person).slice(1) }
  // Someone who may not see the page gets the refusal alone, with no search above it.
  const refused = failed?.startsWith('Only a Report Access Manager')
  return (
    <Shell current="explain" testid="explain-person" title={answer ? answer.name : 'Explain A Person'} wide>
      {!refused && <div className="max-w-xl"><PersonPicker chosen={null} onChoose={choose} label="Find a person" /></div>}
      {!person && <p className="fd-muted">Choose someone to see their business roles, the apps they would open and the reports they would get. {SHADOW_NOTE}</p>}
      {person && !answer && !failed && <Loading />}
      {failed && <Failed message={failed} onRetry={load} />}
      {answer && <Explanation answer={answer} onChanged={load} />}
    </Shell>
  )
}

/** The header chips: Employee, Site and Reports To, each a link where the viewer may open it. */
function HeaderChips({ header }: { header: Explained['header'] }) {
  const chip = (label: string, parts: Part[]) => parts.length > 0 && (
    <span key={label} className={pillClasses('bg-subtle text-ink font-normal')} data-testid="header-chip"><span className="text-ink-muted">{label}</span> <Parts parts={parts} /></span>
  )
  return <div className="flex flex-wrap gap-2" data-testid="header-chips">{chip('Employee', header.employee)}{chip('Site', header.sites)}{chip('Reports To', header.reports_to)}</div>
}

function Explanation({ answer, onChanged }: { answer: Explained; onChanged: () => Promise<unknown> }) {
  const [form, setForm] = useState<'Correct' | 'Also give' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Removing a hand change asks first, on its own line: no browser dialog.
  const [confirming, setConfirming] = useState<string | null>(null)
  const remove = async (role: Explained['roles'][number]) => {
    setError(null)
    try { await act('remove_role', { id: role.hand, updated_at: role.hand_updated_at }); setConfirming(null); await onChanged() } catch (e) { setError(messageOf(e)) }
  }
  const field = 'text-[13px] text-ink-muted'
  return (
    <div className="flex flex-col gap-4">
      <HeaderChips header={answer.header} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <dl className="grid h-fit grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm" data-testid="explain-fields">
          <dt className={field}>HR title</dt><dd data-testid="hr-title">{answer.hr_titles.join(', ') || 'No current job'}</dd>
          <dt className={field}>Status</dt><dd><StaffBadge who={answer.who} /></dd>
          <dt className={field}>Today</dt><dd data-testid="explain-today">{accessWords(answer.today)}</dd>
          <dt className={field}>New model</dt><dd data-testid="explain-next">{accessWords(answer.next)}</dd>
          <dt className={field}>What changes</dt><dd data-testid="explain-change">{answer.change.kinds.length ? <ChangeFacts change={answer.change} /> : 'Nothing: the new model gives the same.'}</dd>
        </dl>
        <div className="flex flex-col gap-5">
          {error && <Notice tone="negative">{error}</Notice>}
          <Group title="Business Roles" count={answer.roles.length} testid="explain-roles">
            {answer.roles.map((role, i) => (
              <Line key={`${role.role}-${i}`} testid="explain-role"
                name={<><RecordLink table={ROLE_TABLE} id={role.role}>{role.name}</RecordLink><span className="text-ink-muted"> · </span><span data-testid="role-area"><Parts parts={role.area.parts} /></span></>}
                meta={[reachWords(role.area), role.until ? `until ${fmtDate(role.until)}` : null, role.reason].filter(Boolean).join(' · ')}
                side={<>
                  <Chip tone={role.hand ? 'hand' : 'source'} testid="source-chip">{role.source}</Chip>
                  {role.hand && confirming !== role.hand && <button type="button" className={linkClasses} onClick={() => setConfirming(role.hand)} data-testid="remove-role">Remove</button>}
                  {role.hand && confirming === role.hand && (
                    <span className="inline-flex items-center gap-2 text-[13px]" data-testid="remove-confirm">Remove this?
                      <button type="button" className="font-medium text-negative hover:underline" onClick={() => remove(role)} data-testid="remove-yes">Yes</button>
                      <button type="button" className={linkClasses} onClick={() => setConfirming(null)} data-testid="remove-keep">Keep</button>
                    </span>
                  )}
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
            {form && <HandForm change={form} person={answer.person} choices={answer.choices} places={answer.places} onDone={async () => { setForm(null); await onChanged() }} onCancel={() => setForm(null)} />}
          </Group>
          <Group title="Apps They Would Open" count={answer.apps.length} testid="explain-apps">
            {answer.apps.map(app => (
              <WhyLine key={`${app.app}-${app.level}`} testid="explain-app" name={<span className="font-medium">{app.app}</span>} meta={`at level ${app.level}`}
                chip={`via ${app.via.join(', ')}`} why={`Given by ${app.via.join(' and ')}, a business role ${app.via.length === 1 ? 'they hold' : 'they hold each of'}.`} />
            ))}
            {answer.apps.length === 0 && <li className="px-2 py-1.5 text-sm text-ink-muted">No app.</li>}
          </Group>
          <Group title="Reports They Would Get" count={answer.reports.length} testid="explain-reports">
            {answer.reports.map(report => (
              <WhyLine key={report.key} testid="explain-report" name={<RecordLink table="dash.report" id={report.key}>{report.name}</RecordLink>} why={report.why.join('; ')} />
            ))}
            {answer.reports.length === 0 && <li className="px-2 py-1.5 text-sm text-ink-muted">No report.</li>}
          </Group>
          {answer.change.decisions.length > 0 && (
            <Group title="Needs A Decision" count={answer.change.decisions.length} testid="explain-decisions"
              note="They get these today only through a role such as Dash Reader, and the new model doesn't give them. The owner decides which business roles get them.">
              {answer.change.decisions.map(report => <Line key={report.id} testid="explain-decision" name={<Named part={report} />} />)}
            </Group>
          )}
        </div>
      </div>
    </div>
  )
}

/** A line with a "Why?" that opens its reason underneath. */
function WhyLine({ name, meta, chip, why, testid }: { name: ReactNode; meta?: ReactNode; chip?: string; why: string; testid: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Line testid={testid} name={name} meta={meta}
      side={<>{chip && <Chip>{chip}</Chip>}<button type="button" className={linkClasses} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="why-toggle">{open ? 'Hide why' : 'Why?'}</button></>}>
      {open && <p className="mt-1 text-[13px] text-ink-muted" data-testid="why-line">{why}</p>}
    </Line>
  )
}

function HandForm({ change, person, choices, places, onDone, onCancel }: { change: 'Correct' | 'Also give'; person: string; choices: Explained['choices']; places: Explained['places']; onDone: () => Promise<void>; onCancel: () => void }) {
  const [role, setRole] = useState('')
  const [site, setSite] = useState(places.default ?? '')
  const [ends, setEnds] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true); setError(null)
    try { await act('give_role', { person, change, role, site, ends_on: ends || null, reason }); await onDone() } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }
  const roleName = choices.find(c => c.id === role)?.name ?? 'the role'
  const siteName = places.stores.find(s => s.id === site)?.name
  return (
    <li className="mx-2 mt-2 flex flex-col gap-3 rounded-control bg-action-tint p-3" data-testid="hand-form">
      <p className="text-sm" data-testid="hand-sentence">{change === 'Correct' ? 'Correct' : 'Also give'}: treat as <b>{roleName}</b>{siteName ? <> at <b>{siteName}</b></> : ' at the place of their job'}.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Business role" className="min-w-48">
          <Select value={role} onChange={e => setRole(e.target.value)} data-testid="hand-role">
            <option value="">Choose a role</option>
            {choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Place" className="min-w-48">
          <Select value={site} onChange={e => setSite(e.target.value)} data-testid="hand-site">
            <option value="">The place of their job</option>
            {places.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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

interface Changed extends Change { person: string; name: string; who: Who | null; roles: string[] }
interface ChangesAnswer { people: number; changed: number; groups: { kind: Kind; people: Changed[] }[] }
const GROUP_TITLES: Record<Kind, string> = {
  loses_dash: 'Would Lose Dash', gains_dash: 'Would Gain Dash', stores: 'Different Stores', reports: 'Different Reports', decision: 'Needs A Decision',
}
const GROUP_NOTES: Partial<Record<Kind, string>> = {
  stores: 'They would reach other stores, or other subcategories in the same store.',
  decision: 'Reports they get today only through a role such as Dash Reader. The owner decides which business roles get them.',
}
const SHOWN = 10

export function AccessChangesPage() {
  const { answer, failed, load } = useRead<ChangesAnswer>('access_changes', {})
  return (
    <Shell current="changes" testid="access-changes" title="Who Would Gain Or Lose Access" wide>
      <p className="fd-muted">{SHADOW_NOTE} A person is listed under every change that applies to them.</p>
      {!answer && !failed && <Loading />}
      {failed && <Failed message={failed} onRetry={load} />}
      {answer && (
        <>
          <p className="text-sm" data-testid="changes-summary">
            {answer.changed === 0 ? `All ${plural(answer.people, 'person', 'people')} would keep exactly what they have.`
              : `${plural(answer.changed, 'person', 'people')} of ${answer.people.toLocaleString('en-IN')} would see something different. Everyone else keeps exactly what they have.`}
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
            name={<><a href={explainAddress(p.person)} className="font-medium text-action hover:underline" data-testid="changed-name">{p.name}</a>{p.who?.code && <span className="text-ink-muted"> {p.who.code}</span>}</>}
            meta={<ChangeFacts change={p} who={p.who} />}
            side={<><StaffBadge who={p.who} />{p.roles.length ? <Chip>{p.roles.join(', ')}</Chip> : <Chip>No business role</Chip>}</>} />
        ))}
        {people.length > SHOWN && !all && <li className="px-2"><button type="button" className={linkClasses} onClick={() => setAll(true)}>Show all {people.length.toLocaleString('en-IN')}</button></li>}
      </Group>
    </div>
  )
}

/** What changes for one person, in words, each name a link. */
function ChangeFacts({ change, who }: { change: Change; who?: Who | null }) {
  const facts: ReactNode[] = []
  if (change.kinds.includes('loses_dash')) facts.push('Would lose Dash')
  if (change.kinds.includes('gains_dash')) facts.push('Would gain Dash')
  const list = (label: string, parts: Part[]) => { if (parts.length) facts.push(<>{label} <Parts parts={parts} /></>) }
  list('Would reach', change.stores_gained)
  list('Would stop reaching', change.stores_lost)
  list('Other subcategories at', change.stores_changed)
  list('Would get', change.gained)
  list('Would lose', change.lost)
  list('Needs a decision:', change.decisions)
  const jobs = who?.jobs?.join(', ')
  return <>{jobs && <span>{jobs}</span>}{facts.map((f, i) => <span key={i} data-testid="change-fact">{jobs || i ? ' · ' : ''}{f}</span>)}</>
}
