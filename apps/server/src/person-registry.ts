// The handler registry for person ids (person-rename R3; person-resolution D6
// reuses it for merges). Every text column of every relation Featherbase owns
// is classified, and only the classification decides what a re-id rewrites
// and what the post-check scan looks at:
//
//   id              holds a principal id → rewritten and scanned
//   json-with-ids   JSON of filter triples ([column, op, value]) on the Table
//                   its `typeColumn` names → only the values whose column is a
//                   Reference to a principal (or a history column) are
//                   rewritten and scanned
//   conditional-id  holds a principal id only when a sibling type column names
//                   Person or Service Account (share.share_name when
//                   share_table = 'Person') → those rows rewritten and scanned
//   code            not a person reference (an employee code, a sign-in
//                   subject, a table name, an address) → left alone
//   free-text       prose and history snapshots → left alone, never scanned
//
// A column nobody classified stops migration 0101 before the re-id, naming the
// column, and test/person-registry.test.ts holds the completeness rule.
// Matching is always exact-value, never a substring.
import { sql, type Sql, type TxSql } from './db'
import { PLATFORM_SCHEMA } from './platform-schema'

type ColumnClass = 'id' | 'json-with-ids' | 'conditional-id' | 'code' | 'free-text'

const PRINCIPAL_TABLES = ['Person', 'Service Account'] as const

interface ColumnSpec {
  class: ColumnClass
  /** conditional-id: the sibling column naming the row's Table. */
  typeColumn?: string
  /** A generated column follows its source; it is scanned, never written. */
  generated?: boolean
}

export interface ClassifiedColumn extends ColumnSpec {
  schema: string
  relation: string
  column: string
  /** The Table the relation stores, when metadata describes it. */
  table: string | null
  /** Why it has this class. */
  rule: string
}

export interface Classification {
  classified: ClassifiedColumn[]
  unclassified: { schema: string; relation: string; column: string; data_type: string }[]
}

const id: ColumnSpec = { class: 'id' }
const code: ColumnSpec = { class: 'code' }
const text: ColumnSpec = { class: 'free-text' }
const filters = (typeColumn: string): ColumnSpec => ({ class: 'json-with-ids', typeColumn })
const on = (typeColumn: string): ColumnSpec => ({ class: 'conditional-id', typeColumn })

