// #700: an app's scheduled jobs. A runtime app declares each job in its
// manifest (`jobs`: name, default cadence, description, grants) and exports
// its handler from its server module under `jobs`. The platform registers it
// as `<app>.<job>`, keeps one Scheduled Job row for it while the app is
// installed, and runs it as the job's own system actor. That actor holds no
// role: what the handler may do is exactly the capabilities its grants name,
// each one a narrow platform operation, and an undeclared one is refused and
// recorded in the Access Log.
import { z } from 'zod'
import { APP_JOB_GRANTS, type ActionRow, type AppJobGrant, type AppJobPerson, type NewLoad, type RuntimeJobContext, type RuntimeJobHandler, type PersonScope } from 'shared'
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { activeApps } from './app-lifecycle'
import { CADENCE_SECONDS, FinalJobFailure, jobRegistrant, type JobHandler } from './jobs'
import { appDatasets, type DatasetDeclaration } from './app-datasets'
import { WITHHELD_MESSAGE, assertNoSecret, holdsSecret, readyAppSetup, secretName, withSecretsKept, type AppSetup } from './app-settings'
import { IDENTIFIER_SYSTEM_KEY } from './identifiers'
import { saveDoc } from './document'
import { logAccess, logActivity } from './audit'
import { queueEmail } from './email'
import { recordUndeliveredNotice, systemManagerEmails } from './system-notice'
import { runAsSystemActor } from './system-actor'
import { callerDocuments, linkedTables } from './runtime-actions'
import { baseTablesReader, type BaseTablesDeclaration } from './change-proposals'
import { admittedToTable } from './mandatory-access'
import { getMeta } from './meta'
import { tableRelation } from './table-engine'
import { getSystemSettings } from './settings'
import { randomBytes } from 'node:crypto'
import { publishUserEvent } from './realtime'
import { send as sendToPerson } from './runtime-mail'
import { NEW_LOAD_PAYLOAD, copyTarget, declaredCopy, loadMoves } from './read-only-copy'

const distinct = (values: string[]) => new Set(values).size === values.length
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const CADENCES = Object.keys(CADENCE_SECONDS) as [string, ...string[]]

const jobSchema = z.object({
  name: identifier,
  // #1330: how the job reads in lists and links; its name in words when absent.
  title: z.string().trim().min(1).optional(),
  cadence: z.enum(CADENCES, { error: `A job's cadence must be one of ${CADENCES.join(', ')}` }),
  description: z.string().trim().min(1),
  grants: z.array(z.enum(APP_JOB_GRANTS, { error: `A job grant must be one of ${APP_JOB_GRANTS.join(', ')}` }))
    .refine(distinct, 'A job names each grant once').optional(),
  // The identifier systems, by key, whose values `read_people` hands it.
  identifiers: z.array(z.string().regex(IDENTIFIER_SYSTEM_KEY)).refine(distinct).optional(),
  // The app's own datasets the job reads.
  datasets: z.array(identifier).refine(distinct).optional(),
  // #1428 (Siraj, 28-Nov-2026): the app's own Tables (or read-only copies)
  // the job reads every row of, past their row privacy, read-only.
  readsAllRows: z.array(z.string().min(1)).refine(distinct, 'A job names each Table it reads once').optional(),
  documents: z.object({ owner_table: z.string(), tables: z.array(z.string()).min(1).refine(distinct) }).strict().optional(),
  // The app's optional secrets the job uses (#666).
  needs: z.array(secretName).refine(distinct).optional(),
}).strict()

/** The manifest's `jobs`. */
export const jobsDeclaration = z.array(jobSchema)
  .refine((jobs) => distinct(jobs.map((job) => job.name)), 'Each job has a name of its own')

export type JobDeclaration = z.infer<typeof jobSchema>

/** #1330: a job's title, its manifest's or its name in words, Title Case ("escalate_issues" -> "Escalate Issues"). */
export function declaredJobTitle(job: Pick<JobDeclaration, 'name' | 'title'>): string {
  return job.title ?? job.name.split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}

/** A job's registered name: also its Scheduled Job, and the actor it runs as. */
export const appJobMethod = (app: string, job: string) => `${app}.${job}`

/** A job's grants, as the set it runs with. */
export const jobGrants = (job: Pick<JobDeclaration, 'grants'>) => new Set<AppJobGrant>(job.grants ?? [])

