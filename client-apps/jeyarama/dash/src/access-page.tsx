// The Report access page (#1046), in Shop Floor's components, for Report Access Managers and
// System Managers: add a MotherDuck Dive as a report (#1169); give a report or a bundle to a person, a role or a job; see who has what and
// take it away; look a person up to see what they see, and why. The rules are the server's
// (report-access-server.ts): the page only asks.
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, DataList, EmptyState, Field, KindTag, Notice, SearchInput, Select, Skeleton, TextInput, type DataColumn } from '@featherbase/shop-floor'
import { act, read } from './api'
import { DashSidebar } from './sections-page'
import { PickerToggle, TeamNote, TeamSelect, startPickerLayout, type PickerLayout, type TeamMember } from './team-access-page'
import { diveIdIn, matchingDives, type DiveChoice } from './add-dive'
import { PeopleLayoutProvider, PeopleLayoutToggle, PersonName, personWithCode, type Who } from './person-identity'

type Kind = 'Person' | 'Role' | 'Job'
interface Row { id: string; updated_at: string; gives: { kind: 'Report' | 'Bundle'; name: string }; to: { kind: Kind; name: string; who?: Who }; given_by: string; given_on: string; removable?: boolean }
interface Page {
  /** #1217: 'team' for a Team Report Manager, who gives only to `team`. */
  scope?: 'company' | 'team'
  team?: TeamMember[]
  reports: { key: string; name: string }[]
  bundles: { id: string; name: string; reports: { member: string; updated_at: string; key: string; name: string }[] }[]
  roles: string[]
  jobs: string[]
  rows: Row[]
  waiting: { person: string; name: string; asked_on: string; who?: Who }[]
}
interface Found extends Who { person: string; name: string }
interface Lookup { name: string; reports: { key: string; name: string; because: string[]; closed: string | null }[] }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That did not go through. Try again.')
/** A day as staff read it: 07-Nov-2026. */
const dayOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return `${String(d).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}-${y}`
}

export function ReportAccess() {
  const [page, setPage] = useState<Page | undefined>()
  const [removals, setRemovals] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const load = useCallback(() => read<Page>('access_page').then(answer => { setPage(answer); setFailed(null) }, error => setFailed(messageOf(error))), [])
  useEffect(() => { void load() }, [load])
  return (
    <PeopleLayoutProvider>
      <div className="fd-shell">
        <DashSidebar current="access" />
        <main className="fd-page" data-testid="report-access">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            <h1 className="fd-title">Report access</h1>
            {!page && !failed && <Skeleton label="Opening report access" lines={6} />}
            {failed && !page && (
              <Card data-testid="access-refused"><EmptyState title="This page couldn't open" body={failed} action={failed.startsWith('Only a Report Access Manager') ? undefined : <Button onClick={() => void load()}>Try again</Button>} /></Card>
            )}
            {page && page.scope === 'team' && <TeamAccess page={page} onChanged={load} />}
            {page && page.scope !== 'team' && (
              <>
                <p className="fd-muted">A person sees every report given to them, through a role they hold, or through their current job. What a report shows them still follows their job.</p>
                <PeopleLayoutToggle />
                <GiveBar key={removals} page={page} onGiven={load} />
                <WhoHasWhat rows={page.rows} onRemoved={() => { setRemovals(n => n + 1); return load() }} />
                <PersonLookup />
                <Bundles page={page} onChanged={load} />
                <AddDive onAdded={load} />
                {page.waiting.length > 0 && <Waiting waiting={page.waiting} />}
              </>
            )}
          </div>
        </main>
      </div>
    </PeopleLayoutProvider>
  )
}

/** #1217: a Team Report Manager's page: their team only, no roles, jobs, bundle tools or waiting list. */
function TeamAccess({ page, onChanged }: { page: Page; onChanged: () => Promise<unknown> }) {
  const [layout, setLayout] = useState<PickerLayout>(startPickerLayout)
  // A remove starts the Give bar afresh, so its last "is given" message doesn't outlive the row.
  const [removals, setRemovals] = useState(0)
  const team = page.team ?? []
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TeamNote team={team} />
        <PickerToggle value={layout} onChange={setLayout} />
      </div>
      <GiveBar key={removals} page={page} onGiven={onChanged} team={{ members: team, layout }} />
      <WhoHasWhat rows={page.rows} onRemoved={() => { setRemovals(n => n + 1); return onChanged() }} empty="Nobody in your team has a report given to them as a person yet." />
      <PersonLookup team={{ members: team, layout }} />
    </>
  )
}
type TeamPicking = { members: TeamMember[]; layout: PickerLayout }

