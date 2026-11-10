import { useEffect, useRef, useState, type FormEvent } from 'react'
import { action, type RecordData } from './api'
import { short } from './ticket-words'
import { Label, Structured, TypeSelect } from './ticket-fields'

export function CreateTicket({
  close,
  created,
}: {
  close: () => void
  created: (id: string) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [kind, setKind] = useState('generic'),
    [details, setDetails] = useState<RecordData>({})
  const [pending, setPending] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      const result = await action('create', {
        title: data.get('title'),
        original: data.get('original'),
        kind,
        details,
      })
      await created(result.ticket.row_id)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the ticket.')
      setPending(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="create-title"
      onCancel={(e) => {
        if (pending) e.preventDefault()
        else close()
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <div>
            <div className="eyebrow">ONE PLACE TO ASK</div>
            <h2 id="create-title">What do you need help with?</h2>
          </div>
          <button
            type="button"
            className="icon"
            aria-label="Close new ticket"
            disabled={pending}
            onClick={close}
          >
            ×
          </button>
        </div>
        <p className="muted">
          Choose a request type, or simply tell us what happened. Add only what
          you know.
        </p>
        <Label title="Request type">
          <TypeSelect value={kind} onChange={setKind} />
        </Label>
        <Label title="Subject">
          <input
            name="title"
            required
            maxLength={160}
            placeholder="A short, public summary — no private information"
          />
        </Label>
        <p className="fine">
          The subject appears in the shared queue. Keep recipient details below.
        </p>
        <Label title="Original message">
          <textarea
            name="original"
            required
            rows={4}
            placeholder="Describe what you need in your own words…"
          />
        </Label>
        <Structured
          kind={kind}
          values={details}
          change={(key, value) => setDetails((d) => ({ ...d, [key]: value }))}
        />
        <p className="fine">
          Original message and structured details are private to you and
          authorized support. The original message is preserved after
          submission.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={pending} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create ticket'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
