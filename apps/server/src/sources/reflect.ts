import { sanitizeHeaders, prettifyLabel, tableNameFromFile } from 'shared'
import { sql } from '../db'
import { AppError } from '../errors'
import { createTable } from '../doctype-engine'
import { ensureHomePageForTable } from '../home-pages'
import { invalidateMeta } from '../meta'
import { isSensitiveColumn } from '../sensitive-columns'
import { getDriver, getSource, assertAllowed } from './registry'
import type { IntrospectedTable, SourceConfig } from './types'

// EDS-2/EDS-3: browse a source and generate bound Tables from what it
// contains. Reflection is metadata-only — one table_def + column_defs per
// source table, no DDL anywhere (BV1).

// Columns that surface through the synthesized standard fields instead of a
// column_def of their own.
const MODIFIED_CANDIDATES = ['updated_at', 'modified', 'last_modified', 'modified_at']

export interface ReflectionCandidate {
  schema: string
  table: string
  pk: string | null
  bindable: boolean
  reason?: string
  proposed_name: string
  already_reflected: string | null
  columns: {
    name: string
    data_type: string
    column_type: string
    nullable: boolean
    is_pk: boolean
  }[]
}

function titleWords(raw: string): string {
  return (
    tableNameFromFile(raw.replace(/\.csv$/i, '')) ||
    raw.replace(/[^A-Za-z0-9]+/g, ' ').trim()
  )
}

// Proposed Desk name: "<Prefix> <Table>", legal per the Table name rule.
function proposeName(cfg: SourceConfig, t: IntrospectedTable, prefix?: string): string {
  const defaultPrefix =
    cfg.engine === 'csv-folder'
      ? 'Seed'
      : titleWords(t.schema.split('.')[0] || cfg.name).split(' ')[0] || 'Src'
  const base = `${prefix ?? defaultPrefix} ${titleWords(t.table)}`
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 61)
    .trim()
  return /^[A-Za-z]/.test(base) ? base : `T ${base}`.slice(0, 61).trim()
}

async function candidateFor(
  cfg: SourceConfig,
  t: IntrospectedTable,
  prefix: string | undefined,
  reflected: Map<string, string>,
): Promise<ReflectionCandidate> {
  // Warehouse tables (duckdb) declare no PK; fall back to the first column —
  // read-only browsing tolerates a non-unique row address (the form shows
  // the first match), and no write path exists to misfire.
  const pk = t.pk ?? (cfg.engine === 'duckdb' ? (t.columns[0]?.name ?? null) : null)
  const bindKey = `${t.schema}\u0000${t.table}`
  const base: Omit<ReflectionCandidate, 'bindable' | 'reason'> = {
    schema: t.schema,
    table: t.table,
    pk,
    proposed_name: proposeName(cfg, t, prefix),
    already_reflected: reflected.get(bindKey) ?? null,
    columns: t.columns.map((c) => ({
      name: c.name,
      data_type: c.data_type,
      column_type: c.column_type,
      nullable: c.nullable,
      is_pk: c.is_pk,
    })),
  }
  if (!pk)
    return { ...base, bindable: false, reason: 'Needs a single-column primary key' }
  // The pk surfaces as the row's `name` everywhere — list values, URLs,
  // comments. A credential-named pk cannot be hidden the way an ordinary
  // column can, so the table is not bindable at all (review finding 7).
  if (isSensitiveColumn(pk))
    return {
      ...base,
      bindable: false,
      reason: `Primary key "${pk}" is a credential column name — not bindable`,
    }
  if (t.columns.filter((c) => c.name !== pk).length === 0)
    return { ...base, bindable: false, reason: 'Only the primary key column exists' }
  return { ...base, bindable: true }
}