/** Checked when an app's files are loaded, before anything is registered. */
export function validateAppJobs(app: string, manifest: {
  jobs?: JobDeclaration[]
  server?: string
  datasets?: readonly { name: string }[]
  secrets?: unknown
  tables?: readonly { name: string; system?: boolean; data_source?: string | null; kind?: string; access_policy?: { shared_column?: string; inherit_column?: string } | null }[]
}, declaredSecrets: Set<string>): void {
  const jobs = manifest.jobs ?? []
  if (!jobs.length) return
  if (!manifest.server) throw new Error('Declared jobs require a server module')
  const datasets = new Set((manifest.datasets ?? []).map((d) => d.name))
  // A job reads every row only of its own app's stored Tables and read-only copies.
  const ownRows = new Set([
    ...(manifest.tables ?? []).filter((t) => t.name.startsWith(`${app}.`) && !t.system && !t.data_source && (!t.kind || t.kind === 'table')).map((t) => t.name),
    ...(manifest.datasets ?? []).filter((d) => (d as { store?: string }).store !== 'json').map((d) => `${app}.${d.name}`),
  ])
  for (const job of jobs) {
    for (const table of job.readsAllRows ?? [])
      if (!ownRows.has(table)) throw new Error(`The job ${job.name} may read every row only of its own app's Tables, not ${table}`)
    if (job.identifiers?.length && !jobGrants(job).has('read_people'))
      throw new Error(`The job ${job.name} names identifier systems, which only a job granted read_people reads`)
    for (const dataset of job.datasets ?? [])
      if (!datasets.has(dataset)) throw new Error(`The job ${job.name} reads the dataset ${dataset}, which the app does not declare in its datasets`)
    for (const secret of job.needs ?? [])
      if (!declaredSecrets.has(secret)) throw new Error(`The job ${job.name} needs the secret ${secret}, which the app does not declare in its secrets`)
    if (job.documents) {
      const declared = job.documents
      const owned = new Map((manifest.tables ?? []).map(table => [table.name, table]))
      if (!declared.tables.includes(declared.owner_table)) throw new Error('A document job must declare its owner Table')
      for (const name of declared.tables) {
        const table = owned.get(name)
        if (!name.startsWith(`${app}.`) || !table || table.system || table.data_source || (table.kind && table.kind !== 'table'))
          throw new Error('A document job may name only its app’s declared stored Tables')
      }
      const owner = owned.get(declared.owner_table)!
      if (!owner.access_policy?.shared_column || owner.access_policy.inherit_column)
        throw new Error('A document job owner Table must declare creator privacy')
    }
    const method = appJobMethod(app, job.name)
    const registrant = jobRegistrant(method)
    if (registrant && registrant !== app)
      throw new Error(`The job ${job.name} would be registered as ${method}, which ${registrant === 'platform' ? 'Featherbase' : `the app ${registrant}`} already uses`)
  }
}

// A job has no places: it reads every row of the datasets it declares.
const EVERY_PLACE: PersonScope = Object.freeze([Object.freeze({ label: 'every place', filters: Object.freeze({}) })])

interface BindRequest {
  app: string
  jobs: JobDeclaration[]
  handlers: Map<string, RuntimeJobHandler>
  setup: () => Promise<AppSetup>
  datasets: readonly DatasetDeclaration[]
  /** #1428: the instance Tables and columns the app reads. */
  baseTables?: BaseTablesDeclaration
}

/** The app's jobs as scheduler events: each handler wrapped so it runs as
 *  its own system actor, with only the capabilities its grants name. */
export function bindAppJobs({ app, jobs, handlers, setup, datasets, baseTables }: BindRequest) {
  return jobs.map((job) => ({
    method: appJobMethod(app, job.name),
    title: declaredJobTitle(job),
    cadence: job.cadence,
    description: job.description,
    handler: runAppJob(app, job, handlers.get(job.name)!, setup, datasets.filter((d) => job.datasets?.includes(d.name)), baseTables),
  }))
}

