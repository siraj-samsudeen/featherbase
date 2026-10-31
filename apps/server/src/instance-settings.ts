// Instance settings as code (#465, design D2–D4, D7, D9): an instance keeps its
// non-secret settings in one reviewed file. This module declares which
// settings a file may manage, applies a file (or previews it) in one
// transaction through saveDoc as the actor `instance-settings`, and exports an
// environment's settings in the file's own shape, never with a secret in it.
import { z } from 'zod'
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { getMeta, ROW_KEY, type TableMeta } from './meta'
import { tableRelation } from './table-engine'
import { saveDoc } from './document'
import { logActivity } from './audit'
import { appOperation } from './app-lifecycle'
import { actionTransaction } from './action-transaction'
import { runAsSystemActor } from './system-actor'
import { INSTANCE_SETTINGS_ACTOR, holdManagedSet, holdManagedSetExclusive, lastApply, recordApply, type ManagedPath, type ManagedValue } from './managed-settings'
import { config } from './config'
import { declaredAppSecretNames, declaredAppSecrets } from './app-settings'
import { DEV_ENVIRONMENTS, SETTINGS_CONDITIONS, VARIABLES, isSet, readVariable, type Variable, type VariableName } from './env'

/** Who an apply's saves are recorded as (D4). */
export { INSTANCE_SETTINGS_ACTOR }

// ---------------------------------------------------------------- scope (D2)

/** What a settings file may manage, declared here and not by the file, so a
 *  file can never reach people, roles or data. `settings` is a Settings Table
 *  (one object); `rows` is a Table whose rows are named by `row_id`. */
const SCOPE = [
  { table: 'System Settings', shape: 'settings', fields: 'all', fileFields: ['privacy_notice'] },
  // Every field of a sign-in method is configuration; its secrets (the Google
  // client secret) are deployment variables, never columns.
  { table: 'Sign In Method', shape: 'rows', fields: 'all', createRows: true },
  // A scheduled job is code; the file switches it on or off and sets how
  // often it runs (#700). Its cadence is a Choice, so a made-up one is
  // refused by the save, listed with the file's other problems.
  { table: 'Scheduled Job', shape: 'rows', fields: ['enabled', 'cadence'], createRows: false },
  // #620 (E2): an installed app's declared settings, one row per
  // `<app>.<setting>`. The App Setting controller refuses a setting the app
  // does not declare. An app's secrets are deployment variables, never rows.
  { table: 'App Setting', shape: 'rows', fields: ['value'], createRows: true },
  // #703: where an instance's outside data lives, so it comes back after a
  // wipe. A row names the variable holding the connection (url_env; the save
  // refuses a connection string), never the connection itself. The connection
  // status columns are the server's own, so they stay out.
  { table: 'Data Source', shape: 'rows', fields: ['engine', 'url_env', 'default_schema', 'access', 'table_allowlist'], createRows: true },
] as const

/** Column types that hold no value, a secret, or a file in one instance's own
 *  storage (the System Settings logo, #380): never in scope. A settings file
 *  can carry none of them from one environment to another. */
const UNMANAGED_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break', 'Tab Break', 'Password', 'Attach', 'Attach Image'])

interface ScopeEntry {
  table: string
  shape: 'settings' | 'rows'
  fields: string[]
  /** Fields whose value the file may keep in a separate file ({ file }). */
  fileFields: string[]
  /** May an apply create a row the environment does not have? */
  createRows: boolean
}

export async function managedScope(): Promise<ScopeEntry[]> {
  const out: ScopeEntry[] = []
  for (const entry of SCOPE) {
    const meta = await getMeta(entry.table)
    const valued = meta.columns.filter((c) => !UNMANAGED_TYPES.has(c.column_type)).map((c) => c.column_name)
    out.push({
      table: entry.table,
      shape: entry.shape,
      fields: entry.fields === 'all' ? valued : valued.filter((f) => (entry.fields as readonly string[]).includes(f)),
      fileFields: [...('fileFields' in entry ? entry.fileFields : [])],
      createRows: 'createRows' in entry ? entry.createRows : false,
    })
  }
  return out
}

