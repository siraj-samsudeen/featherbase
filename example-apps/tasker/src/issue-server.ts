import type { Context } from './server'
import { DEFAULT_HOURS, clockMinutes, deadlineAfter, issueClock, ruleFor, type ClockMode, type SlaRule } from './sla'

type Row = Record<string, unknown>
const ISSUE = 'tasker.issue'
const SUBMITTED = 'Submitted for verification'
const ACTIVE = ['Open', 'Acknowledged']

// Only these rules write these fields; whatever a client sends for them is ignored.
const STAMPED: Record<string, unknown> = {
  raised_at: null, acknowledged_at: null, submitted_at: null, submitted_by: null, closed_at: null, verified_by: null,
  return_reason: null, return_count: 0, clock: null, opens_at: null, closes_at: null, respond_minutes: null, fix_minutes: null,
  respond_by: null, fix_by: null, response_breached: false, fix_breached: false, breached_at: null, paused_since: null,
  pause_approved_by: null, paused_minutes: 0, on_clock_minutes: 0, used_pct: 0, escalation_level: 0, notified_owner: null,
  needs_owner: false, missing_contact: false, issue_log: null, shared: true,
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const instant = (value: unknown) => Date.parse(value instanceof Date ? value.toISOString() : String(value))
const iso = (ms: number) => new Date(ms).toISOString()

async function rules(ctx: Context): Promise<SlaRule[]> {
  const rows = await ctx.documents.list('tasker.sla_rule', {
    fields: ['severity', 'category', 'respond_minutes', 'fix_minutes', 'clock', 'director', 'director_after_minutes'], limit_page_length: 200,
  })
  return rows.map(row => ({ ...row, respond_minutes: Number(row.respond_minutes), fix_minutes: Number(row.fix_minutes) }) as unknown as SlaRule)
}

/** Issues: deadlines from SLA rules, acknowledgement, escalation, pausing and verified closure. */
export async function prepareIssue(ctx: Context): Promise<void> {
  const old: Row = ctx.old ?? {}
  const row = ctx.row
  const now = Date.parse(ctx.now)
  const reason = text(row.change_reason)
  row.change_reason = null
  for (const [field, empty] of Object.entries(STAMPED)) row[field] = ctx.isNew ? empty : old[field] ?? empty
  const log: Row[] = JSON.parse(String(old.issue_log || '[]'))
  const add = (kind: string, extra: Row = {}) => log.push({ at: ctx.now, kind, by: ctx.user, ...extra })
  const from = ctx.isNew ? 'Open' : String(old.issue_state)
  let to = String(row.issue_state ?? 'Open')
  const owner = row.owner ? String(row.owner) : null
  const verifier = row.verifier ? String(row.verifier) : null
  const store = row.store ? await ctx.documents.get('tasker.store', String(row.store)) : null
  const hours = () => ({ opens: String(row.opens_at), closes: String(row.closes_at) })
  const clock = () => String(row.clock) as ClockMode
  const recountDeadlines = () => {
    const raised = instant(row.raised_at)
    row.respond_by = iso(deadlineAfter(raised, Number(row.respond_minutes), clock(), hours()))
    row.fix_by = iso(deadlineAfter(raised, Number(row.fix_minutes) + Number(row.paused_minutes), clock(), hours()))
  }
  const stopped = (since: unknown) => clockMinutes(instant(since), now, clock(), hours())

  if (ctx.isNew) {
    row.raised_at = ctx.now
    to = 'Open'
    add('raised')
  }
  if (ctx.isNew || row.severity !== old.severity || row.category !== old.category) {
    const rule = ruleFor(await rules(ctx), String(row.severity), String(row.category))
    Object.assign(row, { clock: rule.clock, respond_minutes: rule.respond_minutes, fix_minutes: rule.fix_minutes,
      opens_at: String(store?.opens_at || DEFAULT_HOURS.opens), closes_at: String(store?.closes_at || DEFAULT_HOURS.closes) })
    recountDeadlines()
  }

  if (verifier && verifier === owner) ctx.reject('The verifier can’t be the issue’s owner', { verifier: 'Choose someone other than the owner' })
  if ((owner && owner !== old.owner) || (verifier && verifier !== old.verifier)) {
    const members = await ctx.documents.members(ISSUE)
    for (const person of [owner !== old.owner ? owner : null, verifier !== old.verifier ? verifier : null])
      if (person && !members.some(member => member.row_id === person)) ctx.reject('Choose a Tasker member')
  }
  // A new owner acknowledges the issue afresh.
  const reassigned = !ctx.isNew && owner !== (old.owner ?? null) && ACTIVE.includes(from)
  if (reassigned) {
    row.acknowledged_at = null
    if (to === 'Acknowledged') to = 'Open'
  }

  // State changes.
  if (to !== from) {
    if (reassigned && to === 'Open') {
      // Back to Open, waiting for the new owner; their assignment notice follows below.
    } else if (from === 'Open' && to === 'Acknowledged') {
      if (ctx.user !== owner) ctx.reject('Only the owner can acknowledge this issue')
      row.acknowledged_at = ctx.now
      if (now > instant(row.respond_by)) row.response_breached = true
      add('acknowledged')
    } else if (ACTIVE.includes(from) && to === SUBMITTED) {
      if (ctx.user !== owner) ctx.reject('Only the owner submits this issue')
      if (!text(row.evidence_note)) ctx.reject('Add a note on what was done', { evidence_note: 'Say what was done' })
      if (row.paused) { row.paused_minutes = Number(row.paused_minutes) + stopped(row.paused_since); row.paused = false; row.paused_since = null }
      row.pause_requested = false
      row.submitted_at = ctx.now
      row.submitted_by = ctx.user
      row.return_reason = null
      if (!row.acknowledged_at) row.acknowledged_at = ctx.now
      add('submitted')
      if (!verifier) { to = 'Closed'; row.closed_at = ctx.now; add('closed') }
    } else if (from === SUBMITTED && to === 'Closed') {
      if (ctx.user !== verifier) ctx.reject('Only the verifier can accept this issue')
      if (ctx.user === row.submitted_by) ctx.reject('Nobody verifies an issue they submitted')
      row.verified_by = ctx.user
      row.closed_at = ctx.now
      add('closed')
    } else if (from === SUBMITTED && ACTIVE.includes(to)) {
      if (ctx.user !== verifier) ctx.reject('Waiting for the verifier to accept or return this issue')
      if (!reason) ctx.reject('Give a reason for returning this issue', { change_reason: 'Say what still needs doing' })
      row.paused_minutes = Number(row.paused_minutes) + stopped(row.submitted_at)
      Object.assign(row, { submitted_at: null, return_reason: reason, return_count: Number(row.return_count) + 1 })
      to = 'Acknowledged'
      add('returned', { note: reason })
    } else if (from === 'Closed' && ACTIVE.includes(to)) {
      if (!reason) ctx.reject('Give a reason for reopening this issue', { change_reason: 'Say why it is open again' })
      row.paused_minutes = Number(row.paused_minutes) + stopped(row.submitted_at)
      Object.assign(row, { submitted_at: null, closed_at: null, verified_by: null })
      to = 'Acknowledged'
      add('reopened', { note: reason })
    } else ctx.reject('Submit this issue for verification first')
    if (to !== from && ACTIVE.includes(to) && ACTIVE.includes(from) === false) recountDeadlines()
  }
  row.issue_state = to

  // Waiting for a vendor stops the clock only once the store manager approves.
  if (row.pause_requested && !old.pause_requested) {
    if (!text(row.pause_reason) || !row.pause_review_on) ctx.reject('Give a reason and a next review date', { pause_reason: 'Say what you are waiting for' })
    add('pause_requested', { note: text(row.pause_reason) })
  }
  if (row.paused && !old.paused) {
    if (!row.pause_requested) ctx.reject('Ask for the pause first, with a reason and a next review date')
    if (!store?.store_manager || ctx.user !== store.store_manager) ctx.reject('Only the store manager can approve a pause')
    Object.assign(row, { paused_since: ctx.now, pause_approved_by: ctx.user })
    add('paused')
  } else if (!row.paused && old.paused) {
    row.paused_minutes = Number(row.paused_minutes) + stopped(row.paused_since)
    Object.assign(row, { paused_since: null, pause_requested: false })
    recountDeadlines()
    add('resumed')
  }

  // Clocks and escalation, checked on every save and by the escalation job.
  const state = issueClock({ raised_at: String(row.raised_at instanceof Date ? row.raised_at.toISOString() : row.raised_at), fix_minutes: Number(row.fix_minutes), clock: clock(),
    opens_at: String(row.opens_at), closes_at: String(row.closes_at), paused_minutes: Number(row.paused_minutes), paused: Boolean(row.paused),
    paused_since: row.paused_since ? String(row.paused_since instanceof Date ? row.paused_since.toISOString() : row.paused_since) : null,
    submitted_at: row.submitted_at ? String(row.submitted_at instanceof Date ? row.submitted_at.toISOString() : row.submitted_at) : null }, now)
  row.on_clock_minutes = state.onClock
  row.used_pct = state.usedPct
  if (to === 'Open' && !row.response_breached && now > instant(row.respond_by)) { row.response_breached = true; add('response_missed') }
  if (owner && row.notified_owner !== owner) { add('assigned', { to: [owner] }); row.notified_owner = owner }
  if (to === SUBMITTED && state.breached && !row.fix_breached) { row.fix_breached = true; row.breached_at = ctx.now }
  if (ACTIVE.includes(to) && !row.paused) {
    let level = Number(row.escalation_level)
    if (state.usedPct >= 75 && level < 1) { if (owner) add('reminder', { to: [owner] }); level = 1 }
    if (state.breached && level < 2) {
      Object.assign(row, { fix_breached: true, breached_at: ctx.now })
      const recipients: string[] = [], missing: string[] = []
      if (store?.store_manager) recipients.push(String(store.store_manager)); else missing.push(`no store manager for ${String(store?.store_name ?? 'this issue')}`)
      const [head] = await ctx.documents.list('tasker.function_head', { filters: [['owner_function', '=', row.owner_function]], fields: ['head'], limit_page_length: 1 })
      if (head?.head) recipients.push(String(head.head)); else missing.push(`no ${String(row.owner_function)} head`)
      if (recipients.length) add('breach', { to: recipients })
      if (missing.length) { row.missing_contact = true; add('missing', { note: `Escalation has ${missing.join(' and ')}` }) }
      level = 2
    }
    if (level === 2) {
      const rule = ruleFor(await rules(ctx), String(row.severity), String(row.category))
      if (rule.director_after_minutes && now - instant(row.breached_at) >= rule.director_after_minutes * 60_000) {
        if (rule.director) add('director', { to: [String(rule.director)] })
        else { row.missing_contact = true; add('missing', { note: `No director is named for ${String(row.severity)} issues` }) }
        level = 3
      }
    }
    row.escalation_level = level
  }
  row.needs_owner = !owner || Boolean(row.missing_contact)
  row.issue_log = JSON.stringify(log)
}

interface Documents {
  get(table: string, id: string): Promise<Row>
  list(table: string, args?: { filters?: [string, string, unknown][]; fields?: string[]; limit_page_length?: number; limit_start?: number }): Promise<Row[]>
  update(table: string, values: Row): Promise<Row>
}
export interface EscalationJobContext {
  readonly now: string
  readonly documents: { forEachOwner(callback: (scope: { user: string; documents: Documents }) => Promise<void>): Promise<void> }
  setResult(text: string): void
}

/** Every minute: re-save each open issue so its clock and escalation steps are checked. */
export async function runEscalation(ctx: EscalationJobContext) {
  let checked = 0
  await ctx.documents.forEachOwner(async ({ user, documents }) => {
    for (let offset = 0; ; offset += 200) {
      const page = await documents.list(ISSUE, { filters: [['created_by', '=', user], ['issue_state', '!=', 'Closed'], ['issue_state', '!=', SUBMITTED], ['paused', '=', false]],
        fields: ['row_id'], limit_start: offset, limit_page_length: 200 })
      for (const listed of page) {
        const issue = await documents.get(ISSUE, String(listed.row_id))
        await documents.update(ISSUE, { row_id: issue.row_id, updated_at: issue.updated_at, checked_at: ctx.now })
      }
      checked += page.length
      if (page.length < 200) break
    }
  })
  ctx.setResult(`Checked ${checked} open issues`)
}
