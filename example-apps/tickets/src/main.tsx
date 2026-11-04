/// <reference types="vite/client" />
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { createRoot } from 'react-dom/client'
import {
  action,
  read,
  ApiError,
  type Ticket,
  type Session,
  type Detail,
  type RecordData,
} from './api'
import './style.css'

const kinds: Record<string, string> = {
  generic: 'General request',
  access: 'Access request',
  freshness: 'Stale / missing data',
  quality: 'Wrong data / reconciliation',
  report: 'Report / export',
  source: 'New source',
  schema: 'New column / model',
  pipeline: 'Pipeline failure',
  backfill: 'Backfill',
}
const fields: Record<string, [string, string, string?][]> = {
  generic: [],
  access: [
    ['email', 'Recipient email', 'email'],
    ['resource', 'Resource / database / table'],
    ['scope', 'Requested scope / permissions'],
  ],
  freshness: [
    ['source', 'Source'],
    ['report', 'Affected report / table'],
    ['store', 'Store / location'],
    ['period', 'Affected period'],
    ['expected', 'Expected data'],
    ['actual', 'Actual data'],
    ['example', 'Example record / invoice IDs'],
  ],
  quality: [
    ['source', 'Source'],
    ['report', 'Affected report / table'],
    ['expected', 'Expected result'],
    ['actual', 'Actual result'],
    ['period', 'Affected period'],
    ['example', 'Example records'],
  ],
  report: [
    ['report', 'Report / data needed'],
    ['store', 'Store / location'],
    ['from', 'From date', 'date'],
    ['through', 'Through date', 'date'],
    ['format', 'Output format'],
    ['recipients', 'Recipients'],
  ],
  source: [
    ['source', 'Source name'],
    ['vendor', 'Vendor / contact'],
    ['api', 'API / access requirements'],
    ['entity', 'Entities / data needed'],
    ['refresh', 'Refresh frequency'],
  ],
  schema: [
    ['model', 'Model / table'],
    ['column', 'Column'],
    ['definition', 'Business definition'],
    ['example', 'Example value / use case'],
  ],
  pipeline: [
    ['pipeline', 'Pipeline / job'],
    ['failure', 'Failure / error'],
    ['expected', 'Expected result'],
    ['actual', 'Actual result'],
    ['period', 'Affected period'],
  ],
  backfill: [
    ['source', 'Source / table'],
    ['from', 'From date', 'date'],
    ['through', 'Through date', 'date'],
    ['scope', 'Scope / affected reports'],
    ['expected', 'Expected result'],
  ],
}
const stateLabel = (state: string) =>
  state.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const short = (id: string) =>
  id === 'Administrator'
    ? id
    : id.length > 24
      ? `${id.slice(0, 8)}…${id.slice(-4)}`
      : id
// #912: people are shown by name. The reads return the names of the people
// they mention; an id with no known name is never shown as-is.
const knownNames: Record<string, string> = {}
const learnNames = (names: unknown) => {
  if (names && typeof names === 'object') Object.assign(knownNames, names)
}
const isPersonId = (value: string) => value === 'Administrator' || /^(psn|sa)_[a-z0-9]{8,}$/.test(value)
const person = (id: unknown): string =>
  typeof id !== 'string' || !id
    ? '—'
    : (knownNames[id] ?? (isPersonId(id) ? 'Unnamed person' : id))
const display = (value: unknown): string =>
  value == null
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value, (_key, item) => typeof item === 'string' && knownNames[item] ? knownNames[item] : item, 2)
      : typeof value === 'string'
        ? person(value)
        : String(value)
const time = (value: unknown) =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString()
    : display(value)
