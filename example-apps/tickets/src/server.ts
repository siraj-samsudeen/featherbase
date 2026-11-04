import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

// Structural public runtime API: this package has no platform dependency.
type Row = Record<string, unknown>
interface ListArgs {
  fields?: string[]
  filters?: [string, string, unknown][]
  order_by?: string
  limit_start?: number
  limit_page_length?: number
}
interface ReadContext {
  user: string
  payload: unknown
  settings: Readonly<Record<string, string>>
  reject(message: string, fields?: Record<string, string>): never
  documents: {
    get(table: string, id: string): Promise<Row>
    list(table: string, args?: ListArgs): Promise<Row[]>
  }
}
interface Context extends ReadContext {
  documents: ReadContext['documents'] & {
    create(table: string, row: Row): Promise<Row>
    update(table: string, row: Row): Promise<Row>
  }
}
interface Validation {
  row: Row
  old?: Row
  user: string
  isNew: boolean
  reject(message: string): never
}
export const platformVersion = '2026-10'
const writes = new AsyncLocalStorage<{ user: string; operation: string }>()
function validate(table: string, ctx: Validation) {
  const allowed = writes.getStore()
  if (!allowed || allowed.user !== ctx.user) ctx.reject('Use an authorized Tickets action')
  if ((table === 'event' || table === 'progress') && !ctx.isNew) ctx.reject('History is append-only')
  if (table === 'request' && ctx.old && ctx.row.original !== ctx.old.original) ctx.reject('The original request is immutable')
  if (ctx.old && ctx.row.owner !== ctx.old.owner) ctx.reject('The requester is immutable')
}
export const validators = Object.fromEntries(['ticket', 'request', 'event', 'progress'].map(table =>
  [`tickets.${table}`, (ctx: Validation) => validate(table, ctx)]))
export const destructiveGuards = Object.fromEntries(Object.keys(validators).map(table =>
  [table, (ctx: Validation) => ctx.reject('Tickets references and history cannot be renamed or deleted')]))
