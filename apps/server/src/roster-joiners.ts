// New joiners reach the roster (#1297). A roster loaded once misses everyone
// who joined afterwards: no row, so no person, no link and no job. When the
// method's roster names `joiners`, each roster run adds, from the same HR feed
// the status sync reads:
//
// - a roster row for every record the feed shows plainly current (active, not
//   a leaver by the shared rule, on the payroll or a recent joiner) that no row
//   holds, in any status; and
// - that person's primary job, when the settings name a job Table: its site
//   from the record's store, its job from the designation by a whole-word
//   match, its section and manager where the feed and the Tables say so.
//
// Every value a client names (Tables, columns, job titles, how a code is
// built) comes from the settings; the platform names none. A run that would
// add more than the limit adds none and says so. Each row is a normal save by
// the roster link, so it shows in Activity. The link pass then makes the
// person and links them as for any current row.
import { sql, withTransaction } from './db'
import { logActivity } from './audit'
import { saveDoc } from './document'
import { getMeta } from './meta'
import { tableRelation } from './table-engine'
import { runAsSystemActor } from './system-actor'
import { ROSTER_LINK_ACTOR } from './roster-link-actor'
import { feedRefusal, recordVerdict, type EmployeeRecord } from './leaver-check'
import type { Roster } from './roster-first-sign-in'
import { errorMessage } from './errors'

const ACTOR = ROSTER_LINK_ACTOR
/** A run may add at most this share of the roster's current rows... */
const MAX_ADD_SHARE = 0.05
/** ...or this many, whichever is more. */
const MIN_ADD_LIMIT = 10
const COLUMN = /^[a-z][a-z0-9_]*$/

/** The values a template may name, from the feed record and the run. */
type Fields = Record<string, string>

export interface JobSettings {
  table: string
  id_column: string
  id: string
  employee_column: string
  site_column: string
  job_column: string
  /** A whole designation, lower case, to the job it means. */
  jobs: Record<string, string>
  default_job: string
  /** The default job at a site that is not a store, when set. */
  off_store_job: string | null
  /** The feed's store code is this Table's row; its column names the site. */
  site_of_store: { table: string; site_column: string }
  /** A site is a store when this column of its row holds this value. */
  store_site: { table: string; column: string; value: string } | null
  designation_column: string | null
  designation: { table: string; spellings_column: string } | null
  section_column: string | null
  section: { table: string; site_column: string; name_column: string } | null
  /** Jobs that hold a section; others get none. */
  section_jobs: string[]
  reports_to_column: string | null
  /** The roster column holding a manager's code, as the feed names managers. */
  manager_column: string | null
  values: Record<string, string | number | boolean>
}