function runAppJob(app: string, job: JobDeclaration, handler: RuntimeJobHandler, setup: () => Promise<AppSetup>,
  datasets: readonly DatasetDeclaration[], baseTables?: BaseTablesDeclaration): JobHandler {
  const actor = appJobMethod(app, job.name)
  const grants = jobGrants(job)
  return async (payload, ctx) => {
    const [installed] = await sql`select enabled, activation_pending from installed_app where name = ${app}`
    if (!installed?.enabled || installed.activation_pending || !activeApps.has(app))
      throw new FinalJobFailure(`The app ${app} is disabled or unavailable, so its job ${job.name} did not run`)
    // The schedule that queued this run must be the app's own (Codex round 3
    // on #701): the app's code never runs on a row someone else holds.
    const [schedule] = await sql`select owner_app from scheduled_job where method = ${actor}`
    if (schedule?.owner_app !== app)
      throw new FinalJobFailure(`The scheduled job ${actor} is not the app ${app}'s, so its code did not run`)
    let ready: Awaited<ReturnType<typeof readyAppSetup>>
    try {
      ready = await readyAppSetup(app, await setup(), job.needs)
    } catch (error) {
      // Not set up is a refusal, not a failure to retry a minute later.
      if (error instanceof AppError && error.type === 'NotSetUpError') return ctx.refuse(error.message)
      throw error
    }
    // An undeclared capability ends the run for good. Kept here, in the
    // platform's own words, because the app's error is redacted into a plain
    // one on its way out (withSecretsKept) and would otherwise be retried,
    // repeating what the job was allowed to do (Codex round 1 on #701).
    let refusedGrant: string | undefined
    let refusedMethod: string | undefined
    // Recorded, then final; the first refusal is what the run ends with. Only
    // platform words go in: a grant's name or a fixed phrase, never anything
    // the app passed.
    const refuseAccess = async (what: string, recorded: string): Promise<never> => {
      refusedGrant ??= `The job ${actor} has not declared ${what}`
      refusedMethod ??= `${actor}:${recorded}`.slice(0, 140)
      await logAccess(actor, 'app_access_denied', { method: refusedMethod, required: true })
      throw new FinalJobFailure(refusedGrant)
    }
    const need = async <T>(grant: AppJobGrant, fn: () => Promise<T>): Promise<T> => {
      if (!grants.has(grant)) await refuseAccess(`the grant ${grant}`, grant)
      return fn()
    }
    // A dataset the job does not declare is refused the same way (Codex
    // standard review round 3 on #701): recorded, final, and the run fails
    // even if the handler catches it.
    const declaredDatasets = new Set(job.datasets ?? [])
    const readable = appDatasets({ app, operation: job.name, user: actor, title: ready.title, declarations: datasets,
      places: EVERY_PLACE, outbound: true }).datasets
    const dataset = async <T>(name: unknown, fn: () => Promise<T>): Promise<T> => {
      // The name is the app's own argument and may hold anything, a secret
      // included (Codex round 4 on #701), so the refusal names no dataset:
      // not in the Access Log, the run record or the alert.
      if (typeof name !== 'string' || !declaredDatasets.has(name)) await refuseAccess('the dataset it asked for', 'dataset')
      return fn()
    }
    // What the app writes into the run's record, its refusal alert or a
    // person's activity never carries one of its secrets.
    const kept = (text: unknown) => {
      const line = String(text)
      return holdsSecret(ready.kept.values, line) ? WITHHELD_MESSAGE : line
    }
    let documentScopeOpen = true
    let pendingOwners: Promise<void> | undefined
    let documentFailure: unknown
    // #1428: every row of a Table the job declares, read-only; anything else refused and recorded.
    const allRowsOf = new Set(job.readsAllRows ?? [])
    const ownTable = async (table: unknown): Promise<string> => {
      if (typeof table !== 'string' || !allRowsOf.has(table)) await refuseAccess('the Table it asked to read', 'reads_all_rows')
      return table as string
    }
    const forEachOwner: RuntimeJobContext['documents']['forEachOwner'] = callback => {
      if (!job.documents) {
        const refused = refuseAccess('document access', 'documents')
        void refused.catch(() => {})
        return refused
      }
      if (!documentScopeOpen || pendingOwners || typeof callback !== 'function') {
        documentFailure = new AppError('ValidationError', 'Document owner scopes must be awaited sequentially inside the job')
        const refused = Promise.reject(documentFailure)
        void refused.catch(() => {})
        return refused
      }
      const declaration = job.documents
      const work = (async () => {
        const meta = await getMeta(declaration.owner_table)
        if (meta.owner_app !== app || !meta.access_policy?.shared_column || meta.access_policy.inherit_column)
          throw new AppError('PermissionError', 'The document owner Table is unavailable')
        const owners = await sql`select distinct created_by from ${sql(await tableRelation(meta.name))} order by created_by`
        for (const owner of owners) await withTransaction(async () => {
          const user = String(owner.created_by)
          const [person] = await sql`select enabled, replaced_by from person where row_id = ${user} for update`
          if (!person?.enabled || person.replaced_by || !(await admittedToTable(user, meta.name))) return
          const access = callerDocuments(app, [...declaration.tables], user)
          let ownerScopeOpen = true
          const documents = Object.freeze(Object.fromEntries(Object.entries(access.documents).map(([name, operation]) => [
            name, async (table: string, ...args: unknown[]) => {
              if (!ownerScopeOpen) throw new AppError('ValidationError', 'The document owner scope has closed')
              if (!declaration.tables.includes(table)) return refuseAccess('the Table it asked for', 'document_table')
              return (operation as (...args: unknown[]) => Promise<unknown>)(table, ...args)
            },
          ]))) as unknown as typeof access.documents
          try { await callback(Object.freeze({ user, documents })) }
          finally { ownerScopeOpen = false; await access.close() }
        })
      })().catch(error => { documentFailure = error; throw error }).finally(() => { pendingOwners = undefined })
      pendingOwners = work
      // Observe rejection even when an app forgets to await the returned
      // scope; closing the handler still fails and rolls back its writes.
      void work.catch(() => {})
      return work
    }
    const newLoad = await newLoadFor(app, job.name, payload)
    const timeZone = (await getSystemSettings()).time_zone
    // #1428: the instance Tables the app reads, declared columns only, read-only.
    const base = baseTablesReader(app, baseTables, linkedTables(ready.settings))
    const context: RuntimeJobContext = Object.freeze({
      now: new Date().toISOString(), timeZone,
      documents: Object.freeze({
        forEachOwner,
        list: async (table: string, args?: unknown) => everyRow(await ownTable(table), args),
        get: async (table: string, rowId: string) => {
          if (typeof rowId !== 'string' || !rowId) throw new AppError('ValidationError', 'get needs a row id')
          return (await everyRow(await ownTable(table), { filters: [['row_id', '=', rowId]], limit: 1 }))[0] ?? null
        },
      }),
      job: Object.freeze({ name: actor, run: ctx.job.row_id, trigger: ctx.job.trigger }),
      settings: ready.settings,
      secrets: ready.secrets,
      newLoad,
      baseTables: base.helper,
      datasets: Object.freeze({
        active: (name: string, filters?: Parameters<typeof readable.active>[1]) => dataset(name, () => readable.active(name, filters)),
        live: (name: string, filters?: Parameters<typeof readable.live>[1]) => dataset(name, () => readable.live(name, filters)),
      }),
      people: Object.freeze({
        list: () => need('read_people', () => listPeople(job.identifiers ?? [])),
        disable: (person: string, reason: string) => need('disable_people', () => {
          assertNoSecret(ready.kept, reason)
          return disablePerson(actor, person, reason)
        }),
        notify: (person: string, message: unknown) => {
          // Read once, as an email is: what is checked is what is sent.
          const note = snapshotNote(message)
          return need('notify_people', () => {
            const checked = validNote(app, note)
            assertNoSecret(ready.kept, checked)
            return notifyPerson(app, actor, person, checked)
          })
        },
      }),
      email: Object.freeze({
        systemManagers: (message: { subject: string; body: string }) => {
          // Read once, here, into the platform's own strings: what is checked
          // is what is sent, whatever the app does to its object meanwhile
          // (Codex round 2 on #701).
          const mail = snapshotMessage(message)
          return need('email_system_managers', () => {
            const checked = validMessage(mail)
            assertNoSecret(ready.kept, checked)
            return emailSystemManagers(actor, checked)
          })
        },
      }),
      setResult: (text: string) => ctx.setResult(kept(text)),
      refuse: (reason: string) => ctx.refuse(kept(reason)),
    })
    try {
      const run = async () => {
        try { await withSecretsKept(ready.kept, async () => { await handler(context) }) }
        finally {
          await base.close()
          documentScopeOpen = false
          if (pendingOwners) {
            await pendingOwners.catch(() => {})
            documentFailure ??= new AppError('ValidationError', 'Job returned without awaiting its document owner scope')
          }
        }
        if (documentFailure) throw documentFailure
        if (refusedGrant) throw new FinalJobFailure(refusedGrant)
      }
      // Keep the job open until every owner scope has closed: an unawaited
      // callback cannot commit a write after the job has already succeeded.
      if (job.documents) await withTransaction(run)
      else await run()
    } catch (error) {
      if (refusedGrant) {
        // The owner transaction rolled back its writes, including the first
        // denial entry. Keep the refusal in the run's outer audit scope.
        if (job.documents) await logAccess(actor, 'app_access_denied', { method: refusedMethod, required: true })
        throw new FinalJobFailure(refusedGrant)
      }
      throw error
    }
    // A handler that caught the refusal and carried on still fails, for good.
    if (refusedGrant) throw new FinalJobFailure(refusedGrant)
  }
}

