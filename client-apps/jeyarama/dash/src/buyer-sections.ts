// #1246: a category head moves subcategories between their own Buyer Sections; the master data team decides.
// A move is a proposal on the subcategory's Buyer Section Subcategory row (a new row when no desk buys it
// yet), so the approval path versions it as it does Section Subcategory. Desks themselves (their buyer,
// their name) are the master data team's, as a department in use is (department-setup.ts).
import { istToday } from './report.ts'
import { exact, holdsOn, text } from './values.ts'
import { FALLBACK_ROLE, MASTER_DATA_TEAM, OPEN, T, all, byId, freeId, list, myEmployees, unique,
  type ActionContext, type ChangeProposal, type ReadContext, type Row } from './my-sections.ts'
import { BUYER_LINK_FIELDS, BUYER_SECTION, BUYER_SECTION_FIELDS, BUYER_SECTION_SUBCATEGORY, openBuyerSections } from './buyers.ts'

export const BUYER_MOVE = 'buyer_section_move'
const KIND = 'buyer_section'
const MERCHANDISE = 'Merchandise Assignment'
const HEAD_FIELDS = ['employee', 'responsibility', 'division', 'subdivision', 'category', 'subcategory', 'operating_region', 'starts_on', 'ends_on']
const LEVELS = ['subcategory', 'category', 'subdivision', 'division'] as const
/** Who decides: the master data team, always (a category head has no manager on record). */
const APPROVERS = { people: [] as string[], fallbackRoles: [FALLBACK_ROLE] }
const APPLIED_UNREVIEWED = 'Not yet reviewed'

interface About { kind: typeof KIND; subcategory: string; subcategory_name: string; region: string; from_section: string; from: string; to_section: string; to: string
  maker_name: string; link: string }
const about = (p: ChangeProposal) => (p.about ?? {}) as unknown as About
export const isBuyerMove = (p: ChangeProposal) => (p.about as Record<string, unknown> | null)?.kind === KIND

type Ctx = ReadContext | ActionContext

/** The caller's employee ids, and whether they head `subcategory` in `region` today: an open head row
 *  (category head or above) whose deepest level covers it, in that region or in every region. */
async function headsIt(ctx: Ctx, employees: string[], sub: Row, region: string, today: string): Promise<boolean> {
  // Never empty: each caller has already found the desk's category head among them.
  const rows = (await all(ctx, MERCHANDISE, HEAD_FIELDS, [['employee', 'in', employees]]))
    .filter(r => holdsOn(r, today) && text(r.responsibility) !== 'Buyer' && (!exact(r.operating_region) || exact(r.operating_region) === region))
  return rows.some(r => {
    const level = LEVELS.find(l => exact(r[l]))
    if (!level) return text(r.responsibility) === 'Merchandising head'
    return level === 'subcategory' ? exact(r.subcategory) === exact(sub.row_id) : exact(r[level]) === exact(sub[level])
  })
}

/** Hold still what a head's authority over `subcategory` rests on, before any desk or link: their staff rows,
 *  their open head rows, and the subcategory; then re-read who they are. Order everywhere: Employee,
 *  Merchandise Assignment, Subcategory, Buyer Section, Buyer Section Subcategory. */
async function lockAuthority(ctx: ActionContext, person: string, subcategory: string): Promise<string[]> {
  const employees = (await list(ctx, T.employee, ['status', 'person'], [['person', '=', person]])).map(e => exact(e.row_id)).sort()
  for (const id of employees) await ctx.changeProposals.lockRow(T.employee, id)
  const heads = employees.length ? (await all(ctx, MERCHANDISE, HEAD_FIELDS, [['employee', 'in', employees]])).filter(r => text(r.responsibility) !== 'Buyer').map(r => exact(r.row_id)).sort() : []
  for (const id of heads) await ctx.changeProposals.lockRow(MERCHANDISE, id)
  if (subcategory) await ctx.changeProposals.lockRow(T.subcategory, subcategory)
  return (await list(ctx, T.employee, ['status', 'person'], [['person', '=', person], ['status', '=', 'Current']])).map(e => exact(e.row_id))
}