const kinds = ['generic', 'access', 'freshness', 'quality', 'report', 'source', 'schema', 'pipeline', 'backfill']
const ticketFields = ['row_id', 'title', 'kind', 'ticket_state', 'assigned_to', 'public_update', 'updated_at', 'owner']
const eventFields = ['row_id', 'ticket', 'operation', 'text', 'by', 'at']
const progressFields = ['row_id', 'ticket', 'text', 'by', 'at']
function object(ctx: ReadContext, value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) ctx.reject('Expected an object')
  return value as Row
}
function text(ctx: ReadContext, value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) ctx.reject(`${label} is required`)
  return value.trim()
}
function input(ctx: ReadContext, keys: string[]) {
  const p = object(ctx, ctx.payload)
  if (Object.keys(p).some(key => !keys.includes(key))) ctx.reject('Unknown or protected input field')
  return p
}
function parse(value: unknown): Row {
  try {
    const result = JSON.parse(String(value ?? '{}'))
    return result && typeof result === 'object' && !Array.isArray(result) ? result : {}
  } catch { return {} }
}
function configured(ctx: ReadContext, key: string): unknown {
  try { return JSON.parse(ctx.settings[key] ?? 'null') } catch { return null }
}
function members(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
function routes(ctx: ReadContext): Record<string, string[]> {
  const value = configured(ctx, 'approval_routes')
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([key, ids]) => [key, members(ids)]))
}
function capabilities(ctx: ReadContext) {
  const verify = members(configured(ctx, 'verification_admins')).includes(ctx.user)
  const fulfill = members(configured(ctx, 'fulfillment_admins')).includes(ctx.user)
  return {
    support: verify || fulfill || members(configured(ctx, 'support_users')).includes(ctx.user) || Object.values(routes(ctx)).some(ids => ids.includes(ctx.user)),
    verify, fulfill,
  }
}
async function all(ctx: ReadContext, table: string, fields: string[], filters: ListArgs['filters'] = []) {
  const rows: Row[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await ctx.documents.list(table, { fields, filters, order_by: 'row_id asc', limit_start: offset, limit_page_length: 500 })
    rows.push(...page)
    if (page.length < 500) return rows
  }
}
function kind(ctx: ReadContext, value: unknown) {
  if (typeof value !== 'string' || !kinds.includes(value)) ctx.reject('Choose a valid ticket kind')
  return value
}
function details(ctx: ReadContext, value: unknown): Row {
  const row = object(ctx, value)
  const forbidden = ['original', 'verification', 'approval', 'fulfillment', 'actor', 'by', 'at', 'owner', 'ticket_state', 'root_cause']
  if (Object.keys(row).some(key => forbidden.includes(key))) ctx.reject('Protected request field')
  return row
}
async function current(ctx: Context, p: Row, supportOnly = true) {
  const ticket = await ctx.documents.get('tickets.ticket', text(ctx, p.row_id, 'Ticket'))
  if (String(ticket.updated_at) !== text(ctx, p.updated_at, 'Revision')) ctx.reject('This ticket changed; reload before trying again')
  const support = capabilities(ctx).support
  if (supportOnly ? !support : !support && ticket.owner !== ctx.user) ctx.reject('Not authorized to change this request')
  // Do not try a denied private read and catch it: host context failures are sticky.
  const request = await ctx.documents.get('tickets.request', String(ticket.row_id))
  return { ticket, request, structured: parse(request.details_json), support }
}
async function event(ctx: Context, ticket: Row, operation: string, data: Row) {
  return ctx.documents.create('tickets.event', { ticket: ticket.row_id, operation,
    text: JSON.stringify(data), by: ctx.user, at: new Date().toISOString() })
}
async function bump(ctx: Context, ticket: Row, values: Row = {}) {
  return ctx.documents.update('tickets.ticket', { row_id: ticket.row_id, updated_at: ticket.updated_at, ...values })
}
function restricted(ctx: ReadContext, structured: Row) {
  const rules = configured(ctx, 'restricted_resources')
  if (!Array.isArray(rules) || rules.some(value => typeof value !== 'string' || !value.trim())) return true
  const resource = `${structured.resource ?? ''} ${structured.scope ?? ''}`.toLowerCase()
  return rules.some(rule => resource.includes(String(rule).toLowerCase()))
}
function workflow(request: Row, events: Row[]) {
  const decoded: Row[] = events.map(e => ({ ...parse(e.text), operation: e.operation, by: e.by, at: e.at }))
  const verification = decoded.filter(e => e.operation === 'verify' && e.verification_key === request.verification_key).at(-1)
  const approval = decoded.filter(e => e.operation === 'decide' && e.approval_key === request.approval_key).at(-1)
  return { verification, approval }
}
async function history(ctx: ReadContext, ticket: Row) {
  return all(ctx, 'tickets.event', eventFields, [['ticket', '=', ticket.row_id]])
}
const handlers: Record<string, (ctx: Context) => Promise<unknown> | unknown> = {
  async create(ctx) {
    const p = input(ctx, ['title', 'original', 'kind', 'details'])
    const title = text(ctx, p.title, 'Public summary')
    const original = text(ctx, p.original, 'Original request')
    const category = kind(ctx, p.kind ?? 'generic')
    const structured = details(ctx, p.details ?? {})
    const ticket = await ctx.documents.create('tickets.ticket', { title, owner: ctx.user, kind: category, ticket_state: category === 'access' ? 'Needs verification' : 'New' })
    await ctx.documents.create('tickets.request', { row_id: ticket.row_id, original, details_json: JSON.stringify(structured), verification_key: randomUUID(), approval_key: randomUUID() })
    return { ticket }
  },
  async edit(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'title', 'kind', 'details', 'assigned_to', 'public_update'])
    const { ticket, request, structured, support } = await current(ctx, p, false)
    if (!support && ['kind', 'assigned_to', 'public_update'].some(key => p[key] !== undefined)) ctx.reject('Only support may triage or publish progress')
    const next = p.details === undefined ? structured : { ...structured, ...details(ctx, p.details) }
    const category = p.kind === undefined ? ticket.kind : kind(ctx, p.kind)
    // Never turn an access decision into an ordinary-resolution bypass.
    if (ticket.kind === 'access' && category !== 'access') ctx.reject('An access request must keep its access gates')
    const recipientChanged = next.email !== structured.email
    const scopeChanged = ['scope', 'resource', 'region'].some(key => next[key] !== structured[key]) || category !== ticket.kind
    if (p.details !== undefined || category !== ticket.kind) await ctx.documents.update('tickets.request', {
      row_id: request.row_id, updated_at: request.updated_at, details_json: JSON.stringify(next),
      verification_key: recipientChanged ? randomUUID() : request.verification_key,
      approval_key: recipientChanged || scopeChanged ? randomUUID() : request.approval_key,
    })
    // Every edit is attributed history, including the requester's own scope or recipient change.
    await event(ctx, ticket, 'edit', { before: structured, details: next, kind: category,
      ...(p.assigned_to !== undefined ? { assigned_to: p.assigned_to } : {}) })
    const values: Row = { kind: category }
    if (p.title !== undefined) values.title = text(ctx, p.title, 'Public summary')
    if (p.assigned_to !== undefined) values.assigned_to = p.assigned_to === null || p.assigned_to === '' ? null : text(ctx, p.assigned_to, 'Assignee')
    if (p.public_update !== undefined) {
      values.public_update = text(ctx, p.public_update, 'Public update')
      await ctx.documents.create('tickets.progress', { ticket: ticket.row_id, text: values.public_update, by: ctx.user, at: new Date().toISOString() })
    }
    if (recipientChanged || scopeChanged) {
      values.ticket_state = category === 'access' ? 'Needs verification' : 'New'
      if (support && category === 'access') {
        const { verification } = workflow(request, await history(ctx, ticket))
        if (restricted(ctx, next)) values.ticket_state = 'Policy review'
        else if (!recipientChanged && verification?.active === true) values.ticket_state = 'Awaiting approval'
      }
    }
    return { ticket: await bump(ctx, ticket, values) }
  },
  async verify(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'email', 'active', 'region', 'evidence'])
    if (!capabilities(ctx).verify) ctx.reject('Only a configured verification admin may verify employment')
    const { ticket, request, structured } = await current(ctx, p)
    if (ticket.kind !== 'access') ctx.reject('Employment verification is for access requests')
    const email = text(ctx, p.email, 'Email')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email !== structured.email) ctx.reject('Verify the exact requested email')
    if (typeof p.active !== 'boolean') ctx.reject('Record the active employment result')
    const region = text(ctx, p.region, 'Region')
    const evidence = text(ctx, p.evidence, 'Evidence reference')
    await ctx.documents.update('tickets.request', { row_id: request.row_id, updated_at: request.updated_at, approval_key: randomUUID() })
    await event(ctx, ticket, 'verify', { email, active: p.active, region, evidence, verification_key: request.verification_key })
    return { ticket: await bump(ctx, ticket, { ticket_state: restricted(ctx, structured) ? 'Policy review' : p.active ? 'Awaiting approval' : 'Needs verification' }) }
  },
  async decide(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'decision', 'reason'])
    const { ticket, request, structured } = await current(ctx, p)
    if (ticket.kind !== 'access') ctx.reject('Approval is for access requests')
    const { verification } = workflow(request, await history(ctx, ticket))
    if (!verification || verification.active !== true || verification.email !== structured.email) return ctx.reject('Current active employment verification is required')
    if (!members(configured(ctx, 'verification_admins')).includes(String(verification.by))) ctx.reject('Employment must be verified by a current verification admin')
    if (!routes(ctx)[String(verification.region)]?.includes(ctx.user)) ctx.reject('Only a configured approver for the verified region may decide')
    if (restricted(ctx, structured)) ctx.reject('This resource requires policy review')
    const scope = text(ctx, structured.scope, 'Requested scope')
    if (p.decision !== 'approved' && p.decision !== 'rejected') ctx.reject('Choose approved or rejected')
    const reason = p.decision === 'rejected' ? text(ctx, p.reason, 'Rejection reason') : p.reason === undefined || p.reason === '' ? undefined : text(ctx, p.reason, 'Reason')
    await event(ctx, ticket, 'decide', { decision: p.decision, scope, email: structured.email, resource: structured.resource,
      region: verification.region, approval_key: request.approval_key, ...(reason ? { reason } : {}) })
    return { ticket: await bump(ctx, ticket, { ticket_state: p.decision === 'approved' ? 'Approved' : 'Rejected' }) }
  },
  async fulfill(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'reference'])
    if (!capabilities(ctx).fulfill) ctx.reject('Only a configured fulfillment admin may record completion')
    const { ticket, request, structured } = await current(ctx, p)
    if (ticket.kind !== 'access' || ticket.ticket_state !== 'Approved') ctx.reject('Only a current approved access request can be fulfilled')
    const { verification, approval } = workflow(request, await history(ctx, ticket))
    if (!verification || verification.active !== true || verification.email !== structured.email ||
        !approval || approval.decision !== 'approved' || approval.scope !== structured.scope || approval.region !== verification.region)
      return ctx.reject('Current active verification and approval of this exact scope are required')
    if (!members(configured(ctx, 'verification_admins')).includes(String(verification.by)) ||
        !routes(ctx)[String(verification.region)]?.includes(String(approval.by))) ctx.reject('The current configuration no longer authorizes this decision chain')
    if (restricted(ctx, structured)) ctx.reject('This resource requires policy review')
    await event(ctx, ticket, 'fulfill', { reference: text(ctx, p.reference, 'Manual completion reference'),
      scope: approval.scope, email: structured.email, manual: true })
    return { ticket: await bump(ctx, ticket, { ticket_state: 'Resolved' }) }
  },
  async note(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'text'])
    const { ticket } = await current(ctx, p)
    await event(ctx, ticket, 'note', { text: text(ctx, p.text, 'Internal note') })
    return { ticket: await bump(ctx, ticket) }
  },
  async evidence(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'expected', 'observed', 'reference', 'observed_at', 'finding', 'root_cause'])
    const { ticket } = await current(ctx, p)
    const observedAt = text(ctx, p.observed_at, 'Observation time')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) ctx.reject('Use a valid ISO observation time with timezone')
    await event(ctx, ticket, 'evidence', { expected: text(ctx, p.expected, 'Expected outcome'), observed: text(ctx, p.observed, 'Observed outcome'),
      reference: text(ctx, p.reference, 'Evidence reference'), observed_at: observedAt, finding: text(ctx, p.finding, 'Manual finding'),
      ...(p.root_cause === undefined ? {} : { root_cause: text(ctx, p.root_cause, 'Root cause') }) })
    return { ticket: await bump(ctx, ticket, ticket.kind === 'access' || ticket.ticket_state === 'Resolved' ? {} : { ticket_state: 'In progress' }) }
  },
  async link(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'url'])
    const { ticket } = await current(ctx, p)
    let url: URL
    try { url = new URL(text(ctx, p.url, 'Related-work URL')) } catch { return ctx.reject('Use an absolute HTTP or HTTPS URL') }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) ctx.reject('Use an HTTP or HTTPS URL without credentials')
    await event(ctx, ticket, 'link', { url: url.href })
    return { ticket: await bump(ctx, ticket) }
  },
  async resolve(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'reason', 'reference'])
    const { ticket } = await current(ctx, p)
    if (ticket.kind === 'access') ctx.reject('Access must be completed through authorized fulfillment')
    await event(ctx, ticket, 'resolve', { reason: text(ctx, p.reason, 'Resolution reason'), reference: text(ctx, p.reference, 'Resolution evidence') })
    return { ticket: await bump(ctx, ticket, { ticket_state: 'Resolved' }) }
  },
  async reopen(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'reason'])
    const { ticket, request } = await current(ctx, p)
    if (ticket.ticket_state !== 'Resolved') ctx.reject('Only a resolved ticket can be reopened')
    await event(ctx, ticket, 'reopen', { reason: text(ctx, p.reason, 'Reopening reason') })
    if (ticket.kind === 'access') await ctx.documents.update('tickets.request', {
      row_id: request.row_id, updated_at: request.updated_at, approval_key: randomUUID(),
    })
    return { ticket: await bump(ctx, ticket, { ticket_state: ticket.kind === 'access' ? 'Needs verification' : 'In progress' }) }
  },
}
export const actions = Object.fromEntries(Object.entries(handlers).map(([operation, handler]) =>
  [operation, (ctx: Context) => writes.run({ user: ctx.user, operation }, () => handler(ctx))]))