const JOB_ROWS_DEFAULT = 10_000
const JOB_ROWS_MOST = 50_000

/** #1428: a job's read of every row of one of its app's own Tables, as the
 *  storage holds it, so no row privacy applies; filters on its own columns. */
async function everyRow(table: string, args: unknown): Promise<ActionRow[]> {
  const { filters = [], limit = JOB_ROWS_DEFAULT } = (args ?? {}) as { filters?: unknown; limit?: unknown }
  if (!Array.isArray(filters)) throw new AppError('ValidationError', 'A job list takes filters as [column, operator, value] lists')
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > JOB_ROWS_MOST)
    throw new AppError('ValidationError', `A job list reads 1 to ${JOB_ROWS_MOST} rows at a time`)
  const meta = await getMeta(table)
  const columns = new Set(['row_id', 'created_by', 'created_at', 'updated_at', 'updated_by', ...meta.columns.map((c) => c.column_name)])
  const where = filters.map((filter: unknown) => {
    const [column, operator, value] = Array.isArray(filter) ? filter : []
    if (typeof column !== 'string' || !columns.has(column)) throw new AppError('ValidationError', `${table} has no column ${String(column)} to filter on`)
    if (operator === '=') return sql`${sql(column)} = ${value as string}`
    if (operator === 'in' && Array.isArray(value) && value.length) return sql`${sql(column)} in ${sql(value as string[])}`
    throw new AppError('ValidationError', "A job list's filter is [column, '=', value] or [column, 'in', [values]]")
  })
  const rows = await sql`select * from ${sql(await tableRelation(table))}
    where ${where.reduce((all, one) => sql`${all} and ${one}`, sql`true`)} order by row_id limit ${limit as number}`
  return JSON.parse(JSON.stringify(rows)) as ActionRow[]
}

