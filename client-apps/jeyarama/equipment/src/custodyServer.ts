import { withinPlace } from './countRules'
import { FINAL_LINE_STATES, defaultReceiptBy, isOpenTransfer } from './transferRules'
import type { Context } from './server'
import { checkFreeze } from './inventoryServer'

type Row = Record<string, unknown>
type Documents = Context['documents']

async function all(documents: Documents, table: string, filters: [string, string, unknown][], fields: string[]): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { filters, fields, limit_page_length: 500, limit_start: rows.length } as Parameters<Documents['list']>[1])
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

/**
 * Assets Managers are the people who can read the expected lists. Validators don't see roles, so for
 * anyone else this read is itself refused, and that refusal refuses their save.
 */
const isManagerId = async (documents: Documents, user: string) =>
  (await documents.members('equipment.count_expected')).some(person => person.row_id === user)

const OPEN_CUSTODY = ['Pending', 'Accepted', 'Not with me', 'Return requested']

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)
const AWAY = ['In transit', 'With vendor']

/** Only the custodian answers an issue or hands it back; only a manager takes it back. The server keeps the times. */
export async function prepareCustody(ctx: Context): Promise<void> {
  const { row, old } = ctx
  if (ctx.isNew) {
    row.custody_state = 'Pending'
    row.issued_at = ctx.now
    row.responded_at = null
    row.returned_at = null
    return
  }
  if (!same(row.asset, old?.asset) || !same(row.custodian, old?.custodian)) ctx.reject('A custody record keeps its asset and custodian')
  for (const field of ['issued_at', 'responded_at', 'returned_at']) row[field] = old?.[field] ?? null
  if (!same(row.note, old?.note) && ctx.user !== row.custodian && !(await isManagerId(ctx.documents, ctx.user)))
    ctx.reject('Only the custodian or an Assets Manager writes the note')
  const before = String(old?.custody_state), after = String(row.custody_state)
  if (before === after) return
  if (before === 'Returned') ctx.reject('A returned custody is kept as it was')
  if (after === 'Returned') {
    if (!(await isManagerId(ctx.documents, ctx.user))) ctx.reject('Only an Assets Manager can take an asset back')
    row.returned_at = ctx.now
    return
  }
  if (ctx.user !== row.custodian) ctx.reject('Only the person it was issued to can answer')
  const allowed = before === 'Pending' ? ['Accepted', 'Not with me'] : before === 'Accepted' ? ['Return requested'] : []
  if (!allowed.includes(after)) ctx.reject(`An issue that is ${before} can’t become ${after}`)
  if (before === 'Pending') row.responded_at = ctx.now
}

/** A clearance closes only when the person holds nothing. Assets never holds pay. */
export async function prepareClearance(ctx: Context): Promise<void> {
  const { row, old } = ctx
  if (old?.clearance_state === 'Cleared') ctx.reject('A cleared clearance stays cleared')
  if (row.clearance_state === 'Cleared') {
    const held = await all(ctx.documents, 'equipment.custody', [['custodian', '=', row.person]], ['custody_state'])
    if (held.some(c => OPEN_CUSTODY.includes(String(c.custody_state)))) ctx.reject('Return or reassign every asset before clearing')
  }
}

// A direct save can't set these: the server writes each one when its step happens.
const TRANSFER_STAMPS = ['approver', 'approved_at', 'transporter', 'dispatched_at', 'received_at', 'finance_reference', 'finance_confirmed_at', 'finance_confirmed_by']
const APPROVED_TERMS = ['transfer_kind', 'from_place', 'to_place', 'to_entity', 'vendor']
const NEXT_STAGE: Record<string, string[]> = { Requested: ['Approved', 'Rejected', 'Cancelled'], Approved: ['Dispatched', 'Cancelled'], Dispatched: ['Received'] }

const linesOf = (ctx: Context, transfer: unknown) => all(ctx.documents, 'equipment.transfer_line', [['transfer', '=', transfer]], ['line_state'])

/**
 * A transfer moves Requested → Approved (by someone else) → Dispatched (every item out) → Received (every
 * item final), or is rejected or cancelled before dispatch. Once approved, its terms are fixed.
 */
