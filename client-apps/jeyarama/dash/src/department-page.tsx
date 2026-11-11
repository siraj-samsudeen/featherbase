// Your department (#1195): a Department Manager says which sections are theirs and names the
// department; their manager keeps it or turns it down. Three layouts of the same form, behind a
// toggle, so the owner can compare them in the real app: Steps (the default), One list, Step by step.
import { useEffect, useState } from 'react'
import { Button, Card, EmptyState, Field, fmtDate, Notice, Segmented, StatusPill, TextInput } from '@featherbase/shop-floor'
import { act } from './api'
import { LoadFailed, Loading, NotSetUp, Shell, useAnswer } from './sections-page'

interface Section { id: string; name: string; floor: string; sells: string[]; more: number; team_leaders: string[]; suggested: boolean; held_by: string | null }
type Current =
  | { state: 'set_up'; name: string; sections: string[]; reviewing?: { bundle: string; waiting_for: string } | null }
  | { state: 'waiting'; bundle: string; name: string; sections: string[]; waiting_for: string; asked_on: string }
  | { state: 'turned_down'; name: string; sections: string[]; reason: string }
export type Setup =
  | { state: 'not_set_up' | 'unknown_person' | 'no_job' }
  | { state: 'no_sections'; job: { id: string; store: string }; reviewer: string; reviewer_is_team: boolean }
  | { state: 'ok'; name: string; job: { id: string; store: string }; reviewer: string; reviewer_is_team: boolean; floors: { id: string; name: string }[]; start_floors: string[]
      sections: Section[]; names: string[]; current: Current | null }
type Ok = Extract<Setup, { state: 'ok' }>

export type Layout = 'steps' | 'list' | 'wizard'
const LAYOUTS: { value: Layout; label: string }[] = [{ value: 'steps', label: 'Steps' }, { value: 'list', label: 'One list' }, { value: 'wizard', label: 'Step by step' }]
const LAYOUT_KEY = 'dash.department-layout'
/** The layout: the address's `layout`, else the one last chosen here, else Steps. */
export function startLayout(search = window.location.search): Layout {
  const asked = new URLSearchParams(search).get('layout')
  let kept: string | null = null
  try { kept = window.localStorage.getItem(LAYOUT_KEY) } catch { /* private window: no memory */ }
  const value = asked ?? kept
  return LAYOUTS.some(l => l.value === value) ? value as Layout : 'steps'
}
const keepLayout = (layout: Layout) => { try { window.localStorage.setItem(LAYOUT_KEY, layout) } catch { /* nothing to keep it in */ } }
/** The platform's refusal, which act() always throws as an Error. */
const messageOf = (error: unknown) => (error as Error).message
const listed = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)
const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter(v => v !== value) : [...list, value])
/** "the master data team" at the start of a sentence. */
export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
/** A reason as the end of a sentence: one full stop, never two. */
export const sentence = (text: string) => `${text.trim().replace(/[.!?]+$/, '')}.`
/** Who can keep it when the reviewer is away: only said of a person, never of the master data team. */
export const awayLine = (reviewer: string, isTeam: boolean) => (isTeam ? '' : ` If ${reviewer} is away, a Master Data Editor can keep it.`)

/** What a section sells, in a line: three names, then how many more. */
export function sellsLine(section: Pick<Section, 'sells' | 'more'>): string {
  if (!section.sells.length) return 'Nothing placed here yet'
  return `Sells ${section.sells.join(', ')}${section.more ? ` and ${section.more} more` : ''}`
}

