// The Report access page (#1046), in Shop Floor's components, for Report Access Managers and
// System Managers: give a report or a bundle to a person, a role or a job; see who has what and
// take it away; look a person up to see what they see, and why. The rules are the server's
// (report-access-server.ts): the page only asks.
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, DataList, EmptyState, Field, KindTag, Notice, SearchInput, Select, Skeleton, type DataColumn } from '@featherbase/shop-floor'
import { act, read } from './api'
import { DashSidebar } from './sections-page'

type Kind = 'Person' | 'Role' | 'Job'
interface Row { id: string; updated_at: string; gives: { kind: 'Report' | 'Bundle'; name: string }; to: { kind: Kind; name: string }; given_by: string; given_on: string }
interface Page {
  reports: { key: string; name: string }[]
  bundles: { id: string; name: string; reports: string[] }[]
  roles: string[]
  jobs: string[]
  rows: Row[]
  waiting: { person: string; name: string; asked_on: string }[]
}
interface Found { person: string; name: string }
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
  const [failed, setFailed] = useState<string | null>(null)
  const load = useCallback(() => read<Page>('access_page').then(answer => { setPage(answer); setFailed(null) }, error => setFailed(messageOf(error))), [])
  useEffect(() => { void load() }, [load])
  return (
    <div className="fd-shell">
      <DashSidebar current="access" />
      <main className="fd-page" data-testid="report-access">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <h1 className="fd-title">Report access</h1>
          {!page && !failed && <Skeleton label="Opening report access" lines={6} />}
          {failed && !page && (
            <Card data-testid="access-refused"><EmptyState title="This page couldn't open" body={failed} action={<Button onClick={() => void load()}>Try again</Button>} /></Card>
          )}
          {page && (
            <>
              <p className="fd-muted">A person sees every report given to them, through a role they hold, or through their current job. What a report shows them still follows their job.</p>
              <GiveBar page={page} onGiven={load} />
              <WhoHasWhat rows={page.rows} onRemoved={load} />
              <PersonLookup />
              <Bundles bundles={page.bundles} />
              {page.waiting.length > 0 && <Waiting waiting={page.waiting} />}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

/** "Give [report or bundle] to [person, role or job]". */
function GiveBar({ page, onGiven }: { page: Page; onGiven: () => Promise<unknown> }) {
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
      setDone(`${chosenName()} is given to ${kind === 'Person' ? person?.name : receiver}.`)
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
              <option value="">Choose a report or a bundle</option>
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
          <Field label="To" className="w-40">
            <Select value={kind} onChange={event => { setKind(event.target.value as Kind); setReceiver(''); setPerson(null) }} data-testid="give-kind">
              <option value="Person">A person</option>
              <option value="Role">A role</option>
              <option value="Job">A job</option>
            </Select>
          </Field>
          {kind === 'Person' && <PersonPicker chosen={person} onChoose={setPerson} label="Person" />}
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
          <Button variant="primary" loading={busy} onClick={give} data-testid="give-button">Give</Button>
        </div>
        {error && <Notice tone="negative"><span data-testid="give-error">{error}</span></Notice>}
        {done && <Notice tone="positive"><span data-testid="give-done">{done}</span></Notice>}
      </div>
    </Card>
  )
}

/** Finds a person on the staff list by name. */
function PersonPicker({ chosen, onChoose, label }: { chosen: Found | null; onChoose: (found: Found | null) => void; label: string }) {
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
          <span className="font-semibold">{chosen.name}</span><KindTag>Person</KindTag>
          <Button variant="quiet" onClick={() => { onChoose(null); setTyped('') }}>Change</Button>
        </div>
      </div>
    )
  return (
    <div className="relative min-w-56 flex-1">
      <Field label={label}>
        <SearchInput value={typed} onChange={event => setTyped(event.target.value)} placeholder="Type a name" data-testid="person-search" />
      </Field>
      {found && (
        <ul className="absolute z-10 mt-1 w-full rounded-control border border-border bg-surface shadow-sm" data-testid="person-results">
          {found.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No one on the staff list by that name</li>}
          {found.map(person => (
            <li key={person.person}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-subtle" onClick={() => onChoose(person)} data-testid="person-result">
                <span>{person.name}</span><KindTag>Person</KindTag>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Who has what, with Remove after a confirmation naming what goes. */
function WhoHasWhat({ rows, onRemoved }: { rows: Row[]; onRemoved: () => Promise<unknown> }) {
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
    { key: 'to', header: 'To', cell: row => <span className="inline-flex items-center gap-2">{row.to.name}<KindTag>{row.to.kind}</KindTag></span> },
    { key: 'by', header: 'Given by', cell: row => <span>{row.given_by}{row.given_on ? ` · ${dayOf(row.given_on)}` : ''}</span> },
    { key: 'remove', header: <span className="sr-only">Remove</span>, align: 'end', cell: row => (
      confirming?.id === row.id ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-2" data-testid="remove-confirm">
          <span className="text-sm">Remove {row.gives.name} from {row.to.name}?</span>
          <Button variant="danger" loading={busy} onClick={() => void remove(row)} data-testid="remove-yes">Remove</Button>
          <Button variant="quiet" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
        </span>
      ) : <Button variant="quiet" onClick={() => { setError(null); setConfirming(row) }} data-testid="remove">Remove</Button>
    ) },
  ]
  return (
    <Card title="Who has what" data-testid="who-has-what">
      <div className="flex flex-col gap-3 p-4">
        {error && <Notice tone="negative">{error}</Notice>}
        <DataList caption="Who has what" rows={rows} columns={columns} rowKey={row => row.id} rowTestId={() => 'access-row'} layout="table"
          empty={{ title: "Nobody has a report yet", body: "Give one above. Until then nobody sees any report." }} />
      </div>
    </Card>
  )
}

/** What one person sees, and why. */
function PersonLookup() {
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
        <div className="flex flex-wrap items-end gap-3"><PersonPicker chosen={person} onChoose={setPerson} label="Look up a person" /></div>
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

/** The bundles and their reports; each is made and changed in the standard form. */
function Bundles({ bundles }: { bundles: Page['bundles'] }) {
  return (
    <Card title="Bundles" data-testid="bundles"
      actions={<a className="text-sm font-semibold text-action" href="/featherbase/admin/table/dash.report_bundle" data-testid="edit-bundles">Make or change a bundle</a>}>
      <div className="flex flex-col gap-2 p-4">
        {bundles.length === 0 && <p className="fd-muted">No bundles yet. A bundle gives several reports at once.</p>}
        {bundles.map(bundle => (
          <p key={bundle.id} data-testid="bundle"><span className="font-semibold">{bundle.name}</span>: {bundle.reports.length ? bundle.reports.join(', ') : 'no reports yet'}</p>
        ))}
        <p className="text-sm"><a className="text-action" href="/featherbase/admin/table/dash.report_bundle_member">Add a report to a bundle, or take one out</a></p>
      </div>
    </Card>
  )
}

/** People who opened Dash with no report. */
function Waiting({ waiting }: { waiting: Page['waiting'] }) {
  return (
    <Card title="Waiting for a report" data-testid="waiting">
      <ul className="flex flex-col divide-y divide-border p-4">
        {waiting.map(w => <li key={w.person} className="py-1" data-testid="waiting-person">{w.name} · asked on {dayOf(w.asked_on)}</li>)}
      </ul>
    </Card>
  )
}
