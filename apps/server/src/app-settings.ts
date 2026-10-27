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
import { datasetSourceReadOnly } from './sources/read-only'

const settingName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const distinct = (values: string[]) => new Set(values).size === values.length

/** The manifest's `settings`: what the app reads per instance. */
export const settingsDeclaration = z.array(z.object({ name: settingName, required: z.boolean() }).strict())
  .refine(rows => distinct(rows.map(row => row.name)), 'Setting names must be distinct')

export const secretName = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)

/** The manifest's `secrets`: the deployment variables the app reads. A bare
 *  name is a required secret. #666: `{ name, optional: true }` is one the app
 *  can work without; only the operations that name it in `needs` wait for it. */
export const secretsDeclaration = z.array(z.union([secretName, z.object({ name: secretName, optional: z.boolean() }).strict()]))
  .refine(entries => distinct(secretEntries(entries).map(entry => entry.name)), 'Secret names must be distinct')

export type SecretsDeclaration = z.infer<typeof secretsDeclaration>

/** Each declared secret as `{ name, optional }`, from a manifest's `secrets`
 *  (parsed, or as stored on an installed app). */
export function secretEntries(declared: unknown): { name: string; optional: boolean }[] {
  if (!Array.isArray(declared)) return []
  return declared.flatMap(entry => typeof entry === 'string' ? [{ name: entry, optional: false }]
    : entry && typeof entry === 'object' && typeof entry.name === 'string' ? [{ name: entry.name, optional: entry.optional === true }] : [])
}

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
  /** Required settings, and every declared secret, with no value, by name. */
  missing: { settings: string[]; secrets: string[] }
  /** #666: the secrets declared optional, by name. */
  optionalSecrets: readonly string[]
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
  const optionalSecrets: string[] = []
  for (const { name, optional } of secretEntries(declaration.secrets)) {
    if (optional) optionalSecrets.push(name)
    const value = readNamedVariable(name)
    if (present(value)) secrets[name] = value
    else missing.secrets.push(name)
  }
  return { title: declaration.title, settings: Object.freeze(settings), secrets: Object.freeze(secrets), missing, optionalSecrets }
}

/** Each enabled, installed app that declares settings, secrets, datasets or
 *  a scope provider's identifier systems, with the required ones it lacks, by
 *  name (`setting x`, `secret Y`, `identifier system z`). Never a
 *  value. The release check (before migrations) names where the tables are
 *  now, or that App Setting does not exist yet. */
export async function appSetupState(where: { installed?: string; settings?: string | null; sources?: string | null; identifierSystems?: string | null } = {}): Promise<{ app: string; title: string; missing: string[]; optional: string[] }[]> {
  const installed = where.installed ?? platformRelation('installed_app')
  const settings = where.settings === undefined ? platformRelation('app_setting') : where.settings
  const sources = where.sources === undefined ? platformRelation('data_source') : where.sources
  const identifierSystems = where.identifierSystems === undefined ? platformRelation('identifier_system') : where.identifierSystems
  const rows = await sql`select name, manifest from ${sql(installed)}
    where enabled and (manifest ? 'settings' or manifest ? 'secrets' or manifest ? 'datasets'
      or jsonb_typeof(manifest->'scopeProvider'->'identifiers') = 'array') order by name`
  const gaps: { app: string; title: string; missing: string[]; optional: string[] }[] = []
  for (const row of rows) {
    const app = String(row.name)
    const declared = (row.manifest ?? {}) as { title?: string; settings?: { name: string; required: boolean }[]; secrets?: unknown; datasets?: { source: string }[]
      scopeProvider?: { identifiers?: string[] }; reads?: { operations?: Record<string, { needs?: string[] }> }
      actions?: { operations?: Record<string, { needs?: string[] }> } }
    const unset = secretEntries(declared.secrets).filter(({ name }) => !present(readNamedVariable(name)))
    // #666: the reads and actions that wait for each missing optional secret.
    const neededBy = (secret: string) => [['read', declared.reads?.operations], ['action', declared.actions?.operations]]
      .flatMap(([kind, operations]) => Object.entries(operations ?? {}).filter(([, o]) => o?.needs?.includes(secret)).map(([name]) => `${kind} ${name}`))
    const required = (declared.settings ?? []).filter(s => s.required).map(s => s.name)
    const filled = settings && required.length
      ? new Set((await sql`select setting from ${sql(settings)} where app = ${app} and coalesce(trim(value), '') <> ''`).map(r => String(r.setting)))
      : new Set<string>()
    // #625 (E3): a dataset names a Data Source the instance must declare.
    const wanted = [...new Set((declared.datasets ?? []).map(d => d.source))]
    // Read as JSON: before migration 0136 a source has no read_scaling_token.
    const found = sources && wanted.length
      ? new Map((await sql`select row_id, to_jsonb(d) as source from ${sql(sources)} d where row_id in ${sql(wanted)}`)
        .map(r => [String(r.row_id), r.source as { engine: string; url_env: string | null; read_scaling_token?: boolean }]))
      : new Map<string, { engine: string; url_env: string | null; read_scaling_token?: boolean }>()
    // #660: a scope provider names the identifier systems it reads.
    const systems = declared.scopeProvider?.identifiers ?? []
    // A turned-off system is not set up either (owner decision 27-Oct-2026,
    // provisional), nor is a Secret one, which is never given to an app.
    const foundSystems = identifierSystems && systems.length
      ? new Map((await sql`select row_id, enabled, sensitivity from ${sql(identifierSystems)} where row_id in ${sql(systems)}`)
        .map(r => [String(r.row_id), r.sensitivity === 'Secret' ? 'is secret and can\'t be given to an app' : r.enabled === true ? null : 'is turned off']))
      : new Map<string, string | null>()
    const missing = [
      ...required.filter(name => !filled.has(name)).map(name => `setting ${name}`),
      ...unset.filter(({ optional }) => !optional).map(({ name }) => `secret ${name}`),
      ...wanted.map(name => found.has(name) ? (datasetSourceReadOnly(found.get(name)!) ? null : `read-only data source ${name}`) : `data source ${name}`)
        .filter((gap): gap is string => gap !== null),
      ...systems.filter(system => foundSystems.get(system) !== null)
        .map(system => foundSystems.has(system) ? `identifier system ${system} ${foundSystems.get(system)}` : `identifier system ${system}`),
    ]
    const optional = unset.filter(({ optional }) => optional).map(({ name }) => {
      const operations = neededBy(name)
      return `optional secret ${name} (needed by ${operations.length ? operations.join(', ') : 'no read or action'})`
    })
    gaps.push({ app, title: declared.title ?? app, missing, optional })
  }
  return gaps
}