// Platform relations, by basename. `*` is the class of any column of that
// relation not named: relations made of configuration or bookkeeping only.
// Person-carrying columns are always named one by one.
const EXPLICIT: Record<string, Record<string, ColumnSpec>> = {
  person: {
    row_id: id, email: code, username: code, full_name: text, password_hash: code, language: code,
    user_image: code, theme: code,
    // 0117 drops it; the person migrations (0100–0102) still see it on a fresh database.
    palette: code,
    // Codes, declared "not a person reference" (R3): left alone, never scanned.
    // 0107 drops both columns; 0101 still runs before it on a dev database.
    employee_code: code, stylehr_username: code,
  },
  service_account: { row_id: id, label: text },
  person_id_map: { '*': code },
  access_log: { user: id, operation: code, ref_table: code, reference_name: on('ref_table'), method: code, scope: code },
  access_token: { id: code, label: text, token_hash: code, person: id, service_account: id },
  activity_log: { user: id, operation: text, full_name: text, ip_address: code, sign_in_method: code },
  // #620: an app's settings (configuration, never a person) and which roles carry its roles.
  app_role_binding: { app: code, app_role: code, bound_role: code },
  app_setting: { app: code, setting: code, value: text },
  assignment_rule: { ref_table: code, description: text, assign_condition: text, assign_to_field: code, last_user: id },
  assignment_rule_user: { user: id },
  auto_email_report: { '*': code },
  background_job: { method: code, payload: text, job_status: code, error: text, trigger: code },
  client_script: { ref_table: code, script: text },
  column_def: { '*': code, label: text },
  comment: { ref_table: code, ref_name: on('ref_table'), content: text },
  custom_field: { '*': code, label: text },
  dashboard: { label: text, config: text },
  data_scope: { person: id, service_account: id, allow_table: code, for_value: on('allow_table') },
  data_source: { '*': code, last_error: text },
  // #625: an app dataset's rows: warehouse figures, no person in them.
  app_dataset_row: { '*': code },
  dataset_miss: { '*': code },
  // #667: which filter keys a dataset could not apply; no person, label or value.
  dataset_place_drop: { '*': code },
  dataset_snapshot: { dataset: code, state: code, definition_version: code, triggered_by: id, error: text },
  email_account: { '*': code },
  email_queue: {
    sender: code, recipient: code, subject: text, body: text, send_status: code, error: text, ref_table: code,
    reference_name: on('ref_table'), attachments: text,
  },
  email_rule: { '*': code, subject: text, message: text },
  email_sink: { '*': text },
  file: { file_name: text, file_url: code, mime_type: code, ref_table: code, ref_name: on('ref_table'), thumbnail_url: code },
  // #629: glossary terms are prose about words; the rest name apps, Tables and columns.
  glossary_term: { term: text, app: code, definition: text, examples: text, app_key: code, app_wording: text },
  glossary_avoid_word: { word: text, reason: text },
  glossary_link: { link_table: code, link_column: code },
  // #465 D8: a health check's changes of state; the message is prose.
  health_check_event: { check_key: code, severity: code, message: text },
  // The generated pair follows parent/parenttype (rewritten via `parent`).
  has_role: { person: id, service_account: id, role: code },
  // Shortcuts hold Table names and links, never a person id.
  home_page: { label: text, icon: code, module: code, shortcuts: code },
  home_page_link: { label: text, type: code, link_to: code },
  home_page_role: { role: code },
  import_log: { '*': code, error_summary: text, touched: text },
  installed_app: { '*': code },
  // #465 D5: who sent the last settings file; the rest name the file's source and fields.
  // managed_values holds the settings the file set (configuration, never a person).
  instance_settings_apply: { applied_by: id, environment: code, revision: code, run: code, managed_paths: code, managed_values: code },
  internal_metadata: { '*': code },
  job_execution: { job: code, method: code, outcome: code, error: text, result: text },
  letter_head: { '*': text },
  metadata_override: { '*': code },
  migration: { '*': code },
  notification_log: { for_user: id, subject: text, ref_table: code, ref_name: on('ref_table') },
  password_reset: { token: code, user: id },
  patch_log: { '*': code },
  permission: { '*': code },
  pre_auth_bucket: { '*': code },
  print_format: { ref_table: code, template: text, letter_head: code },
  // `query` is dropped by 0111 but still exists when 0101 runs on a fresh database.
  report: { ref_table: code, config: text, report_type: code, query: text, report_script: code },
  revoked_session: { jti: code, person_id: id },
  role: { '*': code },
  runtime_action_result: { caller: id, app: code, action: code, idempotency_key: code, payload: text, result: text, authorization: text },
  sales_target_snapshot_name: { '*': code },
  sales_target_snapshot_row: { '*': code },
  saved_view: { ref_table: code, label: text, filters: filters('ref_table') },
  scheduled_job: { '*': code, description: text },
  series: { '*': code },
  server_script: { '*': code, script: text },
  service_level_agreement: { '*': code },
  share: { share_table: code, share_name: on('share_table'), person: id, service_account: id },
  sign_in_method: { '*': code, label: text },
  single_value: { '*': code },
  sla_priority: { '*': code },
  table_def: { '*': code, description: text, label: text },
  tag_link: { ref_table: code, ref_name: on('ref_table'), tag: code },
  todo: { allocated_to: id, ref_table: code, reference_name: on('ref_table'), description: text, todo_status: code, priority: code },
  translation: { language: code, source_text: text, translated_text: text },
  user_event: { kind: code, ref_key: text, label: text, sub_label: text, path: text },
  user_settings: { user: id, table_name: code, settings: text },
  version: { ref_table: code, ref_name: on('ref_table'), data: text },
  web_form: { '*': code, title: text, success_message: text },
  web_page: { '*': code, title: text, content: text },
  webhook: { '*': code },
  workflow: { '*': code },
  workflow_action: { ref_table: code, ref_name: on('ref_table'), action: code, from_state: code, to_state: code, actor: id },
  workflow_document_state: { '*': code },
  workflow_transition: { '*': code, condition: text },
  sign_in_identity: {
    id: code, person_id: id, method: code, subject: code, sign_in_name: code, email: code, display_name: text,
    pending_email: code, linked_by: id, ended_reason: code, subject_kind: code,
  },
  // person-resolution (0102).
  identifier_system: { '*': code, label: text },
  person_identifier: {
    id: code, person_id: id, system: code, assigner: code, value: code, value_hint: code, record_identifier_id: code,
    worker_type: code, source: code, recorded_by: id, edited_by: id, note: text,
  },
  person_identifier_fingerprint: { '*': code },
  person_match: { '*': code, decided_by: id, decision_note: text, reopen_reason: text },
  person_match_member: { '*': code, person_id: id },
  person_merge: { '*': code, survivor_id: id, loser_id: id, merged_by: id, undone_by: id, note: text, moved: text, deleted: text, survivorship: text, scope_choices: text, leftovers: text },
}

