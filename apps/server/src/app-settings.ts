// #620 (design E2, revised by ADR 0013): an app declares the settings and
// secrets it needs. A setting holds what differs per instance (which Dive dev
// uses, say); its value lives in the App Setting security Table, keyed by app
// and name, and an instance sets it through its settings file
// (instance-settings.ts). A secret stays a deployment variable: read here,
// handed to the app's handlers, and never stored, logged or returned.
import { AsyncLocalStorage } from 'node:async_hooks'
import { formatWithOptions, inspect } from 'node:util'
import { z } from 'zod'
import { sql } from './db'
import { readNamedVariable } from './env'
import { AppError } from './errors'
import { platformRelation } from './platform-schema'

const settingName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const distinct = (values: string[]) => new Set(values).size === values.length

/** The manifest's `settings`: what the app reads per instance. */
export const settingsDeclaration = z.array(z.object({ name: settingName, required: z.boolean() }).strict())
  .refine(rows => distinct(rows.map(row => row.name)), 'Setting names must be distinct')

/** The manifest's `secrets`: the deployment variables the app reads. */
export const secretsDeclaration = z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/))
  .refine(distinct, 'Secret names must be distinct')

export interface AppSetupDeclaration {
  title: string
  settings?: z.infer<typeof settingsDeclaration>
  secrets?: z.infer<typeof secretsDeclaration>
}

/** What a handler is given: the declared settings and secrets that hold a
 *  value, and what is missing for the app to be set up. */
export interface AppSetup {
  title: string
  settings: Readonly<Record<string, string>>
  secrets: Readonly<Record<string, string>>
  /** Required settings and secrets with no value, by name. */
  missing: { settings: string[]; secrets: string[] }
}

const present = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim() !== ''

/** Read `app`'s declared settings and secrets fresh. Only declared names are
 *  read: a stored value for anything else never reaches the app. */
export async function loadAppSetup(app: string, declaration: AppSetupDeclaration): Promise<AppSetup> {
  const declared = declaration.settings ?? []
  const rows = declared.length
    ? await sql`select setting, value from app_setting where app = ${app} and setting in ${sql(declared.map(s => s.name))}`
    : []
  const stored = new Map(rows.map(row => [String(row.setting), row.value as string | null]))
  const settings: Record<string, string> = {}
  const secrets: Record<string, string> = {}
  const missing = { settings: [] as string[], secrets: [] as string[] }
  for (const { name, required } of declared) {
    const value = stored.get(name)
    if (present(value)) settings[name] = value
    else if (required) missing.settings.push(name)
  }
  for (const name of declaration.secrets ?? []) {
    const value = readNamedVariable(name)
    if (present(value)) secrets[name] = value
    else missing.secrets.push(name)
  }
  return { title: declaration.title, settings: Object.freeze(settings), secrets: Object.freeze(secrets), missing }
}

/** Each enabled, installed app that declares settings or secrets, with the
 *  required ones it lacks, by name (`setting x`, `secret Y`). Never a
 *  value. The release check (before migrations) names where the tables are
 *  now, or that App Setting does not exist yet. */
export async function appSetupState(where: { installed?: string; settings?: string | null; sources?: string | null } = {}): Promise<{ app: string; title: string; missing: string[] }[]> {
  const installed = where.installed ?? platformRelation('installed_app')
  const settings = where.settings === undefined ? platformRelation('app_setting') : where.settings
  const sources = where.sources === undefined ? platformRelation('data_source') : where.sources
  const rows = await sql`select name, manifest from ${sql(installed)}
    where enabled and (manifest ? 'settings' or manifest ? 'secrets' or manifest ? 'datasets') order by name`
  const gaps: { app: string; title: string; missing: string[] }[] = []
  for (const row of rows) {
    const app = String(row.name)
    const declared = (row.manifest ?? {}) as { title?: string; settings?: { name: string; required: boolean }[]; secrets?: string[]; datasets?: { source: string }[] }
    const required = (declared.settings ?? []).filter(s => s.required).map(s => s.name)
    const filled = settings && required.length
      ? new Set((await sql`select setting from ${sql(settings)} where app = ${app} and coalesce(trim(value), '') <> ''`).map(r => String(r.setting)))
      : new Set<string>()
    // #625 (E3): a dataset names a Data Source the instance must declare.
    const wanted = [...new Set((declared.datasets ?? []).map(d => d.source))]
    const declaredSources = sources && wanted.length
      ? new Set((await sql`select row_id from ${sql(sources)} where row_id in ${sql(wanted)}`).map(r => String(r.row_id)))
      : new Set<string>()
    const missing = [
      ...required.filter(name => !filled.has(name)).map(name => `setting ${name}`),
      ...(declared.secrets ?? []).filter(name => !present(readNamedVariable(name))).map(name => `secret ${name}`),
      ...wanted.filter(name => !declaredSources.has(name)).map(name => `data source ${name}`),
    ]
    gaps.push({ app, title: declared.title ?? app, missing })
  }
  return gaps
}

/** The secrets installed apps declare that are set here, with their values,
 *  so a settings export can withhold a setting that holds one. */