// ---------------------------------------------------------------- the file (D1)

const rowSchema = z.object({ row_id: z.string().min(1) }).catchall(z.unknown())
const settingsBlock = z.record(z.string(), z.union([z.array(rowSchema), z.record(z.string(), z.unknown())]))

const instanceSettingsFileSchema = z
  .object({
    settings: settingsBlock,
    environments: z.record(z.string(), z.object({ settings: settingsBlock.optional() }).strict()).optional(),
  })
  .strict()

export type InstanceSettingsFile = z.infer<typeof instanceSettingsFileSchema>

/** POST /api/instance-settings/apply. The file is checked by the apply itself,
 *  so its problems are reported in the apply's own terms. */
export const applyRequestSchema = z
  .object({
    file: z.unknown(),
    environment: z.string().min(1).optional(),
    dry_run: z.boolean().optional(),
    source: z.object({ revision: z.string().optional(), run: z.string().optional() }).strict().optional(),
    files: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict()
type Block = z.infer<typeof settingsBlock>
type Row = Record<string, unknown> & { row_id: string }

/** The environment's section on top of the base: an object merges field by
 *  field; rows merge by row_id, and a row only the section names is added. */
function withOverlay(base: Block, overlay: Block | undefined): Block {
  const out: Block = { ...base }
  for (const [table, value] of Object.entries(overlay ?? {})) {
    const under = out[table]
    if (Array.isArray(value) && Array.isArray(under)) {
      const rows = under.map((r) => ({ ...r }))
      for (const row of value) {
        const same = rows.find((r) => r.row_id === row.row_id)
        if (same) Object.assign(same, row)
        else rows.push({ ...row })
      }
      out[table] = rows
    } else if (value && under && !Array.isArray(value) && !Array.isArray(under)) {
      out[table] = { ...under, ...value }
    } else {
      out[table] = value
    }
  }
  return out
}

// ---------------------------------------------------------------- values

type ValueKind = 'check' | 'int' | 'number' | 'json' | 'text'

function kindOf(columnType: string): ValueKind {
  if (columnType === 'Check') return 'check'
  if (columnType === 'Int') return 'int'
  if (columnType === 'Float' || columnType === 'Currency' || columnType === 'Percent') return 'number'
  if (columnType === 'JSON') return 'json'
  return 'text'
}

/** A stored value in the file's own terms: what export writes and what an
 *  apply compares. Blank text and an unset value are the same. */
function fromStored(kind: ValueKind, v: unknown, jsonAsText = false): unknown {
  if (kind === 'check') return v === true || v === 1 || v === '1' || v === 'true'
  if (v === undefined || v === null || v === '') return null
  if (kind === 'int' || kind === 'number') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (kind === 'json') {
    // A jsonb column arrives decoded: a string in it is a JSON string, not
    // JSON text. Only the Settings store (single_value) keeps JSON as text.
    if (typeof v !== 'string' || !jsonAsText) return v
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  }
  return v instanceof Date ? v.toISOString() : String(v)
}

const WANTS: Record<ValueKind, string> = {
  check: 'true or false',
  int: 'a whole number',
  number: 'a number',
  json: 'JSON',
  text: 'text',
}

/** A file value, checked for its type (the save then checks choices and the
 *  rest). Undefined when the type is wrong. */
function fromFile(kind: ValueKind, v: unknown): unknown {
  if (v === null) return kind === 'check' ? false : null
  switch (kind) {
    case 'check':
      return typeof v === 'boolean' ? v : undefined
    case 'int':
      return Number.isInteger(v) ? v : undefined
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined
    case 'json':
      return v
    case 'text':
      return typeof v === 'string' ? (v === '' ? null : v) : undefined
  }
}

/** A value from a variable, in the field's own type. Undefined when it isn't. */
function fromVariable(kind: ValueKind, text: string): unknown {
  const v = text.trim()
  switch (kind) {
    case 'check':
      return v === 'true' ? true : v === 'false' ? false : undefined
    case 'int':
    case 'number': {
      const n = v === '' ? Number.NaN : Number(v)
      return Number.isFinite(n) && (kind === 'number' || Number.isInteger(n)) ? n : undefined
    }
    case 'json':
      try {
        return JSON.parse(text)
      } catch {
        return undefined
      }
    case 'text':
      return text
  }
}

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Key-order-independent JSON, so `{a,b}` and `{b,a}` are the same value. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)

// ---------------------------------------------------------------- values from variables (#703)

const pathKey = (table: string, rowId: string, field: string) => `${table}|${rowId}|${field}`
const withheldValue = (variable: string) => `[the value of ${variable}]`

/** The fields the last apply recorded as coming from a variable. */
function variableOrigins(apply: Awaited<ReturnType<typeof lastApply>>): Map<string, ManagedValue> {
  const origins = (apply?.managed_values ?? []).filter((v) => v.from_variable)
  return new Map(origins.map((v) => [pathKey(v.table, v.row_id, v.field), v]))
}

/** The variable a field's stored value came from, if it is still that value:
 *  a field the file stopped naming is an ordinary setting again once someone
 *  changes it. A field the file still names stays the variable's, whatever an
 *  emergency change has put there. */
function originOf(origins: Map<string, ManagedValue>, table: string, rowId: string, field: string, stored: unknown): string | undefined {
  const origin = origins.get(pathKey(table, rowId, field))
  if (!origin) return undefined
  return !origin.not_in_file || same(origin.value, stored ?? null) ? origin.from_variable : undefined
}

// ---------------------------------------------------------------- reading

async function storedSettings(meta: TableMeta, fields: string[]): Promise<Record<string, unknown>> {
  const rows = await sql`select field, value from single_value where table_name = ${meta.name}`
  const raw = new Map(rows.map((r) => [r.field as string, r.value]))
  const out: Record<string, unknown> = {}
  // A field with no stored row is ABSENT (its default is in effect), which is
  // not the same as a stored null or false: setting either over a default is
  // a change (Codex bot P2 on #491).
  for (const f of fields) out[f] = raw.has(f) ? fromStored(kindOf(columnType(meta, f)), raw.get(f), true) : undefined
  return out
}

/** Each row's managed values, and the `updated_at` a save must echo (the
 *  save path's optimistic-concurrency check, DOC-002). */
async function storedRows(meta: TableMeta, fields: string[], stamps?: Map<string, unknown>): Promise<Map<string, Record<string, unknown>>> {
  const rows = await sql`select * from ${sql(await tableRelation(meta.name))} order by ${sql(meta.row_key)}`
  const out = new Map<string, Record<string, unknown>>()
  for (const r of rows) {
    const values: Record<string, unknown> = {}
    for (const f of fields) values[f] = fromStored(kindOf(columnType(meta, f)), r[f])
    out.set(String(r[meta.row_key]), values)
    stamps?.set(String(r[meta.row_key]), r.updated_at)
  }
  return out
}

async function storedFields(meta: TableMeta, fields: string[]): Promise<Map<string, Record<string, unknown>>> {
  return meta.kind === 'settings' ? new Map([[meta.name, await storedSettings(meta, fields)]]) : storedRows(meta, fields)
}

function columnType(meta: TableMeta, field: string): string {
  return meta.columns.find((c) => c.column_name === field)?.column_type ?? 'Data'
}

// ---------------------------------------------------------------- apply (D4)

interface SettingChange {
  table: string
  row_id: string
  field: string
  old: unknown
  new: unknown
  /** The row did not exist and the apply created it. */
  created?: true
  /** The field had no stored value (its default was in effect). */
  was_default?: true
  /** #703: the new value came from this variable, so old and new are not
   *  shown. A value that had come from a variable and is being replaced by the
   *  file's own shows as `[the value of NAME]` in old. */
  from_variable?: string
}

interface ApplyResult {
  dry_run: boolean
  /** The file's environment section that was applied, if any. */
  environment: string | null
  changes: SettingChange[]
  summary: string
  /** Problems that do not stop an apply here (a feature's missing secret on
   *  a development or test server). */
  warnings: string[]
}

interface ApplyOptions {
  /** The principal that sent the file, recorded in the Activity Log. */
  by: string
  /** Which of the file's `environments` sections to apply on top. */
  environment?: string
  dryRun?: boolean
  /** The file's commit and the workflow run that sent it (D4). */
  source?: { revision?: string; run?: string }
  /** Contents of the files the settings name with { file } (D2). */
  files?: Record<string, string>
  /** Values of the variables the settings name with { env } (#703), read by
   *  the sender, as { file } contents are: the server never reads its own
   *  environment for a file, so a file cannot pull a variable out of it. */
  env?: Record<string, string>
  /** The environment this server runs as, for the feature-secret check (D7).
   *  Defaults to this process's. */
  serverEnvironment?: string
}

const SOURCE_PART = /^[A-Za-z0-9._-]{1,40}$/

class DryRun extends Error {
  constructor(readonly result: ApplyResult) {
    super('dry run')
  }
}

function summarize(n: number, dryRun: boolean): string {
  if (!n) return 'nothing changed'
  const noun = n === 1 ? 'setting' : 'settings'
  return dryRun ? `${n} ${noun} would change` : `${n} ${noun} changed`
}

function refuse(problems: Record<string, string>, hide: ReadonlyMap<string, string> = new Map()): never {
  // A save's refusal may quote the value it refused.
  for (const [path, why] of Object.entries(problems)) {
    let text = why
    for (const [value, name] of hide) text = text.split(value).join(withheldValue(name))
    problems[path] = text
  }
  const lines = Object.entries(problems).map(([path, why]) => `- ${path}: ${why}`)
  throw new AppError('ValidationError', `The settings file was not applied; nothing changed.\n${lines.join('\n')}`, problems)
}

/** Apply a settings file to this environment, or preview it (`dryRun`).
 *  Every problem is listed at once and nothing is written; otherwise every
 *  change lands in one transaction, through saveDoc, as `instance-settings`. */
export async function applyInstanceSettings(input: unknown, opts: ApplyOptions): Promise<ApplyResult> {
  const parsed = instanceSettingsFileSchema.safeParse(input)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || 'file'] = issue.message
    throw new AppError('ValidationError', `The settings file is malformed: ${Object.entries(fields).map(([k, v]) => `${k} ${v}`).join('; ')}`, fields)
  }
  const file = parsed.data
  for (const [key, value] of Object.entries(opts.source ?? {}))
    if (value !== undefined && !SOURCE_PART.test(value))
      throw new AppError('ValidationError', `source.${key} must be up to 40 letters, digits, dots, dashes or underscores`, { [`source.${key}`]: 'invalid' })

  // Which section: required when the file has sections, so a typo or a
  // forgotten name cannot quietly apply the base alone.
  const sections = Object.keys(file.environments ?? {})
  let overlay: Block | undefined
  if (opts.environment !== undefined) {
    if (!sections.includes(opts.environment))
      throw new AppError('ValidationError', `The settings file has no environment "${opts.environment}" (it lists: ${sections.join(', ') || 'none'})`, { environment: 'unknown' })
    overlay = file.environments![opts.environment].settings
  } else if (sections.length) {
    throw new AppError('ValidationError', `Name the environment to apply (the file lists: ${sections.join(', ')})`, { environment: 'required' })
  }
  const desired = withOverlay(file.settings, overlay)

  const scope = await managedScope()
  const problems: Record<string, string> = {}
  const plan: { entry: ScopeEntry; meta: TableMeta; rows: { row_id: string; values: Record<string, unknown> }[] }[] = []
  // #703: which fields came from a variable, and the values never to print.
  const fromVariables = new Map<string, string>()
  const hiddenValues = new Map<string, string>()
  const secretNames = new Set([
    ...(VARIABLES as readonly Variable[]).filter((v) => v.secret).map((v) => v.name as string),
    ...(await declaredAppSecretNames()),
  ])

  // 1. The shape, the names and the types, before anything is read or saved.
  for (const [table, value] of Object.entries(desired)) {
    const entry = scope.find((s) => s.table === table)
    if (!entry) {
      problems[table] = `${table} is not managed by the settings file (it manages: ${scope.map((s) => s.table).join(', ')})`
      continue
    }
    const meta = await getMeta(table)
    const given: Row[] = entry.shape === 'settings'
      ? (Array.isArray(value) ? [] : [{ ...value, row_id: table }])
      : (Array.isArray(value) ? value : [])
    if ((entry.shape === 'settings') === Array.isArray(value)) {
      problems[table] = entry.shape === 'settings' ? `${table} takes one object of fields` : `${table} takes a list of rows, each with a row_id`
      continue
    }
    const seen = new Set<string>()
    const rows: { row_id: string; values: Record<string, unknown> }[] = []
    for (const row of given) {
      const where = entry.shape === 'settings' ? table : `${table}.${row.row_id}`
      if (seen.has(row.row_id)) problems[where] = `${table} names row ${row.row_id} twice`
      seen.add(row.row_id)
      const values: Record<string, unknown> = {}
      for (const [field, raw] of Object.entries(row)) {
        if (field === ROW_KEY) continue
        const path = `${where}.${field}`
        const column = meta.columns.find((c) => c.column_name === field)
        if (!column || UNMANAGED_TYPES.has(column.column_type)) {
          problems[path] = `${table} has no field ${field}`
          continue
        }
        if (!entry.fields.includes(field)) {
          problems[path] = `${table}.${field} is not managed by the settings file (it manages: ${entry.fields.join(', ')})`
          continue
        }
        let v = raw
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'env' in v) {
          const name = (v as { env: unknown }).env
          const text = typeof name === 'string' ? opts.env?.[name] : undefined
          if (typeof name !== 'string' || !VARIABLE_NAME.test(name)) {
            problems[path] = `${table}.${field} names a variable with { "env": ... }, which must be a variable name`
          } else if (secretNames.has(name)) {
            problems[path] = `${table}.${field} names the variable ${name}, which holds a secret; a secret stays a deployment variable and is never saved in a Table`
          } else if (!text?.trim()) {
            problems[path] = `${table}.${field} reads the variable ${name}, which is not set or is empty`
          } else {
            const value = fromVariable(kindOf(column.column_type), text)
            if (value === undefined) problems[path] = `${table}.${field} wants ${WANTS[kindOf(column.column_type)]}, and the variable ${name} holds something else`
            else {
              values[field] = value
              fromVariables.set(pathKey(table, row.row_id, field), name)
              hiddenValues.set(text, name)
            }
          }
          continue
        }
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'file' in v && kindOf(column.column_type) === 'text') {
          const name = (v as { file: unknown }).file
          const text = typeof name === 'string' ? opts.files?.[name] : undefined
          if (text === undefined) {
            problems[path] = `${table}.${field} names the file ${String(name)}, which was not provided`
            continue
          }
          v = text
        }
        const value = fromFile(kindOf(column.column_type), v)
        if (value === undefined) {
          problems[path] = `${table}.${field} wants ${WANTS[kindOf(column.column_type)]}`
          continue
        }
        values[field] = value
      }
      rows.push({ row_id: row.row_id, values })
    }
    plan.push({ entry, meta, rows })
  }
  // Not refused yet: the saves below find the problems only a save can (a
  // value outside a field's choices, a missing row), and every problem is
  // listed at once. The transaction rolls back whole either way.

  // 2. Compare, save what differs, and read back what was written — in one
  //    transaction that a problem, or a dry run, rolls back whole.
  const run = async (): Promise<ApplyResult> => {
    // D5: no save of a lockable Table runs between this read and the commit
    // that publishes the new locked set (managed-settings.ts).
    await holdManagedSetExclusive(sql)
    const origins = variableOrigins(await lastApply())
    for (const { value, from_variable } of origins.values())
      if (typeof value === 'string' && value && !hiddenValues.has(value)) hiddenValues.set(value, from_variable!)
    const changes: SettingChange[] = []
    const warnings: string[] = []
    // What each managed field holds once the saves are done: the "settings
    // match the file" health check compares against it (D8).
    const appliedValues: ManagedValue[] = []
    for (const { entry, meta, rows } of plan) {
      const stamps = new Map<string, unknown>()
      const before = entry.shape === 'settings'
        ? new Map([[meta.name, await storedSettings(meta, entry.fields)]])
        : await storedRows(meta, entry.fields, stamps)
      for (const { row_id, values } of rows) {
        const where = entry.shape === 'settings' ? meta.name : `${meta.name}.${row_id}`
        const current = before.get(row_id)
        if (!current && !entry.createRows) {
          problems[where] = `${meta.name} has no row ${row_id}`
          continue
        }
        const differing = Object.fromEntries(Object.entries(values).filter(([f, v]) => !current || current[f] === undefined || !same(current[f], v)))
        if (!Object.keys(differing).length) continue
        try {
          if (entry.shape === 'settings') await saveDoc(meta.name, differing, INSTANCE_SETTINGS_ACTOR)
          else if (current) await saveDoc(meta.name, { [ROW_KEY]: row_id, ...differing, updated_at: stamps.get(row_id) }, INSTANCE_SETTINGS_ACTOR)
          else await saveDoc(meta.name, { [ROW_KEY]: row_id, ...differing }, INSTANCE_SETTINGS_ACTOR, 'insert')
        } catch (err) {
          if (!(err instanceof AppError)) throw err
          const fields = Object.entries(err.fields ?? {})
          if (fields.length) for (const [f, why] of fields) problems[`${where}.${f}`] = `${err.message}: ${f} ${why}`
          else problems[where] = err.message
          continue
        }
      }
      // What the saves actually left (a hook may normalise a value), field by field.
      const after = entry.shape === 'settings'
        ? new Map([[meta.name, await storedSettings(meta, entry.fields)]])
        : await storedRows(meta, entry.fields)
      for (const { row_id, values } of rows) {
        const old = before.get(row_id)
        const now = after.get(row_id)
        if (!now) continue
        for (const field of Object.keys(values)) {
          const variable = fromVariables.get(pathKey(meta.name, row_id, field))
          appliedValues.push({ table: meta.name, row_id, field, value: now[field] ?? null, ...(variable ? { from_variable: variable } : {}) })
        }
        for (const field of Object.keys(values)) {
          const was = old ? (old[field] ?? null) : null
          if (old && old[field] !== undefined && same(was, now[field])) continue
          if (now[field] === undefined) continue
          if (!old && now[field] === null) continue
          const fromVariable = fromVariables.get(pathKey(meta.name, row_id, field))
          const replacedVariable = originOf(origins, meta.name, row_id, field, was)
          changes.push({
            table: meta.name, row_id, field,
            old: fromVariable ? null : replacedVariable ? withheldValue(replacedVariable) : was,
            new: fromVariable ? null : now[field],
            ...(fromVariable ? { from_variable: fromVariable } : {}),
            ...(old ? {} : { created: true as const }),
            ...(old && old[field] === undefined ? { was_default: true as const } : {}),
          })
        }
      }
    }
    // 3. A feature the file leaves on needs its own secret (D7).
    const serverEnvironment = opts.serverEnvironment ?? config.environment
    const { settingsRequirements } = await import('./release-preflight')
    const { conditions } = await settingsRequirements()
    for (const v of VARIABLES as readonly Variable[]) {
      if (typeof v.required !== 'object' || !conditions?.has(v.required.when) || isSet(v.name as VariableName)) continue
      const why = `${v.name} is not set on this "${serverEnvironment}" server, and with this file ${SETTINGS_CONDITIONS[v.required.when]}.`
      if (DEV_ENVIRONMENTS.includes(serverEnvironment)) warnings.push(`WARNING: ${why}`)
      else problems[v.name] = `${why} Set the variable first, then apply again.`
    }
    if (Object.keys(problems).length) refuse(problems, hiddenValues)

    const result: ApplyResult = {
      dry_run: Boolean(opts.dryRun),
      environment: opts.environment ?? null,
      changes,
      summary: summarize(changes.length, Boolean(opts.dryRun)),
      warnings,
    }
    if (opts.dryRun) throw new DryRun(result)
    // D5: what this file sets is what Admin may no longer change, until the
    // next successful apply replaces it.
    const managed: ManagedPath[] = plan.flatMap(({ meta, rows }) =>
      rows.flatMap(({ row_id, values }) => Object.keys(values).map((field) => ({ table: meta.name, row_id, field }))))
    // A field this file stops naming keeps the variable's value, so that value
    // stays private until someone changes it.
    const named = new Set(managed.map((p) => pathKey(p.table, p.row_id, p.field)))
    for (const [key, origin] of origins) {
      if (named.has(key)) continue
      const current = (await storedFields(await getMeta(origin.table), [origin.field])).get(origin.row_id)
      if (current && same(origin.value, current[origin.field] ?? null)) appliedValues.push({ ...origin, not_in_file: true })
    }
    await recordApply(sql, {
      applied_by: opts.by,
      environment: opts.environment ?? null,
      revision: opts.source?.revision ?? null,
      run: opts.source?.run ?? null,
      managed_paths: managed,
      managed_values: appliedValues,
    })
    const source = [opts.source?.revision && `revision ${opts.source.revision}`, opts.source?.run && `run ${opts.source.run}`].filter(Boolean).join(' ')
    const section = opts.environment ? ` ${opts.environment}` : ''
    await logActivity(INSTANCE_SETTINGS_ACTOR, `settings_apply${section}${source ? ` ${source}` : ''}: ${result.summary}`.slice(0, 140), {
      full_name: `instance settings file, applied by ${opts.by}`.slice(0, 140),
    })
    return result
  }

  try {
    return await appOperation(() => runAsSystemActor(INSTANCE_SETTINGS_ACTOR, () => actionTransaction(run)))
  } catch (err) {
    if (err instanceof DryRun) return err.result
    throw err
  }
}