export async function prepareTransfer(ctx: Context): Promise<void> {
  const { row, old } = ctx
  const asked = { ...row }
  const kind = String(row.transfer_kind)
  if (kind === 'Repair with vendor' && !String(row.vendor ?? '').trim()) ctx.reject('Name the vendor for a repair', { vendor: 'Name the vendor' })
  if (kind === 'Between companies' && !row.to_entity) ctx.reject('Choose the new legal owner for a move between companies', { to_entity: 'Choose the new owner' })
  for (const field of TRANSFER_STAMPS) row[field] = ctx.isNew ? null : old?.[field] ?? null
  await checkFreeze(ctx)
  if (ctx.isNew) {
    row.transfer_state = 'Requested'
    return
  }
  const before = String(old?.transfer_state), after = String(row.transfer_state)
  if (before !== 'Requested' && APPROVED_TERMS.some(field => !same(row[field], old?.[field])))
    ctx.reject('An approved transfer keeps its kind, places, new owner and vendor')

  if (before !== after) {
    if (!(NEXT_STAGE[before] ?? []).includes(after)) ctx.reject(`A ${before.toLowerCase()} transfer can’t become ${after}`)
    if (after === 'Approved' || after === 'Rejected') {
      if (ctx.user === old?.created_by) ctx.reject('Someone other than the requester approves a transfer')
      row.approver = ctx.user
      row.approved_at = ctx.now
    }
    if (after === 'Dispatched') {
      const lines = await linesOf(ctx, row.row_id)
      if (!lines.length || lines.some(line => line.line_state !== 'Dispatched')) ctx.reject('Dispatch every item before the transfer')
      const transporter = String(asked.transporter ?? '').trim()
      if (!transporter) ctx.reject('Name the transporter or vendor', { transporter: 'Name the transporter or vendor' })
      row.transporter = transporter
      row.dispatched_at = ctx.now
      if (!row.expected_receipt_at) row.expected_receipt_at = defaultReceiptBy(kind, ctx.now)
    }
    if (after === 'Received') {
      const lines = await linesOf(ctx, row.row_id)
      if (lines.some(line => !(FINAL_LINE_STATES as readonly string[]).includes(String(line.line_state)))) ctx.reject('Receive every item before the transfer')
      row.received_at = ctx.now
    }
  }

  if (asked.finance_reference && !same(asked.finance_reference, old?.finance_reference)) {
    if (old?.finance_confirmed_at) ctx.reject('Finance has already confirmed this transfer')
    if (kind !== 'Between companies') ctx.reject('Only a move between companies needs Finance')
    if (row.transfer_state !== 'Received') ctx.reject('Confirm Finance only once the transfer is received')
    if (ctx.user === old?.created_by) ctx.reject('Someone other than the requester confirms Finance')
    row.finance_reference = String(asked.finance_reference).trim()
    row.finance_confirmed_at = ctx.now
    row.finance_confirmed_by = ctx.user
  }
}

const NEXT_LINE: Record<string, string[]> = { Requested: ['Dispatched'], Dispatched: ['Received good', 'Received damaged', 'Refused'], Refused: ['Returned to source'] }

/** One open transfer per asset, and only assets from the place it leaves. */
export async function prepareTransferLine(ctx: Context): Promise<void> {
  const { row } = ctx
  if (!ctx.isNew) return prepareLineChange(ctx)
  const transfer = await ctx.documents.get('equipment.transfer', String(row.transfer))
  if (transfer.transfer_state !== 'Requested') ctx.reject('Add items only while the transfer is requested')
  const asset = await ctx.documents.get('equipment.asset', String(row.asset))
  const name = String(asset.asset_name)
  if (AWAY.includes(String(asset.custody_status))) ctx.reject(`${name} is ${String(asset.custody_status).toLowerCase()} and can’t go on another transfer`)
  const places = (await all(ctx.documents, 'equipment.place', [], ['row_id', 'parent_place'])).map(p => ({ row_id: String(p.row_id), parent_place: (p.parent_place as string) ?? null }))
  if (!withinPlace(String(asset.place), String(transfer.from_place), places)) ctx.reject(`${name} is not in the place this transfer leaves from`)
  for (const line of await all(ctx.documents, 'equipment.transfer_line', [['asset', '=', row.asset]], ['transfer', 'line_state'])) {
    if ((FINAL_LINE_STATES as readonly string[]).includes(String(line.line_state))) continue
    if (line.transfer === row.transfer) ctx.reject(`${name} is already on this transfer`)
    const other = await ctx.documents.get('equipment.transfer', String(line.transfer))
    if (isOpenTransfer(String(other.transfer_state))) ctx.reject(`${name} is already on transfer ${other.row_id}`)
  }
  row.line_state = 'Requested'
  row.dispatched_at = null
  row.received_at = null
  row.source_place = null
}