export interface JoinerSettings {
  /** The roster column that names the row, and the template that fills it. */
  code_column: string
  code: string
  values: Record<string, string | number | boolean>
  job: JobSettings | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The roster's joiner settings, or null when it names none; refuses a malformed block. */
export function joinerSettings(raw: unknown): JoinerSettings | null {
  if (raw === undefined || raw === null) return null
  if (!isObj(raw)) throw new Error('settings.roster.joiners must be an object')
  const at = (o: Record<string, unknown>, path: string) => {
    const str = (key: string, optional = false): string | null => {
      const v = o[key]
      if ((v === undefined || v === null) && optional) return null
      if (typeof v !== 'string' || !v.trim()) throw new Error(`settings.roster.${path}${key} must be a string`)
      return v.trim()
    }
    const column = (key: string, optional = false) => {
      const v = str(key, optional)
      if (v !== null && !COLUMN.test(v)) throw new Error(`settings.roster.${path}${key} must be a column name`)
      return v
    }
    const values = (key: string) => {
      const v = o[key] ?? {}
      if (!isObj(v) || !Object.entries(v).every(([k, x]) => COLUMN.test(k) && ['string', 'number', 'boolean'].includes(typeof x)))
        throw new Error(`settings.roster.${path}${key} must map column names to values`)
      return v as Record<string, string | number | boolean>
    }
    const sub = (key: string) => {
      const v = o[key]
      if (v === undefined || v === null) return null
      if (!isObj(v)) throw new Error(`settings.roster.${path}${key} must be an object`)
      return at(v, `${path}${key}.`)
    }
    return { str, column, values, sub, o }
  }
  const top = at(raw, 'joiners.')
  const settings: JoinerSettings = { code_column: top.column('code_column')!, code: top.str('code')!, values: top.values('values'), job: null }
  const job = top.sub('job')
  if (job) {
    const jobs = job.o.jobs ?? {}
    if (!isObj(jobs) || !Object.values(jobs).every((v) => typeof v === 'string' && v.trim()))
      throw new Error('settings.roster.joiners.job.jobs must map designations to jobs')
    const sos = job.sub('site_of_store')
    if (!sos) throw new Error('settings.roster.joiners.job.site_of_store must be an object')
    const store = job.sub('store_site')
    const desig = job.sub('designation')
    const section = job.sub('section')
    const sectionJobs = job.o.section_jobs ?? []
    if (!Array.isArray(sectionJobs) || !sectionJobs.every((j) => typeof j === 'string'))
      throw new Error('settings.roster.joiners.job.section_jobs must be a list of jobs')
    settings.job = {
      table: job.str('table')!,
      id_column: job.column('id_column')!,
      id: job.str('id')!,
      employee_column: job.column('employee_column')!,
      site_column: job.column('site_column')!,
      job_column: job.column('job_column')!,
      jobs: Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k.trim().toLowerCase(), String(v).trim()])),
      default_job: job.str('default_job')!,
      off_store_job: job.str('off_store_job', true),
      site_of_store: { table: sos.str('table')!, site_column: sos.column('site_column')! },
      store_site: store ? { table: store.str('table')!, column: store.column('column')!, value: store.str('value')! } : null,
      designation_column: job.column('designation_column', true),
      designation: desig ? { table: desig.str('table')!, spellings_column: desig.column('spellings_column')! } : null,
      section_column: job.column('section_column', true),
      section: section ? { table: section.str('table')!, site_column: section.column('site_column')!, name_column: section.column('name_column')! } : null,
      section_jobs: sectionJobs as string[],
      reports_to_column: job.column('reports_to_column', true),
      manager_column: job.column('manager_column', true),
      values: job.values('values'),
    }
  }
  return settings
}

/** `{field}` filled from the fields; a field the record lacks makes the whole value null. */
export function fill(template: string, fields: Fields): string | null {
  let missing = false
  const out = template.replace(/\{([a-z_]+)\}/g, (_, k: string) => {
    const v = fields[k]
    if (v === undefined || v === null || v === '') missing = true
    return v ?? ''
  })
  return missing ? null : out
}

const fillAll = (values: Record<string, string | number | boolean>, fields: Fields) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' ? fill(v, fields) : v]))

/** What a run reads besides the feed: who is on the roster, and the Tables a job links to. */
export interface JoinerFacts {
  /** Every roster row's record number, in any status. */
  records: Set<string>
  /** Every roster row's code, in any status. */
  codes: Set<string>
  /** Every roster row's sign-in ID (lower case), in any status. */
  signInIds: Set<string>
  /** Current rows: how many, and each manager code's one row (null when shared). */
  current: number
  managers: Map<string, string | null>
  siteOfStore: Map<string, string>
  storeSites: Set<string> | null
  designations: Map<string, string>
  /** site + section name (lower case) to the section's row, null when two share it. */
  sections: Map<string, string | null>
  jobIds: Set<string>
}

export type JoinerHeld = 'no_code' | 'code_taken' | 'no_name' | 'sign_in_id_taken' | 'sign_in_id_shared' | 'conflicting_records'
export type JobHeld = 'no_site' | 'id_taken'

export interface PlannedJoiner {
  record: string
  code: string
  /** The roster row's values, without the code column. */
  row: Record<string, unknown>
  /** The job's values, without the employee and manager: those are the saved
   *  rows' ids, known only once saved. */
  job: Record<string, unknown> | null
  job_held: JobHeld | null
  /** Their manager: an existing row, or another joiner this run adds. */
  manager: { row: string } | { record: string } | null
}

export interface JoinerPlan {
  table: string
  joiners: PlannedJoiner[]
  held: { record: string; reason: JoinerHeld }[]
  limit: number
  refused: string | null
}