/** The open link for `subcategory` in `region`, if a desk buys it there. */
async function linkIn(ctx: Ctx, subcategory: string, region: string, today: string): Promise<{ link: Row; desk: Row } | null> {
  const links = (await all(ctx, BUYER_SECTION_SUBCATEGORY, BUYER_LINK_FIELDS, [['subcategory', '=', subcategory]])).filter(l => holdsOn(l, today))
  if (!links.length) return null
  const desks = byId(await all(ctx, BUYER_SECTION, BUYER_SECTION_FIELDS, [['row_id', 'in', unique(links.map(l => exact(l.buyer_section)))]]))
  for (const link of links) {
    const desk = desks.get(exact(link.buyer_section))
    if (desk && holdsOn(desk, today) && exact(desk.operating_region) === region) return { link, desk }
  }
  return null
}

/** A link for `subcategory` in `region` set to start after `today`: an open-ended row made today would overlap it
 *  (as scheduledLater guards Section Subcategory). */
async function laterLink(ctx: Ctx, subcategory: string, region: string, today: string): Promise<Row | null> {
  const later = (await all(ctx, BUYER_SECTION_SUBCATEGORY, BUYER_LINK_FIELDS, [['subcategory', '=', subcategory]])).filter(l => (exact(l.starts_on) || '').slice(0, 10) > today)
  if (!later.length) return null
  const desks = byId(await all(ctx, BUYER_SECTION, BUYER_SECTION_FIELDS, [['row_id', 'in', unique(later.map(l => exact(l.buyer_section)))]]))
  const found = later.find(l => exact(desks.get(exact(l.buyer_section))?.operating_region) === region)
  return found ? desks.get(exact(found.buyer_section))! : null
}

async function openMoves(ctx: Ctx, makers?: string[]): Promise<ChangeProposal[]> {
  const found: ChangeProposal[] = []
  for (let start = 0; ; start += 500) {
    const page = await ctx.changeProposals.list({ states: OPEN, limit: 500, start, ...(makers ? { makers } : {}) })
    found.push(...page.filter(isBuyerMove))
    if (page.length < 500) return found
  }
}

const SUB_FIELDS = ['subcategory', 'category', 'subdivision', 'division', 'subcategory_type']
const LEVEL_OF: Record<string, string> = { subcategory: 'row_id', category: 'category', subdivision: 'subdivision', division: 'division' }