export function YourDepartment() {
  const { answer, failed, load } = useAnswer<Setup>('department_setup')
  return (
    <Shell current="department" title="Your department" testid="your-department">
      {!answer && !failed && <Loading />}
      {failed && <LoadFailed onRetry={load} />}
      {answer?.state === 'not_set_up' && <NotSetUp />}
      {answer?.state === 'unknown_person' && (
        <Card data-testid="unknown-person"><EmptyState title="We can't find you on the staff list yet" body="Ask your manager to check that HR has you on the list." /></Card>
      )}
      {answer?.state === 'no_job' && (
        <Card data-testid="no-job"><EmptyState title="This page is for Department Managers" body="Your job on the staff list isn't Department Manager. If it should be, ask your manager to check it with HR." /></Card>
      )}
      {answer?.state === 'no_sections' && (
        <Card data-testid="no-sections">
          <EmptyState title={`${answer.job.store}'s sections aren't set up yet`}
            body={`A department is a group of your store's sections, and Dash has none for ${answer.job.store} yet. The master data team sets them up; then you can choose yours here. ${capital(answer.reviewer)} will review it.`} />
        </Card>
      )}
      {answer?.state === 'ok' && <Ready setup={answer} onChanged={load} />}
    </Shell>
  )
}

function Ready({ setup, onChanged }: { setup: Ok; onChanged: () => Promise<unknown> }) {
  const { current } = setup
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  async function withdraw(bundle: string) {
    setBusy(true)
    setNote(null)
    try {
      await act('withdraw_department', { bundle })
      setNote({ tone: 'positive', text: 'Withdrawn. Nothing was changed.' })
      await onChanged()
    } catch (failure) { setNote({ tone: 'negative', text: messageOf(failure) }) }
    finally { setBusy(false) }
  }
  /** Change it edits in place: the waiting one stays until the new one is sent in its place. */
  const startEditing = () => { setNote(null); setEditing(true) }
  const intro = <p className="fd-muted" data-testid="intro">{setup.name} · Department Manager at {setup.job.store}.</p>
  if (current?.state === 'set_up')
    return (
      <>
        {intro}
        <Card title={`${current.name} · ${setup.job.store}`} data-testid="set-up"
          actions={current.reviewing ? <StatusPill tone="caution">In use, {current.reviewing.waiting_for} to review</StatusPill> : <StatusPill tone="positive">Kept</StatusPill>}>
          <div className="flex flex-col gap-2 p-4">
            <p>{listed(current.sections)}</p>
            {current.reviewing
              ? <p className="fd-muted text-sm" data-testid="reviewing">Your report shows these sections now. {capital(current.reviewing.waiting_for)} will look at it, and can undo it.</p>
              : <p className="fd-muted text-sm">Your report shows these sections. To change them, ask {setup.reviewer}.</p>}
            <a className="fd-link font-semibold" href="?" data-testid="open-report">Open your report</a>
          </div>
        </Card>
      </>
    )
  if (current?.state === 'waiting' && !editing)
    return (
      <>
        {intro}
        {note && <Notice tone={note.tone}><span data-testid="note">{note.text}</span></Notice>}
        <Card title={`Your department · ${setup.job.store}`} data-testid="waiting" actions={<StatusPill tone="caution">Waiting for {current.waiting_for}</StatusPill>}>
          <div className="flex flex-col gap-2 p-4">
            <p className="font-semibold" data-testid="waiting-name">{current.name}</p>
            <p>{listed(current.sections)}</p>
            <p data-testid="sent-note">Sent to {current.waiting_for}. Your report opens as soon as it is kept.</p>
            <p className="fd-muted text-sm">Sent on {fmtDate(current.asked_on)}.{awayLine(current.waiting_for, setup.reviewer_is_team)}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="quiet" className="-mx-3 max-sm:-mx-4" disabled={busy} onClick={startEditing}>Change it</Button>
              <Button variant="quiet" disabled={busy} onClick={() => withdraw(current.bundle)}>Withdraw</Button>
            </div>
          </div>
        </Card>
      </>
    )
  const before = current?.state === 'waiting' || current?.state === 'turned_down' ? current : null
  return (
    <>
      {intro}
      {note && <Notice tone={note.tone}><span data-testid="note">{note.text}</span></Notice>}
      {current?.state === 'turned_down' && (
        <Notice tone="caution"><span data-testid="turned-down">{capital(setup.reviewer)} didn't keep “{current.name}”{current.reason ? `: ${sentence(current.reason)}` : '.'} Change it and send it again.</span></Notice>
      )}
      <SetupForm setup={setup} before={before} replaces={current?.state === 'waiting' ? current.bundle : undefined} onTouched={() => setNote(null)}
        onCancel={current?.state === 'waiting' ? () => setEditing(false) : undefined}
        onSent={async () => { setNote(null); setEditing(false); await onChanged() }} />
    </>
  )
}