/**
 * An item changes state only once its asset has: out of its place to be dispatched, at the
 * destination to be received, back where it left to be returned. The actions move the asset first.
 */
async function prepareLineChange(ctx: Context): Promise<void> {
  const { row, old } = ctx
  if (!same(row.asset, old?.asset) || !same(row.transfer, old?.transfer)) ctx.reject('A transfer item keeps its asset and transfer')
  for (const field of ['dispatched_at', 'received_at', 'source_place']) row[field] = old?.[field] ?? null
  const before = String(old?.line_state), after = String(row.line_state)
  if (before === after) return
  if (!(NEXT_LINE[before] ?? []).includes(after)) ctx.reject(`This item can’t go from ${before} to ${after}`)
  const transfer = await ctx.documents.get('equipment.transfer', String(row.transfer))
  const asset = await ctx.documents.get('equipment.asset', String(row.asset))
  const name = String(asset.asset_name)
  const away = AWAY.includes(String(asset.custody_status))
  if (after === 'Dispatched') {
    if (transfer.transfer_state !== 'Approved') ctx.reject('Dispatch items once the transfer is approved')
    if (!away) ctx.reject(`${name} must be scanned out before it is dispatched`)
    row.source_place = asset.place ?? null
    row.dispatched_at = ctx.now
    return
  }
  if (transfer.transfer_state !== 'Dispatched') ctx.reject('Receive items once the transfer is dispatched')
  if ((after === 'Received good' || after === 'Received damaged') && (away || asset.place !== transfer.to_place)) {
    const to = await ctx.documents.get('equipment.place', String(transfer.to_place))
    ctx.reject(`${name} must be at ${String(to.place_name)} before it is received`)
  }
  if (after === 'Returned to source' && (away || asset.place !== (old?.source_place ?? transfer.from_place)))
    ctx.reject(`${name} must be back where it left before it is returned`)
  row.received_at = ctx.now
}

interface ActionContext {
  user: string
  roles: readonly string[]
  payload: unknown
  documents: Documents & {
    create(table: string, values: Row): Promise<Row>
    update(table: string, values: Row): Promise<Row>
  }
  reject(message: string, fields?: Record<string, string>): never
}

function payload<T extends Record<string, unknown>>(ctx: ActionContext, keys: (keyof T)[]): T {
  const value = ctx.payload as T | null
  if (!value || typeof value !== 'object' || keys.some(key => typeof value[key] !== 'string' || !value[key])) ctx.reject('Something needed for this step is missing')
  return value
}

function requireManager(ctx: ActionContext, message: string) {
  if (!ctx.roles.some(role => role === 'Assets Manager' || role === 'System Manager')) ctx.reject(message)
}

async function current(ctx: ActionContext, table: string, id: unknown) {
  return ctx.documents.get(table, String(id))
}

async function finishIfAllFinal(ctx: ActionContext, transfer: Row) {
  const lines = await all(ctx.documents, 'equipment.transfer_line', [['transfer', '=', transfer.row_id]], ['line_state'])
  if (lines.every(line => (FINAL_LINE_STATES as readonly string[]).includes(String(line.line_state)))) {
    const fresh = await current(ctx, 'equipment.transfer', transfer.row_id)
    await ctx.documents.update('equipment.transfer', { row_id: fresh.row_id, updated_at: fresh.updated_at, transfer_state: 'Received' })
  }
}

