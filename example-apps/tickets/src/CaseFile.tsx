import {
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  action,
  type Ticket,
  type Session,
  type Detail,
  type RecordData,
} from './api'
import { configuredTypes, display, fields, kindLabel, person, short, stateLabel, time, type TicketAction } from './ticket-words'
import { Label, Structured, TypeSelect } from './ticket-fields'
import { StatePill, assignee } from './ticket-state'

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
    <section className="card" id={`action-${name}`}>
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
// Tickets' App Setting rows in Admin, where its connections and people are set up.
export const SETTINGS_HREF = `/featherbase/admin/table/app-setting?filters=${encodeURIComponent(
  JSON.stringify([['app', '=', 'tickets']]),
)}`

// What this person can do on this ticket now: the same conditions that enable
// each action's form in the tabs below.
type HeaderAction = { key: string; label: string; tab: string; target: string; transition?: TicketAction }
function availableActions(now: {
  support: boolean
  capabilities: Session['capabilities']
  access: boolean
  resolved: boolean
  state: string
  canDecide: boolean
  editable: boolean
  rewordable: boolean
  // #918: the moves this ticket's type allows the viewer now (null when the
  // type declares none); the server decides which, for requesters too.
  transitions: TicketAction[] | null
}): HeaderAction[] {
  const actions: HeaderAction[] = (now.transitions ?? []).map((transition) => ({
    key: `transition:${transition.action}`,
    label: transition.action,
    tab: 'Workflow',
    target: 'action-transition',
    transition,
  }))
  const wording: HeaderAction[] = now.rewordable
    ? [{ key: 'wording', label: 'Correct the wording', tab: 'Request', target: 'action-wording' }]
    : []
  if (!now.support) return [...actions, ...wording]
  const workflow = (key: string, label: string): HeaderAction => ({
    key,
    label,
    tab: 'Workflow',
    target: `action-${key}`,
  })
  if (now.access) {
    if (now.capabilities.verify && !now.resolved)
      actions.push(workflow('verify', 'Record verification'))
    if (now.canDecide && !now.resolved)
      actions.push(workflow('decide', 'Decide'))
    if (now.capabilities.fulfill && now.state === 'approved')
      actions.push(workflow('fulfill', 'Record fulfillment'))
  } else if (!now.transitions)
    actions.push(
      now.resolved
        ? workflow('reopen', 'Reopen ticket')
        : workflow('resolve', 'Resolve ticket'),
    )
  if (now.editable)
    actions.push({ key: 'edit', label: 'Edit request', tab: 'Request', target: 'action-edit' })
  actions.push(
    ...wording,
    { key: 'evidence', label: 'Record evidence', tab: 'Evidence', target: 'action-evidence' },
    { key: 'link', label: 'Link work', tab: 'Evidence', target: 'action-link' },
    { key: 'note', label: 'Add note', tab: 'Activity', target: 'action-note' },
  )
  return actions
}
// The header's actions row. Each button opens the form that does the work.
function TicketActions({
  actions,
  choose,
}: {
  actions: HeaderAction[]
  choose: (action: HeaderAction) => void
}) {
  if (!actions.length) return null
  return (
    <div className="header-actions" role="group" aria-label="Actions on this ticket">
      {actions.map((item, i) => (
        <button
          key={item.key}
          type="button"
          className={i === 0 ? 'primary' : 'secondary'}
          onClick={() => choose(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
// #918: the actions this ticket's type lets the viewer take now. The server
// decides which; each asks for its own fields before it is taken.
function TypeActions({ actions, state, mutate, busy, open, setOpen }: {
  actions: TicketAction[]; state: string; mutate: Mutate; busy: boolean
  // #941: which move's form is open, held by the ticket so its header can open one.
  open: string; setOpen: (action: string) => void
}) {
  const [values, setValues] = useState<RecordData>({})
  useEffect(() => { setValues({}) }, [state, open])
  const chosen = actions.find((a) => a.action === open)
  const take = (action: TicketAction, recorded: RecordData) =>
    mutate('transition', { action: action.action, ...(action.fields.length ? { values: recorded } : {}) })
  return (
    <section className="card ticket-actions">
      <h3>Next step</h3>
      {actions.length ? (
        <div className="actions">
          {actions.map((a) => (
            <button key={a.action} type="button" className={open === a.action ? 'primary' : 'secondary'} disabled={busy}
              onClick={() => (a.fields.length ? setOpen(a.action) : void take(a, {}))}>
              {a.action}
            </button>
          ))}
        </div>
      ) : (
        <p className="fine">No action is open to you while this ticket is {state}.</p>
      )}
      {chosen && (
        <form id="action-transition" onSubmit={async (e) => { e.preventDefault(); if (await take(chosen, values)) setOpen('') }}>
          <fieldset disabled={busy}>
            <p className="fine">{chosen.action} moves this ticket to {chosen.next_state}.</p>
            <Structured kind="__action__" values={values} change={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
              fields={chosen.fields.map((f) => ({ ...f, required: true }))} />
            <div className="actions">
              <button type="button" onClick={() => setOpen('')}>Cancel</button>
              <button className="primary">{chosen.action}</button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}
// #918: the requester or support corrects the request's wording; the
// earlier wording stays in the ticket's history.
function Reword({ original, mutate, busy, close }: { original: string; mutate: Mutate; busy: boolean; close: () => void }) {
  return (
    <form id="action-wording" className="card" onSubmit={async (e) => {
      e.preventDefault()
      const text = String(new FormData(e.currentTarget).get('original') ?? '')
      if (await mutate('edit', { original: text })) close()
    }}>
      <fieldset disabled={busy}>
        <Label title="Original message">
          <textarea name="original" required rows={4} defaultValue={original} />
        </Label>
        <p className="fine">The earlier wording is kept in the ticket's history.</p>
        <div className="actions">
          <button type="button" onClick={close}>Cancel</button>
          <button className="primary">Save wording</button>
        </div>
      </fieldset>
    </form>
  )
}
export function CaseFile({
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
  const configured = configuredTypes[ticket.kind]
  const access = ticket.kind === 'access',
    resolved = configured ? configured.done.includes(ticket.ticket_state) : state === 'resolved'
  const verification = detail.verification,
    approval = detail.approval
  const approvalAllowed =
    detail.capabilities?.decide === true ||
    detail.capabilities?.approve === true
  const canDecide =
    support &&
    approvalAllowed &&
    verification?.active === true
  const canReword =
    Boolean(detail.details) &&
    (support || ticket.owner === (typeof session.user === 'string' ? session.user : session.user.row_id))
  const [rewording, setRewording] = useState(false)
  // #1069: support assigns from the header. Picking only asks; Assign saves.
  const current = ticket.assigned_to ?? '',
    people = session.people ?? [],
    me = typeof session.user === 'string' ? session.user : session.user.row_id
  const [picked, setPicked] = useState(current)
  useEffect(() => setPicked(current), [current, ticket.updated_at, ticket.row_id])
  const actions = availableActions({
    support,
    rewordable: canReword,
    capabilities: session.capabilities,
    access,
    resolved,
    state,
    canDecide,
    editable: Boolean(detail.details),
    transitions: configured?.transitions ? ((detail.actions as TicketAction[] | undefined) ?? []) : null,
  })
  const [typeOpen, setTypeOpen] = useState('')
  useEffect(() => setTypeOpen(''), [ticket.ticket_state, ticket.row_id])
  const [focus, setFocus] = useState<{ target: string; at: number } | null>(null)
  useEffect(() => {
    if (!focus) return
    const target = document.getElementById(focus.target)
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    target
      ?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button')
      ?.focus({ preventScroll: true })
  }, [focus])
  return (
    <>
      <header className="ticket-header" aria-label="Ticket">
        <div className="ticket-kicker">
          <span>
            {short(ticket.row_id)} · {kindLabel(ticket.kind)}
          </span>
          <StatePill ticket={ticket} />
        </div>
        <h2>{ticket.title}</h2>
        <dl className="ticket-facts">
          <div>
            <dt id="assigned-to-label">Assigned to</dt>
            <dd>
              {support ? (
                <select
                  aria-labelledby="assigned-to-label"
                  value={picked}
                  disabled={busy}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {current && !people.some((p) => p.row_id === current) && (
                    <option value={current}>{person(current)}</option>
                  )}
                  {people.map((p) => (
                    <option key={p.row_id} value={p.row_id}>{p.full_name}</option>
                  ))}
                </select>
              ) : (
                assignee(ticket)
              )}
            </dd>
          </div>
          <div>
            <dt>Raised by</dt>
            <dd>{person(ticket.owner)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{time(ticket.updated_at)}</dd>
          </div>
        </dl>
        {support && picked !== current && (
          <div className="assign-confirm" role="group" aria-label="Confirm the assignee">
            <span>
              {picked === ''
                ? 'Remove the assignee?'
                : picked === me
                  ? 'Assign to yourself?'
                  : `Assign to ${people.find((p) => p.row_id === picked)?.full_name ?? person(picked)} and email them?`}
            </span>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={async () => {
                // A refused save (someone changed the ticket first) keeps nothing.
                if (!(await mutate('edit', { assigned_to: picked || null }))) setPicked(current)
              }}
            >
              Assign
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setPicked(current)}>
              Cancel
            </button>
          </div>
        )}
        <TicketActions
          actions={actions}
          choose={(chosen) => {
            const move = chosen.transition
            // A move that asks for nothing is taken at once, as in the Workflow tab.
            if (move && !move.fields.length) return void mutate('transition', { action: move.action })
            if (move) setTypeOpen(move.action)
            setTab(chosen.tab)
            if (chosen.key === 'edit') setEditing(true)
            if (chosen.key === 'wording') setRewording(true)
            setFocus({ target: chosen.target, at: Date.now() })
          }}
        />
      </header>
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
            <section className="card public-progress">
              <h3>Public progress</h3>
              <p>{ticket.public_update || 'No public update yet.'}</p>
            </section>
            {detail.details ? (
              <>
                <div className="section-label">
                  {configured?.details_visible_to === 'everyone'
                    ? 'Visible to everyone who can see this ticket'
                    : 'Private · requester & support'}
                </div>
                <h3>Original message</h3>
                <p className="request-body">
                  {display(detail.details.original)}
                </p>
                {rewording && canReword && (
                  <Reword original={String(detail.details.original ?? '')} mutate={mutate} busy={busy} close={() => setRewording(false)} />
                )}
                {Array.isArray(detail.originalHistory) && detail.originalHistory.length > 0 && (
                  <details className="fine">
                    <summary>Earlier wording ({(detail.originalHistory as RecordData[]).length})</summary>
                    {(detail.originalHistory as RecordData[]).map((h, i) => (
                      <p key={i}>
                        “{String(h.text)}” · replaced by {person(h.replaced_by)} · {time(h.replaced_at)}
                      </p>
                    ))}
                  </details>
                )}
                <h3>Request details</h3>
                <Facts
                  values={
                    configured
                      ? Object.fromEntries(
                          configured.fields
                            .filter((field) => structured?.[field.name] != null)
                            .map((field) => [
                              field.label,
                              (detail.labels as RecordData | undefined)?.[field.name] ??
                                (field.type === 'person' ? person(structured?.[field.name]) : structured?.[field.name]),
                            ]),
                        )
                      : Object.fromEntries(
                          Object.entries(structured ?? {}).filter(
                            ([key]) => key !== 'original',
                          ),
                        )
                  }
                />
                {support && (
                  <>
                    {editing && (
                      <button
                        className="secondary"
                        onClick={() => setEditing(false)}
                      >
                        Cancel editing
                      </button>
                    )}
                    {editing && (
                      <form
                        id="action-edit"
                        className="card"
                        onSubmit={async (e) => {
                          e.preventDefault()
                          const data = new FormData(e.currentTarget)
                          await mutate('edit', {
                            title: data.get('title'),
                            kind,
                            details: Object.fromEntries(
                              Object.entries(draft).filter(
                                ([key]) =>
                                  key !== 'original' &&
                                  (!configuredTypes[kind] ||
                                    configuredTypes[kind].fields.some((field) => field.name === key)),
                              ),
                            ),
                            ...(configuredTypes[kind] && data.get('state') && data.get('state') !== ticket.ticket_state
                              ? { state: data.get('state') }
                              : {}),
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
                          {configuredTypes[kind] && kind === ticket.kind && !configuredTypes[kind].transitions && (
                            <Label title="State">
                              <select name="state" defaultValue={ticket.ticket_state}>
                                {configuredTypes[kind].states.map((option) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            </Label>
                          )}
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
                    <section className="card" id="action-decide">
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
                              : verification?.active === true
                                ? 'Only a configured approver for this region can decide.'
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
                    {session.canManage && (
                      <p className="fine">
                        Missing memberships or routes?{' '}
                        <a href={SETTINGS_HREF}>
                          Configure Tickets settings
                        </a>
                      </p>
                    )}
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
            ) : configured?.transitions ? (
              <TypeActions actions={(detail.actions as TicketAction[] | undefined) ?? []} state={ticket.ticket_state} mutate={mutate} busy={busy} open={typeOpen} setOpen={setTypeOpen} />
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
                    {!resolved && configured && (
                      <Label title="Done as">
                        <select name="state" defaultValue={configured.done[0]}>
                          {configured.done.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </Label>
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
              <p>Public progress is shown in Request and in Activity.</p>
            </div>
          ))}
        {tab === 'Activity' && (
          <>
            <div className="section-label">Public history</div>
            <History events={detail.events ?? []} privacy="Public" />
            {!support && detail.privateEvents && (
              <>
                <div className="section-label">Ticket history</div>
                <History events={detail.privateEvents} privacy="Everyone who can see this ticket" />
              </>
            )}
            {support && (
              <>
                <div className="section-label">
                  {configured?.details_visible_to === 'everyone' ? 'Ticket history' : 'Support-only history'}
                </div>
                <History
                  events={detail.privateEvents ?? []}
                  privacy={configured?.details_visible_to === 'everyone' ? 'Everyone who can see this ticket' : 'Support only'}
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
