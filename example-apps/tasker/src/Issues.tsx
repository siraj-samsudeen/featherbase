import { Button, fmtDate, fmtInstantIST } from '@featherbase/shop-floor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import manifest from '../featherbase.json'
import { api, listAllResources, uploadRowFile } from './api'
import { ReasonForm } from './Closure'
import { DEFAULT_RULES, SEVERITIES, clockMinutes, duration, type ClockMode, type SlaRule } from './sla'
import { useStores, type Store } from './Stores'

type NameOf = (person: string) => string
const ISSUE = 'tasker.issue'
const SUBMITTED = 'Submitted for verification'
const ACTIVE = ['Open', 'Acknowledged']
const issueColumns: { column_name: string; choices?: string }[] = manifest.tables.find(table => table.name === ISSUE)!.columns
const choices = (column: string) => issueColumns.find(entry => entry.column_name === column)!.choices!.split('\n')
export const CATEGORIES = choices('category')
export const FUNCTIONS = choices('owner_function')

export interface Issue {
  row_id: string
  updated_at: string
  issue_title: string
  category: string
  severity: string
  store: string | null
  occurred_at: string | null
  asset_area: string | null
  impact: string | null
  containment: string | null
  photo: string | null
  owner_function: string
  owner: string | null
  verifier: string | null
  issue_state: string
  raised_at: string
  acknowledged_at: string | null
  submitted_at: string | null
  submitted_by: string | null
  closed_at: string | null
  verified_by: string | null
  evidence_note: string | null
  return_reason: string | null
  return_count: number | null
  clock: ClockMode
  opens_at: string | null
  closes_at: string | null
  respond_minutes: number
  fix_minutes: number
  respond_by: string
  fix_by: string
  response_breached: boolean
  fix_breached: boolean
  breached_at: string | null
  pause_requested: boolean
  pause_reason: string | null
  pause_review_on: string | null
  paused: boolean
  paused_since: string | null
  on_clock_minutes: number | null
  used_pct: number | null
  needs_owner: boolean
  issue_log: string | null
  created_by: string
}
interface LogEntry { at: string; kind: string; by?: string; to?: string[]; note?: string }
const FIELDS = ['row_id', 'updated_at', 'issue_title', 'category', 'severity', 'store', 'occurred_at', 'asset_area', 'impact', 'containment', 'photo',
  'owner_function', 'owner', 'verifier', 'issue_state', 'raised_at', 'acknowledged_at', 'submitted_at', 'submitted_by', 'closed_at', 'verified_by',
  'evidence_note', 'return_reason', 'return_count', 'clock', 'opens_at', 'closes_at', 'respond_minutes', 'fix_minutes', 'respond_by', 'fix_by',
  'response_breached', 'fix_breached', 'breached_at', 'pause_requested', 'pause_reason', 'pause_review_on', 'paused', 'paused_since',
  'on_clock_minutes', 'used_pct', 'needs_owner', 'issue_log', 'created_by']

export function useIssues() {
  return useQuery({ queryKey: ['task-management', 'issues'], refetchInterval: 60_000,
    queryFn: () => listAllResources<Issue>(ISSUE, { fields: FIELDS, order_by: 'raised_at desc', limit_page_length: 500 }) })
}
const logOf = (issue: Issue): LogEntry[] => JSON.parse(issue.issue_log || '[]')
const hashIssueId = () => new URLSearchParams(location.hash.slice(1)).get('issue')
const left = (issue: Issue) => issue.fix_minutes - Number(issue.on_clock_minutes ?? 0)
const breached = (issue: Issue) => issue.fix_breached || (ACTIVE.includes(issue.issue_state) && left(issue) < 0)