/** "Give [report or bundle] to [person, role or job]"; to a person in their team only, for a Team Report Manager. */
function GiveBar({ page, onGiven, team }: { page: Page; onGiven: () => Promise<unknown>; team?: TeamPicking }) {
  const [gives, setGives] = useState('')
  const [kind, setKind] = useState<Kind>('Person')
  const [receiver, setReceiver] = useState('')
  const [person, setPerson] = useState<Found | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const chosenName = () => {
    const [what, id] = gives.split(':')
    return what === 'report' ? page.reports.find(r => r.key === id)?.name : page.bundles.find(b => b.id === id)?.name
  }
  async function give() {
    const to = kind === 'Person' ? person?.person : receiver
    if (!gives) return setError('Choose a report or a bundle')
    if (!to) return setError(kind === 'Person' ? 'Find the person' : `Choose a ${kind.toLowerCase()}`)
    const [what, id] = gives.split(':')
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await act('give_report', { [what === 'report' ? 'report' : 'report_bundle']: id, [kind.toLowerCase()]: to })
      setDone(`${chosenName()} is given to ${kind === 'Person' && person ? personWithCode(person.name, person) : receiver}.`)
      setReceiver('')
      setPerson(null)
      await onGiven()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="Give a report" data-testid="give-bar">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Give" className="min-w-64 flex-1">
            <Select value={gives} onChange={event => setGives(event.target.value)} data-testid="give-what">
              <option value="">{page.bundles.length ? 'Choose a report or a bundle' : 'Choose a report'}</option>
              <optgroup label="Reports">
                {page.reports.map(report => <option key={report.key} value={`report:${report.key}`}>{report.name} · Report</option>)}
              </optgroup>
              {page.bundles.length > 0 && (
                <optgroup label="Bundles">
                  {page.bundles.map(bundle => <option key={bundle.id} value={`bundle:${bundle.id}`}>{bundle.name} · Bundle</option>)}
                </optgroup>
              )}
            </Select>
          </Field>
          {!team && <Field label="To" className="w-40">
            <Select value={kind} onChange={event => { setKind(event.target.value as Kind); setReceiver(''); setPerson(null) }} data-testid="give-kind">
              <option value="Person">A person</option>
              <option value="Role">A role</option>
              <option value="Job">A job</option>
            </Select>
          </Field>}
          {kind === 'Person' && (team?.layout === 'list'
            ? <TeamSelect team={team.members} chosen={person} onChoose={setPerson} label="To someone in your team" />
            : <PersonPicker chosen={person} onChoose={setPerson} label={team ? 'To someone in your team' : 'Person'} nobody={team ? 'No one in your team matches that' : undefined} />)}
          {kind === 'Role' && (
            <Field label="Role" className="min-w-56 flex-1">
              <Select value={receiver} onChange={event => setReceiver(event.target.value)} data-testid="give-role">
                <option value="">Choose a role</option>
                {page.roles.map(role => <option key={role} value={role}>{role} · Role</option>)}
              </Select>
            </Field>
          )}
          {kind === 'Job' && (
            <Field label="Job" className="min-w-56 flex-1">
              <Select value={receiver} onChange={event => setReceiver(event.target.value)} data-testid="give-job">
                <option value="">Choose a job</option>
                {page.jobs.map(job => <option key={job} value={job}>{job} · Job</option>)}
              </Select>
            </Field>
          )}
          <Button data-action variant="primary" loading={busy} onClick={give} data-testid="give-button">Give</Button>
        </div>
        {error && <Notice tone="negative"><span data-testid="give-error">{error}</span></Notice>}
        {done && <Notice tone="positive"><span data-testid="give-done">{done}</span></Notice>}
      </div>
    </Card>
  )
}

