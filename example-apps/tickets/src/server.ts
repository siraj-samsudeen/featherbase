import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { REPORT_FEEDBACK, reportFeedbackDetails } from './report-feedback'

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
  userName: string
  /** #918: the caller's own roles. */
  roles?: readonly string[]
  people: {
    names(ids: string[]): Promise<Record<string, string | null>>
    /** #1224: names of people who acted on Tickets' own rows, whatever the caller may read. */
    actorNames(ids: string[]): Promise<Record<string, string | null>>
    enabled(ids: string[]): Promise<string[]>
  }
  payload: unknown
  settings: Readonly<Record<string, string>>
  reject(message: string, fields?: Record<string, string>): never
  documents: {
    get(table: string, id: string): Promise<Row>
    list(table: string, args?: ListArgs): Promise<Row[]>
    /** #1196: matching rows, as the caller; null when they cannot be counted for them. */
    count(table: string, filters?: ListArgs['filters']): Promise<number | null>
    isReader(table: string, id: string): Promise<boolean>
  }
  /** #1230: instance Tables the manifest declares under baseTables.read, read as the app, only those columns. */
  baseTables?: { list(table: string, args: ListArgs & { fields: string[] }): Promise<Row[]>; available?(table: string): Promise<boolean> }
}
interface Context extends ReadContext {
  mail: {
    mayRead(person: string, table: string, rowId: string): Promise<boolean>
    toPerson(person: string, message: { subject: string; body: string; path?: string; ref_table?: string; reference_name?: string }): Promise<void>
  }
  documents: ReadContext['documents'] & {
    create(table: string, row: Row): Promise<Row>
    update(table: string, row: Row): Promise<Row>
    handOver(table: string, id: string, person: string): Promise<void>
    setReaders(table: string, id: string, people: string[]): Promise<void>
    delete(table: string, id: string, updatedAt: string): Promise<void>
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
  if ((table === 'event' || table === 'open_event' || table === 'progress') && !ctx.isNew) ctx.reject('History is append-only')
  // Each person writes only their own name, which the platform supplies.
  // #963, #1193: naming a raiser also records their name, for those who may not read Person.
  if (table === 'member' && ctx.row.row_id !== ctx.user && !((allowed?.operation === 'change_raiser' || allowed?.operation === 'create') && ctx.isNew))
    ctx.reject('A person may record only their own name')
  // The wording is corrected only through the edit action, which keeps the earlier wording in history.
  if ((table === 'request' || table === 'open_request') && ctx.old && ctx.row.original !== ctx.old.original && allowed?.operation !== 'edit')
    ctx.reject('The original request is changed only by editing the ticket')
  // #963: change_raiser checks its caller is a System Manager before it writes.
  if (ctx.old && ctx.row.owner !== ctx.old.owner && !(table === 'ticket' && allowed?.operation === 'change_raiser')) ctx.reject('The requester is immutable')
}
const kinds = ['generic', 'access', 'freshness', 'quality', 'report', 'source', 'schema', 'pipeline', 'backfill', REPORT_FEEDBACK]
// Keys a configured field may never take: they carry the request or its gates.
const protectedKeys = ['original', 'verification', 'approval', 'fulfillment', 'actor', 'by', 'at', 'owner', 'ticket_state', 'root_cause', 'title', 'kind', 'state', 'open']
const fieldTypes = ['text', 'long text', 'choice', 'date', 'person', 'link']
const lines = (value: unknown) => String(value ?? '').split('\n').map(line => line.trim()).filter(Boolean)
// Instance configuration is edited in the generic Admin UI, not through
// actions, so these validators check the configuration itself.
function validateType(ctx: Validation) {
  const key = String(ctx.row.type_key ?? '')
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) ctx.reject('A ticket type key is lower case letters, digits and underscores')
  if (ctx.old && ctx.old.type_key !== ctx.row.type_key) ctx.reject('A ticket type key never changes: its tickets carry it')
  if (kinds.includes(key)) ctx.reject('A configured type cannot replace a built-in type')
  const states = lines(ctx.row.states)
  if (!states.length || new Set(states).size !== states.length) ctx.reject('List each state once, one per line; the first is where a ticket starts')
  if (lines(ctx.row.done_states).some(state => !states.includes(state))) ctx.reject('Every done state must be one of the states')
  if (ctx.row.reopen_state && !states.includes(String(ctx.row.reopen_state))) ctx.reject('The reopen state must be one of the states')
  if (ctx.row.routing) {
    const routing = parse(ctx.row.routing)
    if (['field', 'table', 'match', 'person'].some(k => typeof routing[k] !== 'string' || !routing[k])) ctx.reject('Routing names field, table, match and person (and optionally primary)')
  }
  if (!['', 'everyone', 'private'].includes(String(ctx.row.details_visible_to ?? ''))) ctx.reject('Details are visible to everyone or private')
  validateTransitions(ctx, states)
}
// #918: a type's transitions, in the platform Workflow's shape plus `fields`.
const transitionKeys = ['state', 'action', 'next_state', 'allowed', 'fields']
function validateTransitions(ctx: Validation, states: string[]) {
  if (!String(ctx.row.transitions ?? '').trim()) return
  let list: unknown
  try { list = JSON.parse(String(ctx.row.transitions)) } catch { list = null }
  if (!Array.isArray(list)) return ctx.reject('Transitions are a JSON list of {state, action, next_state, allowed, fields}')
  const seen = new Map<string, Transition>()
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) ctx.reject('Each transition is an object')
    const t = item as Row
    if ('condition' in t) ctx.reject('A transition condition is not supported in Tickets yet')
    const extra = Object.keys(t).find(key => !transitionKeys.includes(key))
    if (extra) ctx.reject(`A transition has no "${extra}"; use ${transitionKeys.join(', ')}`)
    for (const key of ['state', 'next_state'] as const)
      if (typeof t[key] !== 'string' || !states.includes(t[key] as string)) ctx.reject(`Transition ${key} "${String(t[key] ?? '')}" is not one of the states`)
    if (typeof t.action !== 'string' || !t.action.trim() || t.action.length > 60) ctx.reject('Each transition names its action (up to 60 characters)')
    if (typeof t.allowed !== 'string' || !t.allowed.trim()) ctx.reject('Each transition says who is allowed: assignee, requester, any, or a role')
    if (t.fields !== undefined && !(Array.isArray(t.fields) && t.fields.every(f => typeof f === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(f))))
      ctx.reject('Transition fields are a list of the type\'s field keys')
    const transition = toTransition(t)
    const key = `${transition.state}\u0000${transition.action}`
    const same = seen.get(key)
    if (same && same.allowed === transition.allowed) ctx.reject(`${transition.action} from ${transition.state} is listed twice for ${transition.allowed}`)
    if (same && (same.next_state !== transition.next_state || same.fields.join() !== transition.fields.join()))
      ctx.reject(`Every ${transition.action} from ${transition.state} must have the same next state and fields`)
    seen.set(key, transition)
  }
}
interface Transition { state: string; action: string; next_state: string; allowed: string; fields: string[] }
function toTransition(t: Row): Transition {
  return { state: String(t.state), action: String(t.action).trim(), next_state: String(t.next_state), allowed: String(t.allowed).trim(),
    fields: Array.isArray(t.fields) ? t.fields.map(String) : [] }
}
function transitionsOf(value: unknown): Transition[] {
  try {
    const list = JSON.parse(String(value ?? '').trim() || '[]')
    return Array.isArray(list) ? list.filter(t => t && typeof t === 'object').map(toTransition) : []
  } catch { return [] }
}
function validateField(ctx: Validation) {
  const name = String(ctx.row.field_name ?? '')
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(name) || protectedKeys.includes(name)) ctx.reject('A field key is lower case letters, digits and underscores, and not a protected key')
  if (!fieldTypes.includes(String(ctx.row.field_type))) ctx.reject(`A field type is one of: ${fieldTypes.join(', ')}`)
  if (ctx.row.field_type === 'choice' && !lines(ctx.row.choices).length) ctx.reject('A choice field lists its choices, one per line')
  if (ctx.row.field_type === 'link' && !String(ctx.row.link_table ?? '').trim()) ctx.reject('A link field names the Table it links to')
}
export const validators = {
  ...Object.fromEntries(['ticket', 'request', 'event', 'progress', 'member', 'open_request', 'open_event', 'data_quality_rule'].map(table =>
    [`tickets.${table}`, (ctx: Validation) => validate(table, ctx)])),
  'tickets.ticket_type': validateType,
  'tickets.type_field': validateField,
}
export const destructiveGuards = {
  ...Object.fromEntries(['ticket', 'request', 'event', 'progress', 'member', 'open_request', 'open_event'].map(table =>
    [`tickets.${table}`, (ctx: Validation) => ctx.reject('Tickets references and history cannot be renamed or deleted')])),
  // A field can be removed; a type is switched off, so its tickets keep their meaning.
  'tickets.ticket_type': (ctx: Validation) => ctx.reject('Switch a ticket type off (enabled) instead of renaming or deleting it'),
  // #1196: a rule leaves its ticket only through remove_rule, which records why.
  'tickets.data_quality_rule': (ctx: Validation) => {
    const allowed = writes.getStore()
    if (allowed?.operation !== 'remove_rule' || allowed.user !== ctx.user) ctx.reject('Remove a rule from its ticket, with a reason')
  },
}
const ticketFields = ['row_id', 'title', 'kind', 'ticket_state', 'assigned_to', 'public_update', 'updated_at', 'owner', 'parent_ticket']
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
function capabilitiesOf(ctx: ReadContext, person: string) {
  const verify = members(configured(ctx, 'verification_admins')).includes(person)
  const fulfill = members(configured(ctx, 'fulfillment_admins')).includes(person)
  return {
    support: verify || fulfill || members(configured(ctx, 'support_users')).includes(person) || Object.values(routes(ctx)).some(ids => ids.includes(person)),
    verify, fulfill,
  }
}
const capabilities = (ctx: ReadContext) => capabilitiesOf(ctx, ctx.user)
/** The people configured for Tickets: who may be assigned, and own a rule.
 *  #964: `assignees` lists people who may be assigned without support rights. */
