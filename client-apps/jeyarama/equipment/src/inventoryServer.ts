import { withinPlace } from './countRules'
import { GROUP_OWNED, isTag, recountSample, rollOf } from './tagRules'
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

/**
 * Validators don't see roles, and a refused read refuses the whole save. Assets Managers can read the
 * expected lists, so this is asked only on paths where anyone else is refused anyway.
 */
const isManager = async (ctx: Context) => (await ctx.documents.members('equipment.count_expected')).some(person => person.row_id === ctx.user)
/** Who acts as asset accountant or finance controller: the pilot's named Finance people, readable by all. */
async function actsAs(ctx: Context, role: 'Asset accountant' | 'Finance controller') {
  return (await all(ctx.documents, 'equipment.finance_person', [['person', '=', ctx.user], ['finance_role', '=', role]], ['row_id'])).length > 0
}
const isAccountant = (ctx: Context) => actsAs(ctx, 'Asset accountant')
const isController = (ctx: Context) => actsAs(ctx, 'Finance controller')

const instant = (value: unknown) => value instanceof Date ? value.toISOString() : String(value)
/** The calendar day in IST, the platform's display zone. */
export const istDay = (value: unknown) => new Date(Date.parse(instant(value)) + 330 * 60_000).toISOString().slice(0, 10)
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)
const money = (value: unknown) => value === null || value === undefined || value === '' ? null : Number(value).toFixed(2)
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const counterIds = async (documents: Documents, count: unknown) =>
  (await all(documents, 'equipment.counter', [['count', '=', count]], ['person'])).map(row => String(row.person))

async function placeTree(documents: Documents) {
  return (await all(documents, 'equipment.place', [], ['row_id', 'parent_place', 'place_name', 'site_manager']))
}
function siteOf(places: Row[], id: unknown): Row | undefined {
  let place = places.find(p => p.row_id === id)
  for (let hops = 0; place?.parent_place && hops < 10; hops++) place = places.find(p => p.row_id === place!.parent_place)
  return place
}
const parents = (places: Row[]) => places.map(p => ({ row_id: String(p.row_id), parent_place: (p.parent_place as string) ?? null }))

async function areaClosedToday(ctx: Context, count: unknown, area: unknown) {
  const closes = await all(ctx.documents, 'equipment.area_close', [['count', '=', count], ['area', '=', area]], ['close_day'])
  return closes.some(close => String(close.close_day).slice(0, 10) === istDay(ctx.now) || instant(close.close_day).slice(0, 10) === istDay(ctx.now))
}

/** A tag is from an issued roll, not spoiled, and on no other count line or asset. */
async function checkNewTag(ctx: Context, tag: string, table: string) {
  const rolls = await all(ctx.documents, 'equipment.tag_roll', [], ['row_id', 'first_no', 'last_no'])
  if (!rollOf(rolls.map(r => ({ row_id: String(r.row_id), first_no: Number(r.first_no), last_no: Number(r.last_no) })), tag)) ctx.reject(`${tag} is not on an issued tag roll`)
  const spoiled = await all(ctx.documents, 'equipment.tag_event', [['tag_no', '=', tag]], ['event_kind'])
  if (spoiled.some(event => event.event_kind === 'Spoiled' || event.event_kind === 'Skipped')) ctx.reject(`${tag} was spoiled; tag numbers are never reused`)
  for (const other of ['equipment.count_line', 'equipment.asset']) {
    const taken = await all(ctx.documents, other, [['tag_no', '=', tag]], ['row_id'])
    // A line's own register asset carries its tag too.
    if (taken.some(row => !(other === table && row.row_id === ctx.row.row_id) && !(other === 'equipment.asset' && row.row_id === ctx.row.asset)))
      ctx.reject(`${tag} is already on another asset; tag numbers are never reused`)
  }
}