export const buyerSectionReads = {
  /** A category head's desks (they are its category head), what each buys, what in their categories no
   *  desk buys yet, and their moves waiting for a decision. */
  async buyer_sections(ctx: ReadContext) {
    const today = istToday()
    const employees = (await myEmployees(ctx)).map(e => exact(e.row_id))
    const open = employees.length ? await openBuyerSections(ctx, today) : null
    if (!open || !open.sections.size) return { desks: [], unplaced: [], waiting: [], decided: [] }
    const desks = [...open.sections.values()].filter(d => employees.includes(exact(d.category_head)))
    if (!desks.length) return { desks: [], unplaced: [], waiting: [], decided: [] }
    const people = byId(await all(ctx, T.employee, ['name', 'status'], [['row_id', 'in', unique(desks.map(d => exact(d.buyer)))]]))
    const codes = unique(open.links.map(l => exact(l.subcategory)))
    const names = codes.length ? byId(await all(ctx, T.subcategory, ['subcategory'], [['row_id', 'in', codes]])) : new Map<string, Row>()
    // What in their categories no desk of that region buys: from their own head rows.
    const heads = (await all(ctx, MERCHANDISE, HEAD_FIELDS, [['employee', 'in', employees]])).filter(r => holdsOn(r, today) && text(r.responsibility) !== 'Buyer')
    const unplaced = new Map<string, { code: string; name: string; region: string }>()
    for (const region of unique(desks.map(d => exact(d.operating_region)))) {
      for (const head of heads.filter(h => !exact(h.operating_region) || exact(h.operating_region) === region)) {
        const level = LEVELS.find(l => exact(head[l]))
        if (!level) continue
        for (const s of await all(ctx, T.subcategory, SUB_FIELDS, [[LEVEL_OF[level], '=', exact(head[level])], ['subcategory_type', '=', 'Merchandise']])) {
          const covered = open.links.some(l => exact(l.subcategory) === exact(s.row_id) && exact(open.sections.get(exact(l.buyer_section))?.operating_region) === region)
          if (!covered) unplaced.set(`${region}|${exact(s.row_id)}`, { code: exact(s.row_id), name: text(s.subcategory), region })
        }
      }
    }
    // What the master data team decided on my recent moves, and why (the last 30 days).
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)
    const decided = (await ctx.changeProposals.list({ makers: [ctx.user], limit: 200 })).filter(p => isBuyerMove(p) && !OPEN.includes(p.state) && (p.decided_at ?? '').slice(0, 10) >= since)
      .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)) || b.row_id.localeCompare(a.row_id))
      .map(p => ({ id: p.row_id, subcategory: about(p).subcategory, subcategory_name: about(p).subcategory_name, from: about(p).from || null, to: about(p).to,
        state: p.state, reason: p.decision_reason, decided_on: String(p.decided_at).slice(0, 10) }))
    const waiting = (await openMoves(ctx, [ctx.user])).map(p => ({ id: p.row_id, subcategory: about(p).subcategory, subcategory_name: about(p).subcategory_name, region: about(p).region,
      from: about(p).from || null, to: about(p).to, applied: p.state === APPLIED_UNREVIEWED, waiting_for: MASTER_DATA_TEAM }))
    return {
      desks: desks.map(d => {
        const buyer = exact(d.buyer) ? people.get(exact(d.buyer)) : undefined
        return { id: exact(d.row_id), name: text(d.name), region: exact(d.operating_region),
          buyer: buyer && text(buyer.status) === 'Current' ? { code: exact(d.buyer), name: text(buyer.name) } : null,
          subcategories: open.links.filter(l => exact(l.buyer_section) === exact(d.row_id)).map(l => ({ code: exact(l.subcategory), name: text(names.get(exact(l.subcategory))?.subcategory), link: exact(l.row_id) }))
            .sort((a, b) => a.code.localeCompare(b.code)) }
      }).sort((a, b) => a.subcategories.length - b.subcategories.length || a.name.localeCompare(b.name)),
      unplaced: [...unplaced.values()].sort((a, b) => a.name.localeCompare(b.name)),
      waiting,
      decided,
    }
  },

  /** The moves the caller may decide: the master data team's list. */
  async buyer_section_approvals(ctx: ReadContext) {
    const mine = []
    for (const p of await openMoves(ctx)) if (p.maker !== ctx.user && await ctx.changeProposals.mayDecide(p.maker, APPROVERS)) mine.push(p)
    // #1223's rule: every record shown is a link, so each one carries its id.
    const makers = mine.length ? await all(ctx, T.employee, ['person', 'status'], [['person', 'in', unique(mine.map(p => p.maker))], ['status', '=', 'Current']]) : []
    return mine.sort((a, b) => a.created_at.localeCompare(b.created_at)).map(p => ({ id: p.row_id, who: about(p).maker_name,
      who_code: exact(makers.find(e => exact(e.person) === p.maker)?.row_id) || null, subcategory: about(p).subcategory,
      subcategory_name: about(p).subcategory_name, region: about(p).region, from: about(p).from || null, from_id: about(p).from_section || null, to: about(p).to, to_id: about(p).to_section,
      applied: p.state === APPLIED_UNREVIEWED, asked_on: p.created_at.slice(0, 10) }))
  },
}