/** The class a metadata column gets from its type, outside platform Tables. */
function byColumnType(columnType: string, referenceTable: string | null): { spec: ColumnSpec; rule: string } | null {
  if (columnType === 'Reference')
    return (PRINCIPAL_TABLES as readonly string[]).includes(referenceTable ?? '')
      ? { spec: id, rule: `Reference → ${referenceTable}` }
      : { spec: code, rule: `Reference → ${referenceTable ?? '?'}` }
  if (['Text', 'Long Text'].includes(columnType)) return { spec: text, rule: columnType }
  if (columnType === 'JSON') return { spec: text, rule: 'JSON on an app Table' }
  if (['Data', 'Choice', 'Attach', 'Attach Image', 'Date', 'Datetime', 'Int', 'Float', 'Currency', 'Check'].includes(columnType))
    return { spec: code, rule: `${columnType} on an app Table` }
  return null
}

interface MetaColumn {
  table: string
  system: boolean
  kind: string
  column_name: string
  column_type: string
  reference_table: string | null
}

/** Classify every text-like column of every relation Featherbase owns: the
 *  platform schema plus every app Table's own storage. */
export async function classifyColumns(db: Sql | TxSql = sql): Promise<Classification> {
  const tables = await db`
    select name, system, kind, coalesce(physical_schema, ${PLATFORM_SCHEMA}) as schema,
      coalesce(physical_relation, regexp_replace(lower(name), '\\s+', '_', 'g')) as relation
    from table_def where data_source is null and kind <> 'settings'`
  const tableByRelation = new Map<string, { name: string; system: boolean; kind: string }>()
  for (const t of tables) tableByRelation.set(`${t.schema}.${t.relation}`, { name: String(t.name), system: t.system === true, kind: String(t.kind) })
  const metaRows = (await db`
    select c.parent as table, t.system, t.kind, c.column_name, c.column_type, c.reference_table
    from column_def c join table_def t on t.name = c.parent`) as unknown as MetaColumn[]
  const metaByTable = new Map<string, Map<string, MetaColumn>>()
  for (const m of metaRows) {
    if (!metaByTable.has(m.table)) metaByTable.set(m.table, new Map())
    metaByTable.get(m.table)!.set(m.column_name, m)
  }
  const appSchemas = [...new Set(tables.map((t) => String(t.schema)))]
  const columns = await db`
    select c.table_schema as schema, c.table_name as relation, c.column_name, c.data_type,
      c.is_generated = 'ALWAYS' as generated
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema in ${db(appSchemas)}
      and c.data_type in ('character varying', 'text', 'character', 'json', 'jsonb')
    order by c.table_schema, c.table_name, c.ordinal_position`

  const out: Classification = { classified: [], unclassified: [] }
  for (const c of columns) {
    const schema = String(c.schema)
    const relation = String(c.relation)
    const column = String(c.column_name)
    const owner = tableByRelation.get(`${schema}.${relation}`) ?? null
    const push = (spec: ColumnSpec, rule: string) =>
      out.classified.push({ ...spec, ...(c.generated ? { generated: true } : {}), schema, relation, column, table: owner?.name ?? null, rule })
    const explicit = schema === PLATFORM_SCHEMA && Object.hasOwn(EXPLICIT, relation) ? EXPLICIT[relation] : undefined
    if (explicit && Object.hasOwn(explicit, column)) {
      push(explicit[column], 'declared')
      continue
    }
    // History columns on every relation: who created and last changed a row.
    if (column === 'created_by' || column === 'updated_by') {
      push(id, 'history')
      continue
    }
    if (column === 'row_id' || column === 'status' || column === 'parentfield' || column === 'parenttype') {
      push(code, 'standard column')
      continue
    }
    // A child row's parent is a principal id exactly when it hangs off one.
    if (column === 'parent' && owner?.kind === 'sub_table') {
      push(on('parenttype'), 'child row parent')
      continue
    }
    if (explicit?.['*']) {
      push(explicit['*'], 'declared for the whole relation')
      continue
    }
    const meta = owner ? metaByTable.get(owner.name)?.get(column) : undefined
    // A platform Table's columns are declared one by one above; only an app
    // Table's columns are classified from their metadata type.
    if (meta && !(owner?.system && schema === PLATFORM_SCHEMA && meta.column_type !== 'Reference')) {
      const typed = byColumnType(meta.column_type, meta.reference_table)
      if (typed) {
        push(typed.spec, typed.rule)
        continue
      }
    }
    out.unclassified.push({ schema, relation, column, data_type: String(c.data_type) })
  }
  return out
}