export const reads = {
  async session(ctx: ReadContext) {
    input(ctx, [])
    return { answer: { user: ctx.user, capabilities: capabilities(ctx), connections: {
      employee: 'unconfigured', email: 'unconfigured', investigation: 'unconfigured',
    } } }
  },
  async queue(ctx: ReadContext) {
    const p = input(ctx, ['search', 'kind', 'state', 'assigned_to'])
    let tickets = await all(ctx, 'tickets.ticket', ticketFields)
    for (const [key, column] of [['kind', 'kind'], ['state', 'ticket_state'], ['assigned_to', 'assigned_to']])
      if (p[key]) tickets = tickets.filter(ticket => p[key] === 'open' && key === 'state' ? ticket.ticket_state !== 'Resolved' : ticket[column] === p[key])
    if (p.search) {
      const words = text(ctx, p.search, 'Search').toLowerCase().split(/\s+/)
      tickets = tickets.filter(ticket => words.every(word => `${ticket.row_id} ${ticket.title} ${ticket.public_update ?? ''}`.toLowerCase().includes(word)))
    }
    return { answer: { tickets, count: tickets.length, hasMore: false } }
  },
  async detail(ctx: ReadContext) {
    const p = input(ctx, ['row_id'])
    const id = text(ctx, p.row_id, 'Ticket')
    const ticket = await ctx.documents.get('tickets.ticket', id)
    const answer: Row = { ticket, events: await all(ctx, 'tickets.progress', progressFields, [['ticket', '=', id]]) }
    const support = capabilities(ctx).support
    if (ticket.owner === ctx.user || support) {
      const request = await ctx.documents.get('tickets.request', id)
      answer.details = { ...parse(request.details_json), original: request.original }
      if (support) {
        const events = await history(ctx, ticket)
        answer.privateEvents = events
        const state = workflow(request, events)
        if (state.verification) answer.verification = state.verification
        if (state.approval) answer.approval = state.approval
        answer.capabilities = { decide: ticket.kind === 'access' && state.verification?.active === true &&
          !restricted(ctx, parse(request.details_json)) && (routes(ctx)[String(state.verification?.region)]?.includes(ctx.user) ?? false) }
      }
    }
    return { answer }
  },
}
