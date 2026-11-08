import { Button, fmtInstantIST } from '@featherbase/shop-floor'
import { useState } from 'react'
import { api, uploadRowFile } from './api'
import { SUBMITTED, closureNotes, type ClosureFields } from './verification'

type NameOf = (person: string) => string
type Patch = (patch: Record<string, unknown>) => Promise<boolean>

export interface VerifiableTask extends ClosureFields {
  row_id: string
  task_title: string
  verifier?: string | null
  evidence_note?: string | null
  evidence_photo?: string | null
  submitted_by?: string | null
  submitted_at?: string | null
}

/** Short notes on a task row or in its details: acknowledgement, waiting, returned, verified, extended. */
export function ClosureNotes({ task, nameOf }: { task: ClosureFields; nameOf: NameOf }) {
  const notes = closureNotes(task, nameOf)
  if (!notes.length) return null
  return <p className="tasker-closure-notes">
    {notes.map(note => <span key={note.kind} className="tasker-closure-chip" data-kind={note.kind}>{note.text}</span>)}
  </p>
}

/** A required reason before a change that needs one: cancelling, moving a due date, returning work. */
export function ReasonForm({ label, action, note, onSubmit, onClose }: {
  label: string
  action: string
  note?: string
  onSubmit: (reason: string) => Promise<unknown>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return <form className="tasker-reason-form" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true)
    try { await onSubmit(reason.trim()) } finally { setBusy(false) }
  }}>
    {note && <p>{note}</p>}
    <label>{label}<input aria-label={label} autoFocus value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
    <div className="tasker-reason-actions">
      <Button type="submit" variant="primary" disabled={busy || !reason.trim()}>{action}</Button>
      <Button type="button" disabled={busy} onClick={onClose}>Never mind</Button>
    </div>
  </form>
}

function Evidence({ task, nameOf }: { task: VerifiableTask; nameOf: NameOf }) {
  return <div className="tasker-evidence">
    <p className="tasker-evidence-by">Submitted{task.submitted_by ? ` by ${nameOf(task.submitted_by)}` : ''}{task.submitted_at ? ` · ${fmtInstantIST(task.submitted_at)}` : ''}</p>
    {task.evidence_note && <p className="tasker-evidence-note">{task.evidence_note}</p>}
    {task.evidence_photo && <a className="tasker-evidence-photo" href={task.evidence_photo} target="_blank" rel="noreferrer"><img src={task.evidence_photo} alt="Evidence photo" /></a>}
  </div>
}