/** The register: a tag, once set, never changes, and the class follows the type. */
export async function prepareAsset(ctx: Context): Promise<void> {
  const { row, old } = ctx
  if (row.asset_type) row.asset_class = (await ctx.documents.get('equipment.asset_type', String(row.asset_type))).asset_class ?? null
  const tag = text(row.tag_no) || null
  row.tag_no = tag
  if (old?.tag_no && tag !== old.tag_no) ctx.reject('A tag number never changes', { tag_no: 'Keep the tag number' })
  if (tag && !isTag(tag)) ctx.reject('A tag is JRA- and six digits, as printed on the roll', { tag_no: 'Type it as JRA-000123' })
  if (tag && tag !== (old?.tag_no ?? null)) {
    const lines = await all(ctx.documents, 'equipment.count_line', [['tag_no', '=', tag]], ['row_id'])
    const assets = await all(ctx.documents, 'equipment.asset', [['tag_no', '=', tag]], ['row_id'])
    // Loading the register carries a counted line's tag onto its new asset.
    if (assets.some(asset => asset.row_id !== row.row_id) || lines.length > 1) ctx.reject(`${tag} is already on another asset; tag numbers are never reused`)
  }
  if (!row.tag_status) row.tag_status = tag ? 'Tagged' : 'Needs a tag'
}

/** The count sheet: a JRA tag from an issued roll, the four labels, Finance-only fields, two initials, and the recount. */
export async function prepareCountLine(ctx: Context): Promise<void> {
  const { row, old } = ctx
  const finance = (await isAccountant(ctx)) || (await isController(ctx))
  for (const field of ['control_category', 'tag_approved'])
    if (!same(row[field] || null, old?.[field] || null) && !finance) ctx.reject('Only Finance sets the control category and book value')
  if (money(row.book_value) !== money(old?.book_value) && !finance) ctx.reject('Only Finance sets the control category and book value')
  for (const field of ['sap_asset_no', 'sap_asset_sub', 'asset'])
    if (!same(row[field], old?.[field]) && !finance && !(await isManager(ctx))) ctx.reject('Matching and loading the register set these')

  if (row.asset_type) row.asset_class = (await ctx.documents.get('equipment.asset_type', String(row.asset_type))).asset_class ?? null
  const status = String(row.tag_status || 'Tagged')
  row.tag_status = status
  const tag = text(row.tag_no) || null
  row.tag_no = tag
  if (old?.tag_no && tag !== old.tag_no) ctx.reject('A tag number never changes', { tag_no: 'Keep the tag number' })
  if (status !== 'Tagged' && tag) ctx.reject('Only a tagged line carries a tag', { tag_no: 'Leave the tag empty' })
  row.ownership = row.ownership || GROUP_OWNED
  if (row.ownership !== GROUP_OWNED) {
    if (!text(row.owner_name)) ctx.reject('Name the owner of a third-party item', { owner_name: 'Name the owner' })
    if (status === 'Tagged' && !row.tag_approved) ctx.reject('A third-party item carries no group tag unless Finance approves')
  }
  if (status === 'Tagged') {
    if (!tag) ctx.reject('Give the tag number', { tag_no: 'Scan or type the tag' })
    if (!isTag(tag)) ctx.reject('A tag is JRA- and six digits, as printed on the roll', { tag_no: 'Type it as JRA-000123' })
    if (tag !== (old?.tag_no ?? null)) await checkNewTag(ctx, tag!, 'equipment.count_line')
  }
  if (!(Number(row.quantity ?? 1) >= 1)) ctx.reject('A line counts at least one item', { quantity: 'Give the quantity' })

  if (old && !same(old.count, row.count)) ctx.reject('A count line stays in its count')
  const count = await ctx.documents.get('equipment.count', String(row.count))
  if (count.count_kind !== 'Fresh inventory') ctx.reject('Count lines belong to a fresh inventory count')
  const counters = await counterIds(ctx.documents, row.count)

  // The independent recount: only flagged lines, recorded by someone outside the count team.
  if (!same(row.recount_result, old?.recount_result)) {
    if (!old?.for_recount) ctx.reject('This line is not in the recount')
    if (counters.includes(ctx.user) || [old?.tagged_by, old?.recorded_by].includes(ctx.user)) ctx.reject('Someone outside the count team recounts')
    Object.assign(row, { recounted_by: ctx.user, recounted_at: ctx.now })
  } else Object.assign(row, { recounted_by: old?.recounted_by ?? null, recounted_at: old?.recounted_at ?? null })
  if (!same(Boolean(row.for_recount), Boolean(old?.for_recount)) && !(await isManager(ctx))) ctx.reject('Only an Assets Manager starts the independent recount')

  if (ctx.isNew) {
    if (count.count_state !== 'Counting') ctx.reject('This count is not counting')
    if (!counters.includes(ctx.user)) ctx.reject('Only this count’s team records lines')
    if (!row.tagged_by || row.tagged_by === ctx.user || !counters.includes(String(row.tagged_by)))
      ctx.reject('Both team members initial: choose the other team member who tagged it', { tagged_by: 'Choose who tagged it' })
    const places = await placeTree(ctx.documents)
    if (!withinPlace(String(row.place), String(count.scope_place), parents(places))) ctx.reject('Record lines only in the place being counted', { place: 'Choose an area inside the counted site' })
    if (await areaClosedToday(ctx, row.count, row.place)) ctx.reject(`${String(places.find(p => p.row_id === row.place)?.place_name ?? 'This area')} is closed for today`)
    Object.assign(row, { recorded_by: ctx.user, counted_at: ctx.now, for_recount: false })
    return
  }
  for (const field of ['recorded_by', 'counted_at', 'tagged_by']) row[field] = old?.[field] ?? null
  if (!same(row.place, old?.place) || !same(row.asset_type, old?.asset_type) || !same(row.asset_name, old?.asset_name) || !same(row.serial_no, old?.serial_no)
      || !same(row.condition, old?.condition) || !same(row.make, old?.make) || !same(row.model, old?.model) || !same(row.quantity, old?.quantity) || !same(row.tag_no, old?.tag_no)) {
    const ownLine = [old?.recorded_by, old?.tagged_by].includes(ctx.user) && count.count_state === 'Counting' && !(await areaClosedToday(ctx, row.count, old?.place))
    if (!ownLine) ctx.reject('Only the team who recorded this line changes it, until the area is closed')
  }
}