export interface JoinerRun {
  plan: JoinerPlan | null
  added: number
  jobs: number
  failed: string[]
}

const sectionKey = (site: string, name: string) => `${site}\u0000${name.trim().toLowerCase()}`

/** Is this record plainly current: active, not a leaver by the shared rule,
 *  on the payroll or a recent joiner not yet on it? */
export function isJoinerRecord(r: EmployeeRecord, today: string, feedDay: string | null): boolean {
  const v = recordVerdict(r, today, feedDay)
  // Positive evidence only: active, and on the payroll or a recent joiner. An unknown payroll is neither.
  return !v.leaver && !v.atWork && r.movement_active === true && (r.payroll_active === true || v.recentJoiner)
}

function jobFor(r: EmployeeRecord, code: string, facts: JoinerFacts, job: JobSettings, today: string): { job: Record<string, unknown> | null; held: JobHeld | null } {
  const j = r.joiner!
  const site = j.store_code ? facts.siteOfStore.get(j.store_code) : undefined
  if (!site) return { job: null, held: 'no_site' }
  const designation = (j.designation ?? '').trim().toLowerCase()
  const isStore = !facts.storeSites || facts.storeSites.has(site)
  const title = job.jobs[designation] ?? (!isStore && job.off_store_job ? job.off_store_job : job.default_job)
  const fields: Fields = { ...fieldsOf(r, today), code, site }
  const id = fill(job.id, fields)
  if (!id || facts.jobIds.has(id)) return { job: null, held: 'id_taken' }
  const out: Record<string, unknown> = {
    ...fillAll(job.values, fields),
    [job.id_column]: id,
    [job.site_column]: site,
    [job.job_column]: title,
  }
  if (job.designation_column && designation) out[job.designation_column] = facts.designations.get(designation) ?? null
  if (job.section_column && j.section_name && job.section_jobs.includes(title))
    out[job.section_column] = facts.sections.get(sectionKey(site, j.section_name)) ?? null
  return { job: out, held: null }
}

function fieldsOf(r: EmployeeRecord, today: string): Fields {
  const j = r.joiner ?? ({} as Partial<NonNullable<EmployeeRecord['joiner']>>)
  const f: Fields = { employee_key: r.employee_key, today }
  const put = (k: string, v: string | null | undefined) => {
    if (v) f[k] = v
  }
  put('employee_code', r.employee_code)
  put('date_of_joining', r.date_of_joining)
  put('full_name', j.full_name)
  put('region', j.region)
  put('designation', j.designation)
  return f
}