// ------------------------------------------------------------------ rewrite

export interface IdMapEntry {
  old_id: string
  new_id: string
  kind: 'person' | 'service_account'
}

function qualified(c: ClassifiedColumn): string {
  return `"${c.schema}"."${c.relation}"`
}

/** Rewrite every registered person-carrying column through the map held in
 *  the temp table `person_id_rewrite (old_id, new_id)`. Returns rows touched
 *  per column. Code and free-text columns are never touched. */
export async function rewriteThroughRegistry(db: Sql | TxSql, columns: ClassifiedColumn[]): Promise<Map<string, number>> {
  const touched = new Map<string, number>()
  for (const c of columns) {
    if (c.generated) continue
    const key = `${c.schema}.${c.relation}.${c.column}`
    if (c.class === 'id') {
      const r = await db.unsafe(
        `update ${qualified(c)} t set "${c.column}" = m.new_id from pg_temp.person_id_rewrite m where t."${c.column}" = m.old_id`,
      )
      if (r.count) touched.set(key, r.count)
    } else if (c.class === 'conditional-id') {
      const r = await db.unsafe(
        `update ${qualified(c)} t set "${c.column}" = m.new_id from pg_temp.person_id_rewrite m
         where t."${c.column}" = m.old_id and t."${c.typeColumn}" in ('Person', 'Service Account')`,
      )
      if (r.count) touched.set(key, r.count)
    } else if (c.class === 'json-with-ids') {
      const n = await rewriteJsonColumn(db, c)
      if (n) touched.set(key, n)
    }
  }
  return touched
}

/** The columns of a Table whose values are principal ids: References to a
 *  principal Table, and the history columns. */
async function principalColumnsOf(db: Sql | TxSql, table: string, cache: Map<string, Set<string>>): Promise<Set<string>> {
  if (cache.has(table)) return cache.get(table)!
  const rows = await db`
    select column_name from column_def
    where parent = ${table} and column_type = 'Reference' and reference_table in ${db([...PRINCIPAL_TABLES])}`
  const set = new Set<string>(['created_by', 'updated_by', ...rows.map((r) => String(r.column_name))])
  cache.set(table, set)
  return set
}

type Leaf = (value: string) => string | null

/** Walk filter triples, applying `leaf` only to values of principal columns. */
function mapFilterValues(raw: unknown, columns: Set<string>, leaf: Leaf): { value: unknown; changed: boolean } {
  if (!Array.isArray(raw)) return { value: raw, changed: false }
  let changed = false
  const next = raw.map((t) => {
    if (!Array.isArray(t) || t.length < 3 || typeof t[0] !== 'string' || !columns.has(t[0])) return t
    const map = (v: unknown) => {
      if (typeof v !== 'string') return v
      const to = leaf(v)
      if (to === null) return v
      changed = true
      return to
    }
    return [t[0], t[1], Array.isArray(t[2]) ? t[2].map(map) : map(t[2]), ...t.slice(3)]
  })
  return { value: next, changed }
}