/** #1418: the new load a queued run names, checked against the registry: a
 *  payload never chooses a copy or a load the platform did not make. */
async function newLoadFor(app: string, job: string, payload: Record<string, unknown>): Promise<NewLoad | null> {
  const given = payload?.[NEW_LOAD_PAYLOAD] as { dataset?: unknown; previous?: unknown; current?: unknown } | undefined
  if (given === undefined) return null
  const target = copyTarget(app, String(given?.dataset))
  const entry = declaredCopy(target)
  const loads = typeof given?.current === 'string' ? await sql`select row_id from dataset_snapshot
    where dataset = ${target} and state in ('active', 'superseded') and row_id in ${sql([given.current, ...(typeof given.previous === 'string' ? [given.previous] : [])])}` : []
  const expected = typeof given?.previous === 'string' && given.previous !== given.current ? 2 : 1
  if (!entry || entry.dataset.onNewLoad !== job || (given.previous !== null && typeof given.previous !== 'string') || loads.length !== expected)
    throw new FinalJobFailure(`The job ${appJobMethod(app, job)} was queued for a new load it was not told of`)
  const previous = (given.previous as string | null)
  const current = given.current as string
  return Object.freeze({
    dataset: String(given.dataset), previous, current,
    moves: async (options: { by: string[]; measure: string; threshold?: number }) =>
      previous ? loadMoves(target, previous, current, options) : [],
  })
}

// ------------------------------------------------------------- capabilities

/** `read_people`: every enabled, current person, with the current values of
 *  the identifier systems the job declares that are on and not secret, valid today. */
