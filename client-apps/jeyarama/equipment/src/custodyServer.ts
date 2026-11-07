import { withinPlace } from './countRules'
import { FINAL_LINE_STATES, defaultReceiptBy, isOpenTransfer } from './transferRules'
import type { Context } from './server'

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

const isManagerId = async (documents: Documents, user: string) =>
  (await documents.members('equipment.count_expected')).some(person => person.row_id === user)

const OPEN_CUSTODY = ['Pending', 'Accepted', 'Not with me', 'Return requested']

/** Only the custodian answers an issue or hands it back; only a manager takes it back. */
export async function prepareCustody(ctx: Context): Promise<void> {
  const { row, old } = ctx
  if (ctx.isNew) {
    row.custody_state = 'Pending'
    row.issued_at = ctx.now
    return
  }
  if (row.asset !== old?.asset || row.custodian !== old?.custodian) ctx.reject('A custody record keeps its asset and custodian')
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

const STAGES = ['Requested', 'Approved', 'Dispatched', 'Received']

/** Someone other than the requester approves; a transfer only moves forward. */
export async function prepareTransfer(ctx: Context): Promise<void> {
  const { row, old } = ctx
  const kind = String(row.transfer_kind)
  if (kind === 'Repair with vendor' && !String(row.vendor ?? '').trim()) ctx.reject('Name the vendor for a repair', { vendor: 'Name the vendor' })
  if (kind === 'Between companies' && !row.to_entity) ctx.reject('Choose the new legal owner for a move between companies', { to_entity: 'Choose the new owner' })
  if (ctx.isNew) {
    row.transfer_state = 'Requested'
    return
  }
  const before = String(old?.transfer_state), after = String(row.transfer_state)
  if (before === after) return
  if (['Rejected', 'Received', 'Cancelled'].includes(before)) ctx.reject(`A ${before.toLowerCase()} transfer stays as it is`)
  if (after === 'Approved' || after === 'Rejected') {
    if (before !== 'Requested') ctx.reject('Only a requested transfer can be approved or rejected')
    if (ctx.user === old?.created_by) ctx.reject('Someone other than the requester approves a transfer')
    row.approver = ctx.user
    row.approved_at = ctx.now
    return
  }
  if (after === 'Cancelled') {
    if (before === 'Dispatched') ctx.reject('A dispatched transfer can’t be cancelled; receive or refuse its items')
    return
  }
  if (STAGES.indexOf(after) < STAGES.indexOf(before)) ctx.reject(`A transfer can’t go back from ${before} to ${after}`)
  if (after === 'Dispatched' && !row.dispatched_at) ctx.reject('Dispatch a transfer from Assets, scanning each item out')
}

/** One open transfer per asset, and only assets from the place it leaves. */
export async function prepareTransferLine(ctx: Context): Promise<void> {
  const { row } = ctx
  if (!ctx.isNew) return
  const transfer = await ctx.documents.get('equipment.transfer', String(row.transfer))
  if (transfer.transfer_state !== 'Requested') ctx.reject('Add items only while the transfer is requested')
  const asset = await ctx.documents.get('equipment.asset', String(row.asset))
  const name = String(asset.asset_name)
  if (asset.custody_status === 'In transit') ctx.reject(`${name} is in transit and can’t go on another transfer`)
  const places = (await all(ctx.documents, 'equipment.place', [], ['row_id', 'parent_place'])).map(p => ({ row_id: String(p.row_id), parent_place: (p.parent_place as string) ?? null }))
  if (!withinPlace(String(asset.place), String(transfer.from_place), places)) ctx.reject(`${name} is not in the place this transfer leaves from`)
  for (const line of await all(ctx.documents, 'equipment.transfer_line', [['asset', '=', row.asset]], ['transfer', 'line_state'])) {
    if ((FINAL_LINE_STATES as readonly string[]).includes(String(line.line_state))) continue
    if (line.transfer === row.transfer) ctx.reject(`${name} is already on this transfer`)
    const other = await ctx.documents.get('equipment.transfer', String(line.transfer))
    if (isOpenTransfer(String(other.transfer_state))) ctx.reject(`${name} is already on transfer ${other.row_id}`)
  }
  row.line_state = 'Requested'
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
    await ctx.documents.update('equipment.transfer', { row_id: fresh.row_id, updated_at: fresh.updated_at, transfer_state: 'Received', received_at: new Date().toISOString() })
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
    const returned = await ctx.documents.update('equipment.custody', { row_id: custody.row_id, updated_at: custody.updated_at, custody_state: 'Returned' })
    const asset = await current(ctx, 'equipment.asset', custody.asset)
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
    const now = new Date().toISOString()
    const custody = transfer.transfer_kind === 'Repair with vendor' ? 'With vendor' : 'In transit'
    for (const line of lines) {
      const fresh = await current(ctx, 'equipment.transfer_line', line.row_id)
      await ctx.documents.update('equipment.transfer_line', { row_id: fresh.row_id, updated_at: fresh.updated_at, line_state: 'Dispatched', dispatched_at: now })
      const asset = await current(ctx, 'equipment.asset', line.asset)
      await ctx.documents.update('equipment.asset', { row_id: asset.row_id, updated_at: asset.updated_at, custody_status: custody })
    }
    return ctx.documents.update('equipment.transfer', { row_id: transfer.row_id, updated_at: transfer.updated_at, transfer_state: 'Dispatched',
      transporter: request.transporter.trim(), dispatched_at: now, expected_receipt_at: transfer.expected_receipt_at ?? defaultReceiptBy(String(transfer.transfer_kind), now) })
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
    const now = new Date().toISOString()
    await ctx.documents.update('equipment.transfer_line', { row_id: line.row_id, updated_at: line.updated_at, line_state: outcome, received_at: now,
      ...(typeof request.note === 'string' && request.note.trim() ? { note: request.note.trim() } : {}) })
    const asset = await current(ctx, 'equipment.asset', line.asset)
    if (outcome === 'Received good' || outcome === 'Received damaged')
      await ctx.documents.update('equipment.asset', { row_id: asset.row_id, updated_at: asset.updated_at, place: transfer.to_place, custody_status: 'At location',
        ...(outcome === 'Received damaged' ? { condition: 'Damaged' } : {}) })
    else if (outcome === 'Returned to source')
      await ctx.documents.update('equipment.asset', { row_id: asset.row_id, updated_at: asset.updated_at, place: transfer.from_place, custody_status: 'At location' })
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
    return ctx.documents.update('equipment.transfer', { row_id: transfer.row_id, updated_at: transfer.updated_at, finance_reference: request.sap_reference.trim(),
      finance_confirmed_at: new Date().toISOString(), finance_confirmed_by: ctx.user })
  },
}