/** A spoiled, skipped or reprinted tag is logged once, with its reason. */
export async function prepareTagEvent(ctx: Context): Promise<void> {
  const { row } = ctx
  if (!ctx.isNew) ctx.reject('A tag event is kept as it was logged')
  const tag = text(row.tag_no)
  row.tag_no = tag
  if (!isTag(tag)) ctx.reject('A tag is JRA- and six digits, as printed on the roll', { tag_no: 'Type it as JRA-000123' })
  if (!text(row.reason)) ctx.reject('Give the reason', { reason: 'Say what happened' })
  const used = [...await all(ctx.documents, 'equipment.count_line', [['tag_no', '=', tag]], ['row_id']), ...await all(ctx.documents, 'equipment.asset', [['tag_no', '=', tag]], ['row_id'])]
  if (row.event_kind === 'Reprinted' && !used.length) ctx.reject(`${tag} is not on an asset yet; only a used tag is reprinted`)
  if (row.event_kind !== 'Reprinted' && used.length) ctx.reject(`${tag} is on an asset; log a reprint instead`)
}

/** Tag rolls cover a range of numbers that no other roll covers. */
export async function prepareTagRoll(ctx: Context): Promise<void> {
  const { row } = ctx
  const first = Number(row.first_no), last = Number(row.last_no)
  if (!(first >= 1 && last >= first && last <= 999999)) ctx.reject('A roll runs from its first number to a later one, up to 999999')
  if (ctx.old && (Number(ctx.old.first_no) !== first || Number(ctx.old.last_no) !== last)) ctx.reject('A roll keeps its numbers')
  const rolls = await all(ctx.documents, 'equipment.tag_roll', [], ['row_id', 'roll_name', 'first_no', 'last_no'])
  const overlap = rolls.find(roll => roll.row_id !== row.row_id && Number(roll.first_no) <= last && first <= Number(roll.last_no))
  if (overlap) ctx.reject(`These numbers overlap ${String(overlap.roll_name)}`)
}