// ---------------------------------------------------------------- drift (D8)

/** A locked field whose value is no longer what the last apply left. */
interface SettingDrift {
  table: string
  row_id: string
  field: string
  /** #703: the file sets this field from this variable. */
  from_variable?: string
}

/** The managed fields that differ from the last apply: [] before any apply
 *  or when nothing differs; null when that apply kept no values (an apply
 *  recorded before 0123), so nothing can be compared. */
export async function settingsDrift(): Promise<SettingDrift[] | null> {
  return (await settingsAgainstFile()).drift
}

/** The last apply and the drift from it, read together under the
 *  managed-settings lock, so an apply committing between the reads can
 *  neither look like drift (Codex review) nor pair one apply's revision with
 *  drift measured against the next (#640 review). */
export async function settingsAgainstFile(): Promise<{ apply: Awaited<ReturnType<typeof lastApply>>; drift: SettingDrift[] | null }> {
  return withTransaction(async () => {
    await holdManagedSet(sql, null)
    const apply = await lastApply()
    return { apply, drift: await driftFrom(apply) }
  })
}

async function driftFrom(apply: Awaited<ReturnType<typeof lastApply>>): Promise<SettingDrift[] | null> {
  if (!apply) return []
  if (apply.managed_values === null) return null
  const drift: SettingDrift[] = []
  const managed = apply.managed_values.filter((v) => !v.not_in_file)
  const tables = [...new Set(managed.map((v) => v.table))]
  for (const table of tables) {
    const recorded = managed.filter((v) => v.table === table)
    const meta = await getMeta(table)
    const fields = [...new Set(recorded.map((v) => v.field))]
    const current = await storedFields(meta, fields)
    for (const v of recorded) {
      const row = current.get(v.row_id)
      if (!row || !same(v.value, row[v.field] ?? null))
        drift.push({ table: v.table, row_id: v.row_id, field: v.field, ...(v.from_variable ? { from_variable: v.from_variable } : {}) })
    }
  }
  return drift
}