/** The one-line clock an issue row shows, with a tone for its colour. */
function clockNote(issue: Issue, nameOf: NameOf): { tone: string; text: string } {
  if (issue.issue_state === 'Closed') return { tone: breached(issue) ? 'breached' : 'ok', text: breached(issue) ? 'Closed · fix time was breached' : 'Closed' }
  if (issue.issue_state === SUBMITTED) return { tone: 'waiting', text: issue.verifier ? `Waiting for ${nameOf(issue.verifier)} to verify` : 'Submitted' }
  if (issue.paused) return { tone: 'paused', text: `Paused${issue.pause_review_on ? ` · review ${fmtDate(String(issue.pause_review_on).slice(0, 10))}` : ''}` }
  if (breached(issue)) return { tone: 'breached', text: `Breached by ${duration(-left(issue))}` }
  if (Number(issue.used_pct) >= 75) return { tone: 'warning', text: `Fix in ${duration(left(issue))} · ${issue.used_pct}% used` }
  return { tone: 'ok', text: `Fix in ${duration(left(issue))}` }
}
function ownerNote(issue: Issue, nameOf: NameOf) {
  if (!issue.owner) return 'Needs an owner'
  if (issue.issue_state === 'Open') return `Not acknowledged by ${nameOf(issue.owner)}`
  return `Owner: ${nameOf(issue.owner)}`
}
const LOG_LABELS: Record<string, string> = {
  raised: 'Raised', assigned: 'Assigned', acknowledged: 'Acknowledged', reminder: '75% reminder', breach: 'Breached', director: 'Director told',
  missing: 'No one to escalate to', response_missed: 'Response time missed', pause_requested: 'Pause asked for', paused: 'Pause approved',
  resumed: 'Clock resumed', submitted: 'Submitted', returned: 'Returned', closed: 'Closed', reopened: 'Reopened',
}
function logText(entry: LogEntry, nameOf: NameOf) {
  const label = LOG_LABELS[entry.kind] ?? entry.kind
  if (entry.to?.length) return `${label} · notice to ${entry.to.map(nameOf).join(', ')}`
  if (entry.kind === 'missing') return entry.note ?? label
  // Clock checks run as whoever raised the issue, so only people's own steps name them.
  const by = entry.by && ['acknowledged', 'pause_requested', 'paused', 'resumed', 'submitted', 'returned', 'reopened'].includes(entry.kind) ? ` by ${nameOf(entry.by)}` : ''
  return `${label}${by}${entry.note ? `: ${entry.note}` : ''}`
}

function Choice({ label, value, options, onChange, required, blank }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void; required?: boolean; blank?: string }) {
  return <label>{label}<select aria-label={label} required={required} value={value} onChange={(event) => onChange(event.target.value)}>
    {blank !== undefined && <option value="">{blank}</option>}
    {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
  </select></label>
}

function RaiseIssue({ people, nameOf, onRaised, onCancel }: { people: { row_id: string }[]; nameOf: NameOf; onRaised: (notice: string) => Promise<void>; onCancel: () => void }) {
  const stores = useStores()
  const [draft, setDraft] = useState({ issue_title: '', category: CATEGORIES[0], severity: 'Medium', store: '', occurred_at: '', asset_area: '', impact: '', containment: '', owner_function: FUNCTIONS[0], owner: '', verifier: '' })
  const [photo, setPhoto] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (field: keyof typeof draft) => (value: string) => setDraft({ ...draft, [field]: value })
  const personOptions = people.map(person => [person.row_id, nameOf(person.row_id)] as [string, string])
  return <form aria-label="Raise an issue" className="tasker-issue-form" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    let raised: { row_id: string; updated_at: string }
    try {
      raised = await api.post('/api/save_row', { table: ISSUE, row: {
        ...draft, store: draft.store || null, owner: draft.owner || null, verifier: draft.verifier || null,
        occurred_at: draft.occurred_at ? new Date(draft.occurred_at).toISOString() : null,
      } })
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not raise the issue'); setBusy(false); return }
    // The photo hangs on the raised issue, so whoever can open the issue opens it.
    let notice = ''
    if (photo) {
      try {
        const photoUrl = await uploadRowFile(photo, ISSUE, raised.row_id)
        await api.patch(`/api/table/${ISSUE}/${encodeURIComponent(raised.row_id)}`, { photo: photoUrl, updated_at: raised.updated_at })
      } catch (failure) { notice = `The issue was raised, but its photo was not added: ${failure instanceof Error ? failure.message : 'the upload failed'}` }
    }
    setBusy(false)
    await onRaised(notice)
  }}>
    <label className="tasker-issue-wide">What happened<input aria-label="What happened" required value={draft.issue_title} onChange={(event) => set('issue_title')(event.target.value)} placeholder="Dairy chiller 2 at 9°C" /></label>
    <Choice label="Category" value={draft.category} options={CATEGORIES.map(value => [value, value])} onChange={set('category')} required />
    <Choice label="Severity" value={draft.severity} options={SEVERITIES.map(value => [value, value])} onChange={set('severity')} required />
    <Choice label="Store" value={draft.store} options={stores.map(store => [store.row_id, store.store_name])} onChange={set('store')} blank="No store" />
    <label>Happened at<input type="datetime-local" aria-label="Happened at" value={draft.occurred_at} onChange={(event) => set('occurred_at')(event.target.value)} /></label>
    <label>Asset or area<input aria-label="Asset or area" value={draft.asset_area} onChange={(event) => set('asset_area')(event.target.value)} /></label>
    <Choice label="Owner function" value={draft.owner_function} options={FUNCTIONS.map(value => [value, value])} onChange={set('owner_function')} required />
    <label className="tasker-issue-half">Impact<textarea aria-label="Impact" rows={2} value={draft.impact} onChange={(event) => set('impact')(event.target.value)} /></label>
    <label className="tasker-issue-half">Done right away<textarea aria-label="Done right away" rows={2} value={draft.containment} onChange={(event) => set('containment')(event.target.value)} /></label>
    <Choice label="Owner" value={draft.owner} options={personOptions} onChange={set('owner')} blank="Decide later" />
    <Choice label="Verifier" value={draft.verifier} options={personOptions.filter(([id]) => id !== draft.owner)} onChange={set('verifier')} blank="No verifier" />
    <label>Photo (optional)<input type="file" accept="image/*" aria-label="Issue photo" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} /></label>
    {error && <p role="alert" className="tasker-issue-wide">{error}</p>}
    <div className="tasker-reason-actions tasker-issue-wide">
      <Button type="submit" variant="primary" disabled={busy}>Raise issue</Button>
      <Button type="button" disabled={busy} onClick={onCancel}>Never mind</Button>
    </div>
  </form>
}