/** The site manager signs an area's day when the labels used equal its tagged lines and spoiled labels. */
export async function prepareAreaClose(ctx: Context): Promise<void> {
  const { row } = ctx
  if (!ctx.isNew) ctx.reject('A signed area close is kept as it was')
  const places = await placeTree(ctx.documents)
  const area = places.find(p => p.row_id === row.area)
  if (!area) ctx.reject('Choose the area')
  const site = siteOf(places, row.area)
  if (!site?.site_manager || site.site_manager !== ctx.user) ctx.reject('Only the site manager signs an area')
  const today = istDay(ctx.now)
  if (await areaClosedToday(ctx, row.count, row.area)) ctx.reject(`${String(area!.place_name)} is already signed for today`)
  const lines = (await all(ctx.documents, 'equipment.count_line', [['count', '=', row.count], ['place', '=', row.area]], ['tag_status', 'counted_at']))
    .filter(line => istDay(line.counted_at) === today)
  const events = (await all(ctx.documents, 'equipment.tag_event', [['count', '=', row.count], ['area', '=', row.area]], ['event_kind', 'created_at']))
    .filter(event => event.event_kind !== 'Reprinted' && istDay(event.created_at) === today)
  const tagged = lines.filter(line => line.tag_status === 'Tagged').length
  const labels = Number(row.labels_used)
  if (labels !== tagged + events.length)
    ctx.reject(`${plural(labels, 'label')} used, but ${plural(tagged, 'tagged line')} and ${plural(events.length, 'spoiled label')}: find the difference before signing`, { labels_used: 'Count the labels used again' })
  Object.assign(row, { close_day: today, tagged_lines: tagged, other_lines: lines.length - tagged, spoiled: events.length, signed_by: ctx.user, signed_at: ctx.now })
}

/** During a fresh count's freeze dates, moving anything into or out of its site needs the site manager's note. */
export async function checkFreeze(ctx: Context): Promise<void> {
  const { row, old } = ctx
  const places = await placeTree(ctx.documents)
  const sites = [siteOf(places, row.from_place), siteOf(places, row.to_place)].filter(Boolean) as Row[]
  const note = text(row.freeze_note)
  row.freeze_note = note || null
  if (note !== text(old?.freeze_note)) {
    if (note && !sites.some(site => site.site_manager === ctx.user)) ctx.reject('Only the site manager writes the freeze note')
    row.freeze_note_by = note ? ctx.user : null
  } else row.freeze_note_by = old?.freeze_note_by ?? null
  const moving = ctx.isNew || (row.transfer_state !== old?.transfer_state && ['Approved', 'Dispatched'].includes(String(row.transfer_state)))
  if (!moving || note) return
  const today = istDay(ctx.now)
  const counts = await all(ctx.documents, 'equipment.count', [['count_kind', '=', 'Fresh inventory']], ['scope_place', 'count_state', 'freeze_from', 'freeze_to'])
  for (const count of counts) {
    if (count.count_state === 'Closed' || !count.freeze_from || !count.freeze_to) continue
    const from = instant(count.freeze_from).slice(0, 10), to = instant(count.freeze_to).slice(0, 10)
    const site = siteOf(places, count.scope_place)
    if (from <= today && today <= to && sites.some(s => s.row_id === site?.row_id))
      ctx.reject(`${String(site?.place_name)} is in its count freeze; the site manager’s written note is needed`, { freeze_note: 'The site manager writes why it may move' })
  }
}