// ---------------------------------------------------------------- export (D9)

interface ExportResult {
  file: InstanceSettingsFile
  /** Fields left out because their value looks like a secret, with why. */
  withheld: string[]
}

/** URL credentials: `scheme://user:password@` or `scheme://token@`. */
const URL_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+@/i
/** JSON keys that name a secret. */
const SECRET_KEY = /pass(word)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|signature|authorization/i
/** A secret-named key with a value in text: a URL's `?token=…`, a DSN's
 *  `password=…`, `api_key=…`. */
const SECRET_ASSIGNMENT = /(?:^|[^a-z0-9])(?:pass(?:word)?|pwd|secret|client[_-]?secret|token|access[_-]?token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?|sig(?:nature)?|auth(?:orization)?)\s*=\s*[^\s&;,'"]+/i
/** An HTTP authorization value written out. */
const AUTH_VALUE = /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}/i

/** Every key path in a JSON value that names a secret, sorted. */
function secretKeysIn(v: unknown, at = ''): string[] {
  const out: string[] = []
  if (Array.isArray(v)) v.forEach((item, i) => out.push(...secretKeysIn(item, `${at}[${i}]`)))
  else if (v && typeof v === 'object')
    for (const [k, item] of Object.entries(v)) {
      const path = at ? `${at}.${k}` : k
      if (SECRET_KEY.test(k)) out.push(path)
      else out.push(...secretKeysIn(item, path))
    }
  return out.sort()
}

