// #620 (design E2, revised by ADR 0013): an app declares the settings and
// secrets it needs. A setting holds what differs per instance (which Dive dev
// uses, say); its value lives in the App Setting security Table, keyed by app
// and name, and an instance sets it through its settings file
// (instance-settings.ts). A secret stays a deployment variable: read here,
// handed to the app's handlers, and never stored, logged or returned.
import { inspect } from 'node:util'
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

/** The App Setting row ID for one app's setting. */
export const appSettingId = (app: string, setting: string) => `${app}.${setting}`

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
export async function appSetupState(where: { installed?: string; settings?: string | null } = {}): Promise<{ app: string; title: string; missing: string[] }[]> {
  const installed = where.installed ?? platformRelation('installed_app')
  const settings = where.settings === undefined ? platformRelation('app_setting') : where.settings
  const rows = await sql`select name, manifest from ${sql(installed)}
    where enabled and (manifest ? 'settings' or manifest ? 'secrets') order by name`
  const gaps: { app: string; title: string; missing: string[] }[] = []
  for (const row of rows) {
    const app = String(row.name)
    const declared = (row.manifest ?? {}) as { title?: string; settings?: { name: string; required: boolean }[]; secrets?: string[] }
    const required = (declared.settings ?? []).filter(s => s.required).map(s => s.name)
    const filled = settings && required.length
      ? new Set((await sql`select setting from ${sql(settings)} where app = ${app} and coalesce(trim(value), '') <> ''`).map(r => String(r.setting)))
      : new Set<string>()
    const missing = [
      ...required.filter(name => !filled.has(name)).map(name => `setting ${name}`),
      ...(declared.secrets ?? []).filter(name => !present(readNamedVariable(name))).map(name => `secret ${name}`),
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

function holdsSecret(secrets: Readonly<Record<string, string>>, text: string): boolean {
  return Object.values(secrets).some(value => text.includes(value))
}

/** Refuse an answer (already JSON) that holds one of the app's secrets. */
export function assertNoSecret(secrets: Readonly<Record<string, string>>, json: string): void {
  if (holdsSecret(secrets, json)) throw new AppError('InternalError', WITHHELD_ANSWER)
}

/** Run the app's code; an error it raises that holds one of its secrets
 *  anywhere a log line or a response could show (message, fields, stack,
 *  cause, own properties) is replaced by one that does not. */
export async function withSecretsKept<T>(secrets: Readonly<Record<string, string>>, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!Object.keys(secrets).length) throw error
    let text: string
    try { text = inspect(error, { depth: 8, showHidden: true, breakLength: Infinity }) } catch { text = String(error) }
    if (error instanceof AppError && error.fields) text += JSON.stringify(error.fields)
    if (!holdsSecret(secrets, text)) throw error
    throw error instanceof AppError ? new AppError(error.type, WITHHELD_MESSAGE) : new Error(WITHHELD_MESSAGE)
  }
}