async function loadRewriteMap(db: Sql | TxSql): Promise<Map<string, string>> {
  const rows = await db.unsafe(`select old_id, new_id from pg_temp.person_id_rewrite`)
  return new Map(rows.map((r) => [String(r.old_id), String(r.new_id)]))
}

/** A json-with-ids column is jsonb (saved_view.filters), so its text always parses. */
async function jsonRows(db: Sql | TxSql, c: ClassifiedColumn) {
  return db.unsafe(
    `select ctid::text as ctid, "${c.column}"::text as v, "${c.typeColumn}" as tbl from ${qualified(c)} where "${c.column}" is not null`,
  )
}

async function rewriteJsonColumn(db: Sql | TxSql, c: ClassifiedColumn): Promise<number> {
  const map = await loadRewriteMap(db)
  if (!map.size || !c.typeColumn) return 0
  const cache = new Map<string, Set<string>>()
  let n = 0
  for (const r of await jsonRows(db, c)) {
    const columns = await principalColumnsOf(db, String(r.tbl ?? ''), cache)
    const { value, changed } = mapFilterValues(JSON.parse(String(r.v)), columns, (v) => map.get(v) ?? null)
    if (!changed) continue
    await db.unsafe(`update ${qualified(c)} set "${c.column}" = $1::text::jsonb where ctid = $2::text::tid`, [JSON.stringify(value), String(r.ctid)])
    n++
  }
  return n
}

export interface ScanHit {
  column: string
  rows: number
}

/** The post-check: does any OLD id survive in a registered column? Exact
 *  values only, registered columns only (A-B1). */
export async function scanForOldIds(db: Sql | TxSql, columns: ClassifiedColumn[]): Promise<ScanHit[]> {
  const hits: ScanHit[] = []
  const map = await loadRewriteMap(db)
  const old = new Set(map.keys())
  for (const c of columns) {
    const key = `${c.schema}.${c.relation}.${c.column}`
    if (c.class === 'id') {
      const [r] = await db.unsafe(
        `select count(*)::int as n from ${qualified(c)} t join pg_temp.person_id_rewrite m on t."${c.column}" = m.old_id`,
      )
      if (r.n) hits.push({ column: key, rows: r.n })
    } else if (c.class === 'conditional-id') {
      const [r] = await db.unsafe(
        `select count(*)::int as n from ${qualified(c)} t join pg_temp.person_id_rewrite m on t."${c.column}" = m.old_id
         where t."${c.typeColumn}" in ('Person', 'Service Account')`,
      )
      if (r.n) hits.push({ column: key, rows: r.n })
    } else if (c.class === 'json-with-ids' && c.typeColumn) {
      const cache = new Map<string, Set<string>>()
      let n = 0
      for (const r of await jsonRows(db, c)) {
        const columns = await principalColumnsOf(db, String(r.tbl ?? ''), cache)
        if (mapFilterValues(JSON.parse(String(r.v)), columns, (v) => (old.has(v) ? v : null)).changed) n++
      }
      if (n) hits.push({ column: key, rows: n })
    }
  }
  return hits
}

/** Load a map into the session-local rewrite table the handlers read. */
export async function stageRewriteMap(db: Sql | TxSql, entries: IdMapEntry[]): Promise<void> {
  await db.unsafe(`create temp table if not exists person_id_rewrite (old_id text primary key, new_id text not null) on commit drop`)
  await db.unsafe(`truncate pg_temp.person_id_rewrite`)
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500)
    await db.unsafe(
      `insert into pg_temp.person_id_rewrite (old_id, new_id) select * from unnest($1::text[], $2::text[])`,
      [chunk.map((e) => e.old_id), chunk.map((e) => e.new_id)],
    )
  }
}

/** The text columns nobody classified, one per line, for 0101's refusal. */
export function formatUnclassified(columns: Classification['unclassified']): string {
  return columns.map((x) => `  ${x.schema}.${x.relation}.${x.column} (${x.data_type}): UNCLASSIFIED`).join('\n')
}