/** Why a value must not leave the server, or null. The scope holds no secret
 *  field (D4), so this is the second guard: a secret pasted into a setting. */
function secretIn(value: unknown, appSecrets: readonly { name: string; value: string }[] = []): string | null {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const v of VARIABLES as readonly Variable[]) {
    if (!v.secret) continue
    const secret = readVariable(v.name as VariableName)?.trim()
    if (secret && secret.length >= 6 && text.includes(secret)) return `holds the value of ${v.name}`
  }
  // #620: the secrets installed apps declare are deployment variables too.
  // An app named each one as a secret, so even a short value is withheld.
  for (const { name, value: secret } of appSecrets)
    if (text.includes(secret)) return `holds the value of ${name}`
  if (URL_CREDENTIALS.test(text)) return 'a web address with credentials in it'
  if (SECRET_ASSIGNMENT.test(text)) return 'names a secret with its value (a password=, token= or key= setting)'
  if (AUTH_VALUE.test(text)) return 'holds an authorization value'
  // JSON written as text is checked like JSON.
  let parsed: unknown = value
  if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = value
    }
  }
  const keys = typeof parsed === 'object' ? secretKeysIn(parsed) : []
  if (keys.length) return `holds ${keys.length === 1 ? 'a key that names' : 'keys that name'} a secret (${keys.join(', ')})`
  return null
}