export async function declaredAppSecrets(): Promise<{ name: string; value: string }[]> {
  const rows = await sql`select distinct jsonb_array_elements_text(manifest->'secrets') as name
    from installed_app where jsonb_typeof(manifest->'secrets') = 'array' order by name`
  return rows.flatMap(row => {
    const value = readNamedVariable(String(row.name))?.trim()
    return value ? [{ name: String(row.name), value }] : []
  })
}

/** The app's setup, or its "not set up yet" answer when a required setting
 *  or secret has no value: never a crash in the app's handler. The answer
 *  names no setting or secret; the server log names the missing ones (names
 *  only, never a value). */
export async function readyAppSetup(app: string, setup: AppSetup): Promise<AppSetup> {
  const { settings, secrets } = setup.missing
  if (!settings.length && !secrets.length) return setup
  console.warn(`[apps] ${app} is not set up yet; missing ${[
    ...settings.map(name => `setting ${name}`), ...secrets.map(name => `secret ${name}`)].join(', ')}`)
  throw new AppError('NotSetUpError', `${setup.title} is not set up yet. An administrator needs to finish setting it up.`)
}

// A secret must never leave in what the app answers, raises or has logged.
// The platform cannot stop trusted app code from misusing a secret (ADR 0011:
// no sandbox), but it never carries one out itself: an answer holding one is
// withheld, and an error holding one is replaced before it is answered or
// logged.
export const WITHHELD_ANSWER = "The app's answer was withheld: it held one of the app's secrets"
export const WITHHELD_MESSAGE = "The app's message was withheld: it held one of the app's secrets"

/** Does `value` hold one of `secrets`, in any decoded string or object key
 *  it reaches? Compares decoded values, never serialized text, so a secret
 *  that JSON or inspect would escape (a quote, a backslash, a new line) is
 *  still found. An error's own properties (message, stack, fields, cause)
 *  are walked too, hidden ones included. */
export function holdsSecret(secrets: readonly string[], value: unknown, seen = new Set<unknown>()): boolean {
  if (!secrets.length) return false
  if (typeof value === 'string') return secrets.some(secret => value.includes(secret))
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const keys = value instanceof Error ? Reflect.ownKeys(value) : Object.keys(value)
  for (const key of keys) {
    if (typeof key === 'string' && holdsSecret(secrets, key, seen)) return true
    let child: unknown
    try { child = (value as Record<PropertyKey, unknown>)[key] } catch { continue }
    if (holdsSecret(secrets, child, seen)) return true
  }
  if (value instanceof Error && 'cause' in value && holdsSecret(secrets, value.cause, seen)) return true
  return false
}

/** Refuse an answer (decoded JSON) that holds one of the app's secrets. */
export function assertNoSecret(secrets: Readonly<Record<string, string>>, answer: unknown): void {
  if (holdsSecret(Object.values(secrets), answer)) throw new AppError('InternalError', WITHHELD_ANSWER)
}

// Console output while an app's handler runs has every one of that app's
// secrets replaced. This guards against ACCIDENTAL logging (a debug line, an
// upstream error logged before it is rethrown); it is not a sandbox. Trusted
// app code (ADR 0011) can still write to process.stdout directly or send a
// secret anywhere it likes. The secrets are request-scoped (AsyncLocalStorage),
// so two handlers running at once never see each other's.
const SECRET_REDACTION = '[secret withheld]'
const runningSecrets = new AsyncLocalStorage<readonly string[]>()
const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
const redactors = new WeakSet<object>()

function redact(text: string, secrets: readonly string[]): string {
  // An object's strings are printed escaped, so each secret's escaped forms
  // are replaced too. Longest first, so a secret inside another goes whole.
  const forms = new Set(secrets.flatMap(secret => [secret, JSON.stringify(secret).slice(1, -1), inspect(secret).slice(1, -1)]))
  for (const form of [...forms].filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(form).join(SECRET_REDACTION)
  return text
}

/** Wrap whatever each console method is now (a test's spy included), once. */
function redactConsole(): void {
  for (const level of CONSOLE_LEVELS) {
    const current = console[level] as (...args: unknown[]) => void
    if (redactors.has(current)) continue
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const secrets = runningSecrets.getStore()
      if (!secrets?.length) return current.apply(this, args)
      // No precheck: a Headers, a Map or JSON text can print a secret that no
      // walk of its keys would find. Format as console would, then redact.
      return current.call(this, redact(formatWithOptions({}, ...args), secrets))
    }
    redactors.add(wrapped)
    console[level] = wrapped
  }
}

/** Run the app's code with its secrets kept in: console output redacted
 *  while it runs, and an error it raises that holds one replaced by one that
 *  does not, before it is answered or logged. */
export async function withSecretsKept<T>(secrets: Readonly<Record<string, string>>, run: () => Promise<T>): Promise<T> {
  const values = Object.values(secrets)
  if (!values.length) return run()
  redactConsole()
  try {
    return await runningSecrets.run(values, run)
  } catch (error) {
    if (!holdsSecret(values, error)) throw error
    throw error instanceof AppError ? new AppError(error.type, WITHHELD_MESSAGE) : new Error(WITHHELD_MESSAGE)
  }
}