function SetupForm({ setup, before, replaces, onCancel, onTouched, onSent }: { setup: Ok; before: { name: string; sections: string[] } | null; replaces?: string; onCancel?: () => void; onTouched: () => void; onSent: () => Promise<unknown> }) {
  const [layout, setLayout] = useState<Layout>(startLayout)
  const fromBefore = before ? setup.sections.filter(s => before.sections.includes(s.name) && !s.held_by).map(s => s.id) : null
  const [floors, setFloorsNow] = useState<string[]>(() => {
    if (!fromBefore) return setup.start_floors
    const wanted = new Set(setup.sections.filter(s => fromBefore.includes(s.id)).map(s => s.floor))
    return setup.floors.map(f => f.id).filter(id => wanted.has(id))
  })
  const [ticked, setTickedNow] = useState<string[]>(fromBefore ?? setup.sections.filter(s => s.suggested && !s.held_by).map(s => s.id))
  const [name, setNameNow] = useState(before?.name ?? '')
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  // A refusal, or a note about what was done before, is stale once anything changes.
  const touched = () => { setError(null); onTouched() }
  const setFloors = (next: string[]) => { touched(); setFloorsNow(next) }
  const setTicked = (next: string[]) => { touched(); setTickedNow(next) }
  const setName = (next: string) => { touched(); setNameNow(next) }
  const [busy, setBusy] = useState(false)
  useEffect(() => keepLayout(layout), [layout])
  const chosen = setup.sections.filter(s => ticked.includes(s.id))
  const trimmed = name.trim()
  async function send() {
    setBusy(true)
    setError(null)
    try { await act('set_up_department', { job: setup.job.id, name: trimmed, sections: chosen.map(s => s.id), ...(replaces ? { replaces } : {}) }); await onSent() }
    catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }
  // The read lists every floor a section is on, "No floor" included.
  const floorName = (id: string) => setup.floors.find(f => f.id === id)!.name
  const shownSections = setup.sections.filter(s => floors.includes(s.floor))

  const floorPicker = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Floors" data-testid="floors">
        {setup.floors.map(f => (
          <Button key={f.id || 'none'} variant={floors.includes(f.id) ? 'primary' : 'secondary'} aria-pressed={floors.includes(f.id)} onClick={() => setFloors(toggle(floors, f.id))}>{f.name}</Button>
        ))}
      </div>
      <p className="fd-muted text-sm">{setup.start_floors.length === 1 ? `Your Team Leaders' sections are on the ${floorName(setup.start_floors[0])}. ` : ''}If your department spans more than one floor, choose each.</p>
    </div>
  )
  const sectionRow = (s: Section) => (
    <label key={s.id} className={`flex items-start gap-3 px-4 py-3 ${s.held_by ? 'opacity-60' : 'cursor-pointer'}`} data-testid="section-row">
      <input type="checkbox" className="mt-1 size-5 shrink-0" checked={ticked.includes(s.id)} disabled={!!s.held_by} onChange={() => setTicked(toggle(ticked, s.id))} aria-label={s.name} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-semibold">{s.name} <span className="fd-muted font-normal">· {floorName(s.floor)}</span></span>
        <span className="text-sm">{sellsLine(s)}</span>
        <span className="fd-muted text-sm">{s.team_leaders.length ? `Team Leader: ${listed(s.team_leaders)}` : 'No Team Leader'}</span>
        {s.suggested && !s.held_by && <span><StatusPill tone="opportunity">Your Team Leader runs it</StatusPill></span>}
        {s.held_by && <span className="fd-muted text-sm" data-testid="held-by">Already in {s.held_by}. Ask {setup.reviewer} if it should move to you.</span>}
      </span>
    </label>
  )
  const sectionList = shownSections.length
    ? <div className="flex flex-col divide-y divide-border">{shownSections.map(sectionRow)}</div>
    : <p className="fd-muted p-4" data-testid="no-floor-chosen">Choose a floor to see its sections.</p>
  const namePicker = (
    <div className="flex flex-col gap-3">
      {setup.names.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Names other stores use</span>
          <div className="flex flex-wrap gap-2" data-testid="names">
            {setup.names.map(n => <Button key={n} variant={trimmed === n ? 'primary' : 'secondary'} aria-pressed={trimmed === n} onClick={() => setName(n)}>{n}</Button>)}
          </div>
        </div>
      )}
      <Field label="Department name" hint="Use the name your store uses on the floor, for example Ladies Ethnic.">
        <TextInput value={name} maxLength={60} onChange={event => setName(event.target.value)} data-testid="name-input" />
      </Field>
    </div>
  )
  const summary = `${chosen.length} ${chosen.length === 1 ? 'section' : 'sections'}${trimmed ? ` · ${trimmed}` : ''}. Nothing changes until ${setup.reviewer} keeps it.`
  const cancel = onCancel && <Button variant="quiet" disabled={busy} onClick={onCancel} data-testid="cancel-change">Cancel</Button>
  const sendBar = (
    <div className="flex flex-col gap-2">
      {error && <Notice tone="negative"><span data-testid="refused">{error}</span></Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || !chosen.length || !trimmed} onClick={send} data-testid="send">Send to {setup.reviewer}</Button>
        {cancel}
        <span className="fd-muted text-sm" data-testid="summary">{summary}</span>
      </div>
    </div>
  )
  const lead = <p className="fd-muted" data-testid="lead">Say which sections are yours and give the department a name. {capital(setup.reviewer)} reviews it, and your report opens once it is kept.{replaces ? ' What you send replaces the one waiting.' : ''}</p>
  const toggleBar = <Segmented label="Layout" options={LAYOUTS} value={layout} onChange={value => { setLayout(value); setStep(1) }} className="self-end" />

  if (layout === 'list')
    return (
      <>
        {toggleBar}
        {lead}
        <Card title="Your department" data-testid="layout-list">
          <div className="border-b border-border p-4">{floorPicker}</div>
          {/* The read lists only floors that have a section. */}
          {setup.floors.filter(f => floors.includes(f.id)).map(f => (
            <div key={f.id || 'none'}>
              <h3 className="bg-subtle px-4 py-2 text-sm font-semibold">{f.name}</h3>
              <div className="flex flex-col divide-y divide-border">{shownSections.filter(s => s.floor === f.id).map(sectionRow)}</div>
            </div>
          ))}
          {!shownSections.length && sectionList}
          <div className="border-t border-border p-4">{namePicker}</div>
        </Card>
        {sendBar}
      </>
    )
  if (layout === 'wizard')
    return (
      <>
        {toggleBar}
        {lead}
        <p className="text-sm font-semibold" data-testid="wizard-step">Step {step} of 3</p>
        {step === 1 && <Card title="Which floor are you on?" data-testid="layout-wizard"><div className="p-4">{floorPicker}</div></Card>}
        {step === 2 && <Card title="Tick your sections" data-testid="layout-wizard">{sectionList}</Card>}
        {step === 3 && (
          <Card title="What is your department called?" data-testid="layout-wizard">
            <div className="flex flex-col gap-3 p-4">{namePicker}<p className="text-sm" data-testid="wizard-sections">{listed(chosen.map(s => s.name))}</p></div>
          </Card>
        )}
        <div className="flex flex-wrap gap-2">
          {step > 1 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {step < 3 && <Button variant="primary" disabled={step === 2 && !chosen.length} onClick={() => setStep(step + 1)} data-testid="next">Next</Button>}
          {step < 3 && cancel}
        </div>
        {step === 3 && sendBar}
      </>
    )
  return (
    <>
      {toggleBar}
      {lead}
      <Card title="1. Which floor are you on?" data-testid="layout-steps"><div className="p-4">{floorPicker}</div></Card>
      <Card title="2. Tick your sections">{sectionList}</Card>
      <Card title="3. What is your department called?"><div className="p-4">{namePicker}</div></Card>
      {sendBar}
    </>
  )
}

