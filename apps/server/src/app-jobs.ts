// #700: an app's scheduled jobs. A runtime app declares each job in its
// manifest (`jobs`: name, default cadence, description, grants) and exports
// its handler from its server module under `jobs`. The platform registers it
// as `<app>.<job>`, keeps one Scheduled Job row for it while the app is
// installed, and runs it as the job's own system actor. That actor holds no
// role: what the handler may do is exactly the capabilities its grants name,
// each one a narrow platform operation, and an undeclared one is refused and
// recorded in the Access Log.
import { z } from 'zod'
import { APP_JOB_GRANTS, type AppJobGrant, type AppJobPerson, type RuntimeJobContext, type RuntimeJobHandler, type PersonScope } from 'shared'
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

const distinct = (values: string[]) => new Set(values).size === values.length
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const CADENCES = Object.keys(CADENCE_SECONDS) as [string, ...string[]]

const jobSchema = z.object({
  name: identifier,
  cadence: z.enum(CADENCES, { errorMap: () => ({ message: `A job's cadence must be one of ${CADENCES.join(', ')}` }) }),
  description: z.string().trim().min(1),
  grants: z.array(z.enum(APP_JOB_GRANTS, { errorMap: () => ({ message: `A job grant must be one of ${APP_JOB_GRANTS.join(', ')}` }) }))
    .refine(distinct, 'A job names each grant once').optional(),
  // The identifier systems, by key, whose values `read_people` hands it.
  identifiers: z.array(z.string().regex(IDENTIFIER_SYSTEM_KEY)).refine(distinct).optional(),
  // The app's own datasets the job reads.
  datasets: z.array(identifier).refine(distinct).optional(),
  // The app's optional secrets the job uses (#666).
  needs: z.array(secretName).refine(distinct).optional(),
}).strict()

/** The manifest's `jobs`. */
export const jobsDeclaration = z.array(jobSchema)
  .refine((jobs) => distinct(jobs.map((job) => job.name)), 'Each job has a name of its own')

export type JobDeclaration = z.infer<typeof jobSchema>

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
}, declaredSecrets: Set<string>): void {
  const jobs = manifest.jobs ?? []
  if (!jobs.length) return
  if (!manifest.server) throw new Error('Declared jobs require a server module')
  const datasets = new Set((manifest.datasets ?? []).map((d) => d.name))
  for (const job of jobs) {
    if (job.identifiers?.length && !jobGrants(job).has('read_people'))
      throw new Error(`The job ${job.name} names identifier systems, which only a job granted read_people reads`)
    for (const dataset of job.datasets ?? [])
      if (!datasets.has(dataset)) throw new Error(`The job ${job.name} reads the dataset ${dataset}, which the app does not declare in its datasets`)
    for (const secret of job.needs ?? [])
      if (!declaredSecrets.has(secret)) throw new Error(`The job ${job.name} needs the secret ${secret}, which the app does not declare in its secrets`)
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
}

/** The app's jobs as scheduler events: each handler wrapped so it runs as
 *  its own system actor, with only the capabilities its grants name. */
export function bindAppJobs({ app, jobs, handlers, setup, datasets }: BindRequest) {
  return jobs.map((job) => ({
    method: appJobMethod(app, job.name),
    cadence: job.cadence,
    description: job.description,
    handler: runAppJob(app, job, handlers.get(job.name)!, setup, datasets.filter((d) => job.datasets?.includes(d.name))),
  }))
}

function runAppJob(app: string, job: JobDeclaration, handler: RuntimeJobHandler, setup: () => Promise<AppSetup>,
  datasets: readonly DatasetDeclaration[]): JobHandler {
  const actor = appJobMethod(app, job.name)
  const grants = jobGrants(job)
  return async (_payload, ctx) => {
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
    // Recorded, then final; the first refusal is what the run ends with. Only
    // platform words go in: a grant's name or a fixed phrase, never anything
    // the app passed.
    const refuseAccess = async (what: string, recorded: string): Promise<never> => {
      refusedGrant ??= `The job ${actor} has not declared ${what}`
      await logAccess(actor, 'app_access_denied', { method: `${actor}:${recorded}`.slice(0, 140), required: true })
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
    const context: RuntimeJobContext = Object.freeze({
      job: Object.freeze({ name: actor, run: ctx.job.row_id, trigger: ctx.job.trigger }),
      settings: ready.settings,
      secrets: ready.secrets,
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
      await withSecretsKept(ready.kept, async () => { await handler(context) })
    } catch (error) {
      if (refusedGrant) throw new FinalJobFailure(refusedGrant)
      throw error
    }
    // A handler that caught the refusal and carried on still fails, for good.
    if (refusedGrant) throw new FinalJobFailure(refusedGrant)
  }
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
  | { add: { name: string; cadence: string; description: string; grants: AppJobGrant[] } }
  | { change: { name: string; cadence?: string; description?: string; grants?: AppJobGrant[] } }
  | { remove: { name: string } }

/** What an upgrade does to the app's jobs. A job the upgrade keeps may lose
 *  grants or identifier systems, never gain one: like a widened table grant
 *  (#437), that needs a reviewed install. A job the upgrade adds arrives with
 *  the grants its version declares, listed in the preview. */
export function planJobChanges(app: string, prior: JobDeclaration[], target: JobDeclaration[]): JobPlanStep[] {
  const steps: JobPlanStep[] = []
  for (const job of target) {
    const before = prior.find((p) => p.name === job.name)
    if (!before) {
      steps.push({ add: { name: job.name, cadence: job.cadence, description: job.description, grants: [...jobGrants(job)] } })
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
    ]
    if (wider.length)
      throw new AppError('ValidationError', `The job ${appJobMethod(app, job.name)} would gain ${wider.join(', ')}; ` +
        'a job cannot gain access in an upgrade')
    const change: { name: string; cadence?: string; description?: string; grants?: AppJobGrant[] } = { name: job.name }
    if (job.cadence !== before.cadence) change.cadence = job.cadence
    if (job.description !== before.description) change.description = job.description
    if (jobGrants(before).size !== jobGrants(job).size) change.grants = [...jobGrants(job)]
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
  const [row] = await sql`select owner_app from scheduled_job where method = ${method}`
  if (row && row.owner_app !== app)
    throw new AppError('ConflictError', `The job ${method} is already a scheduled job of ${row.owner_app ? `the app ${String(row.owner_app)}` : 'Featherbase'}`)
  const registrant = jobRegistrant(method)
  if (registrant && registrant !== app)
    throw new AppError('ConflictError', `The job ${method} is already registered by ${registrant === 'platform' ? 'Featherbase' : `the app ${registrant}`}`)
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
        row_id: method, created_by: actor, updated_by: actor, method, cadence: step.add.cadence,
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
      const [row] = await sql`select row_id, cadence, description from scheduled_job where method = ${method} and owner_app = ${app}`
      if (!row) continue
      const locked = await managedFieldsOf('Scheduled Job', String(row.row_id))
      const updates: Record<string, string> = {}
      if (step.change.cadence && row.cadence === before.cadence && !locked.includes('cadence')) updates.cadence = step.change.cadence
      if (step.change.description && row.description === before.description && !locked.includes('description')) updates.description = step.change.description
      if (Object.keys(updates).length)
        await sql`update scheduled_job set ${sql({ ...updates, updated_by: actor })}, updated_at = now() where method = ${method}`
    }
  }
}