/** Pure: who this run adds, with their jobs, and whether it must refuse. */
export function planJoinerAdds(
  roster: Roster,
  settings: JoinerSettings,
  records: EmployeeRecord[],
  latestFeedDay: string | null,
  facts: JoinerFacts,
  today: string,
): JoinerPlan {
  const { link } = roster
  const plan: JoinerPlan = { table: link.table, joiners: [], held: [], limit: Math.max(MIN_ADD_LIMIT, Math.ceil(facts.current * MAX_ADD_SHARE)), refused: null }
  plan.refused = feedRefusal(records, latestFeedDay, today)
  if (plan.refused) return plan
  // A record the feed holds more than once must agree with itself, and every copy must qualify.
  const byRecord = new Map<string, EmployeeRecord[]>()
  for (const r of records) {
    const record = String(r.employee_key).trim()
    if (record && !facts.records.has(record)) byRecord.set(record, [...(byRecord.get(record) ?? []), r])
  }
  const signature = (r: EmployeeRecord) => JSON.stringify([r.employee_code, r.joiner, r.payroll_active, r.movement_active, r.date_of_joining])
  const candidates: { record: string; r: EmployeeRecord }[] = []
  for (const [record, copies] of byRecord) {
    if (!copies.every((r) => isJoinerRecord(r, today, latestFeedDay))) continue
    if (new Set(copies.map(signature)).size > 1) {
      plan.held.push({ record, reason: 'conflicting_records' })
      continue
    }
    candidates.push({ record, r: copies[0] })
  }
  // A sign-in ID two joiners share is not guessed between, as the link pass would not.
  const idCount = new Map<string, number>()
  for (const { r } of candidates) if (r.employee_code) idCount.set(r.employee_code.toLowerCase(), (idCount.get(r.employee_code.toLowerCase()) ?? 0) + 1)
  const batchByCode = new Map<string, string | null>()
  for (const { record, r } of candidates) {
    const fields = fieldsOf(r, today)
    const code = fill(settings.code, fields)
    if (!code || !r.employee_code) {
      plan.held.push({ record, reason: 'no_code' })
      continue
    }
    if (!r.joiner?.full_name) {
      plan.held.push({ record, reason: 'no_name' })
      continue
    }
    const signIn = r.employee_code.toLowerCase()
    if (facts.signInIds.has(signIn)) {
      plan.held.push({ record, reason: 'sign_in_id_taken' })
      continue
    }
    if ((idCount.get(signIn) ?? 0) > 1) {
      plan.held.push({ record, reason: 'sign_in_id_shared' })
      continue
    }
    if (facts.codes.has(code.toLowerCase())) {
      plan.held.push({ record, reason: 'code_taken' })
      continue
    }
    const row = {
      ...fillAll(settings.values, { ...fields, code }),
      [link.record_number_column]: record,
      [link.sign_in_id_column]: r.employee_code,
      [link.name_column]: r.joiner.full_name,
      [link.status_column]: link.current_status,
    }
    const job = settings.job ? jobFor(r, code, facts, settings.job, today) : { job: null, held: null }
    plan.joiners.push({ record, code, row, job: job.job, job_held: job.held, manager: null })
    batchByCode.set(signIn, record)
  }
  // Managers: an existing current row, or a joiner this run adds; never one two share.
  const managerColumn = settings.job?.manager_column
  if (settings.job?.reports_to_column && managerColumn) {
    const managerOf = new Map(candidates.map(({ record, r }) => [record, r.joiner?.manager_code?.toLowerCase() ?? null]))
    for (const j of plan.joiners) {
      const m = managerOf.get(j.record)
      if (!m) continue
      const existing = facts.managers.get(m)
      const incoming = batchByCode.get(m)
      if (existing && !incoming) j.manager = { row: existing }
      else if (incoming && !facts.managers.has(m) && incoming !== j.record) j.manager = { record: incoming }
    }
  }
  if (plan.joiners.length > plan.limit)
    plan.refused = `it would add ${plan.joiners.length} new joiners to ${facts.current} current rows, more than the limit of ${plan.limit}`
  return plan
}

async function relationOf(table: string, columns: string[]): Promise<string> {
  const meta = await getMeta(table)
  if (meta.data_source) throw new Error(`${table} lives in an outside source`)
  const have = new Set(meta.columns.map((c) => c.column_name))
  const missing = columns.filter((c) => c !== 'row_id' && !have.has(c))
  if (missing.length) throw new Error(`${table} has no column ${missing.join(', ')}`)
  return tableRelation(table)
}