/** Set-ups waiting for this reviewer, on Waiting for your approval. */
export interface WaitingSetup { bundle: string; who: string; job: string; store: string; name: string; asked_on: string; applied?: boolean; sections: { id: string; name: string; team_leaders: string[] }[] }

export function DepartmentApprovals({ setups, onDecided }: { setups: WaitingSetup[]; onDecided: (said: string) => Promise<unknown> }) {
  return <>{setups.map(setup => <SetupCard key={setup.bundle} setup={setup} onDecided={onDecided} />)}</>
}

function SetupCard({ setup, onDecided }: { setup: WaitingSetup; onDecided: (said: string) => Promise<unknown> }) {
  const [mode, setMode] = useState<'view' | 'change' | 'reject'>('view')
  const [name, setName] = useState(setup.name)
  const [keep, setKeep] = useState(setup.sections.map(s => s.id))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function decide(payload: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await act('decide_department', { bundle: setup.bundle, ...payload })
      await onDecided(payload.decision === 'reject' ? `Turned down. ${setup.who} sees your reason.` : `Kept. ${setup.who}'s report now shows these sections.`)
    }
    catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }
  return (
    <Card title={`${setup.who} · ${setup.job}`} data-testid="setup-card" actions={<StatusPill tone="caution">New department</StatusPill>}>
      <div className="flex flex-col gap-3 p-4">
        <p className="font-semibold" data-testid="setup-ask">Set up “{setup.name}” at {setup.store}</p>
        {setup.applied && <p className="text-sm" data-testid="setup-applied">Already in use: {setup.who}'s report shows these sections. Keep it, or undo it.</p>}
        {mode === 'change' ? (
          <>
            {!setup.applied && <Field label="Department name"><TextInput value={name} maxLength={60} onChange={event => setName(event.target.value)} data-testid="change-name" /></Field>}
            <div className="flex flex-col gap-1">
              {setup.sections.map(s => (
                <label key={s.id} className="flex items-center gap-3 py-1">
                  <input type="checkbox" className="size-5" checked={keep.includes(s.id)} onChange={() => setKeep(toggle(keep, s.id))} aria-label={s.name} />
                  <span>{s.name} <span className="fd-muted">· {s.team_leaders.length ? `Team Leader ${listed(s.team_leaders)}` : 'no Team Leader'}</span></span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="setup-sections">
            {setup.sections.map(s => <li key={s.id}>{s.name} <span className="fd-muted">· {s.team_leaders.length ? `Team Leader ${listed(s.team_leaders)}` : 'no Team Leader'}</span></li>)}
          </ul>
        )}
        {mode === 'reject' && (
          <Field label="Why not?"><TextInput value={reason} onChange={event => setReason(event.target.value)} data-testid="reject-reason" /></Field>
        )}
        <p className="fd-muted text-sm">Asked on {fmtDate(setup.asked_on)}. Keeping it opens {setup.who}'s report for these sections.</p>
        {error && <Notice tone="negative"><span data-testid="decide-refused">{error}</span></Notice>}
        <div className="flex flex-wrap gap-2">
          {mode === 'view' && <>
            <Button variant="primary" disabled={busy} onClick={() => decide({ decision: 'approve' })} data-testid="keep">Keep it</Button>
            <Button disabled={busy} onClick={() => setMode('change')}>Change, then keep</Button>
            <Button variant="quiet" disabled={busy} onClick={() => setMode('reject')}>{setup.applied ? 'Undo it' : 'Turn down'}</Button>
          </>}
          {mode === 'change' && <>
            <Button variant="primary" disabled={busy || !keep.length || !name.trim()} onClick={() => decide({ decision: 'approve', name: name.trim(), sections: keep })} data-testid="keep-changed">Keep with changes</Button>
            <Button variant="quiet" disabled={busy} onClick={() => setMode('view')}>Cancel</Button>
          </>}
          {mode === 'reject' && <>
            <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => decide({ decision: 'reject', reason: reason.trim() })} data-testid="confirm-reject">{setup.applied ? 'Undo it' : 'Turn it down'}</Button>
            <Button variant="quiet" disabled={busy} onClick={() => setMode('view')}>Cancel</Button>
          </>}
        </div>
      </div>
    </Card>
  )
}