/** Only an asset accountant who did not count matches; a description match needs a second person's check. */
export async function prepareSapMatch(ctx: Context): Promise<void> {
  const { row, old } = ctx
  if (!ctx.isNew) {
    for (const field of ['sap_book', 'line', 'method', 'second_checker', 'matched_by', 'matched_at'])
      if (!same(instant(row[field]), instant(old?.[field]))) ctx.reject('A match is kept as it was made; only its check is added')
    if (row.checked && !old?.checked && ctx.user !== old?.second_checker) ctx.reject('Only the named second person checks this match')
    if (!row.checked && old?.checked) ctx.reject('A check stays recorded')
    return
  }
  if (row.method === 'Description, place and date') {
    if (!row.second_checker) ctx.reject('A match by description, place and date needs a second person to check it', { second_checker: 'Choose who checks it' })
    if (row.second_checker === ctx.user) ctx.reject('Someone other than the matcher checks it')
  }
  const line = await ctx.documents.get('equipment.count_line', String(row.line))
  const tag = String(line.tag_no ?? line.asset_name)
  if ([line.tagged_by, line.recorded_by].includes(ctx.user) || (await counterIds(ctx.documents, line.count)).includes(ctx.user))
    ctx.reject(`The count team never matches: you are on the team that counted ${tag}`)
  const earlier = await all(ctx.documents, 'equipment.sap_match', [['line', '=', row.line]], ['sap_book'])
  if (earlier.length) {
    const record = await ctx.documents.get('equipment.sap_book', String(earlier[0].sap_book))
    ctx.reject(`${tag} is already matched to ${String(record.sap_asset_no)}-${String(record.sap_asset_sub ?? '0')}`)
  }
  Object.assign(row, { matched_by: ctx.user, matched_at: ctx.now, checked: false })
}

const EXCEPTION_STAGES: Record<string, string[]> = { Open: ['Approved', 'Closed'], Approved: ['Closed'], Closed: [] }

/** Only a Finance Controller who raised nothing, counted nothing and is not an asset accountant approves. */
export async function prepareException(ctx: Context): Promise<void> {
  const { row, old } = ctx
  if (ctx.isNew) {
    Object.assign(row, { raised_by: ctx.user, exception_state: 'Open', approved_by: null, approved_at: null })
    return
  }
  for (const field of ['raised_by', 'approved_by', 'approved_at']) row[field] = old?.[field] ?? null
  const before = String(old?.exception_state), after = String(row.exception_state)
  if (before === after) return
  if (!EXCEPTION_STAGES[before]?.includes(after)) ctx.reject(`An ${before.toLowerCase()} exception can’t become ${after}`)
  if (after !== 'Approved') return
  if (!(await isController(ctx)) || (await isAccountant(ctx))) ctx.reject('Only a Finance Controller approves; an asset accountant never approves')
  if (old?.raised_by === ctx.user) ctx.reject('Nobody approves an exception they raised')
  if (!text(row.approval_ref)) ctx.reject('Give the approval reference', { approval_ref: 'Give the reference' })
  if (row.line) {
    const line = await ctx.documents.get('equipment.count_line', String(row.line))
    if ([line.tagged_by, line.recorded_by].includes(ctx.user)) ctx.reject('Nobody approves their own work: you counted this item')
  }
  Object.assign(row, { approved_by: ctx.user, approved_at: ctx.now })
}

interface ActionContext {
  user: string
  roles: readonly string[]
  payload: unknown
  documents: Documents & { create(table: string, values: Row): Promise<Row>; update(table: string, values: Row): Promise<Row> }
  reject(message: string, fields?: Record<string, string>): never
}