/** This environment's managed settings in the file's own shape (D9). Unset
 *  fields are left out (they keep their defaults, unmanaged). A field set from
 *  a variable exports as that variable's name, never its value (#703). */
export async function exportInstanceSettings(): Promise<ExportResult> {
  // Under the managed-settings lock: an apply committing between reading the
  // origins and reading the values would export a variable's value (#703).
  return withTransaction(async () => {
    await holdManagedSet(sql, null)
    return exportUnderLock()
  })
}

async function exportUnderLock(): Promise<ExportResult> {
  const settings: Block = {}
  const withheld: string[] = []
  const appSecrets = await declaredAppSecrets()
  const origins = variableOrigins(await lastApply())
  for (const entry of await managedScope()) {
    const meta = await getMeta(entry.table)
    const keep = (where: string, rowId: string, values: Record<string, unknown>) => {
      const out: Record<string, unknown> = {}
      for (const [field, value] of Object.entries(values)) {
        const variable = originOf(origins, entry.table, rowId, field, value)
        if (variable) {
          out[field] = { env: variable }
          continue
        }
        if (value === null || value === undefined) continue
        const why = secretIn(value, appSecrets)
        if (why) withheld.push(`${where}.${field}: ${why}`)
        else out[field] = value
      }
      return out
    }
    if (entry.shape === 'settings') {
      settings[entry.table] = keep(entry.table, entry.table, await storedSettings(meta, entry.fields))
    } else {
      const rows: Row[] = []
      for (const [rowId, values] of await storedRows(meta, entry.fields))
        rows.push({ row_id: rowId, ...keep(`${entry.table}.${rowId}`, rowId, values) })
      settings[entry.table] = rows
    }
  }
  return { file: { settings }, withheld }
}