async function listPeople(systems: string[]): Promise<AppJobPerson[]> {
  const people = await sql`
    select p.row_id, p.full_name, p.email,
      (p.row_id = 'Administrator' or exists (
        select 1 from has_role r where r.parent = p.row_id and r.parenttype = 'Person'
          and r.role in ('System Manager', 'Administrator'))) as privileged
    from person p
    where p.enabled and not coalesce(p.built_in, false) and p.replaced_by is null
    order by p.row_id`
  const values = systems.length
    // As a scope provider gets them (currentIdentifiers in person-scope.ts):
    // only a system that is on and not secret, and only values valid on
    // India's today, so a future start is not handed out yet and a scheduled
    // end still counts until it comes (Codex standard review on #701).
    ? await sql`select i.person_id, i.system, i.value from person_identifier i
        join identifier_system s on s.row_id = i.system and s.enabled and s.sensitivity <> 'Secret'
        where i.system in ${sql(systems)} and i.valid @> (now() at time zone 'Asia/Kolkata')::date and i.value is not null
        order by i.person_id, i.system, i.value`
    : []
  const byPerson = new Map<string, Record<string, string[]>>()
  for (const v of values) {
    const held = byPerson.get(String(v.person_id)) ?? {}
    ;(held[String(v.system)] ??= []).push(String(v.value))
    byPerson.set(String(v.person_id), held)
  }
  return people.map((p) => ({
    person: String(p.row_id),
    full_name: (p.full_name as string | null) ?? null,
    email: (p.email as string | null) ?? null,
    privileged: p.privileged === true,
    identifiers: Object.fromEntries(systems.map((system) => [system, byPerson.get(String(p.row_id))?.[system] ?? []])),
  }))
}

/** `disable_people`: a normal row save, so the change is versioned and the
 *  person's sessions end. Re-read under a row lock: someone may have
 *  re-enabled, disabled or promoted them since the job decided. Privileged
 *  people are never disabled. The job's actor holds System Manager only for
 *  this one save (system-actor.ts). */
export async function disablePerson(actor: string, person: string, reason: string): Promise<boolean> {
  if (typeof person !== 'string' || !person) throw new AppError('ValidationError', 'disable needs a person')
  if (typeof reason !== 'string' || !reason.trim()) throw new AppError('ValidationError', 'disable needs a reason')
  return withTransaction(async () => {
    // The row lock first, the roles after it in a statement of their own
    // (Codex round 2 on #701): a lock that waits for a concurrent promotion
    // returns the promoted row, but a role subquery in the same statement
    // still reads the snapshot from before it waited.
    const [row] = await sql`select updated_at, enabled from person where row_id = ${person} for update`
    if (!row || !row.enabled || person === 'Administrator') return false
    const [privileged] = await sql`select 1 from has_role where parent = ${person} and parenttype = 'Person'
      and role in ('System Manager', 'Administrator') limit 1`
    if (privileged) return false
    await runAsSystemActor(actor, () => saveDoc('Person', { row_id: person, updated_at: row.updated_at, enabled: false }, actor))
    await logActivity(actor, `disabled ${person}: ${reason.trim()}`.slice(0, 140))
    return true
  })
}

type Note = { subject: string; body: string; email?: boolean; path?: string; ref_table?: string; reference_name?: string }
const NOTE_FIELDS = ['subject', 'body', 'email', 'path', 'ref_table', 'reference_name'] as const

/** A notice's fields, each read exactly once at the call. */
function snapshotNote(message: unknown): Readonly<Record<string, unknown>> {
  if (!message || typeof message !== 'object') return Object.freeze({})
  return Object.freeze(Object.fromEntries(NOTE_FIELDS.map((field) => [field, (message as Record<string, unknown>)[field]])))
}

/** The snapshot as the platform's own strings, or a refusal. A link names one of the app's own Tables. */
function validNote(app: string, note: Readonly<Record<string, unknown>>): Readonly<Note> {
  const { subject, body, email, path, ref_table, reference_name } = note
  if (typeof subject !== 'string' || !subject.trim() || typeof body !== 'string')
    throw new AppError('ValidationError', 'A notice needs a subject and a body')
  if (email !== undefined && typeof email !== 'boolean') throw new AppError('ValidationError', 'A notice\'s email is true or false')
  if (path !== undefined && (typeof path !== 'string' || !path.startsWith('/'))) throw new AppError('ValidationError', 'A notice\'s path starts with /')
  if ((ref_table === undefined) !== (reference_name === undefined) || (ref_table !== undefined &&
      (typeof ref_table !== 'string' || !ref_table.startsWith(`${app}.`) || typeof reference_name !== 'string' || !reference_name)))
    throw new AppError('ValidationError', 'A notice links to a row of one of the app\'s own Tables, by ref_table and reference_name together')
  return Object.freeze({ subject: subject.replace(/\s+/g, ' ').trim(), body, email: email as boolean | undefined, path: path as string | undefined,
    ref_table: ref_table as string | undefined, reference_name: reference_name as string | undefined })
}