export const inventoryActions = {
  /** Link one SAP record to one or more count lines, then copy its number and share of book value to them. */
  async match_sap(ctx: ActionContext) {
    if (!ctx.roles.includes('Assets Accountant')) ctx.reject('Only an asset accountant matches SAP records')
    const request = ctx.payload as { sap_book?: unknown; lines?: unknown; method?: unknown; second_checker?: unknown } | null
    if (!request || typeof request.sap_book !== 'string' || !Array.isArray(request.lines) || !request.lines.length || typeof request.method !== 'string')
      ctx.reject('Choose the SAP record, its tags and how they were matched')
    const record = await ctx.documents.get('equipment.sap_book', request.sap_book)
    for (const line of request.lines as unknown[])
      await ctx.documents.create('equipment.sap_match', { sap_book: record.row_id, line: String(line), method: request.method, second_checker: request.second_checker || null })
    const matched = await all(ctx.documents, 'equipment.sap_match', [['sap_book', '=', record.row_id]], ['line'])
    const share = Number(record.book_value ?? 0) / Math.max(1, Number(record.quantity ?? 1))
    for (const id of request.lines as unknown[]) {
      const line = await ctx.documents.get('equipment.count_line', String(id))
      await ctx.documents.update('equipment.count_line', {
        row_id: line.row_id, updated_at: line.updated_at, sap_asset_no: record.sap_asset_no, sap_asset_sub: record.sap_asset_sub ?? '0',
        book_value: share.toFixed(2), control_category: line.control_category || 'Capital asset in SAP',
      })
    }
    return { matched: matched.length }
  },

  /** The independent recount, on the Finance Controller's threshold: every tagged line over it and a sample of the rest. */
  async start_recount(ctx: ActionContext) {
    if (!ctx.roles.some(role => role === 'Assets Manager' || role === 'System Manager')) ctx.reject('Only an Assets Manager starts the independent recount')
    const request = ctx.payload as { count?: unknown } | null
    if (!request || typeof request.count !== 'string') ctx.reject('Choose the fresh count to recount')
    const count = await ctx.documents.get('equipment.count', request.count)
    if (count.count_kind !== 'Fresh inventory') ctx.reject('Recount a fresh inventory count')
    const site = await ctx.documents.get('equipment.place', String(count.scope_place))
    const [setting] = await all(ctx.documents, 'equipment.control_setting', [['site', '=', count.scope_place]], ['recount_threshold', 'recount_percent'])
    if (!setting?.recount_threshold) ctx.reject(`Set the recount threshold for ${String(site.place_name)} first`)
    const lines = await all(ctx.documents, 'equipment.count_line', [['count', '=', count.row_id], ['tag_status', '=', 'Tagged']], ['row_id', 'updated_at', 'book_value', 'for_recount'])
    if (lines.some(line => line.for_recount)) ctx.reject('This count’s recount has already started')
    const picked = recountSample(lines.map(line => ({ row_id: String(line.row_id), book_value: line.book_value as string })),
      { percent: Number(setting.recount_percent || 10), threshold: Number(setting.recount_threshold) }, Math.random)
    for (const id of picked) {
      const line = lines.find(l => l.row_id === id)!
      await ctx.documents.update('equipment.count_line', { row_id: line.row_id, updated_at: line.updated_at, for_recount: true })
    }
    return { sampled: picked.length }
  },

  /** Phase 7: the group's counted lines become register assets, with their tags, labels and SAP numbers. */
  async load_register(ctx: ActionContext) {
    if (!ctx.roles.some(role => role === 'Assets Manager' || role === 'System Manager')) ctx.reject('Only an Assets Manager loads the register')
    const request = ctx.payload as { count?: unknown } | null
    if (!request || typeof request.count !== 'string') ctx.reject('Choose the fresh count to load')
    const lines = await all(ctx.documents, 'equipment.count_line', [['count', '=', request.count]], ['row_id'])
    let loaded = 0
    for (const { row_id } of lines) {
      const line = await ctx.documents.get('equipment.count_line', String(row_id))
      // Third-party items are recorded but are not group property.
      if (line.asset || line.ownership !== GROUP_OWNED || line.tag_status === 'Third-party, not tagged') continue
      const asset = await ctx.documents.create('equipment.asset', {
        asset_name: line.asset_name, asset_type: line.asset_type, place: line.place, tag_no: line.tag_no ?? null, tag_status: line.tag_status,
        make: line.make ?? null, model: line.model ?? null, serial_no: line.serial_no ?? null, condition: line.condition ?? 'Working',
        usage: line.usage ?? null, ownership: line.ownership, quantity: line.quantity ?? 1, custodian: line.custodian ?? null, photo: line.photo ?? null,
        control_category: line.control_category ?? null, book_value: line.book_value ?? null, sap_asset_no: line.sap_asset_no ?? null, sap_asset_sub: line.sap_asset_sub ?? null,
        book_status: line.sap_asset_no ? 'Capitalized' : 'Not yet in SAP',
      })
      await ctx.documents.update('equipment.count_line', { row_id: line.row_id, updated_at: line.updated_at, asset: asset.row_id })
      loaded++
    }
    return { loaded }
  },
}