function staffOf(ctx: ReadContext) {
  return new Set([...['support_users', 'verification_admins', 'fulfillment_admins', 'assignees'].flatMap(key => members(configured(ctx, key))),
    ...Object.values(routes(ctx)).flat()])
}
async function all(ctx: ReadContext, table: string, fields: string[], filters: ListArgs['filters'] = []) {
  const rows: Row[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await ctx.documents.list(table, { fields, filters, order_by: 'row_id asc', limit_start: offset, limit_page_length: 500 })
    rows.push(...page)
    if (page.length < 500) return rows
  }
}
interface TypeField { name: string; label: string; type: string; choices: string[]; required: boolean; link_table?: string; link_label?: string }
interface TicketType { key: string; label: string; states: string[]; done: string[]; reopen: string; routing: Row | null; fields: TypeField[]; transitions: Transition[]; visibility: 'everyone' | 'private'; enabled: boolean }
// Fields a transition asks for are recorded by that action, never on intake.
const actionFieldNames = (type: TicketType) => new Set(type.transitions.flatMap(t => t.fields))
const intakeFields = (type: TicketType) => { const asked = actionFieldNames(type); return type.fields.filter(f => !asked.has(f.name)) }
async function configuredTypes(ctx: ReadContext): Promise<Map<string, TicketType>> {
  const rows = await all(ctx, 'tickets.ticket_type', ['row_id', 'type_key', 'label', 'enabled', 'states', 'done_states', 'reopen_state', 'routing', 'transitions', 'details_visible_to'])
  const fieldRows = await all(ctx, 'tickets.type_field', ['row_id', 'ticket_type', 'field_name', 'label', 'field_type', 'choices', 'link_table', 'link_label', 'required', 'field_order'])
  const types = new Map<string, TicketType>()
  for (const row of rows) {
    // A switched-off type is not offered for new tickets, but its existing
    // tickets keep its states, actions and privacy.
    const states = lines(row.states)
    types.set(String(row.type_key), { key: String(row.type_key), label: String(row.label), states, done: lines(row.done_states),
      reopen: String(row.reopen_state || states[0]), routing: row.routing ? parse(row.routing) : null, transitions: transitionsOf(row.transitions),
      // Siraj, 04-Nov-2026: privacy is a choice per type, and open is the default.
      visibility: row.details_visible_to === 'private' ? 'private' : 'everyone', enabled: !!row.enabled,
      fields: fieldRows.filter(f => f.ticket_type === row.row_id).sort((a, b) => Number(a.field_order ?? 0) - Number(b.field_order ?? 0)).map(f => ({
        name: String(f.field_name), label: String(f.label), type: String(f.field_type), choices: lines(f.choices), required: !!f.required,
        ...(f.link_table ? { link_table: String(f.link_table), link_label: String(f.link_label || 'row_id') } : {}),
      })) })
  }
  return types
}
// A linked instance Table is read only when an administrator listed it, and
// as the caller: what the caller may not read reads as nothing.
function linked(ctx: ReadContext, table: string | undefined) {
  return !!table && members(configured(ctx, 'linked_tables')).includes(table)
}
async function linkRows(ctx: ReadContext, field: TypeField, filters: ListArgs['filters'] = []) {
  if (!linked(ctx, field.link_table)) return []
  return ctx.documents.list(field.link_table!, { fields: ['row_id', field.link_label!], filters, limit_page_length: 500 })
}
function isDone(ticket: Row, types: Map<string, TicketType>) {
  const type = types.get(String(ticket.kind))
  return type ? type.done.includes(String(ticket.ticket_state)) : ticket.ticket_state === 'Resolved'
}
/** A kind a ticket may be given now: a built-in or an enabled configured type
 *  (`current` is the ticket's own kind, which it may keep while switched off). */