/** Why an approval no longer fits what was asked, read under the locks; null when it still does. */
async function whyStale(ctx: ActionContext, p: ChangeProposal, today: string, makerEmployees: string[]): Promise<string | null> {
  const a = about(p)
  const [to] = await list(ctx, BUYER_SECTION, BUYER_SECTION_FIELDS, [['row_id', '=', a.to_section]])
  if (!to || !holdsOn(to, today)) return 'The Buyer Section it would go to has closed.'
  if (exact(to.operating_region) !== a.region) return 'The Buyer Section it would go to is now in another region.'
  const now = await linkIn(ctx, a.subcategory, a.region, today)
  if ((now ? exact(now.link.row_id) : '') !== a.link) return 'That subcategory has since been moved another way.'
  if (await laterLink(ctx, a.subcategory, a.region, today)) return 'That subcategory is set to join another Buyer Section on a later day.'
  const [sub] = await list(ctx, T.subcategory, SUB_FIELDS, [['row_id', '=', a.subcategory]])
  if (!makerEmployees.includes(exact(to.category_head)) || !sub || !(await headsIt(ctx, makerEmployees, sub, a.region, today)))
    return 'The person who asked no longer heads that category.'
  if (now && !makerEmployees.includes(exact(now.desk.category_head))) return 'The Buyer Section it comes from is no longer theirs.'
  return null
}