export const custodyActions = {
  /** Issue an asset to an employee or a location custodian; it waits for their answer. */
  async issue_custody(ctx: ActionContext) {
    requireManager(ctx, 'Only an Assets Manager can issue an asset')
    const request = payload<{ asset: string; person: string; kind: string }>(ctx, ['asset', 'person', 'kind'])
    if (!['Employee', 'Location custodian'].includes(request.kind)) ctx.reject('Choose Employee or Location custodian')
    const asset = await current(ctx, 'equipment.asset', request.asset)
    const open = await all(ctx.documents, 'equipment.custody', [['asset', '=', asset.row_id]], ['custody_state'])
    if (open.some(c => OPEN_CUSTODY.includes(String(c.custody_state)))) ctx.reject(`${asset.asset_name} is already in someone’s custody; take it back first`)
    if (asset.custody_status === 'In transit' || asset.custody_status === 'With vendor') ctx.reject(`${asset.asset_name} is ${String(asset.custody_status).toLowerCase()} and can’t be issued`)
    const custody = await ctx.documents.create('equipment.custody', { asset: asset.row_id, custodian: request.person, custodian_kind: request.kind })
    const location = request.kind === 'Location custodian'
    await ctx.documents.update('equipment.asset', { row_id: asset.row_id, updated_at: asset.updated_at, custodian: request.person, location_custodian: location,
      custody_status: location ? 'At location' : 'With custodian' })
    return custody
  },

  /** A manager takes an asset back; it is then at its location with no custodian. */
  async return_custody(ctx: ActionContext) {
    requireManager(ctx, 'Only an Assets Manager can take an asset back')
    const request = payload<{ custody: string }>(ctx, ['custody'])
    const custody = await current(ctx, 'equipment.custody', request.custody)
    if (custody.custody_state === 'Returned') ctx.reject('This asset is already back')
    const asset = await current(ctx, 'equipment.asset', custody.asset)
    if (AWAY.includes(String(asset.custody_status))) ctx.reject(`${asset.asset_name} is ${String(asset.custody_status).toLowerCase()}; receive it before taking it back`)
    const returned = await ctx.documents.update('equipment.custody', { row_id: custody.row_id, updated_at: custody.updated_at, custody_state: 'Returned' })
    await ctx.documents.update('equipment.asset', { row_id: asset.row_id, updated_at: asset.updated_at, custodian: null, location_custodian: false, custody_status: 'At location' })
    return returned
  },

  /** Every item scanned out; assets go in transit, or with the vendor for a repair. */
  async dispatch_transfer(ctx: ActionContext) {
    requireManager(ctx, 'Only an Assets Manager can dispatch a transfer')
    const request = ctx.payload as { transfer?: unknown; transporter?: unknown; scanned?: unknown } | null
    if (!request || typeof request.transfer !== 'string' || typeof request.transporter !== 'string' || !request.transporter.trim() || !Array.isArray(request.scanned))
      ctx.reject('Scan the items and name the transporter or vendor')
    const transfer = await current(ctx, 'equipment.transfer', request.transfer)
    if (transfer.transfer_state !== 'Approved') ctx.reject('Dispatch a transfer once it is approved')
    const lines = await all(ctx.documents, 'equipment.transfer_line', [['transfer', '=', transfer.row_id]], ['row_id', 'asset'])
    if (!lines.length) ctx.reject('This transfer has no items')
    const scanned = new Set((request.scanned as unknown[]).map(String))
    for (const line of lines) if (!scanned.has(String(line.asset))) {
      const asset = await current(ctx, 'equipment.asset', line.asset)
      ctx.reject(`Scan every item before dispatch: ${asset.asset_name} is not scanned`)
    }
    const custody = transfer.transfer_kind === 'Repair with vendor' ? 'With vendor' : 'In transit'
    for (const line of lines) {
      const asset = await current(ctx, 'equipment.asset', line.asset)
      await ctx.documents.update('equipment.asset', { row_id: asset.row_id, updated_at: asset.updated_at, custody_status: custody })
      const fresh = await current(ctx, 'equipment.transfer_line', line.row_id)
      await ctx.documents.update('equipment.transfer_line', { row_id: fresh.row_id, updated_at: fresh.updated_at, line_state: 'Dispatched' })
    }
    return ctx.documents.update('equipment.transfer', { row_id: transfer.row_id, updated_at: transfer.updated_at, transfer_state: 'Dispatched', transporter: request.transporter.trim() })
  },

  /** Receive one item: its place changes only now. Refused items go back to where they left. */
  async receive_line(ctx: ActionContext) {
    requireManager(ctx, 'Only an Assets Manager can receive items into a site')
    const request = payload<{ line: string; outcome: string; note?: string }>(ctx, ['line', 'outcome'])
    const line = await current(ctx, 'equipment.transfer_line', request.line)
    const transfer = await current(ctx, 'equipment.transfer', line.transfer)
    if (transfer.transfer_state !== 'Dispatched') ctx.reject('Receive items once the transfer is dispatched')
    const outcome = request.outcome
    if (outcome === 'Returned to source' ? line.line_state !== 'Refused' : line.line_state !== 'Dispatched')
      ctx.reject(outcome === 'Returned to source' ? 'Only a refused item comes back to where it left' : 'This item is not waiting to be received')
    if (!['Received good', 'Received damaged', 'Refused', 'Returned to source'].includes(outcome)) ctx.reject('Choose how the item was received')
    // The asset moves first; the item's own rules then check it is where its new state says.
    const asset = await current(ctx, 'equipment.asset', line.asset)
    const settled = asset.custodian && !asset.location_custodian ? 'With custodian' : 'At location'
    if (outcome === 'Received good' || outcome === 'Received damaged')
      await ctx.documents.update('equipment.asset', { row_id: asset.row_id, updated_at: asset.updated_at, place: transfer.to_place, custody_status: settled,
        ...(outcome === 'Received damaged' ? { condition: 'Damaged' } : {}) })
    else if (outcome === 'Returned to source')
      await ctx.documents.update('equipment.asset', { row_id: asset.row_id, updated_at: asset.updated_at, place: line.source_place ?? transfer.from_place, custody_status: settled })
    await ctx.documents.update('equipment.transfer_line', { row_id: line.row_id, updated_at: line.updated_at, line_state: outcome,
      ...(typeof request.note === 'string' && request.note.trim() ? { note: request.note.trim() } : {}) })
    await finishIfAllFinal(ctx, transfer)
    return { line: line.row_id, outcome }
  },

  /** A move between companies changes the legal owner only after Finance confirms the SAP transaction. */
  async confirm_finance(ctx: ActionContext) {
    requireManager(ctx, 'Only an Assets Manager can record the Finance confirmation')
    const request = payload<{ transfer: string; sap_reference: string }>(ctx, ['transfer', 'sap_reference'])
    const transfer = await current(ctx, 'equipment.transfer', request.transfer)
    if (transfer.transfer_kind !== 'Between companies') ctx.reject('Only a move between companies needs Finance')
    if (transfer.transfer_state !== 'Received') ctx.reject('Confirm Finance only once the transfer is received')
    if (transfer.finance_confirmed_at) ctx.reject('Finance has already confirmed this transfer')
    if (transfer.created_by === ctx.user) ctx.reject('Someone other than the requester confirms Finance')
    for (const line of await all(ctx.documents, 'equipment.transfer_line', [['transfer', '=', transfer.row_id]], ['asset', 'line_state'])) {
      if (line.line_state !== 'Received good' && line.line_state !== 'Received damaged') continue
      const asset = await current(ctx, 'equipment.asset', line.asset)
      await ctx.documents.update('equipment.asset', { row_id: asset.row_id, updated_at: asset.updated_at, owner_entity: transfer.to_entity })
    }
    return ctx.documents.update('equipment.transfer', { row_id: transfer.row_id, updated_at: transfer.updated_at, finance_reference: request.sap_reference.trim() })
  },
}