function kind(ctx: ReadContext, value: unknown, types: Map<string, TicketType>, current?: unknown) {
  if (typeof value !== 'string' || !(kinds.includes(value) || (types.has(value) && (types.get(value)!.enabled || value === current))))
    ctx.reject('Choose a valid ticket kind')
  return value
}
// A configured type's values are checked against its current fields.
async function typedDetails(ctx: ReadContext, type: TicketType, values: Row, asked = intakeFields(type), allRequired = false): Promise<Row> {
  const known = new Map(type.fields.map(field => [field.name, field]))
  const unknown = Object.keys(values).find(key => !known.has(key))
  if (unknown) ctx.reject(`${type.label} has no field ${unknown}`)
  const notAsked = Object.keys(values).find(key => !asked.some(field => field.name === key))
  if (notAsked) ctx.reject(`${known.get(notAsked)!.label} is recorded by an action, not here`)
  // A person field takes any Person the caller may see (the Person permission applies).
  const personIds = asked.filter(f => f.type === 'person').map(f => values[f.name]).filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim())
  const visible = personIds.length ? await ctx.people.names(personIds) : {}
  const out: Row = {}
  for (const field of asked) {
    const raw = values[field.name]
    const value = typeof raw === 'string' ? raw.trim() : raw
    if (value === undefined || value === null || value === '') {
      if (field.required || allRequired) ctx.reject(`${field.label} is required`)
      continue
    }
    if (typeof value !== 'string') return ctx.reject(`${field.label} must be text`)
    if (field.type === 'choice' && !field.choices.includes(value)) ctx.reject(`${field.label} must be one of: ${field.choices.join(', ')}`)
    if (field.type === 'date' && !(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)))) ctx.reject(`${field.label} must be a date (YYYY-MM-DD)`)
    if (field.type === 'person' && !visible[value]) ctx.reject(`${field.label} must be a person you can see`)
    if (field.type === 'link' && !(await linkRows(ctx, field, [['row_id', '=', value]])).length) ctx.reject(`${field.label} must be one of its listed rows`)
    out[field.name] = value
  }
  return out
}
// The primary owner of the linked value, read as the requester; none → unassigned.
async function routed(ctx: ReadContext, type: TicketType, values: Row): Promise<string | null> {
  const routing = type.routing
  if (!routing || values[String(routing.field)] === undefined || !linked(ctx, String(routing.table))) return null
  const filters: [string, string, unknown][] = [[String(routing.match), '=', values[String(routing.field)]]]
  if (routing.primary) filters.push([String(routing.primary), '=', 1])
  const [owner] = await ctx.documents.list(String(routing.table), { fields: [String(routing.person)], filters, limit_page_length: 1 })
  return owner && typeof owner[String(routing.person)] === 'string' ? String(owner[String(routing.person)]) : null
}
function details(ctx: ReadContext, value: unknown): Row {
  const row = object(ctx, value)
  const forbidden = ['original', 'verification', 'approval', 'fulfillment', 'actor', 'by', 'at', 'owner', 'ticket_state', 'root_cause']
  if (Object.keys(row).some(key => forbidden.includes(key))) ctx.reject('Protected request field')
  return row
}
// Where a ticket's request and history live. A ticket of a type whose details
// are visible to everyone keeps them in Tables everyone may read; every other
// ticket (built-in types, private types) keeps them private to the requester
// and support. Decided when the ticket is created.
interface Place { request: string; event: string; open: boolean }
const PRIVATE: Place = { request: 'tickets.request', event: 'tickets.event', open: false }
const OPEN: Place = { request: 'tickets.open_request', event: 'tickets.open_event', open: true }
async function place(ctx: ReadContext, ticketId: unknown): Promise<Place> {
  const [row] = await ctx.documents.list(OPEN.request, { fields: ['row_id'], filters: [['row_id', '=', String(ticketId)]], limit_page_length: 1 })
  return row ? OPEN : PRIVATE
}
/** The earlier wordings of a request, oldest first. */
function history_of(request: Row): Row[] {
  try { const list = JSON.parse(String(request.original_history ?? '[]')); return Array.isArray(list) ? list : [] } catch { return [] }
}
// #925: a private ticket's assignee and the person it is raised for read its
// request as the raiser does, and stop when they are no longer named.
async function keepReaders(ctx: Context, ticket: Row, structured: Row, type: TicketType | undefined) {
  const raisedFor = type?.fields.some(f => f.name === 'raised_for' && f.type === 'person') ? structured.raised_for : undefined
  const people = [ticket.assigned_to, raisedFor].filter((p): p is string => typeof p === 'string' && !!p && p !== ticket.owner)
  await ctx.documents.setReaders(PRIVATE.request, String(ticket.row_id), people)
}
async function current(ctx: Context, p: Row, supportOnly = true) {
  const ticket = await ctx.documents.get('tickets.ticket', text(ctx, p.row_id, 'Ticket'))
  if (String(ticket.updated_at) !== text(ctx, p.updated_at, 'Revision')) ctx.reject('This ticket changed; reload before trying again')
  const support = capabilities(ctx).support
  if (supportOnly ? !support : !support && ticket.owner !== ctx.user) ctx.reject('Not authorized to change this request')
  // Do not try a denied private read and catch it: host context failures are sticky.
  const where = await place(ctx, ticket.row_id)
  const request = await ctx.documents.get(where.request, String(ticket.row_id))
  return { ticket, request, structured: parse(request.details_json), support, where }
}
async function event(ctx: Context, ticket: Row, operation: string, data: Row) {
  return ctx.documents.create((await place(ctx, ticket.row_id)).event, { ticket: ticket.row_id, operation,
    text: JSON.stringify(data), by: ctx.user, at: new Date().toISOString() })
}
/** #1463: a link to where a ticket's work is done, on the same site: a label and a relative /… path. */
function openLink(ctx: ReadContext, value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) ctx.reject('An open link has a label and href only')
  const link = value as Row
  if (Object.keys(link).some(key => key !== 'label' && key !== 'href')) ctx.reject('An open link has a label and href only')
  const label = text(ctx, link.label, 'An open link\'s label')
  if (label.length > 60) ctx.reject('An open link\'s label is up to 60 characters')
  // A path on this site only: never a scheme, another host (//host) or a backslash a browser reads as one.
  if (typeof link.href !== 'string' || !/^\/(?![\/\\])[^\s\\]*$/.test(link.href) || link.href.length > 500)
    ctx.reject('An open link\'s href must be a relative path on this site, starting with /')
  return { label, href: link.href }
}
/** Takes `open` out of details a caller gave, so the type checks the rest; undefined when not given, null to remove it. */
function takeLink(ctx: ReadContext, value: unknown): { rest: unknown; link: Row | null | undefined } {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value) || !('open' in value)) return { rest: value, link: undefined }
  const { open, ...rest } = value as Row
  return { rest, link: open === null ? null : openLink(ctx, open) }
}
const withLink = (details: Row, link: Row | null | undefined) => {
  const { open: _, ...rest } = details
  return link ? { ...rest, open: link } : rest
}
/** #1397: the parent a ticket may sit under, one level deep; `self` is the ticket being re-parented. */
async function parentFor(ctx: Context, value: unknown, self?: Row): Promise<string> {
  const id = text(ctx, value, 'Parent ticket')
  if (self && id === self.row_id) ctx.reject('A ticket cannot be its own parent')
  const [parent] = await ctx.documents.list('tickets.ticket', { fields: ['row_id', 'parent_ticket'], filters: [['row_id', '=', id]], limit_page_length: 1 })
  if (!parent) ctx.reject(`No ticket ${id}`)
  if (parent.parent_ticket) ctx.reject(`${id} is a sub-ticket, and a sub-ticket cannot have sub-tickets`)
  if (self && (await ctx.documents.list('tickets.ticket', { fields: ['row_id'], filters: [['parent_ticket', '=', String(self.row_id)]], limit_page_length: 1 })).length)
    ctx.reject(`${String(self.row_id)} has sub-tickets, so it cannot be one`)
  return id
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
// #1256: what a viewer is shown, as Person holds it now: anyone who acted on
// Tickets' rows (whatever the viewer may read), then anyone the viewer may read
// or the settings name. An id neither names is absent.
async function liveNames(ctx: ReadContext, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const add = (named: Record<string, string | null>) => { for (const [id, name] of Object.entries(named)) if (name) out[id] = name }
  for (let i = 0; i < ids.length; i += 500) add(await ctx.people.actorNames(ids.slice(i, i + 500)))
  const rest = ids.filter(id => !out[id] && /^(psn|sa|svc)_/.test(id))
  for (let i = 0; i < rest.length; i += 500) add(await ctx.people.names(rest.slice(i, i + 500)))
  return out
}
// The caller's own stored name copy, as they appear now. Only their own: names
// are read live (above), so a copy is shown only where Person can't be read,
// and a copy of someone who never acts again keeps their last name (#1256).
async function remember(ctx: Context) {
  const [row] = await ctx.documents.list('tickets.member', { fields: ['row_id', 'full_name', 'updated_at'], filters: [['row_id', '=', ctx.user]], limit_page_length: 1 })
  if (!row) await ctx.documents.create('tickets.member', { row_id: ctx.user, full_name: ctx.userName })
  else if (row.full_name !== ctx.userName) await ctx.documents.update('tickets.member', { row_id: ctx.user, updated_at: row.updated_at, full_name: ctx.userName })
}
// #963, #1193: a raiser named by a System Manager. Only that check reaches here; the
// raiser must be an enabled person, and their name is kept for those who may not read Person.
async function namedRaiser(ctx: Context, raiser: string) {
  if (!(await ctx.people.enabled([raiser])).includes(raiser)) ctx.reject('The raiser must be an enabled person')
  const [known] = await ctx.documents.list('tickets.member', { fields: ['row_id'], filters: [['row_id', '=', raiser]], limit_page_length: 1 })
  const name = (await ctx.people.names([raiser]))[raiser]
  if (!known && name) await ctx.documents.create('tickets.member', { row_id: raiser, full_name: name })
}
const isSystemManager = (ctx: ReadContext) => (ctx.roles ?? []).includes('System Manager')
function idsIn(value: unknown, out: Set<string>) {
  if (typeof value === 'string') out.add(value)
  else if (Array.isArray(value)) for (const item of value) idsIn(item, out)
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value))
    if (['owner', 'by', 'assigned_to', 'replaced_by', 'old_raiser', 'new_raiser', 'raiser'].includes(key)) idsIn(item, out)
    else if (key === 'text' && typeof item === 'string') idsIn(parse(item), out)
    else if (item && typeof item === 'object') idsIn(item, out)
}
async function names(ctx: ReadContext, ...values: unknown[]): Promise<Record<string, string>> {
  const ids = new Set<string>()
  for (const value of values) idsIn(value, ids)
  if (!ids.size) return {}
  // #1256: Person first, live; the stored copy only for whoever it can't name
  // (a "raised for" person who never acted, seen by someone who can't read Person).
  const known = await liveNames(ctx, [...ids])
  const rest = [...ids].filter(id => !known[id])
  if (rest.length) for (const row of await all(ctx, 'tickets.member', ['row_id', 'full_name'], [['row_id', 'in', rest]]))
    known[String(row.row_id)] = String(row.full_name)
  return known
}
async function history(ctx: ReadContext, ticket: Row) {
  return all(ctx, (await place(ctx, ticket.row_id)).event, eventFields, [['ticket', '=', ticket.row_id]])
}
// #918: who a transition lets act. `any` is anyone involved in the ticket:
// its raiser, its assignee or support; never a colleague who sees the summary.
function mayTake(ctx: ReadContext, ticket: Row, t: Transition, support: boolean) {
  if (t.allowed === 'assignee') return !!ticket.assigned_to && ticket.assigned_to === ctx.user
  if (t.allowed === 'requester') return ticket.owner === ctx.user
  if (t.allowed === 'any') return ticket.owner === ctx.user || ticket.assigned_to === ctx.user || support
  return (ctx.roles ?? []).includes(t.allowed)
}
function available(ctx: ReadContext, ticket: Row, type: TicketType | undefined, support: boolean) {
  const actions = new Map<string, Transition>()
  for (const t of type?.transitions ?? [])
    if (t.state === ticket.ticket_state && !actions.has(t.action) && mayTake(ctx, ticket, t, support)) actions.set(t.action, t)
  return [...actions.values()]
}
// #1001: tells a newly assigned person, once this save commits. The description
// goes in only when the ticket screen would show it to them.
async function tellAssignee(ctx: Context, ticket: Row, assignee: string, description: unknown, where: Place) {
  const id = String(ticket.row_id)
  // #925: a private ticket's new assignee now reads its request too.
  const visible = await ctx.mail.mayRead(assignee, where.request, id)
  await ctx.mail.toPerson(assignee, {
    subject: `Ticket assigned to you: ${String(ticket.title)}`,
    body: `${ctx.userName} assigned this ticket to you.\n\nTicket: ${String(ticket.title)}\n\n${visible ? `Description:\n${String(description)}` : 'Its description is private, so it is left out of this email.'}`,
    path: `?ticket=${encodeURIComponent(id)}`, ref_table: 'tickets.ticket', reference_name: id,
  })
}
// ---- #1196: data quality rules: a gap that one filter describes, counted live ----
type Filter = [string, string, unknown]
const SEVERITIES = ['High', 'Medium', 'Low']
const MAX_RULES = 25
const RULE_OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'like', 'not like', 'in', 'not in', 'is blank', 'is not blank']
const RULE_TABLE = 'tickets.data_quality_rule'
const ruleFields = ['row_id', 'ticket', 'title', 'checked_table', 'filters', 'severity', 'owner', 'how_to_fix', 'rows_when_raised']
function ruleTable(ctx: ReadContext, value: unknown) {
  const table = text(ctx, value, 'Table')
  if (!linked(ctx, table)) ctx.reject(`${table} is not one of Tickets' linked Tables; an administrator lists it in linked_tables`)
  return table
}
function ruleFilters(ctx: ReadContext, value: unknown): Filter[] {
  if (!Array.isArray(value) || !value.length || value.length > 10) ctx.reject('A rule has 1 to 10 conditions, each [column, operator, value]')
  return (value as unknown[]).map(item => {
    if (!Array.isArray(item) || item.length !== 3 || typeof item[0] !== 'string' || !item[0]) return ctx.reject('Each condition is [column, operator, value]')
    if (!RULE_OPERATORS.includes(String(item[1]))) ctx.reject(`A condition's operator is one of: ${RULE_OPERATORS.join(', ')}`)
    return [item[0], String(item[1]), String(item[1]).includes('blank') ? null : item[2]] as Filter
  })
}
const OPERATOR_WORDS: Record<string, string> = { '=': 'is', '!=': 'is not', 'like': 'is like', 'not like': 'is not like', 'in': 'is one of', 'not in': 'is none of' }
/** A rule's conditions as a person reads them in its history: role is "Buyer" and person is blank. */
const conditionsText = (filters: Filter[]) => filters.map(([column, op, value]) =>
  `${column} ${OPERATOR_WORDS[op] ?? op}${op.includes('blank') ? '' : ` "${Array.isArray(value) ? value.join(', ') : String(value)}"`}`).join(' and ')