/** #1418 `notify_people`: one bell entry, and an email when asked; recorded
 *  in the Activity Log under the job. Never for someone turned off or built in. */
export async function notifyPerson(app: string, actor: string, person: string, note: Readonly<Note>): Promise<boolean> {
  if (typeof person !== 'string' || !person.trim()) throw new AppError('ValidationError', 'notify needs a person')
  const [row] = await sql`select row_id, enabled, built_in from person
    where row_id = ${person} or (${person.includes('@')} and lower(email) = lower(${person.trim()})) order by row_id = ${person} desc limit 1`
  if (!row || !row.enabled || row.built_in) return false
  const id = String(row.row_id)
  await sql`insert into notification_log ${sql({
    row_id: randomBytes(5).toString('hex'), created_by: actor, updated_by: actor, for_user: id,
    subject: note.subject.slice(0, 140), ref_table: note.ref_table ?? null, ref_name: note.reference_name ?? null, read: false,
  } as unknown as Record<string, never>)}`
  publishUserEvent(id, 'notification', { subject: note.subject.slice(0, 140) })
  if (note.email) await sendToPerson(app, id, note)
  await logActivity(actor, `notified ${id}: ${note.subject}`.slice(0, 140))
  return true
}

/** `email_system_managers`: one message to each System Manager with an address. */
/** An app's email, each property read exactly once at the call. Checked
 *  only once the job is known to hold the grant. */
function snapshotMessage(message: unknown): { readonly subject: unknown; readonly body: unknown } {
  if (!message || typeof message !== 'object') return Object.freeze({ subject: undefined, body: undefined })
  return Object.freeze({ subject: (message as { subject?: unknown }).subject, body: (message as { body?: unknown }).body })
}

/** The snapshot as the platform's own strings, or a refusal. */
function validMessage(mail: { readonly subject: unknown; readonly body: unknown }): Readonly<{ subject: string; body: string }> {
  if (typeof mail.subject !== 'string' || !mail.subject.trim() || typeof mail.body !== 'string')
    throw new AppError('ValidationError', 'An email needs a subject and a body')
  return Object.freeze({ subject: mail.subject, body: mail.body })
}

async function emailSystemManagers(actor: string, message: Readonly<{ subject: string; body: string }>): Promise<number> {
  const managers = await systemManagerEmails()
  if (!managers.length) {
    await recordUndeliveredNotice(`${actor} email`)
    return 0
  }
  for (const to of managers) await queueEmail({ to, subject: message.subject, body: message.body })
  return managers.length
}

// ------------------------------------------------------------- upgrades

export type JobPlanStep =
  | { add: { name: string; title?: string; cadence: string; description: string; grants: AppJobGrant[]; documents?: JobDeclaration['documents']; readsAllRows?: string[] } }
  | { change: { name: string; title?: string; cadence?: string; description?: string; grants?: AppJobGrant[]; documents?: JobDeclaration['documents'] | null } }
  | { remove: { name: string } }
type JobPlanChange = Extract<JobPlanStep, { change: unknown }>['change']

/** What an upgrade does to the app's jobs. A job the upgrade keeps may lose
 *  grants or identifier systems, never gain one: like a widened table grant
 *  (#437), that needs a reviewed install. A job the upgrade adds arrives with
 *  the grants its version declares, listed in the preview. */