/** The secrets installed apps declare that are set here, with their values,
 *  so a settings export can withhold a setting that holds one. */
export async function declaredAppSecrets(): Promise<{ name: string; value: string }[]> {
  const rows = await sql`select manifest->'secrets' as secrets from installed_app where jsonb_typeof(manifest->'secrets') = 'array'`
  const names = [...new Set(rows.flatMap(row => secretEntries(row.secrets).map(entry => entry.name)))].sort()
  return names.flatMap(name => {
    const value = readNamedVariable(name)?.trim()
    return value ? [{ name, value }] : []
  })
}

/** The app's setup for one read or action, or its "not set up yet" answer
 *  when a required setting or secret, or an optional secret the operation
 *  `needs` (#666), has no value: never a crash in the app's handler. The
 *  answer names no setting or secret; the server log names the missing ones
 *  (names only, never a value).
 *
 *  The handler gets the required secrets and the optional ones it needs. An
 *  optional secret it does not declare it needs is withheld even when set,
 *  and reaching for it fails the operation, so a missing declaration shows
 *  up while the secret is set, not first on an instance that lacks it. */
export async function readyAppSetup(app: string, setup: AppSetup, needs: readonly string[] = []): Promise<AppSetup> {
  const optional = new Set(setup.optionalSecrets)
  const used = (name: string) => !optional.has(name) || needs.includes(name)
  const settings = setup.missing.settings
  const secrets = setup.missing.secrets.filter(used)
  if (settings.length || secrets.length) {
    console.warn(`[apps] ${app} is not set up yet; missing ${[
      ...settings.map(name => `setting ${name}`), ...secrets.map(name => `secret ${name}`)].join(', ')}`)
    throw new AppError('NotSetUpError', `${setup.title} is not set up yet. An administrator needs to finish setting it up.`)
  }
  const withheld = setup.optionalSecrets.filter(name => !used(name))
  if (!withheld.length) return setup
  const handed = Object.freeze(Object.fromEntries(Object.entries(setup.secrets).filter(([name]) => used(name))))
  return { ...setup, secrets: new Proxy(handed, {
    get(target, key, receiver) {
      if (typeof key === 'string' && withheld.includes(key)) {
        console.warn(`[apps] ${app} used the secret ${key} in a read or action that does not declare it needs it`)
        throw new AppError('InternalError', `${setup.title} used a secret this read or action does not declare it needs. The app needs to declare it.`)
      }
      return Reflect.get(target, key, receiver)
    },
  }) }
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
