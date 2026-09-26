import { useRef, useState } from 'react'
import { api } from './api'
import { Markdown } from './Markdown'

export function ProjectDescription({ project, onSaved }: {
  project: { row_id: string; description?: string | null; updated_at: string }
  onSaved: () => Promise<void>
}) {
  const [draft, setDraft] = useState<{ description: string; updated_at: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const edit = useRef<HTMLButtonElement>(null)
  function cancel() { setDraft(null); setError(''); requestAnimationFrame(() => edit.current?.focus()) }
  return <section className="tasker-project-description" aria-label="Project description">
    {draft ? <form onSubmit={async (event) => {
      event.preventDefault(); setSaving(true); setError('')
      try {
        await api.patch(`/api/table/tasker.project/${encodeURIComponent(project.row_id)}`, draft)
        await onSaved(); cancel()
      } catch (error) { setError(error instanceof Error ? error.message : 'Could not save description') }
      finally { setSaving(false) }
    }} onKeyDown={(event) => { if (event.key === 'Escape' && !saving) { event.stopPropagation(); cancel() } }}>
      <label>Project description <span className="tasker-hint">Markdown supported</span>
        <textarea autoFocus rows={6} value={draft.description} disabled={saving}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </label>
      {error && <p role="alert">{error} Cancel and reopen to load the latest version.</p>}
      <div className="tasker-editor-actions">
        <button className="fc-btn-primary" disabled={saving}>Save description</button>
        <button type="button" className="fc-btn" disabled={saving} onClick={cancel}>Cancel</button>
      </div>
    </form> : <>
      {project.description && <Markdown>{project.description}</Markdown>}
      <button ref={edit} type="button" className="fc-btn" onClick={() => setDraft({ description: project.description ?? '', updated_at: project.updated_at })}>
        {project.description ? 'Edit description' : 'Add description'}
      </button>
      {!project.description && <span className="tasker-hint"> Give this project a purpose and shared context.</span>}
    </>}
  </section>
}