// Only add_rule writes a rule (every other write is refused), always as checked JSON.
const storedFilters = (value: unknown) => JSON.parse(String(value)) as Filter[]
// #1230: the instance's Data Quality Row Table names the rows a ticket covers. Tickets reads it as a
// declared base Table (featherbase.json baseTables.read), only once an administrator lists it in
// linked_tables, and only after the caller has read the ticket itself: no row of a ticket they can't see.
const COVERED_TABLE = 'Data Quality Row'
const COVERED_FIELDS = ['ticket', 'affected_table', 'affected_row', 'fixed_on', 'note']
const COVERED_SETUP = `An administrator lists ${COVERED_TABLE} in Tickets' linked_tables to show the rows a ticket covers here.`
const day = (value: unknown) => typeof value === 'string' && value ? value.slice(0, 10) : null
/** Every row a read returns, page by page: the platform caps a page at 500. */
async function pages(read: (args: ListArgs) => Promise<Row[]>) {
  const rows: Row[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await read({ order_by: 'row_id asc', limit_start: offset, limit_page_length: 500 })
    rows.push(...page)
    if (page.length < 500) return rows
  }
}
/** The ids of the matching rows the caller may read themself; none for a linked Table that is gone or
 *  unreadable. count first: it answers null for those rather than failing the page. */
async function readableIds(ctx: ReadContext, table: string, filters: ListArgs['filters']) {
  if (!await ctx.documents.count(table, filters)) return new Set<string>()
  return new Set((await pages(args => ctx.documents.list(table, { ...args, fields: ['row_id'], filters }))).map(row => String(row.row_id)))
}
/** The rows a ticket covers, open first, then fixed; each linked only when the caller may read that row.
 *  null while Data Quality Row is not a linked Table; undefined when the ticket covers none. */