export async function introspectSource(
  sourceName: string,
  schema?: string,
  prefix?: string,
): Promise<{ source: string; engine: string; access: string; tables: ReflectionCandidate[] }> {
  const cfg = await getSource(sourceName)
  const driver = getDriver(cfg)
  const introspected = await driver.introspect(cfg, schema)
  const rows = await sql<{ name: string; external_schema: string | null; external_table: string | null }[]>`
    select name, external_schema, external_table from table_def
    where data_source = ${sourceName}`
  const reflected = new Map(
    rows.map((r) => [`${r.external_schema ?? ''}\u0000${r.external_table ?? ''}`, r.name]),
  )
  const tables: ReflectionCandidate[] = []
  for (const t of introspected) tables.push(await candidateFor(cfg, t, prefix, reflected))
  return { source: cfg.name, engine: cfg.engine, access: cfg.access, tables }
}

// EDS-3 (review finding 10): a bound Table created directly through
// POST /api/doctype gets the same checks reflection applies — the source
// must exist, the relation must be in its allowlist, and every mapped
// column (plus the pk and modified column) must actually be there. Without
// this, a hand-written definition persists happily and only fails at query
// time. Called from createTable.
export async function assertBindingIsValid(def: {
  name: string
  data_source: string
  external_schema?: string
  external_table: string
  external_pk: string
  external_modified?: string
  columns: { column_name: string; source_column?: string }[]
}): Promise<void> {
  const cfg = await getSource(def.data_source) // NotFoundError if absent
  assertAllowed(cfg, def.external_schema ?? '', def.external_table)
  const driver = getDriver(cfg)
  const introspected = await driver.introspect(cfg, def.external_schema || undefined)
  const match = introspected.find(
    (t) =>
      t.table === def.external_table &&
      (!def.external_schema || t.schema === def.external_schema),
  )
  if (!match)
    throw new AppError('ValidationError', 'Unknown source relation', {
      external_table: `${def.external_schema ? `${def.external_schema}.` : ''}${def.external_table} does not exist on data source ${cfg.name}`,
    })
  const available = new Set(match.columns.map((c) => c.name))
  // Some drivers synthesize identity/revision columns that are not real
  // columns of the relation — csv-folder's positional `_row` and file-mtime
  // `_mtime`. Introspection reports the synthetic pk in `match.pk`.
  if (match.pk) available.add(match.pk)
  if (cfg.engine === 'csv-folder') available.add('_mtime')
  const errors: Record<string, string> = {}
  if (!available.has(def.external_pk))
    errors.external_pk = `Column ${def.external_pk} does not exist on the source relation`
  // The pk serializes as `name` and the modified column as `updated_at` on
  // every row — a credential-named mapping would leak the secret verbatim.
  // boundContext backstops this at query time; reject it at creation too.
  if (isSensitiveColumn(def.external_pk))
    errors.external_pk = `Column ${def.external_pk} is a credential column name and cannot be the primary key`
  if (def.external_modified && !available.has(def.external_modified))
    errors.external_modified = `Column ${def.external_modified} does not exist on the source relation`
  if (def.external_modified && isSensitiveColumn(def.external_modified))
    errors.external_modified = `Column ${def.external_modified} is a credential column name and cannot be the modified column`
  for (const c of def.columns) {
    const sc = c.source_column || c.column_name
    if (!available.has(sc))
      errors[c.column_name] = `Source column ${sc} does not exist on the source relation`
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', `Invalid binding for ${def.name}`, errors)
}

export interface ReflectResult {
  created: { table: string; name: string }[]
  skipped: { table: string; reason: string }[]
}

// EDS-3: generate one bound Table per requested source table.
export async function reflectTables(
  sourceName: string,
  opts: { schema?: string; tables: string[]; module?: string; prefix?: string },
): Promise<ReflectResult> {
  const cfg = await getSource(sourceName)
  const driver = getDriver(cfg)
  if (!opts.tables?.length)
    throw new AppError('ValidationError', 'Pass tables: the source table names to reflect')
  const introspected = await driver.introspect(cfg, opts.schema)
  // Entries are addressed by their schema-QUALIFIED identifier; a bare
  // table name is accepted only while unambiguous (review finding 4: two
  // schemas can hold same-named tables, and a name-keyed map would bind
  // whichever entry happened to win the map).
  const byQualified = new Map(
    introspected.map((t) => [t.schema ? `${t.schema}.${t.table}` : t.table, t]),
  )
  const byBareName = new Map<string, IntrospectedTable[]>()
  for (const t of introspected) {
    const list = byBareName.get(t.table) ?? []
    list.push(t)
    byBareName.set(t.table, list)
  }
  const rows = await sql<{ name: string; external_schema: string | null; external_table: string | null }[]>`
    select name, external_schema, external_table from table_def
    where data_source = ${sourceName}`
  const reflected = new Map(
    rows.map((r) => [`${r.external_schema ?? ''}\u0000${r.external_table ?? ''}`, r.name]),
  )

  const result: ReflectResult = { created: [], skipped: [] }
  for (const tableName of opts.tables) {
    let t = byQualified.get(tableName)
    if (!t) {
      const matches = byBareName.get(tableName) ?? []
      if (matches.length > 1) {
        result.skipped.push({
          table: tableName,
          reason: `Ambiguous — qualify it: ${matches.map((m) => `${m.schema}.${m.table}`).join(' or ')}`,
        })
        continue
      }
      t = matches[0]
    }
    if (!t) {
      result.skipped.push({ table: tableName, reason: 'Not found on the source' })
      continue
    }
    const candidate = await candidateFor(cfg, t, opts.prefix, reflected)
    if (!candidate.bindable) {
      result.skipped.push({ table: tableName, reason: candidate.reason! })
      continue
    }
    if (candidate.already_reflected) {
      result.skipped.push({
        table: tableName,
        reason: `Already reflected as ${candidate.already_reflected}`,
      })
      continue
    }
    assertAllowed(cfg, t.schema, t.table)
    try {
      const created = await buildBoundTable(cfg, t, candidate, opts)
      result.created.push({ table: tableName, name: created })
      reflected.set(`${t.schema}\u0000${t.table}`, created)
    } catch (err) {
      result.skipped.push({
        table: tableName,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return result
}

async function buildBoundTable(
  cfg: SourceConfig,
  t: IntrospectedTable,
  candidate: ReflectionCandidate,
  opts: { module?: string; prefix?: string },
): Promise<string> {
  const pk = candidate.pk!
  // The modified column surfaces as the standard updated_at; the pk surfaces
  // as name. Neither gets a column_def. On csv-folder the synthetic _mtime
  // plays the modified role.
  const modified =
    cfg.engine === 'csv-folder'
      ? '_mtime'
      : (t.columns.find(
          (c) =>
            MODIFIED_CANDIDATES.includes(c.name.toLowerCase()) && c.column_type === 'Datetime',
        )?.name ?? null)
  // Credential-named source columns are never reflected — the same names
  // the native path refuses to serialize (review finding 2). The runtime
  // binding filter in dispatch.ts backstops any that slip in later.
  const dataColumns = t.columns.filter(
    (c) => c.name !== pk && c.name !== modified && !isSensitiveColumn(c.name),
  )
  const legalNames = sanitizeHeaders(dataColumns.map((c) => c.name))
  const columns = dataColumns.map((c, i) => ({
    column_name: legalNames[i],
    source_column: c.name,
    label: prettifyLabel(c.name),
    column_type: c.column_type,
    // Write-relevant only on engines with a write path; keeps forms honest
    // about what the source will reject.
    reqd: (cfg.engine === 'postgres' || cfg.engine === 'mysql') && !c.nullable && !c.has_default,
    in_list_view: i < 4,
  }))
  const name = candidate.proposed_name
  const [clash] = await sql`select 1 from table_def where name = ${name}`
  if (clash) throw new AppError('ConflictError', `Table ${name} already exists`)
  await createTable({
    name,
    module: opts.module ?? cfg.name,
    kind: 'table',
    system: false,
    data_source: cfg.name,
    external_schema: t.schema,
    external_table: t.table,
    external_pk: pk,
    ...(modified ? { external_modified: modified } : {}),
    columns,
  })
  // Platform convention (#80): every new non-sub_table Table gets a link on
  // its module's home page — reflected Tables included, or they'd be
  // reachable only through All tables (and the 0060 idempotency contract
  // would break on the next migration re-run).
  await ensureHomePageForTable(name, opts.module ?? cfg.name)
  invalidateMeta(name)
  return name
}
