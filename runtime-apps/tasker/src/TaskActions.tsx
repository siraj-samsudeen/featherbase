import { useRef, useState } from 'react'
import { ApiError, api, getSessionUser } from './api'

type PendingAction = { action: 'promote' | 'delete_accidental'; idempotencyKey: string; payload: { row_id: string; updated_at: string; confirm: boolean } }

export function TaskActions({ task, disabled, onCompleted }: {
  task: { row_id: string; updated_at: string }
  disabled: boolean
  onCompleted: (projectId?: string) => Promise<void>
}) {
  const [confirm, setConfirm] = useState<'promote' | 'delete_accidental' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const menu = useRef<HTMLDetailsElement>(null)
  const storageKey = `tasker.pending-action:${getSessionUser()?.row_id}:${task.row_id}`
  const [pending, setPending] = useState<PendingAction | null>(() => JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'))
  const confirmedRevision = useRef(task.updated_at)
  function remember(value: PendingAction | null) {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value))
    else sessionStorage.removeItem(storageKey)
    setPending(value)
  }
  async function run(action: 'promote' | 'delete_accidental', confirmed: boolean) {
    menu.current?.removeAttribute('open')
    setBusy(true); setError('')
    // @spec promotion_is_atomic_retryable
    // Keep the exact envelope when a response is lost; a confirmation is a new request.
    const request = pending ?? { action, idempotencyKey: crypto.randomUUID(), payload: { row_id: task.row_id, updated_at: confirmed ? confirmedRevision.current : task.updated_at, confirm: confirmed } }
    remember(request)
    try {
      const { result } = await api.post<{ result: { confirmationRequired?: boolean; projectId?: string; deleted?: boolean; message?: string } }>(
        `/api/app_actions/tasker/${request.action}`, { idempotencyKey: request.idempotencyKey, payload: request.payload },
      )
      remember(null)
      if (result.confirmationRequired) { confirmedRevision.current = request.payload.updated_at; setConfirm('promote'); return }
      if (result.deleted === false) { setConfirm(null); setError(result.message ?? 'This task has retained work. Use Cancelled instead.'); return }
      setConfirm(null)
      await onCompleted(result.projectId)
    } catch (error) {
      // A host refusal is known; a transport failure may have committed.
      if (error instanceof ApiError && error.status && error.status < 500) { remember(null); setConfirm(null) }
      setError(error instanceof Error ? error.message : 'Could not complete action')
    }
    finally { setBusy(false) }
  }
  return <div className="tasker-actions">
    <details ref={menu}>
      <summary aria-label="More task actions">More actions</summary>
      <div className="tasker-action-menu">
        <button type="button" disabled={disabled || busy || Boolean(pending)} onClick={() => void run('promote', false)}>Promote to project</button>
        <button type="button" disabled={disabled || busy || Boolean(pending)} onClick={() => { menu.current?.removeAttribute('open'); confirmedRevision.current = task.updated_at; setConfirm('delete_accidental'); setError('') }}>Delete accidental task</button>
      </div>
    </details>
    {busy && <p role="status">Working…</p>}
    {confirm && <div className="tasker-action-backdrop"><div role="alertdialog" aria-modal="true" aria-label={confirm === 'promote' ? 'Preserve task history' : 'Delete accidental task'} className="tasker-action-confirm" onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === 'Escape' && !busy && !pending) { setConfirm(null); menu.current?.querySelector('summary')?.focus() }
      if (event.key === 'Tab') {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        if ((event.shiftKey && document.activeElement === buttons[0]) || (!event.shiftKey && document.activeElement === buttons.at(-1))) {
          event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus()
        }
      }
    }}>
      <p>{confirm === 'promote'
        ? 'This task has work history that a project cannot hold directly. Tasker will create the project and keep this task as its first task so its assignment, urgency, comments, and activity are preserved. Continue?'
        : 'Delete this accidental task permanently? This cannot be undone. Use Cancelled for retained work. Tasks with assignment, urgency, discussion, history, references, attachments or shared access cannot be deleted here.'}</p>
      <div className="tasker-editor-actions">
        <button autoFocus type="button" className="fc-btn" disabled={busy || Boolean(pending)} onClick={() => { setConfirm(null); menu.current?.querySelector('summary')?.focus() }}>Cancel</button>
        <button type="button" className="fc-btn-primary" disabled={busy || Boolean(pending)} onClick={() => void run(confirm, true)}>{confirm === 'promote' ? 'Continue' : 'Delete permanently'}</button>
      </div>
      {error && pending && <button type="button" className="fc-btn" disabled={busy} onClick={() => void run(pending.action, pending.payload.confirm)}>Retry same request</button>}
    </div></div>}
    {error && <p role="alert">{error}</p>}
    {!confirm && pending && !busy && <button type="button" className="fc-btn" onClick={() => void run(pending.action, pending.payload.confirm)}>Retry same request</button>}
  </div>
}