function Clock({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) {
  return <div role="group" aria-label={label} className="tasker-issue-clock" data-tone={tone}><p className="tasker-issue-clock-label">{label}</p>{children}</div>
}

function IssueDetail({ issue, me, people, nameOf, onSaved }: { issue: Issue; me: string; people: { row_id: string }[]; nameOf: NameOf; onSaved: () => Promise<void> }) {
  const stores = useStores()
  const queryClient = useQueryClient()
  const store = stores.find(entry => entry.row_id === issue.store)
  const [form, setForm] = useState<'pause' | 'submit' | 'return' | 'reopen' | null>(null)
  const [pause, setPause] = useState({ reason: '', review: '' })
  const [note, setNote] = useState('')
  const [newTask, setNewTask] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setForm(null); setError('') }, [issue.row_id])
  const tasks = useQuery({ queryKey: ['task-management', 'issue-tasks', issue.row_id],
    queryFn: () => listAllResources<{ row_id: string; task_title: string; task_state: string; assigned_to: string | null }>('tasker.task', {
      fields: ['row_id', 'task_title', 'task_state', 'assigned_to'], filters: [['issue', '=', issue.row_id]], order_by: 'created_at asc', limit_page_length: 100 }) })
  async function patch(values: Record<string, unknown>) {
    setBusy(true); setError('')
    try {
      await api.patch(`/api/table/${ISSUE}/${encodeURIComponent(issue.row_id)}`, { ...values, updated_at: issue.updated_at })
      await onSaved()
      setForm(null)
      return true
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update the issue'); return false }
    finally { setBusy(false) }
  }
  const now = Date.now()
  const active = ACTIVE.includes(issue.issue_state)
  const isOwner = issue.owner === me
  const responseMinutes = issue.acknowledged_at ? clockMinutes(Date.parse(issue.raised_at), Date.parse(issue.acknowledged_at), issue.clock, { opens: issue.opens_at || '09:00', closes: issue.closes_at || '22:00' }) : null
  const verifyEnd = issue.closed_at ? Date.parse(issue.closed_at) : now
  const clock = clockNote(issue, nameOf)
  const personOptions = people.map(person => [person.row_id, nameOf(person.row_id)] as [string, string])
  return <section aria-label="Issue detail" className="tasker-issue-detail">
    <div className="tasker-issue-detail-head">
      <h2>{issue.issue_title}</h2>
      <a href="#" className="tasker-issue-close">Close</a>
    </div>
    <p className="tasker-issue-facts">
      <span className="tasker-severity" data-severity={issue.severity}>{issue.severity}</span>
      {[issue.category, store?.store_name, issue.asset_area, issue.owner_function, issue.occurred_at ? `happened ${fmtInstantIST(issue.occurred_at)}` : null].filter(Boolean).join(' · ')}
    </p>
    {(issue.impact || issue.containment) && <dl className="tasker-issue-notes">
      {issue.impact && <><dt>Impact</dt><dd>{issue.impact}</dd></>}
      {issue.containment && <><dt>Done right away</dt><dd>{issue.containment}</dd></>}
    </dl>}
    {issue.photo && <a href={issue.photo} target="_blank" rel="noreferrer" className="tasker-evidence-photo"><img src={issue.photo} alt="Issue photo" /></a>}
    <div className="tasker-issue-people">
      <Choice label="Issue owner" value={issue.owner ?? ''} options={personOptions} blank="Needs an owner" onChange={(value) => void patch({ owner: value || null })} />
      <Choice label="Issue verifier" value={issue.verifier ?? ''} options={personOptions.filter(([id]) => id !== issue.owner)} blank="No verifier" onChange={(value) => void patch({ verifier: value || null })} />
    </div>
    <div className="tasker-issue-clocks">
      <Clock label="Response clock" tone={issue.response_breached ? 'breached' : issue.acknowledged_at ? 'ok' : undefined}>
        <p>Respond by {fmtInstantIST(issue.respond_by)}</p>
        <p className="tasker-issue-clock-value">{responseMinutes !== null ? `${issue.response_breached ? 'Missed' : 'Met'} · ${duration(responseMinutes)}` : issue.response_breached ? 'Missed · not acknowledged' : 'Waiting for the owner'}</p>
      </Clock>
      <Clock label="Resolution clock" tone={clock.tone}>
        <p>Fix by {issue.paused ? 'paused' : fmtInstantIST(issue.fix_by)} · {issue.clock === 'Store hours' ? `store hours ${issue.opens_at}–${issue.closes_at}` : 'round the clock'}</p>
        <p className="tasker-issue-clock-value">{clock.text}</p>
        <div className="tasker-issue-bar"><div style={{ width: `${Math.min(100, Number(issue.used_pct ?? 0))}%` }} /></div>
        <p className="tasker-evidence-by">Elapsed {duration((now - Date.parse(issue.raised_at)) / 60_000)} · on the clock {duration(Number(issue.on_clock_minutes ?? 0))}</p>
        {issue.fix_breached && issue.breached_at && <p className="tasker-evidence-by">Fix time breached {fmtInstantIST(issue.breached_at)}</p>}
      </Clock>
      <Clock label="Verification clock" tone={issue.issue_state === SUBMITTED ? 'waiting' : undefined}>
        <p className="tasker-issue-clock-value">{issue.submitted_at ? `${issue.closed_at ? 'Took' : 'Waiting'} ${duration((verifyEnd - Date.parse(issue.submitted_at)) / 60_000)}` : 'Starts when submitted'}</p>
        {issue.verified_by && <p className="tasker-evidence-by">Verified by {nameOf(issue.verified_by)}</p>}
      </Clock>
    </div>
    {issue.pause_requested && !issue.paused && <p className="tasker-issue-status">Pause asked for · the clock runs until the store manager approves{issue.pause_reason ? ` · ${issue.pause_reason}` : ''}</p>}
    {issue.paused && <p className="tasker-issue-status">Paused since {issue.paused_since ? fmtInstantIST(issue.paused_since) : ''}{issue.pause_reason ? ` · ${issue.pause_reason}` : ''}</p>}
    {issue.return_reason && active && <p className="tasker-issue-status" data-tone="warning">Returned: {issue.return_reason}</p>}
    {issue.evidence_note && !active && <div className="tasker-evidence"><p className="tasker-evidence-by">What was done{issue.submitted_by ? `, by ${nameOf(issue.submitted_by)}` : ''}</p><p className="tasker-evidence-note">{issue.evidence_note}</p></div>}
    {error && <p role="alert">{error}</p>}
    <div className="tasker-verification-actions">
      {isOwner && issue.issue_state === 'Open' && <Button type="button" variant="primary" disabled={busy} onClick={() => void patch({ issue_state: 'Acknowledged' })}>Acknowledge</Button>}
      {isOwner && active && !issue.pause_requested && !issue.paused && <Button type="button" disabled={busy} onClick={() => setForm('pause')}>Waiting for vendor</Button>}
      {issue.pause_requested && !issue.paused && store?.store_manager === me && <Button type="button" variant="primary" disabled={busy} onClick={() => void patch({ paused: true })}>Approve pause</Button>}
      {issue.paused && (isOwner || store?.store_manager === me) && <Button type="button" disabled={busy} onClick={() => void patch({ paused: false })}>Resume clock</Button>}
      {isOwner && active && <Button type="button" disabled={busy} onClick={() => { setForm('submit'); setNote(issue.evidence_note ?? '') }}>{issue.verifier ? 'Submit for verification' : 'Close issue'}</Button>}
      {issue.issue_state === SUBMITTED && issue.verifier === me && <>
        <Button type="button" variant="primary" disabled={busy} onClick={() => void patch({ issue_state: 'Closed' })}>Accept and close</Button>
        <Button type="button" disabled={busy} onClick={() => setForm('return')}>Return</Button>
      </>}
      {issue.issue_state === 'Closed' && <Button type="button" disabled={busy} onClick={() => setForm('reopen')}>Reopen</Button>}
    </div>
    {form === 'pause' && <form className="tasker-reason-form" onSubmit={(event) => { event.preventDefault(); void patch({ pause_requested: true, pause_reason: pause.reason.trim(), pause_review_on: pause.review || null }) }}>
      <label>What you are waiting for<input aria-label="What you are waiting for" autoFocus value={pause.reason} onChange={(event) => setPause({ ...pause, reason: event.target.value })} /></label>
      <label>Next review<input type="date" aria-label="Next review" value={pause.review} onChange={(event) => setPause({ ...pause, review: event.target.value })} /></label>
      <div className="tasker-reason-actions"><Button type="submit" variant="primary" disabled={busy}>Ask to pause</Button><Button type="button" onClick={() => setForm(null)}>Never mind</Button></div>
    </form>}
    {form === 'submit' && <form className="tasker-submit-form" onSubmit={(event) => { event.preventDefault(); void patch({ issue_state: SUBMITTED, evidence_note: note.trim() || null }) }}>
      <label>What was done<textarea aria-label="What was done" rows={3} autoFocus value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="tasker-reason-actions"><Button type="submit" variant="primary" disabled={busy}>Submit</Button><Button type="button" onClick={() => setForm(null)}>Not yet</Button></div>
    </form>}
    {form === 'return' && <ReasonForm label="Reason for returning" action="Return issue" onClose={() => setForm(null)} onSubmit={(reason) => patch({ issue_state: 'Acknowledged', change_reason: reason })} />}
    {form === 'reopen' && <ReasonForm label="Reason for reopening" action="Reopen issue" onClose={() => setForm(null)} onSubmit={(reason) => patch({ issue_state: 'Acknowledged', change_reason: reason })} />}
    <div className="tasker-issue-columns">
      <div>
        <h3>Escalation log</h3>
        <ol aria-label="Escalation log" className="tasker-issue-log">
          {logOf(issue).map((entry, index) => <li key={index} data-kind={entry.kind}><span>{fmtInstantIST(entry.at)}</span> {logText(entry, nameOf)}</li>)}
        </ol>
      </div>
      <div>
        <h3>Corrective tasks</h3>
        <ul aria-label="Corrective tasks" className="tasker-issue-tasks">
          {(tasks.data?.data ?? []).map(task => <li key={task.row_id}>
            <a href={`#task=${encodeURIComponent(task.row_id)}`}>{task.task_title}</a>
            <span className="tasker-evidence-by"> · {task.task_state}{task.assigned_to ? ` · ${nameOf(task.assigned_to)}` : ''}</span>
          </li>)}
        </ul>
        <form className="tasker-issue-task-form" onSubmit={async (event) => {
          event.preventDefault()
          const title = newTask.trim()
          if (!title) return
          setError('')
          try {
            await api.post('/api/save_row', { table: 'tasker.task', row: { task_title: title, issue: issue.row_id } })
            setNewTask('')
            await queryClient.invalidateQueries({ queryKey: ['task-management'] })
          } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not add the task') }
        }}>
          <input aria-label="New corrective task" placeholder="Add a corrective task, then press Enter" value={newTask} onChange={(event) => setNewTask(event.target.value)} />
        </form>
      </div>
    </div>
  </section>
}