/** Finds a person on the staff list by name. */
function PersonPicker({ chosen, onChoose, label, nobody = 'No one on the staff list matches that' }: { chosen: Found | null; onChoose: (found: Found | null) => void; label: string; nobody?: string }) {
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  useEffect(() => {
    const q = typed.trim()
    if (q.length < 2) { setFound(null); return }
    let live = true
    const timer = setTimeout(() => { read<Found[]>('person_search', { q }).then(answer => { if (live) setFound(answer) }, () => { if (live) setFound([]) }) }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [typed])
  if (chosen)
    return (
      <div className="flex min-w-56 flex-1 flex-col">
        <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
        <div className="flex min-h-control items-center gap-2" data-testid="person-chosen">
          <PersonName name={chosen.name} who={chosen} strong /><KindTag>Person</KindTag>
          <Button variant="quiet" onClick={() => { onChoose(null); setTyped('') }}>Change</Button>
        </div>
      </div>
    )
  return (
    <div className="relative min-w-56 flex-1">
      <Field label={label}>
        <SearchInput value={typed} onChange={event => setTyped(event.target.value)} placeholder="Type a name or employee code" data-testid="person-search" />
      </Field>
      {found && (
        <ul className="absolute z-10 mt-1 w-full rounded-control border border-border bg-surface shadow-sm" data-testid="person-results">
          {found.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">{nobody}</li>}
          {found.map(person => (
            <li key={person.person}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-subtle" onClick={() => { onChoose(person); setTyped('') }} data-testid="person-result">
                <span className="min-w-0 flex-1"><PersonName name={person.name} who={person} /></span><KindTag>Person</KindTag>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Who has what, with Remove after a confirmation naming what goes. */
function WhoHasWhat({ rows, onRemoved, empty }: { rows: Row[]; onRemoved: () => Promise<unknown>; empty?: string }) {
  const [confirming, setConfirming] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function remove(row: Row) {
    setBusy(true)
    setError(null)
    try {
      await act('remove_report_access', { id: row.id, updated_at: row.updated_at })
      setConfirming(null)
      await onRemoved()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  const columns: DataColumn<Row>[] = [
    { key: 'gives', header: 'Gives', phone: 'title', cell: row => <span className="inline-flex items-center gap-2">{row.gives.name}<KindTag>{row.gives.kind}</KindTag></span> },
    { key: 'to', header: 'To', cell: row => <span className="inline-flex items-center gap-2"><PersonName name={row.to.name} who={row.to.who} /><KindTag>{row.to.kind}</KindTag></span> },
    { key: 'by', header: 'Given by', cell: row => <span>{row.given_by}{row.given_on ? ` · ${dayOf(row.given_on)}` : ''}</span> },
    { key: 'remove', header: <span className="sr-only">Remove</span>, align: 'end', cell: row => (
      confirming?.id === row.id ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-2" data-testid="remove-confirm">
          <span className="text-sm">Remove {row.gives.name} from {personWithCode(row.to.name, row.to.who)}?</span>
          <Button variant="danger" loading={busy} onClick={() => void remove(row)} data-testid="remove-yes">Remove</Button>
          <Button variant="quiet" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
        </span>
      ) : row.removable === false ? <span className="px-3 text-sm text-ink-muted" data-testid="not-yours">Not given by you</span>
        : <Button data-action variant="quiet" onClick={() => { setError(null); setConfirming(row) }} data-testid="remove">Remove</Button>
    ) },
  ]
  return (
    <Card title="Who has what" data-testid="who-has-what">
      {/* relative + clip: the hidden "Remove" header is absolutely placed, and must not widen the page on a phone. */}
      <div className="relative flex flex-col gap-3 overflow-x-clip p-4">
        {error && <Notice tone="negative">{error}</Notice>}
        <DataList caption="Who has what" rows={rows} columns={columns} rowKey={row => row.id} rowTestId={() => 'access-row'} layout="table"
          empty={{ title: "Nobody has a report yet", body: empty ?? "Give one above. Until then nobody sees any report." }} />
      </div>
    </Card>
  )
}

/** What one person sees, and why. */
function PersonLookup({ team }: { team?: TeamPicking } = {}) {
  const [person, setPerson] = useState<Found | null>(null)
  const [answer, setAnswer] = useState<Lookup | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setAnswer(null)
    setError(null)
    if (!person) return
    let live = true
    read<Lookup>('person_lookup', { person: person.person }).then(found => { if (live) setAnswer(found) }, failure => { if (live) setError(messageOf(failure)) })
    return () => { live = false }
  }, [person])
  return (
    <Card title="What a person sees" data-testid="person-lookup">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">{team?.layout === 'list'
          ? <TeamSelect team={team.members} chosen={person} onChoose={setPerson} label="Look up someone in your team" />
          : <PersonPicker chosen={person} onChoose={setPerson} label={team ? 'Look up someone in your team' : 'Look up a person'} nobody={team ? 'No one in your team matches that' : undefined} />}</div>
        {error && <Notice tone="negative">{error}</Notice>}
        {answer && answer.reports.length === 0 && <p data-testid="lookup-none">{answer.name} sees no report. Nothing has been given to them, their roles or their job.</p>}
        {answer && answer.reports.length > 0 && (
          <ul className="flex flex-col divide-y divide-border" data-testid="lookup-reports">
            {answer.reports.map(report => (
              <li key={report.key} className="py-2" data-testid="lookup-report">
                <p className="font-semibold">{report.name}</p>
                {report.closed && <p className="text-sm text-negative" data-testid="lookup-closed">{report.closed}</p>}
                <p className="text-sm text-ink-muted">{report.because.join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

/**
 * The bundles and their reports, made and changed here: a Report Access Manager can't open the
 * Admin pages. Taking a report out names it first, as Remove does above.
 */
function Bundles({ page, onChanged }: { page: Page; onChanged: () => Promise<unknown> }) {
  const [name, setName] = useState('')
  const [adding, setAdding] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(action: string, payload: Record<string, unknown>, after: () => void) {
    setBusy(true)
    setError(null)
    try {
      await act(action, payload)
      after()
      await onChanged()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="Bundles" data-testid="bundles">
      <div className="flex flex-col gap-3 p-4">
        {error && <Notice tone="negative">{error}</Notice>}
        {page.bundles.length === 0 && <p className="fd-muted">No bundles yet. A bundle gives several reports at once.</p>}
        {page.bundles.map(bundle => {
          const missing = page.reports.filter(report => !bundle.reports.some(held => held.key === report.key))
          return (
            <div key={bundle.id} className="flex flex-col gap-2 border-b border-border pb-3" data-testid="bundle">
              <p className="font-semibold">{bundle.name}</p>
              {bundle.reports.length === 0 && <p className="fd-muted text-sm">No reports in it yet.</p>}
              <ul className="flex flex-col gap-1">
                {bundle.reports.map(held => (
                  <li key={held.member} className="flex flex-wrap items-center gap-2" data-testid="bundle-report">
                    <span>{held.name}</span>
                    {confirming === held.member ? (
                      <span className="inline-flex flex-wrap items-center gap-2" data-testid="take-out-confirm">
                        <span className="text-sm">Take {held.name} out of {bundle.name}?</span>
                        <Button variant="danger" loading={busy} onClick={() => void run('remove_from_bundle', { id: held.member, updated_at: held.updated_at }, () => setConfirming(null))} data-testid="take-out-yes">Take out</Button>
                        <Button variant="quiet" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
                      </span>
                    ) : <Button data-action variant="quiet" onClick={() => { setError(null); setConfirming(held.member) }} data-testid="take-out">Take out</Button>}
                  </li>
                ))}
              </ul>
              {missing.length > 0 && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={`Add a report to ${bundle.name}`}>
                    <Select value={adding[bundle.id] ?? ''} onChange={event => setAdding({ ...adding, [bundle.id]: event.target.value })} data-testid="bundle-add-choice">
                      <option value="">Choose a report</option>
                      {missing.map(report => <option key={report.key} value={report.key}>{report.name}</option>)}
                    </Select>
                  </Field>
                  <Button data-action disabled={busy || !adding[bundle.id]} onClick={() => void run('add_to_bundle', { bundle: bundle.id, report: adding[bundle.id] }, () => setAdding({ ...adding, [bundle.id]: '' }))} data-testid="bundle-add">Add</Button>
                </div>
              )}
            </div>
          )
        })}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="New bundle">
            <TextInput value={name} onChange={event => setName(event.target.value)} placeholder="For example, Team leader pack" data-testid="bundle-name" />
          </Field>
          <Button data-action disabled={busy || !name.trim()} onClick={() => void run('make_bundle', { name: name.trim() }, () => setName(''))} data-testid="bundle-make">Make bundle</Button>
        </div>
      </div>
    </Card>
  )
}

/** How many Dives the card lists before Show more. */
const DIVES_SHOWN = 25

/**
 * Add a Dive (#1169): any of the organisation's Dives becomes a report taking no filter, which
 * then shows in Give and in every bundle's list above. A pasted link or id finds its Dive.
 */
function AddDive({ onAdded }: { onAdded: () => Promise<unknown> }) {
  const [choices, setChoices] = useState<{ dives: DiveChoice[] } | { unreachable: true } | undefined>()
  const [failed, setFailed] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(DIVES_SHOWN)
  const [chosen, setChosen] = useState<DiveChoice | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const loadDives = useCallback(() => {
    setFailed(null)
    setChoices(undefined)
    return read<{ dives: DiveChoice[] } | { unreachable: true }>('dive_choices').then(setChoices, failure => setFailed(messageOf(failure)))
  }, [])
  useEffect(() => { void loadDives() }, [loadDives])
  const dives = choices && 'dives' in choices ? choices.dives : null
  const found = dives ? matchingDives(dives, search) : []
  function choose(dive: DiveChoice) {
    setChosen(dive)
    setName(dive.title)
    setError(null)
    setAdded(null)
  }
  async function add() {
    if (!chosen) return
    setBusy(true)
    setError(null)
    try {
      const answer = await act<{ name: string }>('add_report', { dive_id: chosen.dive_id, name: name.trim() })
      setChosen(null)
      setSearch('')
      // Said once the pickers above hold it, so the notice never points at a list without it.
      await Promise.all([onAdded(), loadDives()])
      setAdded(answer.name)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  const pastedId = diveIdIn(search)
  return (
    <Card title="Add a Dive" data-testid="add-dive">
      <div className="flex flex-col gap-3 p-4">
        <p className="fd-muted">Any Dive in MotherDuck can become a report here. Once added, give it or put it in a bundle above.</p>
        {added && <Notice tone="positive"><span data-testid="dive-added">{added} is in Dash. Give it or put it in a bundle above.</span></Notice>}
        {!choices && !failed && <Skeleton label="Reading the Dives in MotherDuck" lines={4} />}
        {(failed || (choices && 'unreachable' in choices)) && (
          <div className="flex flex-wrap items-center gap-3" data-testid="dives-unreachable">
            <Notice tone="negative">{failed ?? "Dash couldn't reach MotherDuck to list the Dives."}</Notice>
            {!failed?.startsWith('Only a Report Access Manager') && <Button onClick={() => void loadDives()}>Try again</Button>}
          </div>
        )}
        {dives && (
          <>
            <Field label="Find a Dive: type part of its title or owner, or paste its link">
              <SearchInput value={search} onChange={event => { setSearch(event.target.value); setShown(DIVES_SHOWN) }} placeholder="For example, Women Buyers, or https://app.motherduck.com/dives/…" data-testid="dive-search" />
            </Field>
            {found.length === 0 && (
              <p className="fd-muted" data-testid="dives-none">
                {pastedId ? "Dash can't see the Dive in that link. Ask its owner whether it was deleted, or made in another MotherDuck account."
                  : dives.length ? 'No Dive matches that.' : 'Dash can see no Dive in MotherDuck.'}
              </p>
            )}
            <ul className="flex flex-col divide-y divide-border">
              {found.slice(0, shown).map(dive => (
                <li key={dive.dive_id} className="flex flex-col gap-2 py-2" data-testid="dive">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">{dive.title}</span>
                      <span className="fd-muted text-sm"> · {dive.owner}{dive.saved_on ? ` · saved ${dayOf(dive.saved_on)}` : ''}</span>
                    </span>
                    {dive.in_dash ? <span className="fd-muted text-sm" data-testid="dive-in-dash">In Dash as {dive.in_dash}</span>
                      : chosen?.dive_id !== dive.dive_id && <Button data-action variant="quiet" onClick={() => choose(dive)} data-testid="dive-choose">Add</Button>}
                  </div>
                  {chosen?.dive_id === dive.dive_id && (
                    <div className="flex flex-col gap-2 rounded border border-border p-3" data-testid="dive-adding">
                      <Field label="Name in the left pane">
                        <TextInput value={name} onChange={event => setName(event.target.value)} data-testid="dive-name" />
                      </Field>
                      <p className="text-sm">Everyone you give it to sees everything the Dive shows, whatever their store.</p>
                      {error && <Notice tone="negative">{error}</Notice>}
                      <div className="flex flex-wrap gap-2">
                        <Button loading={busy} disabled={!name.trim()} onClick={() => void add()} data-testid="dive-add">Add to Dash</Button>
                        <Button variant="quiet" disabled={busy} onClick={() => setChosen(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {found.length > shown && <Button variant="quiet" onClick={() => setShown(shown + DIVES_SHOWN)} data-testid="dives-more">Show more ({found.length - shown} more)</Button>}
          </>
        )}
      </div>
    </Card>
  )
}

/** People who opened Dash with no report. */
function Waiting({ waiting }: { waiting: Page['waiting'] }) {
  return (
    <Card title="Waiting for a report" data-testid="waiting">
      <ul className="flex flex-col divide-y divide-border p-4">
        {waiting.map(w => <li key={w.person} className="py-1" data-testid="waiting-person"><span className="flex flex-wrap items-baseline justify-between gap-x-3"><PersonName name={w.name} who={w.who} /><span className="text-sm text-ink-muted">asked on {dayOf(w.asked_on)}</span></span></li>)}
      </ul>
    </Card>
  )
}