async function coveredRows(ctx: ReadContext, ticketId: string) {
  // Unlinked, deleted or reshaped since: leave the list out rather than fail the page (Codex adversarial, round 1).
  if (!ctx.baseTables?.available || !linked(ctx, COVERED_TABLE) || !await ctx.baseTables.available(COVERED_TABLE)) return null
  const base = ctx.baseTables
  const found = await pages(args => base.list(COVERED_TABLE, { ...args, fields: ['row_id', ...COVERED_FIELDS], filters: [['ticket', '=', ticketId]] }))
  if (!found.length) return undefined
  // A row links only where the caller may open it: a linked Table they read, and a row that is there.
  // count first: it reads a Table that was removed, or can't be read, as nothing rather than failing the page.
  const readable = new Map<string, Set<string>>()
  for (const table of [...new Set(found.map(row => String(row.affected_table)))].filter(table => linked(ctx, table))) {
    const keys = [...new Set(found.filter(row => row.affected_table === table).map(row => String(row.affected_row)))]
    readable.set(table, await readableIds(ctx, table, [['row_id', 'in', keys]]))
  }
  // Each Data Quality Row's own record (where it is marked fixed), for a caller who may open it.
  const own = await readableIds(ctx, COVERED_TABLE, [['ticket', '=', ticketId]])
  const rows = found.map(row => ({ table: String(row.affected_table), row: String(row.affected_row),
    note: typeof row.note === 'string' && row.note.trim() ? row.note : null, fixed_on: day(row.fixed_on),
    link: readable.get(String(row.affected_table))?.has(String(row.affected_row)) ?? false,
    record: own.has(String(row.row_id)) ? String(row.row_id) : null }))
    .sort((a, b) => Number(!!a.fixed_on) - Number(!!b.fixed_on) || a.table.localeCompare(b.table) || a.row.localeCompare(b.row))
  return { rows, total: rows.length, fixed: rows.filter(row => row.fixed_on).length }
}
/** Its raiser, its assignee or Tickets support: those a ticket's "any" action lets act. */
function involved(ctx: ReadContext, ticket: Row) {
  return ticket.owner === ctx.user || (!!ticket.assigned_to && ticket.assigned_to === ctx.user) || capabilities(ctx).support
}
async function revised(ctx: Context, p: Row) {
  const ticket = await ctx.documents.get('tickets.ticket', text(ctx, p.row_id, 'Ticket'))
  if (String(ticket.updated_at) !== text(ctx, p.updated_at, 'Revision')) ctx.reject('This ticket changed; reload before trying again')
  return ticket
}
// Open rules first (uncounted ones after counted), then High → Low, then by title.
const ruleOrder = (rule: Row) => rule.rows_left === 0 ? 2 : rule.rows_left === null ? 1 : 0
/** A ticket's rules, each counted now as the reader; uncountable reads as null. */
async function rulesOf(ctx: ReadContext, ticketId: string) {
  const rules: Row[] = []
  for (const row of await all(ctx, RULE_TABLE, ruleFields, [['ticket', '=', ticketId]])) {
    const filters = storedFilters(row.filters)
    const table = String(row.checked_table)
    // The count when raised is part of the ticket's record; only the live count follows
    // the Table's read permission (decided 11-Nov-2026, #1196).
    rules.push({ row_id: row.row_id, title: row.title, table, filters, severity: row.severity, owner: row.owner ?? null, how_to_fix: row.how_to_fix ?? null,
      rows_when_raised: Number(row.rows_when_raised), rows_left: linked(ctx, table) ? await ctx.documents.count(table, filters) : null })
  }
  return rules.sort((a, b) => ruleOrder(a) - ruleOrder(b) || SEVERITIES.indexOf(String(a.severity)) - SEVERITIES.indexOf(String(b.severity))
    || String(a.title).localeCompare(String(b.title)))
}
const handlers: Record<string, (ctx: Context) => Promise<unknown> | unknown> = {
  async create(ctx) {
    const p = input(ctx, ['title', 'original', 'kind', 'details', 'raiser', 'parent_ticket'])
    // #1193: a System Manager (an agent's service account, say) raises it for someone else.
    const raiser = p.raiser === undefined ? ctx.user : text(ctx, p.raiser, 'Raiser')
    const onBehalf = raiser !== ctx.user
    if (onBehalf && !isSystemManager(ctx)) ctx.reject('Only a System Manager may raise a ticket for someone else')
    if (onBehalf) await namedRaiser(ctx, raiser)
    const title = text(ctx, p.title, 'Public summary')
    const original = text(ctx, p.original, 'Original request')
    const types = await configuredTypes(ctx)
    const category = kind(ctx, p.kind ?? 'generic', types)
    const type = types.get(category)
    // #1463: an open link is checked on its own; the type checks the rest.
    const given = takeLink(ctx, p.details)
    const structured = withLink(type ? await typedDetails(ctx, type, object(ctx, given.rest ?? {}))
      : category === REPORT_FEEDBACK ? reportFeedbackDetails(given.rest, ctx.reject) : details(ctx, given.rest ?? {}), given.link)
    const assignee = type ? await routed(ctx, type, structured) : null
    const parent = p.parent_ticket === undefined || p.parent_ticket === null ? null : await parentFor(ctx, p.parent_ticket)
    const ticket = await ctx.documents.create('tickets.ticket', { title, owner: raiser, kind: category, ...(parent ? { parent_ticket: parent } : {}),
      ticket_state: type ? type.states[0] : category === 'access' ? 'Needs verification' : 'New', ...(assignee ? { assigned_to: assignee } : {}) })
    // Access gates' keys belong to private requests only.
    await ctx.documents.create(type?.visibility === 'everyone' ? OPEN.request : PRIVATE.request, { row_id: ticket.row_id, original, details_json: JSON.stringify(structured),
      ...(type?.visibility === 'everyone' ? {} : { verification_key: randomUUID(), approval_key: randomUUID() }) })
    // A private request is reached through an own-rows grant, so it is the raiser's row.
    if (onBehalf && type?.visibility !== 'everyone') await ctx.documents.handOver(PRIVATE.request, String(ticket.row_id), raiser)
    if (onBehalf) await event(ctx, ticket, 'raise_on_behalf', { raiser })
    if (type?.visibility !== 'everyone') await keepReaders(ctx, ticket, structured, type)
    return { ticket }
  },
  async edit(ctx) {
    // A copy: the payload is frozen, and the open link is taken out of its details below.
    const p = { ...input(ctx, ['row_id', 'updated_at', 'title', 'kind', 'details', 'assigned_to', 'public_update', 'state', 'original', 'parent_ticket']) }
    const { ticket, request, structured: stored, support, where } = await current(ctx, p, false)
    // #1463: the open link is set or kept apart from the type's own details, which never know it.
    const { open: kept, ...structured } = stored
    const given = takeLink(ctx, p.details)
    const linkChanged = given.link !== undefined
    if (linkChanged) p.details = Object.keys(given.rest as Row).length ? given.rest : undefined
    const link = linkChanged ? given.link : (kept as Row | undefined)
    if (!support && ['kind', 'assigned_to', 'public_update', 'state', 'parent_ticket'].some(key => p[key] !== undefined)) ctx.reject('Only support may triage, file under a parent or publish progress')
    const types = await configuredTypes(ctx)
    const category = p.kind === undefined ? String(ticket.kind) : kind(ctx, p.kind, types, ticket.kind)
    const type = types.get(category)
    // A ticket whose type has actions moves only through them, and keeps that
    // type: reclassifying it would let a state change skip them.
    const currentType = types.get(String(ticket.kind))
    if (currentType?.transitions.length && category !== ticket.kind) ctx.reject(`${currentType.label} keeps its type; it moves only through its actions`)
    if (p.state !== undefined && (type?.transitions.length || currentType?.transitions.length)) ctx.reject(`${(currentType ?? type)!.label} moves only through its actions`)
    // Details stay where they were raised: never moved between open and private.
    if (category !== ticket.kind && (type?.visibility === 'everyone') !== where.open)
      ctx.reject(where.open ? 'This ticket\'s details are visible to everyone; choose a type whose details are too' : 'This ticket\'s details are private; choose a type whose details are private too')
    const merged = p.details === undefined ? structured : { ...structured, ...object(ctx, p.details) }
    // An action's recorded values are kept as they are; only that action writes them.
    const recorded = type ? Object.fromEntries(Object.entries(merged).filter(([key]) => actionFieldNames(type).has(key))) : {}
    if (type && p.details !== undefined) {
      const changed = Object.keys(object(ctx, p.details)).find(key => actionFieldNames(type).has(key) && p.details && (p.details as Row)[key] !== structured[key])
      if (changed) ctx.reject(`${type.fields.find(f => f.name === changed)!.label} is recorded by an action, not here`)
    }
    const intake = type ? Object.fromEntries(Object.entries(merged).filter(([key]) => !actionFieldNames(type).has(key))) : merged
    const checked = type ? (p.details === undefined && category === ticket.kind ? structured : { ...await typedDetails(ctx, type, intake), ...recorded })
      // #1240: feedback on a report keeps its checked shape whoever edits it, and whatever it was before.
      : category === REPORT_FEEDBACK ? (p.details === undefined && category === ticket.kind ? structured : reportFeedbackDetails(merged, ctx.reject))
      : p.details === undefined ? structured : { ...structured, ...details(ctx, p.details) }
    const next = withLink(checked, link)
    // Only a configured type moves between states directly, and only among its own.
    if (p.state !== undefined && (!type || !type.states.includes(String(p.state)))) ctx.reject('Choose one of this type\'s states')
    // Never turn an access decision into an ordinary-resolution bypass.
    if (ticket.kind === 'access' && category !== 'access') ctx.reject('An access request must keep its access gates')
    const recipientChanged = next.email !== structured.email
    const scopeChanged = ['scope', 'resource', 'region'].some(key => next[key] !== structured[key]) || category !== ticket.kind
    // The requester or support may correct the wording; the earlier wording is kept.
    const original = p.original === undefined ? undefined : text(ctx, p.original, 'Original request')
    const reworded = original !== undefined && original !== request.original
    const wording = reworded ? { original, original_history: JSON.stringify([...history_of(request), { text: request.original, replaced_by: ctx.user, replaced_at: new Date().toISOString() }]) } : {}
    if (reworded && where.open) {
      // A ticket opened from private keeps its private copy in step too.
      const [kept] = await ctx.documents.list(PRIVATE.request, { fields: ['row_id', 'updated_at', 'original', 'original_history'], filters: [['row_id', '=', String(ticket.row_id)]], limit_page_length: 1 })
      if (kept) await ctx.documents.update(PRIVATE.request, { row_id: kept.row_id, updated_at: kept.updated_at, original,
        original_history: JSON.stringify([...history_of(kept), { text: kept.original, replaced_by: ctx.user, replaced_at: new Date().toISOString() }]) })
    }
    if (p.details !== undefined || linkChanged || category !== ticket.kind || reworded) await ctx.documents.update(where.request, {
      row_id: request.row_id, updated_at: request.updated_at, details_json: JSON.stringify(next), ...wording,
      ...(where.open ? {} : {
        verification_key: recipientChanged ? randomUUID() : request.verification_key,
        approval_key: recipientChanged || scopeChanged ? randomUUID() : request.approval_key,
      }),
    })
    // Every edit is attributed history, including the requester's own scope or recipient change.
    await event(ctx, ticket, 'edit', { before: stored, details: next, kind: category,
      ...(reworded ? { original_before: request.original, original } : {}),
      ...(p.assigned_to !== undefined ? { assigned_to: p.assigned_to } : {}), ...(p.state !== undefined ? { state: p.state } : {}),
      ...(p.parent_ticket !== undefined ? { parent_ticket: p.parent_ticket } : {}) })
    const values: Row = { kind: category }
    if (p.parent_ticket !== undefined) values.parent_ticket = p.parent_ticket === null || p.parent_ticket === '' ? null : await parentFor(ctx, p.parent_ticket, ticket)
    if (p.title !== undefined) values.title = text(ctx, p.title, 'Public summary')
    if (p.assigned_to !== undefined) values.assigned_to = p.assigned_to === null || p.assigned_to === '' ? null : text(ctx, p.assigned_to, 'Assignee')
    if (p.public_update !== undefined) {
      values.public_update = text(ctx, p.public_update, 'Public update')
      await ctx.documents.create('tickets.progress', { ticket: ticket.row_id, text: values.public_update, by: ctx.user, at: new Date().toISOString() })
    }
    if (p.state !== undefined) values.ticket_state = String(p.state)
    else if ((recipientChanged || scopeChanged) && !(type && category === ticket.kind)) {
      values.ticket_state = category === 'access' ? 'Needs verification' : type ? type.states[0] : 'New'
      if (category === 'access') {
        // The request row says whether its current recipient holds an active
        // verification, so a requester's own edit is judged like support's.
        const verified = !recipientChanged && !!request.active_verification && request.active_verification === request.verification_key
        if (restricted(ctx, next)) values.ticket_state = 'Policy review'
        else if (verified) values.ticket_state = 'Awaiting approval'
      }
    }
    const saved = await bump(ctx, ticket, values)
    if (!where.open) await keepReaders(ctx, saved, next, type)
    // Only here, never in `create`: a load through `create` stays quiet.
    const assignee = values.assigned_to
    if (typeof assignee === 'string' && assignee !== ticket.assigned_to && assignee !== ctx.user)
      await tellAssignee(ctx, saved, assignee, reworded ? original : request.original, where)
    return { ticket: saved }
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
    await ctx.documents.update('tickets.request', { row_id: request.row_id, updated_at: request.updated_at, approval_key: randomUUID(),
      active_verification: p.active ? request.verification_key : null })
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
    const types = await configuredTypes(ctx)
    return { ticket: await bump(ctx, ticket, ticket.kind === 'access' || types.has(String(ticket.kind)) || ticket.ticket_state === 'Resolved' ? {} : { ticket_state: 'In progress' }) }
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
    const p = input(ctx, ['row_id', 'updated_at', 'reason', 'reference', 'state'])
    const { ticket } = await current(ctx, p)
    if (ticket.kind === 'access') ctx.reject('Access must be completed through authorized fulfillment')
    const type = (await configuredTypes(ctx)).get(String(ticket.kind))
    if (type?.transitions.length) ctx.reject(`${type.label} moves only through its actions`)
    const state = type ? String(p.state ?? type.done[0] ?? '') : 'Resolved'
    if (type ? !type.done.includes(state) : p.state !== undefined) ctx.reject(type ? 'Choose one of this type\'s done states' : 'This type resolves as Resolved')
    await event(ctx, ticket, 'resolve', { reason: text(ctx, p.reason, 'Resolution reason'), reference: text(ctx, p.reference, 'Resolution evidence'), ...(type ? { state } : {}) })
    return { ticket: await bump(ctx, ticket, { ticket_state: state }) }
  },
  async transition(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'action', 'values'])
    const ticket = await ctx.documents.get('tickets.ticket', text(ctx, p.row_id, 'Ticket'))
    if (String(ticket.updated_at) !== text(ctx, p.updated_at, 'Revision')) ctx.reject('This ticket changed; reload before trying again')
    const action = text(ctx, p.action, 'Action')
    const type = (await configuredTypes(ctx)).get(String(ticket.kind))
    if (!type?.transitions.length) return ctx.reject('This ticket type has no actions')
    const listed = type.transitions.filter(t => t.state === ticket.ticket_state && t.action === action)
    if (!listed.length) ctx.reject(`${action} is not an action from ${String(ticket.ticket_state)}`)
    const support = capabilities(ctx).support
    const transition = listed.find(t => mayTake(ctx, ticket, t, support))
    if (!transition) return ctx.reject(`You are not allowed to ${action} this ticket`)
    const values = object(ctx, p.values ?? {})
    const extra = Object.keys(values).find(key => !transition.fields.includes(key))
    if (extra) ctx.reject(`${action} does not record ${extra}`)
    const asked = transition.fields.map(name => type.fields.find(f => f.name === name))
    if (asked.some(f => !f)) ctx.reject(`${action} names a field this type does not have; ask a System Manager to fix the type`)
    const recorded = await typedDetails(ctx, type, values, asked as TypeField[], true)
    if (transition.fields.length) {
      // The values sit with the request: open, or private to the raiser and support.
      const where = await place(ctx, ticket.row_id)
      if (!where.open && !support && ticket.owner !== ctx.user) ctx.reject(`Only the raiser or Tickets support can record what ${action} asks for`)
      const request = await ctx.documents.get(where.request, String(ticket.row_id))
      await ctx.documents.update(where.request, { row_id: request.row_id, updated_at: request.updated_at,
        details_json: JSON.stringify({ ...parse(request.details_json), ...recorded }) })
      // An action may record who it is raised for.
      if (!where.open) await keepReaders(ctx, ticket, { ...parse(request.details_json), ...recorded }, type)
    }
    const from = String(ticket.ticket_state), to = transition.next_state
    await event(ctx, ticket, 'transition', { action, from, to, values: recorded })
    // The shared progress names the action, never the private values.
    await ctx.documents.create('tickets.progress', { ticket: ticket.row_id, text: `${action}: ${from} → ${to}`, by: ctx.user, at: new Date().toISOString() })
    return { ticket: await bump(ctx, ticket, { ticket_state: to }) }
  },
  // A ticket raised before its type's details were open to everyone keeps them
  // private until support opens them: copied, with its history, into the open
  // Tables. The private rows stay as they were (history is never deleted).
  async open_details(ctx) {
    const p = input(ctx, ['row_id'])
    if (!capabilities(ctx).support) ctx.reject('Only Tickets support may open a ticket\'s details')
    const ticket = await ctx.documents.get('tickets.ticket', text(ctx, p.row_id, 'Ticket'))
    const type = (await configuredTypes(ctx)).get(String(ticket.kind))
    if (type?.visibility !== 'everyone') ctx.reject('Only a ticket whose type shows its details to everyone can be opened')
    if ((await place(ctx, ticket.row_id)).open) return { ticket, opened: false }
    const request = await ctx.documents.get(PRIVATE.request, String(ticket.row_id))
    await ctx.documents.create(OPEN.request, { row_id: ticket.row_id, original: request.original, details_json: request.details_json,
      ...(request.original_history ? { original_history: request.original_history } : {}) })
    const events = await all(ctx, PRIVATE.event, eventFields, [['ticket', '=', ticket.row_id]])
    for (const e of events) await ctx.documents.create(OPEN.event, { ticket: ticket.row_id, operation: e.operation, text: e.text, by: e.by, at: e.at })
    return { ticket, opened: true, events: events.length }
  },
  // #963: the raiser protects the audit trail, so this is for a System Manager
  // only, never Tickets support. A private request is reached through an
  // own-rows grant, so it moves with the raiser; the rest of the ticket stays.
  async change_raiser(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'new_raiser', 'reason'])
    if (!isSystemManager(ctx)) ctx.reject('Only a System Manager may change who raised a ticket')
    const ticket = await ctx.documents.get('tickets.ticket', text(ctx, p.row_id, 'Ticket'))
    if (String(ticket.updated_at) !== text(ctx, p.updated_at, 'Revision')) ctx.reject('This ticket changed; reload before trying again')
    const reason = text(ctx, p.reason, 'Reason')
    const raiser = text(ctx, p.new_raiser, 'New raiser')
    if (raiser === ticket.owner) ctx.reject('That person is already the raiser')
    await namedRaiser(ctx, raiser)
    const [kept] = await ctx.documents.list(PRIVATE.request, { fields: ['row_id'], filters: [['row_id', '=', String(ticket.row_id)]], limit_page_length: 1 })
    if (kept) await ctx.documents.handOver(PRIVATE.request, String(kept.row_id), raiser)
    await event(ctx, ticket, 'change_raiser', { old_raiser: ticket.owner, new_raiser: raiser, reason })
    const saved = await bump(ctx, ticket, { owner: raiser })
    if (kept) await keepReaders(ctx, saved, parse((await ctx.documents.get(PRIVATE.request, String(ticket.row_id))).details_json), (await configuredTypes(ctx)).get(String(ticket.kind)))
    return { ticket: saved }
  },
  async add_rule(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'title', 'table', 'filters', 'severity', 'owner', 'how_to_fix'])
    const ticket = await revised(ctx, p)
    if (!involved(ctx, ticket)) ctx.reject('Only the ticket\'s raiser, its assignee or Tickets support may add a rule')
    const title = text(ctx, p.title, 'Title')
    const table = ruleTable(ctx, p.table)
    const filters = ruleFilters(ctx, p.filters)
    if (!SEVERITIES.includes(String(p.severity))) ctx.reject(`Severity is one of: ${SEVERITIES.join(', ')}`)
    // The owner is someone Tickets assigns work to, or the ticket's own raiser or assignee.
    const owner = p.owner === undefined || p.owner === null || p.owner === '' ? (ticket.assigned_to ?? null) : text(ctx, p.owner, 'Owner')
    if (owner && ![...staffOf(ctx), ticket.owner, ticket.assigned_to].includes(owner)) ctx.reject('The owner is one of the people Tickets assigns work to')
    const how = p.how_to_fix === undefined || p.how_to_fix === null || p.how_to_fix === '' ? null : text(ctx, p.how_to_fix, 'How to fix')
    if ((await ctx.documents.list(RULE_TABLE, { fields: ['row_id'], filters: [['ticket', '=', ticket.row_id]], limit_page_length: MAX_RULES })).length >= MAX_RULES)
      ctx.reject(`A ticket holds at most ${MAX_RULES} rules`)
    // A list names a column the Table lacks in its refusal; the count below never fails.
    await ctx.documents.list(table, { fields: ['row_id'], filters, limit_page_length: 1 })
    const rows = await ctx.documents.count(table, filters)
    if (rows === null) ctx.reject(`You may not read ${table}`)
    if (rows === 0) ctx.reject('This rule matches no rows, so there is nothing to fix')
    const rule = await ctx.documents.create(RULE_TABLE, { ticket: ticket.row_id, title, checked_table: table, filters: JSON.stringify(filters),
      severity: p.severity, owner, how_to_fix: how, rows_when_raised: rows })
    await event(ctx, ticket, 'add_rule', { rule: rule.row_id, title, table, conditions: conditionsText(filters), severity: p.severity, rows })
    return { ticket: await bump(ctx, ticket), rule }
  },
  async remove_rule(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'rule', 'reason'])
    const ticket = await revised(ctx, p)
    if (!involved(ctx, ticket)) ctx.reject('Only the ticket\'s raiser, its assignee or Tickets support may remove a rule')
    const reason = text(ctx, p.reason, 'Reason')
    const rule = await ctx.documents.get(RULE_TABLE, text(ctx, p.rule, 'Rule'))
    if (rule.ticket !== ticket.row_id) ctx.reject('That rule is not on this ticket')
    await ctx.documents.delete(RULE_TABLE, String(rule.row_id), String(rule.updated_at))
    await event(ctx, ticket, 'remove_rule', { rule: rule.row_id, title: rule.title, table: rule.checked_table, conditions: conditionsText(storedFilters(rule.filters)), reason })
    return { ticket: await bump(ctx, ticket) }
  },
  async reopen(ctx) {
    const p = input(ctx, ['row_id', 'updated_at', 'reason'])
    const { ticket, request } = await current(ctx, p)
    const types = await configuredTypes(ctx)
    const configuredType = types.get(String(ticket.kind))
    if (configuredType?.transitions.length) ctx.reject(`${configuredType.label} moves only through its actions`)
    if (!isDone(ticket, types)) ctx.reject('Only a resolved ticket can be reopened')
    await event(ctx, ticket, 'reopen', { reason: text(ctx, p.reason, 'Reopening reason') })
    if (ticket.kind === 'access') await ctx.documents.update('tickets.request', {
      row_id: request.row_id, updated_at: request.updated_at, approval_key: randomUUID(),
    })
    const type = types.get(String(ticket.kind))
    return { ticket: await bump(ctx, ticket, { ticket_state: ticket.kind === 'access' ? 'Needs verification' : type ? type.reopen : 'In progress' }) }
  },
}
export const actions = Object.fromEntries(Object.entries(handlers).map(([operation, handler]) =>
  [operation, (ctx: Context) => writes.run({ user: ctx.user, operation }, async () => { await remember(ctx); return handler(ctx) })]))