function SlaRules({ people, nameOf, onSaved }: { people: { row_id: string }[]; nameOf: NameOf; onSaved: () => Promise<void> }) {
  const stores = useStores()
  const queryClient = useQueryClient()
  const rules = useQuery({ queryKey: ['task-management', 'sla-rules'], queryFn: () => listAllResources<SlaRule & { row_id: string; updated_at: string }>('tasker.sla_rule', {
    fields: ['row_id', 'updated_at', 'severity', 'category', 'respond_minutes', 'fix_minutes', 'clock', 'director', 'director_after_minutes'], limit_page_length: 200 }) })
  const heads = useQuery({ queryKey: ['task-management', 'function-heads'], queryFn: () => listAllResources<{ row_id: string; updated_at: string; owner_function: string; head: string }>('tasker.function_head', {
    fields: ['row_id', 'updated_at', 'owner_function', 'head'], limit_page_length: 50 }) })
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  const [storeDrafts, setStoreDrafts] = useState<Record<string, Record<string, string>>>({})
  const [override, setOverride] = useState({ severity: 'High', category: CATEGORIES[0], respond: '1', fix: '2', clock: 'Round the clock' })
  const [error, setError] = useState('')
  const all = rules.data?.data ?? []
  const personOptions = people.map(person => [person.row_id, nameOf(person.row_id)] as [string, string])
  async function save(table: string, row: Record<string, unknown>) {
    setError('')
    try {
      await api.post('/api/save_row', { table, row })
      await queryClient.invalidateQueries({ queryKey: ['task-management'] })
      await onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save') }
  }
  const hours = (minutes: unknown) => String(Number(minutes) / 60)
  const ruleRow = (severity: string) => all.find(rule => rule.severity === severity && !rule.category)
  const draftFor = (severity: string) => {
    const rule = ruleRow(severity) ?? DEFAULT_RULES[severity]
    return { respond: hours(rule.respond_minutes), fix: hours(rule.fix_minutes), clock: rule.clock, director: rule.director ?? '', after: rule.director_after_minutes ? hours(rule.director_after_minutes) : '', ...drafts[severity] }
  }
  const storeDraft = (store: Store) => ({ manager: store.store_manager ?? '', opens: store.opens_at ?? '09:00', closes: store.closes_at ?? '22:00', ...storeDrafts[store.row_id] })
  const saveStore = (store: Store, values: Record<string, string>) => save('tasker.store', { row_id: store.row_id, updated_at: store.updated_at,
    store_manager: values.manager || null, opens_at: values.opens, closes_at: values.closes })
  return <section aria-labelledby="sla-heading" className="tasker-sla">
    <div className="tasker-section-title"><h2 id="sla-heading">SLA rules and people</h2><p>Proposed defaults until the business approves its own. Times are in hours.</p></div>
    {error && <p role="alert">{error}</p>}
    <table aria-label="SLA rules" className="tasker-sla-table">
      <thead><tr><th>Severity</th><th>Respond within</th><th>Fix within</th><th>Clock</th><th>Director</th><th>Director after breach</th><th /></tr></thead>
      <tbody>{SEVERITIES.map(severity => {
        const draft = draftFor(severity)
        const set = (field: string) => (value: string) => setDrafts({ ...drafts, [severity]: { ...drafts[severity], [field]: value } })
        const existing = ruleRow(severity)
        return <tr key={severity}>
          <th scope="row"><span className="tasker-severity" data-severity={severity}>{severity}</span></th>
          <td><input type="number" min="0" step="0.25" aria-label={`${severity}: respond within hours`} value={draft.respond} onChange={(event) => set('respond')(event.target.value)} /></td>
          <td><input type="number" min="0" step="0.25" aria-label={`${severity}: fix within hours`} value={draft.fix} onChange={(event) => set('fix')(event.target.value)} /></td>
          <td><select aria-label={`${severity}: clock`} value={draft.clock} onChange={(event) => set('clock')(event.target.value)}><option>Round the clock</option><option>Store hours</option></select></td>
          <td><select aria-label={`${severity}: director`} value={draft.director} onChange={(event) => set('director')(event.target.value)}><option value="">No director</option>{personOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></td>
          <td><input type="number" min="0" step="0.25" aria-label={`${severity}: director after hours`} value={draft.after} onChange={(event) => set('after')(event.target.value)} /></td>
          <td><Button type="button" aria-label={`Save ${severity}`} onClick={() => void save('tasker.sla_rule', {
            ...(existing ? { row_id: existing.row_id, updated_at: existing.updated_at } : {}), severity,
            respond_minutes: Math.round(Number(draft.respond) * 60), fix_minutes: Math.round(Number(draft.fix) * 60), clock: draft.clock,
            director: draft.director || null, director_after_minutes: draft.after ? Math.round(Number(draft.after) * 60) : null,
          }).then(() => setDrafts({ ...drafts, [severity]: {} }))}>Save</Button></td>
        </tr>
      })}</tbody>
    </table>
    <h3>Category rules</h3>
    <ul className="tasker-sla-overrides">
      {all.filter(rule => rule.category).map(rule => <li key={rule.row_id}>{rule.category} · {rule.severity}: respond in {duration(rule.respond_minutes)}, fix in {duration(rule.fix_minutes)}, {rule.clock.toLowerCase()}</li>)}
    </ul>
    <form className="tasker-sla-override-form" aria-label="Add a category rule" onSubmit={(event) => { event.preventDefault(); void save('tasker.sla_rule', {
      severity: override.severity, category: override.category, respond_minutes: Math.round(Number(override.respond) * 60), fix_minutes: Math.round(Number(override.fix) * 60), clock: override.clock }) }}>
      <Choice label="Category" value={override.category} options={CATEGORIES.map(value => [value, value])} onChange={(value) => setOverride({ ...override, category: value })} />
      <Choice label="Severity" value={override.severity} options={SEVERITIES.map(value => [value, value])} onChange={(value) => setOverride({ ...override, severity: value })} />
      <label>Respond (hours)<input type="number" min="0" step="0.25" value={override.respond} onChange={(event) => setOverride({ ...override, respond: event.target.value })} /></label>
      <label>Fix (hours)<input type="number" min="0" step="0.25" value={override.fix} onChange={(event) => setOverride({ ...override, fix: event.target.value })} /></label>
      <Choice label="Clock" value={override.clock} options={[['Round the clock', 'Round the clock'], ['Store hours', 'Store hours']]} onChange={(value) => setOverride({ ...override, clock: value })} />
      <Button type="submit">Add category rule</Button>
    </form>
    <h3>Store managers and hours</h3>
    <table aria-label="Store managers and hours" className="tasker-sla-table">
      <thead><tr><th>Store</th><th>Store manager</th><th>Opens at</th><th>Closes at</th></tr></thead>
      <tbody>{stores.map(store => {
        const draft = storeDraft(store)
        const set = (field: string, value: string) => setStoreDrafts({ ...storeDrafts, [store.row_id]: { ...storeDrafts[store.row_id], [field]: value } })
        const commit = () => void saveStore(store, draft).then(() => setStoreDrafts({ ...storeDrafts, [store.row_id]: {} }))
        return <tr key={store.row_id}>
          <th scope="row">{store.store_name}</th>
          <td><select aria-label={`${store.store_name} manager`} value={draft.manager} onChange={(event) => void saveStore(store, { ...draft, manager: event.target.value })}><option value="">No manager</option>{personOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></td>
          <td><input aria-label={`${store.store_name} opens at`} value={draft.opens} onChange={(event) => set('opens', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') commit() }} onBlur={() => { if (draft.opens !== (store.opens_at ?? '09:00')) commit() }} /></td>
          <td><input aria-label={`${store.store_name} closes at`} value={draft.closes} onChange={(event) => set('closes', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') commit() }} onBlur={() => { if (draft.closes !== (store.closes_at ?? '22:00')) commit() }} /></td>
        </tr>
      })}</tbody>
    </table>
    <h3>Function heads</h3>
    <table aria-label="Function heads" className="tasker-sla-table">
      <tbody>{FUNCTIONS.map(name => {
        const head = (heads.data?.data ?? []).find(entry => entry.owner_function === name)
        return <tr key={name}><th scope="row">{name}</th><td>
          <select aria-label={`${name} head`} value={head?.head ?? ''} onChange={(event) => { if (event.target.value) void save('tasker.function_head', { ...(head ? { row_id: head.row_id, updated_at: head.updated_at } : {}), owner_function: name, head: event.target.value }) }}>
            <option value="">No head named</option>{personOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></td></tr>
      })}</tbody>
    </table>
  </section>
}

const FOR_YOU = ['assigned', 'reminder', 'breach', 'director']

/** Issues: raise, see every open issue's clock, notices for you, and the SLA rules. */
export function IssuesPage({ me, people, nameOf, onSaved }: { me: string; people: { row_id: string }[]; nameOf: NameOf; onSaved: () => Promise<void> }) {
  const issues = useIssues()
  const stores = useStores()
  const [selected, setSelected] = useState(hashIssueId)
  const [mode, setMode] = useState<'list' | 'rules'>('list')
  const [raising, setRaising] = useState(false)
  const [notice, setNotice] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  useEffect(() => {
    const change = () => { setSelected(hashIssueId()); if (hashIssueId()) setMode('list') }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  const all = issues.data?.data ?? []
  const open = all.filter(issue => issue.issue_state !== 'Closed')
  const order = (issue: Issue) => breached(issue) && ACTIVE.includes(issue.issue_state) ? -100000 + left(issue) : issue.issue_state === SUBMITTED ? 100000 : -Number(issue.used_pct ?? 0)
  const listed = [...(showClosed ? all : open)].sort((a, b) => order(a) - order(b))
  const counts: [string, number][] = [
    ['Open', open.length],
    ['Breached', open.filter(issue => ACTIVE.includes(issue.issue_state) && breached(issue)).length],
    ['Past 75%', open.filter(issue => ACTIVE.includes(issue.issue_state) && !breached(issue) && Number(issue.used_pct) >= 75).length],
    ['To verify', open.filter(issue => issue.issue_state === SUBMITTED && issue.verifier === me).length],
    ['Needs an owner', open.filter(issue => issue.needs_owner).length],
  ]
  const weekAgo = Date.now() - 7 * 86_400_000
  const notices = all.flatMap(issue => logOf(issue).filter(entry => FOR_YOU.includes(entry.kind) && entry.to?.includes(me) && Date.parse(entry.at) > weekAgo).map(entry => ({ issue, entry })))
    .sort((a, b) => Date.parse(b.entry.at) - Date.parse(a.entry.at)).slice(0, 8)
  const current = selected ? all.find(issue => issue.row_id === selected) : undefined
  const refresh = async () => { await issues.refetch(); await onSaved() }
  return <section aria-labelledby="issues-heading" className="tasker-issues">
    <div className="tasker-issues-head">
      <div className="tasker-section-title"><h2 id="issues-heading">Issues</h2><p>Failures and exceptions, each with one owner and its own clocks.</p></div>
      <div className="tasker-issues-modes">
        <Button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>Issue list</Button>
        <Button type="button" aria-pressed={mode === 'rules'} onClick={() => setMode('rules')}>SLA rules and people</Button>
      </div>
    </div>
    {mode === 'rules' ? <SlaRules people={people} nameOf={nameOf} onSaved={refresh} /> : <>
      {issues.error && <p role="alert">Could not load issues: {issues.error.message}</p>}
      {notice && <p role="alert">{notice}</p>}
      <div role="group" aria-label="Issue counts" className="tasker-issue-counts">
        {counts.map(([label, value]) => <div key={label} data-tone={label === 'Breached' && value ? 'breached' : label === 'Past 75%' && value ? 'warning' : undefined}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      {notices.length > 0 && <section aria-label="For you" className="tasker-issue-notices">
        <h3>For you</h3>
        <ul>{notices.map(({ issue, entry }, index) => <li key={index} data-kind={entry.kind}>
          <span>{fmtInstantIST(entry.at)}</span> {LOG_LABELS[entry.kind]} · <a href={`#issue=${encodeURIComponent(issue.row_id)}`}>{issue.issue_title}</a>
        </li>)}</ul>
      </section>}
      {current && <IssueDetail key={current.row_id} issue={current} me={me} people={people} nameOf={nameOf} onSaved={refresh} />}
      {raising ? <RaiseIssue people={people} nameOf={nameOf} onCancel={() => setRaising(false)} onRaised={async (raisedNotice) => { setRaising(false); setNotice(raisedNotice); await refresh() }} />
        : <Button type="button" variant="primary" onClick={() => { setRaising(true); setNotice('') }}>Raise an issue</Button>}
      <div className="tasker-issue-list-head">
        <h3>{showClosed ? 'All issues' : 'Open issues'}</h3>
        <label className="tasker-issue-show-closed"><input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} /> Show closed</label>
      </div>
      {!listed.length && !issues.isPending && <p className="text-ink-muted">No open issues.</p>}
      <ul aria-label={showClosed ? 'All issues' : 'Open issues'} className="tasker-issue-list">
        {listed.map(issue => {
          const clock = clockNote(issue, nameOf)
          return <li key={issue.row_id} aria-label={issue.issue_title} data-selected={issue.row_id === selected || undefined}>
            <a href={`#issue=${encodeURIComponent(issue.row_id)}`}>{issue.issue_title}</a>
            <span className="tasker-severity" data-severity={issue.severity}>{issue.severity}</span>
            <span className="tasker-issue-store">{stores.find(store => store.row_id === issue.store)?.store_name ?? 'No store'}</span>
            <span className="tasker-issue-clock-chip" data-tone={clock.tone}>{clock.text}</span>
            <span className="tasker-issue-owner" data-tone={!issue.owner ? 'breached' : undefined}>{ownerNote(issue, nameOf)}</span>
          </li>
        })}
      </ul>
    </>}
  </section>
}