export const buyerSectionActions = {
  /** Move a subcategory to another of my desks, or put one no desk buys yet into one of them. */
  async move_buyer_subcategory(ctx: ActionContext) {
    const payload = (ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {}) as Record<string, unknown>
    const today = istToday()
    const code = typeof payload.subcategory === 'string' ? payload.subcategory : ''
    const toId = typeof payload.to_section === 'string' ? payload.to_section : ''
    const employees = await myEmployees(ctx)
    const mine = employees.map(e => exact(e.row_id))
    const [seen] = toId ? await list(ctx, BUYER_SECTION, BUYER_SECTION_FIELDS, [['row_id', '=', toId]]) : []
    if (!seen || !holdsOn(seen, today) || !mine.includes(exact(seen.category_head))) ctx.reject('Pick one of your own Buyer Sections')
    const region = exact(seen.operating_region)
    // One change at a time per subcategory and region; then hold still my authority, the desks and the link it rests on.
    await ctx.changeProposals.serialize(`buyer:${region}:${code}`)
    mine.splice(0, mine.length, ...await lockAuthority(ctx, ctx.user, code))
    const before = await linkIn(ctx, code, region, today)
    for (const id of unique([toId, before ? exact(before.desk.row_id) : '']).sort()) await ctx.changeProposals.lockRow(BUYER_SECTION, id)
    if (before) await ctx.changeProposals.lockRow(BUYER_SECTION_SUBCATEGORY, exact(before.link.row_id))
    const [to] = await list(ctx, BUYER_SECTION, BUYER_SECTION_FIELDS, [['row_id', '=', toId]])
    if (!to || !holdsOn(to, today) || !mine.includes(exact(to.category_head))) ctx.reject('Pick one of your own Buyer Sections')
    if (exact(to.operating_region) !== region) ctx.reject('That Buyer Section has just changed. Open the page again')
    const [sub] = code ? await list(ctx, T.subcategory, SUB_FIELDS, [['row_id', '=', code]]) : []
    if (!sub || text(sub.subcategory_type) !== 'Merchandise') ctx.reject('Pick a subcategory from the list')
    if (!(await headsIt(ctx, mine, sub, region, today))) ctx.reject('That subcategory is outside your categories')
    const now = await linkIn(ctx, code, region, today)
    if (now && !mine.includes(exact(now.desk.category_head))) ctx.reject('That subcategory is outside your categories: another head\'s Buyer Section buys it')
    if (now && exact(now.desk.row_id) === toId) ctx.reject(`It is already in ${text(to.name)}`)
    const scheduled = await laterLink(ctx, code, region, today)
    if (scheduled) ctx.reject(`${text(sub.subcategory)} is set to join ${text(scheduled.name)} on a later day. Ask the master data team`)
    if ((await openMoves(ctx)).some(p => about(p).subcategory === code && about(p).region === region)) ctx.reject('A change to that subcategory is already waiting')
    const a: About = { kind: KIND, subcategory: code, subcategory_name: text(sub.subcategory), region, from_section: now ? exact(now.desk.row_id) : '', from: now ? text(now.desk.name) : '',
      to_section: toId, to: text(to.name), maker_name: text(employees[0]?.name), link: now ? exact(now.link.row_id) : '' }
    const proposal = await ctx.changeProposals.propose({ table: BUYER_SECTION_SUBCATEGORY, row: now ? exact(now.link.row_id) : null,
      changes: now ? { buyer_section: toId } : { buyer_section: toId, subcategory: code }, reviewed: now ? ['subcategory'] : [],
      approvers: APPROVERS, about: a as unknown as Record<string, unknown>, type: BUYER_MOVE,
      apply: { effectiveOn: today, newRow: { buyer_section_subcategory_id: await freeId(ctx, BUYER_SECTION_SUBCATEGORY, `${region}-${code}-${today}`), source_key: `Dash, asked ${today}` } } })
    return { id: proposal.row_id, state: proposal.state, waiting_for: MASTER_DATA_TEAM }
  },

  /** The master data team keeps or turns down a move. Approve-first: re-checked under the locks, then applied today. */
  async decide_buyer_section(ctx: ActionContext) {
    const payload = (ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {}) as Record<string, unknown>
    const [p] = typeof payload.proposal === 'string' && payload.proposal ? await ctx.changeProposals.list({ ids: [payload.proposal] }) : []
    if (!p || !isBuyerMove(p) || !OPEN.includes(p.state)) ctx.reject('That change is no longer waiting')
    if (p.maker === ctx.user || !(await ctx.changeProposals.mayDecide(p.maker, APPROVERS))) ctx.reject('Only the master data team decides this')
    if (payload.decision !== 'approve' && payload.decision !== 'reject') ctx.reject('Keep it or turn it down')
    const today = istToday()
    const a = about(p)
    if (payload.decision === 'reject') {
      const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
      if (!reason) ctx.reject('Say why it is turned down')
      const done = p.state === APPLIED_UNREVIEWED ? await ctx.changeProposals.undo(p.row_id, { approvers: APPROVERS, reason }) : await ctx.changeProposals.reject(p.row_id, { approvers: APPROVERS, reason })
      return { state: done.state }
    }
    if (p.state === APPLIED_UNREVIEWED) return { state: (await ctx.changeProposals.confirm(p.row_id, { approvers: APPROVERS })).state }
    await ctx.changeProposals.serialize(`buyer:${a.region}:${a.subcategory}`)
    const makerEmployees = await lockAuthority(ctx, p.maker, a.subcategory)
    for (const id of unique([a.to_section, a.from_section]).sort()) await ctx.changeProposals.lockRow(BUYER_SECTION, id)
    if (a.link) await ctx.changeProposals.lockRow(BUYER_SECTION_SUBCATEGORY, a.link)
    const stale = await whyStale(ctx, p, today, makerEmployees)
    if (stale) return { state: (await ctx.changeProposals.needsFreshReview(p.row_id, { approvers: APPROVERS, reason: stale })).state }
    const decided = await ctx.changeProposals.approve(p.row_id, { approvers: APPROVERS, effectiveOn: today,
      newRow: { buyer_section_subcategory_id: await freeId(ctx, BUYER_SECTION_SUBCATEGORY, `${a.region}-${a.subcategory}-${today}`), source_key: `Dash, approved ${today}` } })
    return { state: decided.state }
  },
}