async function readFacts(roster: Roster, settings: JoinerSettings): Promise<JoinerFacts> {
  const { link } = roster
  const job = settings.job
  const rosterRel = await relationOf(link.table, [settings.code_column, link.record_number_column, link.sign_in_id_column, link.status_column, ...(job?.manager_column ? [job.manager_column] : [])])
  const rows = await sql`select ${sql(settings.code_column)}::text as code, trim(${sql(link.record_number_column)}::text) as record,
      lower(trim(${sql(link.sign_in_id_column)}::text)) as sign_in,
      trim(${sql(link.status_column)}::text) = ${link.current_status} and retired_at is null as current
      ${job?.manager_column ? sql`, lower(trim(${sql(job.manager_column)}::text)) as manager, row_id` : sql``}
    from ${sql(rosterRel)}`
  const facts: JoinerFacts = {
    records: new Set(rows.map((r) => String(r.record ?? '')).filter(Boolean)),
    codes: new Set(rows.map((r) => String(r.code ?? '').toLowerCase()).filter(Boolean)),
    signInIds: new Set(rows.map((r) => String(r.sign_in ?? '')).filter(Boolean)),
    current: rows.filter((r) => r.current).length,
    managers: new Map(),
    siteOfStore: new Map(),
    storeSites: null,
    designations: new Map(),
    sections: new Map(),
    jobIds: new Set(),
  }
  if (!job) return facts
  for (const r of rows)
    if (r.current && r.manager) facts.managers.set(String(r.manager), facts.managers.has(String(r.manager)) ? null : String(r.row_id))
  const plants = await sql`select row_id, ${sql(job.site_of_store.site_column)}::text as site
    from ${sql(await relationOf(job.site_of_store.table, [job.site_of_store.site_column]))} where retired_at is null`
  for (const p of plants) if (p.site) facts.siteOfStore.set(String(p.row_id), String(p.site))
  if (job.store_site) {
    const sites = await sql`select row_id from ${sql(await relationOf(job.store_site.table, [job.store_site.column]))}
      where retired_at is null and ${sql(job.store_site.column)}::text = ${job.store_site.value}`
    facts.storeSites = new Set(sites.map((s) => String(s.row_id)))
  }
  if (job.designation) {
    const ds = await sql`select row_id, ${sql(job.designation.spellings_column)}::text as spellings
      from ${sql(await relationOf(job.designation.table, [job.designation.spellings_column]))} where retired_at is null`
    for (const d of ds)
      for (const s of String(d.spellings ?? '').split(';').map((x) => x.trim().toLowerCase()).filter(Boolean)) facts.designations.set(s, String(d.row_id))
  }
  if (job.section) {
    const ss = await sql`select row_id, ${sql(job.section.site_column)}::text as site, ${sql(job.section.name_column)}::text as name
      from ${sql(await relationOf(job.section.table, [job.section.site_column, job.section.name_column]))} where retired_at is null`
    for (const s of ss) {
      if (!s.site || !s.name) continue
      const k = sectionKey(String(s.site), String(s.name))
      facts.sections.set(k, facts.sections.has(k) ? null : String(s.row_id))
    }
  }
  const ids = await sql`select ${sql(job.id_column)}::text as id from ${sql(await relationOf(job.table, [job.id_column, job.employee_column, job.site_column, job.job_column]))}`
  facts.jobIds = new Set(ids.map((i) => String(i.id)))
  return facts
}

/** What the run would add, changing nothing. Null when the roster names no joiners. */
export async function planJoiners(roster: Roster, feed: { records: EmployeeRecord[]; latestFeedDay: string | null } | { refused: string }, today: string): Promise<JoinerPlan | null> {
  const empty = (refused: string): JoinerPlan => ({ table: roster.link.table, joiners: [], held: [], limit: MIN_ADD_LIMIT, refused })
  let settings: JoinerSettings | null
  try {
    settings = joinerSettings(roster.link.joiners)
  } catch (err) {
    return empty(errorMessage(err))
  }
  if (!settings) return null
  if ('refused' in feed) return empty(feed.refused)
  try {
    return planJoinerAdds(roster, settings, feed.records, feed.latestFeedDay, await readFacts(roster, settings), today)
  } catch (err) {
    return empty(`its Tables could not be read: ${errorMessage(err)}`)
  }
}

/** Add one joiner and their job, under a lock on the record, checked again. */
/** Add one joiner and their job in one transaction, under locks on their
 *  record and sign-in ID, checked again. The job names the saved row's id,
 *  and a manager this run added by theirs. */
async function addOne(roster: Roster, settings: JoinerSettings, j: PlannedJoiner, added: Map<string, string>): Promise<{ row: string | null; job: boolean }> {
  const { link } = roster
  const signIn = String(j.row[link.sign_in_id_column]).toLowerCase()
  return withTransaction(async () => {
    for (const key of [`record:${j.record}`, `sign-in:${signIn}`].sort())
      await sql`select pg_advisory_xact_lock(hashtext(${`roster-joiner:${link.table}:${key}`}))`
    const rel = await tableRelation(link.table)
    const [taken] = await sql`select 1 from ${sql(rel)}
      where trim(${sql(link.record_number_column)}::text) = ${j.record} or lower(${sql(settings.code_column)}::text) = ${j.code.toLowerCase()}
        or lower(trim(${sql(link.sign_in_id_column)}::text)) = ${signIn} limit 1`
    if (taken) return { row: null, job: false }
    const saved = await runAsSystemActor(ACTOR, () => saveDoc(link.table, { ...j.row, [settings.code_column]: j.code }, ACTOR, 'insert'))
    const row = String(saved.row_id)
    const job = settings.job
    if (!j.job || !job) return { row, job: false }
    const manager = j.manager && ('row' in j.manager ? j.manager.row : added.get(j.manager.record))
    await runAsSystemActor(ACTOR, () =>
      saveDoc(job.table, { ...j.job, [job.employee_column]: row, ...(job.reports_to_column && manager ? { [job.reports_to_column]: manager } : {}) }, ACTOR, 'insert'))
    return { row, job: true }
  })
}