export function planJobChanges(app: string, prior: JobDeclaration[], target: JobDeclaration[]): JobPlanStep[] {
  const steps: JobPlanStep[] = []
  for (const job of target) {
    const before = prior.find((p) => p.name === job.name)
    if (!before) {
      steps.push({ add: { name: job.name, ...(job.title ? { title: job.title } : {}), cadence: job.cadence, description: job.description, grants: [...jobGrants(job)], ...(job.documents ? { documents: job.documents } : {}), ...(job.readsAllRows ? { readsAllRows: job.readsAllRows } : {}) } })
      continue
    }
    // Grants, identifier systems, datasets and optional secrets are all
    // access: a kept job may only lose them.
    const gained = (now: readonly string[] | undefined, had: readonly string[] | undefined) =>
      (now ?? []).filter((item) => !(had ?? []).includes(item))
    const wider = [
      ...gained([...jobGrants(job)], [...jobGrants(before)]),
      ...gained(job.identifiers, before.identifiers),
      ...gained(job.datasets, before.datasets).map((d) => `the dataset ${d}`),
      ...gained(job.needs, before.needs).map((n) => `the secret ${n}`),
      ...gained(job.documents?.tables, before.documents?.tables).map(name => `the Table ${name}`),
      ...gained(job.readsAllRows, before.readsAllRows).map(name => `every row of ${name}`),
      ...(job.documents && job.documents.owner_table !== before.documents?.owner_table ? ['a different document owner Table'] : []),
    ]
    if (wider.length)
      throw new AppError('ValidationError', `The job ${appJobMethod(app, job.name)} would gain ${wider.join(', ')}; ` +
        'a job cannot gain access in an upgrade')
    const change: JobPlanChange = { name: job.name }
    if (declaredJobTitle(job) !== declaredJobTitle(before)) change.title = declaredJobTitle(job)
    if (job.cadence !== before.cadence) change.cadence = job.cadence
    if (job.description !== before.description) change.description = job.description
    if (jobGrants(before).size !== jobGrants(job).size) change.grants = [...jobGrants(job)]
    if (JSON.stringify(before.documents ?? null) !== JSON.stringify(job.documents ?? null)) change.documents = job.documents ?? null
    if (Object.keys(change).length > 1) steps.push({ change })
  }
  for (const job of prior)
    if (!target.some((t) => t.name === job.name)) steps.push({ remove: { name: job.name } })
  return steps
}

/** An app may claim a job name only if no one else holds it: not a Scheduled
 *  Job of Featherbase's or another app's, nor a handler someone else
 *  registered. Checked before the app's handler is registered or its row
 *  written. */
export async function assertJobClaimable(app: string, method: string): Promise<void> {
  const refusal = await jobClaimRefusal(app, method)
  if (refusal) throw new AppError('ConflictError', refusal)
}

/** Why `app` may not claim the job name `method`, or null when it may. */
export async function jobClaimRefusal(app: string, method: string): Promise<string | null> {
  const [row] = await sql`select owner_app from scheduled_job where method = ${method}`
  if (row && row.owner_app !== app)
    return `The job ${method} is already a scheduled job of ${row.owner_app ? `the app ${String(row.owner_app)}` : 'Featherbase'}`
  const registrant = jobRegistrant(method)
  if (registrant && registrant !== app)
    return `The job ${method} is already registered by ${registrant === 'platform' ? 'Featherbase' : `the app ${registrant}`}`
  return null
}

/** Write an upgrade's job steps, in its transaction. A changed default reaches
 *  a row only where the row still holds the old default and the instance
 *  settings file does not manage that field: an administrator's or the file's
 *  choice is never overwritten. */
export async function applyJobPlan(app: string, steps: JobPlanStep[], prior: JobDeclaration[], actor: string): Promise<void> {
  const { managedFieldsOf } = await import('./managed-settings')
  for (const step of steps) {
    if ('add' in step) {
      const method = appJobMethod(app, step.add.name)
      await assertJobClaimable(app, method)
      await sql`insert into scheduled_job ${sql({
        row_id: method, created_by: actor, updated_by: actor, method, title: declaredJobTitle(step.add), cadence: step.add.cadence,
        enabled: true, description: step.add.description, owner_app: app,
      })} on conflict (method) do nothing`
    } else if ('remove' in step) {
      const method = appJobMethod(app, step.remove.name)
      // Only a schedule the app owns, and only then its queued runs.
      const gone = await sql`delete from scheduled_job where method = ${method} and owner_app = ${app} returning 1`
      if (gone.length) await sql`delete from background_job where method = ${method} and job_status = 'queued'`
    } else {
      const method = appJobMethod(app, step.change.name)
      const before = prior.find((p) => p.name === step.change.name)!
      const [row] = await sql`select row_id, title, cadence, description from scheduled_job where method = ${method} and owner_app = ${app}`
      if (!row) continue
      const locked = await managedFieldsOf('Scheduled Job', String(row.row_id))
      const updates: Record<string, string> = {}
      if (step.change.cadence && row.cadence === before.cadence && !locked.includes('cadence')) updates.cadence = step.change.cadence
      if (step.change.description && row.description === before.description && !locked.includes('description')) updates.description = step.change.description
      if (step.change.title && row.title === declaredJobTitle(before) && !locked.includes('title')) updates.title = step.change.title
      if (Object.keys(updates).length)
        await sql`update scheduled_job set ${sql({ ...updates, updated_by: actor })}, updated_at = now() where method = ${method}`
    }
  }
}