export const reads = {
  async session(ctx: ReadContext) {
    input(ctx, [])
    const can = capabilities(ctx)
    const answer: Row = { user: { row_id: ctx.user, full_name: ctx.userName }, capabilities: can, connections: {
      employee: 'unconfigured', email: 'unconfigured', investigation: 'unconfigured',
    } }
    if (can.support) {
      // The people configured for Tickets whose names are known, for assignment.
      const known = await names(ctx, [...staffOf(ctx)])
      answer.people = Object.entries(known).map(([row_id, full_name]) => ({ row_id, full_name }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
    }
    return { answer }
  },
  // The types a requester may choose, with each configured type's fields and
  // the options its links and people offer this caller.
  async form(ctx: ReadContext) {
    input(ctx, [])
    const types = await configuredTypes(ctx)
    const configuredList: Row[] = []
    // Switched-off types are listed (their tickets still show and move), marked
    // so the form never offers them for a new ticket.
    for (const type of types.values()) {
      const fields: Row[] = []
      const asked = actionFieldNames(type)
      for (const field of type.fields) fields.push({ name: field.name, label: field.label, type: field.type, required: field.required,
        ...(asked.has(field.name) ? { asked_by_action: true } : {}),
        ...(field.type === 'choice' ? { choices: field.choices } : {}),
        ...(field.type === 'link' ? { options: (await linkRows(ctx, field)).map(r => ({ value: String(r.row_id), label: String(r[field.link_label!] ?? r.row_id) })) } : {}) })
      configuredList.push({ key: type.key, label: type.label, states: type.states, done: type.done, fields, transitions: type.transitions.length > 0, details_visible_to: type.visibility, enabled: type.enabled })
    }
    return { answer: { types: [...kinds.map(key => ({ key, builtin: true })), ...configuredList] } }
  },
  async queue(ctx: ReadContext) {
    const p = input(ctx, ['search', 'kind', 'state', 'assigned_to'])
    let tickets = await all(ctx, 'tickets.ticket', ticketFields)
    const types = await configuredTypes(ctx)
    // #1397: a parent's row counts its sub-tickets; the sub-tickets themselves are listed only by a search.
    const subTickets = new Map<string, { count: number; open: number }>()
    for (const ticket of tickets) if (ticket.parent_ticket) {
      const counted = subTickets.get(String(ticket.parent_ticket)) ?? { count: 0, open: 0 }
      subTickets.set(String(ticket.parent_ticket), { count: counted.count + 1, open: counted.open + Number(!isDone(ticket, types)) })
    }
    // Which parent each sub-ticket sits under, so a page keeps an opened sub-ticket open under its parent's row.
    const under = Object.fromEntries(tickets.filter(ticket => ticket.parent_ticket).map(ticket => [String(ticket.row_id), String(ticket.parent_ticket)]))
    tickets = tickets.flatMap(ticket => ticket.parent_ticket && !p.search ? [] : [subTickets.has(String(ticket.row_id)) ? { ...ticket, sub_tickets: subTickets.get(String(ticket.row_id)) } : ticket])
    for (const [key, column] of [['kind', 'kind'], ['state', 'ticket_state'], ['assigned_to', 'assigned_to']])
      if (p[key]) tickets = tickets.filter(ticket => p[key] === 'open' && key === 'state' ? !isDone(ticket, types) : ticket[column] === p[key])
    if (p.search) {
      const words = text(ctx, p.search, 'Search').toLowerCase().split(/\s+/)
      tickets = tickets.filter(ticket => words.every(word => `${ticket.row_id} ${ticket.title} ${ticket.public_update ?? ''}`.toLowerCase().includes(word)))
    }
    return { answer: { tickets, count: tickets.length, hasMore: false, under,
      names: await names(ctx, tickets.map(ticket => ({ owner: ticket.owner, assigned_to: ticket.assigned_to }))) } }
  },
  // #1240: the caller's own open feedback on one report (Dash's "Report an issue"), newest first.
  async about_report(ctx: ReadContext) {
    const p = input(ctx, ['report_key'])
    const key = text(ctx, p.report_key, 'Report key')
    const types = await configuredTypes(ctx)
    const mine = (await all(ctx, 'tickets.ticket', ticketFields, [['owner', '=', ctx.user], ['kind', '=', REPORT_FEEDBACK]]))
      .filter(ticket => !isDone(ticket, types))
    const requests = new Map<string, Row>()
    for (let i = 0; i < mine.length; i += 500) {
      const ids = mine.slice(i, i + 500).map(ticket => String(ticket.row_id))
      for (const request of await ctx.documents.list(PRIVATE.request, { fields: ['row_id', 'details_json'], filters: [['row_id', 'in', ids]], limit_page_length: 500 }))
        requests.set(String(request.row_id), parse(request.details_json))
    }
    const tickets = mine.filter(ticket => requests.get(String(ticket.row_id))?.report_key === key)
      .sort((a, b) => String(b.row_id).localeCompare(String(a.row_id)))
      .map(ticket => { const d = requests.get(String(ticket.row_id))!; return { row_id: ticket.row_id, title: ticket.title, ticket_state: ticket.ticket_state,
        updated_at: ticket.updated_at, problem: d.problem ?? null, about: d.about ?? null } })
    return { answer: { tickets, count: tickets.length } }
  },
  // #1196: how many rows a rule being written would match, as the caller.
  async rule_preview(ctx: ReadContext) {
    const p = input(ctx, ['table', 'filters'])
    return { answer: { count: await ctx.documents.count(ruleTable(ctx, p.table), ruleFilters(ctx, p.filters)) } }
  },
  async detail(ctx: ReadContext) {
    const p = input(ctx, ['row_id'])
    const id = text(ctx, p.row_id, 'Ticket')
    const ticket = await ctx.documents.get('tickets.ticket', id)
    const answer: Row = { ticket, events: await all(ctx, 'tickets.progress', progressFields, [['ticket', '=', id]]) }
    const support = capabilities(ctx).support
    const where = await place(ctx, id)
    // #925: a private ticket's assignee and raised-for person read what its raiser reads.
    if (where.open || ticket.owner === ctx.user || support || (!where.open && await ctx.documents.isReader(where.request, id))) {
      const request = await ctx.documents.get(where.request, id)
      answer.details = { ...parse(request.details_json), original: request.original }
      // Whoever reads the request reads its earlier wordings, with who replaced each and when.
      const earlier = history_of(request)
      if (earlier.length) answer.originalHistory = earlier
      if (support || where.open) {
        const events = await history(ctx, ticket)
        answer.privateEvents = events
        const state = workflow(request, events)
        if (state.verification) answer.verification = state.verification
        if (state.approval) answer.approval = state.approval
        answer.capabilities = { decide: ticket.kind === 'access' && state.verification?.active === true &&
          !restricted(ctx, parse(request.details_json)) && (routes(ctx)[String(state.verification?.region)]?.includes(ctx.user) ?? false) }
      }
    }
    const type = (await configuredTypes(ctx)).get(String(ticket.kind))
    const entered = (answer.details ?? {}) as Row
    const personValues: string[] = []
    if (type && answer.details) {
      const labels: Row = {}
      for (const field of type.fields) {
        const value = entered[field.name]
        if (typeof value !== 'string') continue
        if (field.type === 'link') { const [row] = await linkRows(ctx, field, [['row_id', '=', value]]); if (row) labels[field.name] = row[field.link_label!] ?? value }
        if (field.type === 'person') personValues.push(value)
      }
      answer.labels = labels
    }
    // The actions this viewer may take now, with what each asks for.
    if (type?.transitions.length) {
      const actions: Row[] = []
      for (const t of available(ctx, ticket, type, support)) {
        const fields: Row[] = []
        for (const f of t.fields.map(name => type.fields.find(field => field.name === name)).filter((f): f is TypeField => !!f))
          fields.push({ name: f.name, label: f.label, type: f.type, ...(f.type === 'choice' ? { choices: f.choices } : {}),
            // A link offers the rows the caller may read, as the new-ticket form does.
            ...(f.type === 'link' ? { options: (await linkRows(ctx, f)).map(r => ({ value: String(r.row_id), label: String(r[f.link_label!] ?? r.row_id) })) } : {}) })
        actions.push({ action: t.action, next_state: t.next_state, fields })
      }
      answer.actions = actions
    }
    // #1397: its parent, or its sub-tickets, open ones first.
    if (ticket.parent_ticket) {
      const [parent] = await ctx.documents.list('tickets.ticket', { fields: ticketFields, filters: [['row_id', '=', String(ticket.parent_ticket)]], limit_page_length: 1 })
      if (parent) answer.parent = parent
    }
    const allTypes = await configuredTypes(ctx)
    answer.children = (await all(ctx, 'tickets.ticket', ticketFields, [['parent_ticket', '=', id]]))
      .sort((a, b) => Number(isDone(a, allTypes)) - Number(isDone(b, allTypes)) || String(a.row_id).localeCompare(String(b.row_id)))
    answer.rules = await rulesOf(ctx, id)
    // #1230: everyone who reads the ticket reads the rows it covers; support is told how to switch them on.
    const covered = await coveredRows(ctx, id)
    if (covered) answer.coveredRows = covered
    if (covered === null && support && type) answer.coveredRowsSetup = COVERED_SETUP
    // #1196: who may add a rule here, and the Tables a rule may check.
    if (involved(ctx, ticket)) answer.ruleTables = members(configured(ctx, 'linked_tables'))
    answer.names = await names(ctx, { owner: ticket.owner, assigned_to: ticket.assigned_to }, answer.events, answer.privateEvents ?? [], answer.rules,
      answer.verification ?? {}, answer.approval ?? {}, answer.originalHistory ?? [], personValues)
    return { answer }
  },
}