/** Managers this run adds come before the joiners who report to them. */
function managersFirst(joiners: PlannedJoiner[]): PlannedJoiner[] {
  const byRecord = new Map(joiners.map((j) => [j.record, j]))
  const out: PlannedJoiner[] = []
  const placed = new Set<string>()
  const visiting = new Set<string>()
  const place = (j: PlannedJoiner) => {
    if (placed.has(j.record) || visiting.has(j.record)) return
    visiting.add(j.record)
    const m = j.manager && 'record' in j.manager ? byRecord.get(j.manager.record) : undefined
    if (m) place(m)
    visiting.delete(j.record)
    placed.add(j.record)
    out.push(j)
  }
  joiners.forEach(place)
  return out
}

/** Act on a plan unless it refuses. `acceptCount` lifts the size limit for
 *  exactly the count a dry run showed; it never lifts a bad feed. */
export async function applyJoiners(roster: Roster, plan: JoinerPlan | null, opts: { acceptCount?: number } = {}): Promise<JoinerRun> {
  const run: JoinerRun = { plan, added: 0, jobs: 0, failed: [] }
  if (!plan) return run
  if (opts.acceptCount !== undefined) {
    if (plan.joiners.length !== opts.acceptCount) plan.refused ??= `it would add ${plan.joiners.length} new joiners, not the ${opts.acceptCount} accepted`
    else if (plan.refused?.startsWith('it would add')) plan.refused = null
  }
  if (plan.refused) {
    await logActivity('system', `roster_joiners_refused ${plan.table}: ${plan.refused}`.slice(0, 140))
    return run
  }
  const settings = joinerSettings(roster.link.joiners)!
  const added = new Map<string, string>()
  for (const j of managersFirst(plan.joiners))
    try {
      const done = await addOne(roster, settings, j, added)
      if (done.row) {
        added.set(j.record, done.row)
        run.added++
        await logActivity(ACTOR, `roster_joiner_added ${plan.table} ${j.code}${done.job ? ' with a job' : j.job_held ? `; job held: ${j.job_held}` : ''}`.slice(0, 140))
      }
      if (done.job) run.jobs++
    } catch (err) {
      run.failed.push(`${j.code}: ${errorMessage(err)}`)
    }
  return run
}

/** Counts and reasons only: safe for logs. */
export function formatJoiners(plan: JoinerPlan | null, run?: JoinerRun): string[] {
  if (!plan) return []
  const reasons = new Map<string, number>()
  for (const h of plan.held) reasons.set(h.reason, (reasons.get(h.reason) ?? 0) + 1)
  const jobHeld = plan.joiners.filter((j) => j.job_held).length
  const withJob = plan.joiners.filter((j) => j.job).length
  const withManager = plan.joiners.filter((j) => j.job && j.manager).length
  const heldBy = [...reasons].map(([r, n]) => `${r} ${n}`).join(', ') || 'none'
  const lines = [
    run
      ? `roster joiners ${plan.table}: added ${run.added}, with a job ${run.jobs}${run.failed.length ? `; FAILED ${run.failed.length}` : ''}`
      : `roster joiners ${plan.table}: would add ${plan.joiners.length} (with a job ${withJob}, of them with a manager ${withManager}, job held ${jobHeld}); held ${plan.held.length} (${heldBy}); limit ${plan.limit}`,
  ]
  if (plan.refused) lines.push(`roster joiners ${plan.table}: ADDED NONE — ${plan.refused}`)
  return lines
}