function Label({ children, title }: { children: ReactNode; title: string }) {
  return (
    <label>
      <span>{title}</span>
      {children}
    </label>
  )
}
function TypeSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!kinds[value] && <option value={value}>{stateLabel(value)}</option>}
      {Object.entries(kinds).map(([key, name]) => (
        <option key={key} value={key}>
          {name}
        </option>
      ))}
    </select>
  )
}
function Structured({
  kind,
  values,
  change,
}: {
  kind: string
  values: RecordData
  change: (key: string, value: string) => void
}) {
  return (
    <div className="form-grid">
      {(fields[kind] ?? []).map(([key, title, type]) => (
        <Label key={key} title={title}>
          <input
            type={type ?? 'text'}
            value={String(values[key] ?? '')}
            onChange={(e) => change(key, e.target.value)}
          />
        </Label>
      ))}
    </div>
  )
}
function Facts({ values }: { values: RecordData }) {
  return (
    <dl className="facts">
      {Object.entries(values)
        .filter(
          ([, value]) => value !== undefined && value !== null && value !== '',
        )
        .map(([key, value]) => (
          <div key={key}>
            <dt>{stateLabel(key)}</dt>
            <dd>{display(value)}</dd>
          </div>
        ))}
    </dl>
  )
}
function EventBody({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return <Facts values={parsed as RecordData} />
      }
    } catch {
      /* Plain public progress is text, not a structured event. */
    }
  }
  return <p>{display(value)}</p>
}
function History({
  events,
  privacy,
}: {
  events: RecordData[]
  privacy: string
}) {
  return events.length ? (
    <div className="timeline">
      {events.map((event, i) => (
        <div className="event" key={String(event.row_id ?? i)}>
          <span className="privacy">{privacy}</span>
          <h4>
            {stateLabel(
              String(event.kind ?? event.operation ?? event.action ?? 'Update'),
            )}
          </h4>
          {event.text != null && <EventBody value={event.text} />}
          <small>
            {person(event.actor ?? event.by ?? event.owner)} ·{' '}
            {time(event.at ?? event.created_at ?? event.creation)}
          </small>
          <Facts
            values={Object.fromEntries(
              Object.entries(event).filter(
                ([key]) =>
                  ![
                    'row_id',
                    'ticket',
                    'kind',
                    'operation',
                    'action',
                    'text',
                    'actor',
                    'by',
                    'owner',
                    'at',
                    'created_at',
                    'creation',
                  ].includes(key),
              ),
            )}
          />
        </div>
      ))}
    </div>
  ) : (
    <p className="muted">No {privacy.toLowerCase()} activity yet.</p>
  )
}
function CreateTicket({
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
type Mutate = (name: string, payload: RecordData) => Promise<boolean>
function ActionForm({
  title,
  name,
  mutate,
  children,
  disabled,
  reason,
  button,
}: {
  title: string
  name: string
  mutate: Mutate
  children: ReactNode
  disabled?: boolean
  reason?: string
  button?: string
}) {
  return (
    <section className="card">
      <h3>{title}</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          const values = Object.fromEntries(new FormData(form))
          if (await mutate(name, values)) form.reset()
        }}
      >
        <fieldset disabled={disabled}>
          {children}
          <button className="secondary" type="submit">
            {button ?? title}
          </button>
        </fieldset>
        {reason && <p className="fine">{reason}</p>}
      </form>
    </section>
  )
}
function Field({
  name,
  title,
  type = 'text',
  required = true,
  value,
}: {
  name: string
  title: string
  type?: string
  required?: boolean
  value?: string
}) {
  return (
    <Label title={title}>
      <input name={name} type={type} required={required} defaultValue={value} />
    </Label>
  )
}
function CaseFile({
  detail,
  session,
  mutate,
  busy,
}: {
  detail: Detail
  session: Session
  mutate: Mutate
  busy: boolean
}) {
  const [tab, setTab] = useState('Request'),
    [editing, setEditing] = useState(false)
  const ticket = detail.ticket,
    support = session.capabilities.support
  const structured = (
    detail.details?.details && typeof detail.details.details === 'object'
      ? detail.details.details
      : detail.details
  ) as RecordData | undefined
  const [kind, setKind] = useState(ticket.kind),
    [draft, setDraft] = useState<RecordData>(structured ?? {})
  useEffect(() => {
    setKind(ticket.kind)
    setDraft(structured ?? {})
    setEditing(false)
  }, [ticket.updated_at, ticket.row_id])
  const state = ticket.ticket_state.toLowerCase().replace(/ /g, '_')
  const access = ticket.kind === 'access',
    resolved = state === 'resolved'
  const verification = detail.verification,
    approval = detail.approval
  const approvalAllowed =
    detail.capabilities?.decide === true ||
    detail.capabilities?.approve === true
  const canDecide =
    support &&
    (approvalAllowed || state === 'awaiting_approval') &&
    verification?.active === true
  return (
    <>
      <div className="detail-kicker">
        <span>CASE / {short(ticket.row_id)}</span>
        <span className={`badge ${resolved ? 'green' : ''}`}>
          {stateLabel(ticket.ticket_state)}
        </span>
      </div>
      <h2>{ticket.title}</h2>
      <div className="detail-sub">
        <span className="avatar">{person(ticket.owner).slice(0, 1).toUpperCase()}</span>
        <span>{person(ticket.owner)}</span>
        <span>· {kinds[ticket.kind] ?? stateLabel(ticket.kind)}</span>
      </div>
      <div className="card public-progress">
        <span className="privacy">Public progress</span>
        <p>{ticket.public_update || 'No public update yet.'}</p>
        <small>
          Assigned to{' '}
          {ticket.assigned_to ? person(ticket.assigned_to) : 'unassigned'} ·
          Updated {time(ticket.updated_at)}
        </small>
      </div>
      <div className="tabs" role="tablist" aria-label="Ticket detail">
        {['Request', 'Workflow', 'Evidence', 'Activity'].map((name) => (
          <button
            key={name}
            role="tab"
            id={`tab-${name}`}
            aria-controls="case-panel"
            aria-selected={tab === name}
            className={tab === name ? 'active' : ''}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <section role="tabpanel" id="case-panel" aria-labelledby={`tab-${tab}`}>
        {tab === 'Request' && (
          <>
            {detail.details ? (
              <>
                <div className="section-label">
                  Private · requester & support
                </div>
                <h3>Original message</h3>
                <p className="request-body">
                  {display(detail.details.original)}
                </p>
                <h3>Request details</h3>
                <Facts
                  values={Object.fromEntries(
                    Object.entries(structured ?? {}).filter(
                      ([key]) => key !== 'original',
                    ),
                  )}
                />
                {support && (
                  <>
                    <button
                      className="secondary"
                      onClick={() => setEditing(!editing)}
                    >
                      {editing ? 'Cancel editing' : 'Edit / classify request'}
                    </button>
                    {editing && (
                      <form
                        className="card"
                        onSubmit={async (e) => {
                          e.preventDefault()
                          const data = new FormData(e.currentTarget)
                          await mutate('edit', {
                            title: data.get('title'),
                            kind,
                            details: Object.fromEntries(
                              Object.entries(draft).filter(
                                ([key]) => key !== 'original',
                              ),
                            ),
                            assigned_to: data.get('assigned_to'),
                            ...(String(
                              data.get('public_update') ?? '',
                            ).trim() &&
                            data.get('public_update') !== ticket.public_update
                              ? { public_update: data.get('public_update') }
                              : {}),
                          })
                        }}
                      >
                        <fieldset disabled={busy}>
                          <Label title="Request type">
                            <TypeSelect value={kind} onChange={setKind} />
                          </Label>
                          <Field
                            title="Public subject"
                            name="title"
                            value={ticket.title}
                          />
                          <Structured
                            kind={kind}
                            values={draft}
                            change={(key, value) =>
                              setDraft((d) => ({ ...d, [key]: value }))
                            }
                          />
                          <Label title="Assign to">
                            <select name="assigned_to" defaultValue={ticket.assigned_to ?? ''}>
                              <option value="">Unassigned</option>
                              {ticket.assigned_to && !(session.people ?? []).some((p) => p.row_id === ticket.assigned_to) && (
                                <option value={ticket.assigned_to}>{person(ticket.assigned_to)}</option>
                              )}
                              {(session.people ?? []).map((p) => (
                                <option key={p.row_id} value={p.row_id}>{p.full_name}</option>
                              ))}
                            </select>
                          </Label>
                          <Label title="Public progress update">
                            <textarea
                              name="public_update"
                              defaultValue={ticket.public_update}
                              rows={3}
                            />
                          </Label>
                          <p className="fine">
                            Changes are attributed. Changing recipient or scope
                            requires the dependent checks again. The original
                            message cannot be edited.
                          </p>
                          <button className="primary">Save request</button>
                        </fieldset>
                      </form>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="empty">
                <h3>Shared summary only</h3>
                <p>
                  The original message and request details are visible only to
                  the requester and authorized support.
                </p>
              </div>
            )}
          </>
        )}
        {tab === 'Workflow' && (
          <>
            {access ? (
              <>
                <div className="steps">
                  {[
                    'Verify employee',
                    'Regional decision',
                    'Manual fulfillment',
                  ].map((text, i) => (
                    <div className="step" key={text}>
                      <b>0{i + 1}</b>
                      {text}
                    </div>
                  ))}
                </div>
                {support ? (
                  <>
                    <span className="privacy">
                      Support only · manual records
                    </span>
                    {verification && (
                      <section className="card">
                        <h3>Employee verification</h3>
                        <Facts values={verification} />
                      </section>
                    )}
                    {approval && (
                      <section className="card">
                        <h3>Current decision</h3>
                        <Facts values={approval} />
                      </section>
                    )}
                    <ActionForm
                      title="Record employee verification"
                      name="verify"
                      mutate={async (name, values) =>
                        mutate(name, {
                          ...values,
                          active: values.active === 'true',
                        })
                      }
                      disabled={
                        busy || !session.capabilities.verify || resolved
                      }
                      reason={
                        !session.capabilities.verify
                          ? 'Only configured verification admins may record employment evidence.'
                          : 'Manual check only. No employee lookup is connected.'
                      }
                    >
                      <Field
                        name="email"
                        title="Verified email"
                        type="email"
                        value={String(structured?.email ?? '')}
                      />
                      <Label title="Employment status">
                        <select name="active">
                          <option value="true">Active employee</option>
                          <option value="false">Inactive employee</option>
                        </select>
                      </Label>
                      <Field name="region" title="Verified region" />
                      <Field
                        name="evidence"
                        title="Verification evidence reference"
                      />
                    </ActionForm>
                    <section className="card">
                      <h3>Regional decision</h3>
                      <p>
                        Only the configured approver for the current verified
                        region can decide. The server checks membership and
                        resource policy.
                      </p>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault()
                          const data = new FormData(e.currentTarget)
                          const submitter = (e.nativeEvent as SubmitEvent)
                            .submitter as HTMLButtonElement
                          const reason = String(data.get('reason') ?? '').trim()
                          await mutate('decide', {
                            decision: submitter.value,
                            ...(reason ? { reason } : {}),
                          })
                        }}
                      >
                        <fieldset disabled={busy || !canDecide || resolved}>
                          <Field
                            name="reason"
                            title="Decision reason"
                            required={false}
                          />
                          <div className="actions">
                            <button className="primary" value="approved">
                              Approve request
                            </button>
                            <button value="rejected">Reject request</button>
                          </div>
                        </fieldset>
                      </form>
                      {(!canDecide || resolved) && (
                        <p className="fine">
                          {resolved
                            ? 'This request is already resolved.'
                            : state === 'policy_review'
                              ? 'Resource policy blocks ordinary approval. An authorized policy review is required.'
                              : 'Current active verification and a configured regional approval route are required.'}
                        </p>
                      )}
                    </section>
                    <ActionForm
                      title="Record manual fulfillment"
                      name="fulfill"
                      mutate={mutate}
                      disabled={
                        busy ||
                        !session.capabilities.fulfill ||
                        state !== 'approved'
                      }
                      reason={
                        !session.capabilities.fulfill
                          ? 'Only configured fulfillment admins can record completion.'
                          : 'Requires a current approval and active employee verification. This records work already completed; it does not grant access automatically.'
                      }
                    >
                      <Field
                        name="reference"
                        title="Manual fulfillment reference"
                      />
                    </ActionForm>
                    <p className="fine">
                      Missing memberships or routes?{' '}
                      <a href="/featherbase/admin/apps">
                        Configure Tickets settings
                      </a>
                    </p>
                  </>
                ) : (
                  <div className="card">
                    <h3>Access is reviewed by authorized staff</h3>
                    <p>
                      Verification, regional approval and manual fulfillment
                      must be completed in order. Private employee evidence is
                      not shared.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <section className="card">
                  <h3>Investigation workflow</h3>
                  <p>
                    Support records findings and references, then resolves the
                    request with a reason and supporting evidence. No automated
                    investigation runs in stage one.
                  </p>
                </section>
                {support && (
                  <ActionForm
                    title={resolved ? 'Reopen ticket' : 'Resolve ticket'}
                    name={resolved ? 'reopen' : 'resolve'}
                    mutate={mutate}
                    disabled={busy}
                  >
                    <Field
                      name="reason"
                      title={
                        resolved ? 'Reopening reason' : 'Resolution reason'
                      }
                    />
                    {!resolved && (
                      <Field
                        name="reference"
                        title="Resolution evidence reference"
                      />
                    )}
                  </ActionForm>
                )}
              </>
            )}
          </>
        )}
        {tab === 'Evidence' &&
          (support ? (
            <>
              <div className="section-label">
                Support only · manually recorded
              </div>
              <p className="muted">
                Record observations, not assumptions. A finding is not an
                automated diagnosis; leave the root cause unknown unless
                established.
              </p>
              <History
                events={(detail.privateEvents ?? []).filter((e) =>
                  ['evidence', 'link', 'finding'].includes(
                    String(e.kind ?? e.operation ?? e.action),
                  ),
                )}
                privacy="Support only"
              />
              <ActionForm
                title="Record evidence"
                name="evidence"
                mutate={(name, values) => {
                  const { root_cause, ...evidence } = values
                  return mutate(name, {
                    ...evidence,
                    observed_at: new Date(
                      String(values.observed_at),
                    ).toISOString(),
                    ...(root_cause ? { root_cause } : {}),
                  })
                }}
                disabled={busy}
              >
                <Field name="expected" title="Expected outcome" />
                <Field name="observed" title="Observed outcome" />
                <Field
                  name="reference"
                  title="Evidence references (source and report)"
                />
                <Field
                  name="observed_at"
                  title="Observation time"
                  type="datetime-local"
                />
                <Label title="Finding">
                  <select name="finding">
                    <option value="confirmed_mismatch">
                      Confirmed mismatch
                    </option>
                    <option value="no_mismatch">No mismatch found</option>
                    <option value="inconclusive">Inconclusive</option>
                  </select>
                </Label>
                <Field
                  name="root_cause"
                  title="Root cause (optional; otherwise unknown)"
                  required={false}
                />
              </ActionForm>
              <ActionForm
                title="Link related work"
                name="link"
                mutate={mutate}
                disabled={busy}
              >
                <Field
                  name="url"
                  title="Existing issue / pull-request URL"
                  type="url"
                />
              </ActionForm>
              <p className="fine">
                References only. Tickets does not create issues, execute fixes
                or open pull requests.
              </p>
            </>
          ) : (
            <div className="empty">
              <h3>Evidence is private to support</h3>
              <p>Public progress is available above and in Activity.</p>
            </div>
          ))}
        {tab === 'Activity' && (
          <>
            <div className="section-label">Public history</div>
            <History events={detail.events ?? []} privacy="Public" />
            {support && (
              <>
                <div className="section-label">Support-only history</div>
                <History
                  events={detail.privateEvents ?? []}
                  privacy="Support only"
                />
                <ActionForm
                  title="Add internal note"
                  name="note"
                  mutate={mutate}
                  disabled={busy}
                >
                  <Label title="Internal note">
                    <textarea name="text" required rows={3} />
                  </Label>
                </ActionForm>
              </>
            )}
          </>
        )}
      </section>
    </>
  )
}
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [tickets, setTickets] = useState<Ticket[]>([]),
    [detail, setDetail] = useState<Detail | null>(null)
  const [selected, setSelected] = useState(''),
    [search, setSearch] = useState(''),
    [kind, setKind] = useState(''),
    [state, setState] = useState(''),
    [view, setView] = useState('all')
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [create, setCreate] = useState(false),
    [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const queueSequence = useRef(0),
    detailSequence = useRef(0)
  const userId = session
    ? typeof session.user === 'string'
      ? session.user
      : session.user.row_id
    : ''
  const identity =
    session && typeof session.user === 'object'
      ? (session.user.full_name ?? person(userId))
      : person(userId)
  const report = (e: unknown) =>
    setError(
      e instanceof Error
        ? e.message
        : 'Could not load Tickets. Please try again.',
    )
  useEffect(() => {
    read<Session>('session')
      .then(setSession)
      .catch((e) => {
        report(e)
        setLoading(false)
      })
  }, [reload])
  useEffect(() => {
    if (!session) return
    const sequence = ++queueSequence.current
    const timeout = setTimeout(() => {
      setLoading(true)
      read<{ tickets: Ticket[] }>('queue', {
        search,
        kind,
        state: state || (view === 'assigned' ? 'open' : ''),
        ...(view === 'assigned' ? { assigned_to: userId } : {}),
      })
        .then((result) => {
          if (sequence === queueSequence.current) {
            learnNames((result as { names?: unknown }).names)
            setTickets(result.tickets)
            setSelected((id) => id || result.tickets[0]?.row_id || '')
          }
        })
        .catch((e) => {
          if (sequence === queueSequence.current) report(e)
        })
        .finally(() => {
          if (sequence === queueSequence.current) setLoading(false)
        })
    }, 180)
    return () => {
      clearTimeout(timeout)
      queueSequence.current++
    }
  }, [session, search, kind, state, view, reload, userId])
  useEffect(() => {
    const sequence = ++detailSequence.current
    setDetail((current) =>
      current?.ticket.row_id === selected ? current : null,
    )
    if (!selected) return
    setDetailLoading(true)
    read<Detail>('detail', { row_id: selected })
      .then((value) => {
        if (sequence === detailSequence.current) {
          learnNames(value.names)
          setDetail(value)
        }
      })
      .catch((e) => {
        if (sequence === detailSequence.current) report(e)
      })
      .finally(() => {
        if (sequence === detailSequence.current) setDetailLoading(false)
      })
    return () => {
      detailSequence.current++
    }
  }, [selected, reload])
  async function mutate(name: string, payload: RecordData) {
    if (!detail || busy || detailLoading) return false
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action(name, {
        ...payload,
        row_id: detail.ticket.row_id,
        updated_at: detail.ticket.updated_at,
      })
      setNotice('Saved. The queue and case are refreshed from the server.')
      setReload((n) => n + 1)
      return true
    } catch (e) {
      report(e)
      if (e instanceof ApiError && e.status === 409) {
        setNotice(
          'The case changed. Review the refreshed version before trying again.',
        )
        setReload((n) => n + 1)
      }
      return false
    } finally {
      setBusy(false)
    }
  }
  const visible = tickets.filter(
    (ticket) => view !== 'mine' || ticket.owner === userId,
  )
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">f</span>
          <div>
            feather<span>TICKETS</span>
          </div>
        </div>
        <div className="workspace">
          Data support<small>One queue. An accountable path.</small>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Ticket queues">
          {[
            ['all', 'All tickets'],
            ['mine', 'My requests'],
            ...(session?.capabilities.support
              ? [['assigned', 'Assigned to me']]
              : []),
          ].map(([key, name]) => (
            <button
              key={key}
              className={view === key ? 'active' : ''}
              onClick={() => setView(key)}
            >
              {name}
              <span>↗</span>
            </button>
          ))}
        </nav>
        <div className="nav-label">REQUEST TYPES</div>
        <div className="type-list">
          Access & permissions
          <br />
          Data & reconciliation
          <br />
          Reports & exports
          <br />
          Sources & pipelines
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">
            {identity.slice(0, 1).toUpperCase() || '·'}
          </span>
          <div>
            <b title={userId}>{identity || 'Connecting…'}</b>
            <small>
              {session?.capabilities.support
                ? 'Support workspace'
                : 'Requester workspace'}
            </small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span className="breadcrumb">
            Workspace <span>/</span> <b>Tickets</b>
          </span>
          <span className="signed-in">
            {session ? `Signed in · ${identity}` : 'Connecting to Featherbase…'}
          </span>
        </header>
        <div className="page-heading">
          <div>
            <div className="eyebrow">DATA WAREHOUSE SUPPORT</div>
            <h1>A clear path from ask to answer.</h1>
            <p>
              Shared progress. Private details. People accountable at every
              step.
            </p>
          </div>
          <button
            className="primary"
            disabled={!session}
            onClick={() => setCreate(true)}
          >
            ＋ New ticket
          </button>
        </div>
        <div className="connection-strip">
          <span className="connection-dot" />
          <b>Connections</b>
          <span>Employee lookup · Inbound email · Automated investigation</span>
          <span className="badge">Unconfigured</span>
          <details>
            <summary>Details</summary>
            <div>
              <p>
                Stage one uses manual verification, fulfillment and recorded
                evidence. No live integrations are running.
              </p>
              {session && (
                <Facts
                  values={
                    session.connections &&
                    typeof session.connections === 'object'
                      ? (session.connections as RecordData)
                      : { status: session.connections ?? 'unconfigured' }
                  }
                />
              )}
            </div>
          </details>
        </div>
        {error && (
          <div role="alert" className="error banner">
            {error}
            <button
              onClick={() => {
                setError('')
                setReload((n) => n + 1)
              }}
            >
              Retry / refresh
            </button>
            {!session && (
              <a href="/featherbase/login?next=%2Ftickets%2F">Sign in</a>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <section className="inbox">
          <div className="queue">
            <div className="queue-heading">
              <h2>
                {view === 'mine'
                  ? 'My requests'
                  : view === 'assigned'
                    ? 'Assigned to me'
                    : 'All tickets'}
              </h2>
              <span>{visible.length}</span>
              <button
                className="refresh"
                aria-label="Refresh tickets"
                disabled={loading || busy}
                onClick={() => setReload((n) => n + 1)}
              >
                ↻
              </button>
            </div>
            <div className="filters">
              <input
                aria-label="Search tickets"
                placeholder="Search public summaries…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Filter by request type"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="">All types</option>
                {Object.entries(kinds).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by status"
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                <option value="">{view === 'assigned' ? 'Open work' : 'All statuses'}</option>
                {['New', 'Needs verification', 'Awaiting approval', 'Approved', 'Rejected', 'Policy review', 'In progress', 'Resolved'].map(value => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="ticket-list" aria-busy={loading}>
              {loading && (
                <div className="loading" role="status">
                  Loading queue…
                </div>
              )}
              {!loading && !visible.length && (
                <div className="empty">
                  <span className="empty-mark">↗</span>
                  <h3>
                    {search || kind
                      ? 'No matching tickets'
                      : 'A little breathing room.'}
                  </h3>
                  <p>
                    {search || kind
                      ? 'Try another search or request type.'
                      : 'No tickets in this queue yet. Create a request when you need a hand.'}
                  </p>
                </div>
              )}
              {visible.map((ticket) => (
                <button
                  key={ticket.row_id}
                  className={`ticket ${selected === ticket.row_id ? 'selected' : ''}`}
                  aria-pressed={selected === ticket.row_id}
                  onClick={() => {
                    if (!busy) {
                      setSelected(ticket.row_id)
                      setNotice('')
                    }
                  }}
                >
                  <div className="ticket-top">
                    <span className="ticket-id">{short(ticket.row_id)}</span>
                    <span
                      className={`badge ${ticket.ticket_state.toLowerCase() === 'resolved' ? 'green' : ''}`}
                    >
                      {stateLabel(ticket.ticket_state)}
                    </span>
                  </div>
                  <div className="ticket-title">{ticket.title}</div>
                  <div className="ticket-meta">
                    <span>{kinds[ticket.kind] ?? stateLabel(ticket.kind)}</span>
                    <span>{person(ticket.owner)}</span>
                  </div>
                  {ticket.public_update && (
                    <p className="ticket-update">{ticket.public_update}</p>
                  )}
                </button>
              ))}
            </div>
            <div className="queue-footer">
              Shared summaries · Signed-in workspace
            </div>
          </div>
          <article className="detail" aria-busy={detailLoading || busy}>
            {detailLoading && !detail ? (
              <div className="empty" role="status">
                Loading case…
              </div>
            ) : detail && session ? (
              <CaseFile
                key={detail.ticket.row_id}
                detail={detail}
                session={session}
                mutate={mutate}
                busy={busy || detailLoading}
              />
            ) : (
              <div className="empty detail-empty">
                <span className="empty-mark">⌁</span>
                <div className="eyebrow">YOUR CASE FILE</div>
                <h2>Every request has a story.</h2>
                <p>
                  Select a ticket to see its progress,
                  <br />
                  or start with a new request.
                </p>
              </div>
            )}
          </article>
        </section>
      </main>
      {create && (
        <CreateTicket
          close={() => setCreate(false)}
          created={async (id) => {
            setSelected(id)
            setReload((n) => n + 1)
            setNotice('Ticket created and saved to the server.')
          }}
        />
      )}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