/** Verifier, acknowledgement, submission with evidence, and the verifier's accept or return, in task details. */
export function VerificationPanel({ task, shared, me, people, disabled, onPatch, nameOf }: {
  task: VerifiableTask
  shared: boolean
  me: string
  people: { row_id: string }[]
  disabled: boolean
  onPatch: Patch
  nameOf: NameOf
}) {
  const [submitting, setSubmitting] = useState(false)
  const [returning, setReturning] = useState(false)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState('')
  const settled = task.task_state === 'Done' || task.task_state === 'Cancelled'
  const submitted = task.task_state === SUBMITTED
  const canSubmit = Boolean(task.verifier) && !submitted && !settled && me !== task.verifier
  const choices = people.filter(person => person.row_id !== task.assigned_to)

  return <section className="tasker-verification" aria-label="Verification">
    <ClosureNotes task={task} nameOf={nameOf} />
    {shared && <label className="tasker-verifier">Verifier
      <select aria-label="Task verifier" disabled={disabled || submitted} value={task.verifier ?? ''} onChange={(event) => void onPatch({ verifier: event.target.value || null })}>
        <option value="">No verifier</option>
        {choices.map(person => <option key={person.row_id} value={person.row_id}>{nameOf(person.row_id)}</option>)}
        {task.verifier && !choices.some(person => person.row_id === task.verifier) && <option value={task.verifier}>{nameOf(task.verifier)}</option>}
      </select>
    </label>}
    <div className="tasker-verification-actions">
      {task.assigned_to === me && !task.acknowledged_at && !settled &&
        <Button type="button" variant="primary" disabled={disabled} onClick={() => void onPatch({ acknowledged_at: new Date().toISOString() })}>Acknowledge</Button>}
      {canSubmit && !submitting && <Button type="button" disabled={disabled} onClick={() => { setSubmitting(true); setNote(task.evidence_note ?? '') }}>Submit for verification</Button>}
      {submitted && me === task.verifier && !returning && <>
        <Button type="button" variant="primary" disabled={disabled} onClick={() => void onPatch({ task_state: 'Done' })}>Accept and close</Button>
        <Button type="button" disabled={disabled} onClick={() => setReturning(true)}>Return</Button>
      </>}
    </div>
    {canSubmit && submitting && <form className="tasker-submit-form" onSubmit={async (event) => {
      event.preventDefault(); setUploadError('')
      let evidencePhoto: string | undefined
      if (photo) {
        try { evidencePhoto = await uploadRowFile(photo, 'tasker.task', task.row_id) } catch (error) { setUploadError(error instanceof Error ? error.message : 'Could not upload the photo'); return }
      }
      if (await onPatch({ task_state: SUBMITTED, evidence_note: note.trim() || null, ...(evidencePhoto ? { evidence_photo: evidencePhoto } : {}) })) setSubmitting(false)
    }}>
      <label>What was done<textarea aria-label="What was done" rows={3} autoFocus value={note} disabled={disabled} onChange={(event) => setNote(event.target.value)} /></label>
      <label>Photo (optional)<input aria-label="Evidence photo" type="file" accept="image/*" disabled={disabled} onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} /></label>
      {uploadError && <p role="alert">{uploadError}</p>}
      <div className="tasker-reason-actions">
        <Button type="submit" variant="primary" disabled={disabled}>Submit</Button>
        <Button type="button" disabled={disabled} onClick={() => setSubmitting(false)}>Not yet</Button>
      </div>
    </form>}
    {submitted && <Evidence task={task} nameOf={nameOf} />}
    {returning && <ReasonForm label="Reason for returning" action="Return task" onClose={() => setReturning(false)}
      onSubmit={async (reason) => { if (await onPatch({ task_state: 'In progress', change_reason: reason })) setReturning(false) }} />}
  </section>
}

/** The verifier new tasks in a project start with. */
export function ProjectVerifier({ project, people, nameOf, onSaved }: {
  project: { row_id: string; updated_at: string; default_verifier?: string | null }
  people: { row_id: string }[]
  nameOf: NameOf
  onSaved: () => Promise<void>
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <div className="tasker-project-verifier">
    <label>Default verifier
      <select aria-label="Default verifier" disabled={busy} value={project.default_verifier ?? ''} onChange={async (event) => {
        setBusy(true); setError('')
        try {
          await api.patch(`/api/table/tasker.project/${encodeURIComponent(project.row_id)}`, { default_verifier: event.target.value || null, updated_at: project.updated_at })
          await onSaved()
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save the verifier') }
        finally { setBusy(false) }
      }}>
        <option value="">No default verifier</option>
        {people.map(person => <option key={person.row_id} value={person.row_id}>{nameOf(person.row_id)}</option>)}
      </select>
    </label>
    <span className="tasker-hint">New tasks here are closed only when this person accepts them.</span>
    {error && <p role="alert">{error}</p>}
  </div>
}

/** Every submitted task waiting for this person's check, with what was done. */
export function ToVerifyPage({ tasks, nameOf, hrefFor }: { tasks: VerifiableTask[]; nameOf: NameOf; hrefFor: (id: string) => string }) {
  return <section aria-labelledby="verify-heading">
    <div className="tasker-section-title"><h2 id="verify-heading">To verify</h2><p>Work others submitted for your check. Accept it to close it, or return it with a reason.</p></div>
    {!tasks.length && <p className="text-ink-muted">Nothing is waiting for your check.</p>}
    <ul className="tasker-verify-list">
      {tasks.map(task => <li key={task.row_id} className="tasker-verify-card">
        <a href={hrefFor(task.row_id)}>{task.task_title}</a>
        <Evidence task={task} nameOf={nameOf} />
        {Number(task.return_count ?? 0) > 0 && <p className="tasker-evidence-by">Returned {task.return_count} {task.return_count === 1 ? 'time' : 'times'} before</p>}
      </li>)}
    </ul>
  </section>
}
