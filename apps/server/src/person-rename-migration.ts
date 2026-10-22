// Migration 0101 (OpenSpec change `person-rename`, design § Migration).
//
// One transaction: the human's record becomes Person, service accounts move
// to their own table, every principal-carrying column becomes a pair of
// Reference columns (person / service_account, exactly one set), and every
// person and service account is re-keyed to an opaque id through the handler
// registry, followed by an exact-match scan that aborts on any surviving old
// id. `cli people:plan` runs the same code in a rolled-back transaction.
import { sql } from './db'
import { createTable } from './table-engine'
import { invalidateMeta } from './meta'
import { PLATFORM_SCHEMA } from './platform-schema'
import { BUILT_IN_PERSONS, PERSON_ID_PREFIX, SERVICE_ACCOUNT_ID_PREFIX, newPersonId, newServiceAccountId } from './opaque-id'
import {
  classifyColumns,
  formatClassification,
  rewriteThroughRegistry,
  scanForOldIds,
  stageRewriteMap,
  type ClassifiedColumn,
  type Classification,
  type IdMapEntry,
  type ScanHit,
} from './person-registry'

export interface PersonRenameReport {
  alreadyApplied: boolean
  persons: IdMapEntry[]
  builtIns: string[]
  serviceAccounts: (IdMapEntry & { label: string })[]
  tokens: { person: number; service_account: number }
  scopeRows: { person: number; service_account: number }
  shareRows: { person: number; service_account: number }
  roleRows: { person: number; service_account: number }
  /** Rows rewritten per registered column (incl. conditional-id ones). */
  rewritten: Record<string, number>
  conditionalRewritten: Record<string, number>
  classification: Classification
  scan: ScanHit[]
}

const Q = (relation: string) => `${PLATFORM_SCHEMA}.${relation}`

async function relationExists(relation: string): Promise<boolean> {
  const [row] = await sql`select to_regclass(${Q(relation)}) as r`
  return Boolean(row?.r)
}

async function columnExists(relation: string, column: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from information_schema.columns
    where table_schema = ${PLATFORM_SCHEMA} and table_name = ${relation} and column_name = ${column}`
  return Boolean(row)
}

async function constraintExists(name: string): Promise<boolean> {
  const [row] = await sql`select 1 from pg_constraint where conname = ${name} and connamespace = ${PLATFORM_SCHEMA}::regnamespace`
  return Boolean(row)
}

async function addColumnDef(table: string, column: Record<string, unknown>) {
  const [have] = await sql`select 1 from column_def where parent = ${table} and column_name = ${String(column.column_name)}`
  if (have) return
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = ${table}`
  await sql`insert into column_def ${sql({
    parent: table,
    position: (maxidx as number) + 1,
    label: null,
    reference_table: null,
    reqd: false,
    unique: false,
    default_value: null,
    read_only: false,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
    ...column,
  })}`
}

// --------------------------------------------------------------- step 1

/** Every place a Table NAME is stored: the Reference → Table columns from
 *  metadata, each sub-table's parenttype, and the raw ones. */
async function renameTableEverywhere(from: string, to: string) {
  const refs = await sql`
    select t.name as table, coalesce(t.physical_schema, ${PLATFORM_SCHEMA}) as schema,
      coalesce(t.physical_relation, regexp_replace(lower(t.name), '\\s+', '_', 'g')) as relation, c.column_name
    from column_def c join table_def t on t.name = c.parent
    where c.column_type = 'Reference' and c.reference_table = 'Table'
      and t.data_source is null and t.kind <> 'settings'`
  const targets: [string, string, string][] = refs.map((r) => [String(r.schema), String(r.relation), String(r.column_name)])
  for (const t of await sql`
    select coalesce(physical_schema, ${PLATFORM_SCHEMA}) as schema,
      coalesce(physical_relation, regexp_replace(lower(name), '\\s+', '_', 'g')) as relation
    from table_def where kind = 'sub_table' and data_source is null`)
    targets.push([String(t.schema), String(t.relation), 'parenttype'])
  for (const raw of [['saved_view', 'ref_table'], ['user_settings', 'table_name'], ['tag_link', 'ref_table'], ['access_log', 'ref_table']] as const)
    targets.push([PLATFORM_SCHEMA, raw[0], raw[1]])
  const seen = new Set<string>()
  for (const [schema, relation, column] of targets) {
    const key = `${schema}.${relation}.${column}`
    if (seen.has(key)) continue
    seen.add(key)
    const [exists] = await sql`
      select 1 from information_schema.columns where table_schema = ${schema} and table_name = ${relation} and column_name = ${column}`
    if (!exists) continue
    await sql.unsafe(`update "${schema}"."${relation}" set "${column}" = $1 where "${column}" = $2`, [to, from])
  }
  await sql`update column_def set reference_table = ${to} where reference_table = ${from}`
  await sql`update column_def set row_table = ${to} where row_table = ${from}`
  // Custom Field rows are keyed `<Table>-<column>`.
  await sql`update custom_field set row_id = ${to + '-'} || substr(row_id, ${from.length + 2}) where dt = ${to} and row_id like ${from + '-%'}`
}

async function renameUserToPerson() {
  // The table, its keys, indexes and triggers.
  await sql.unsafe(`alter table ${PLATFORM_SCHEMA}."user" rename to person`)
  for (const [from, to] of [['user_pkey', 'person_pkey']]) if (await constraintExists(from)) await sql.unsafe(`alter table ${Q('person')} rename constraint ${from} to ${to}`)
  for (const [from, to] of [
    ['user_username_lower_uq', 'person_username_lower_uq'],
    ['user_email_lower_uq', 'person_email_lower_uq'],
  ])
    await sql.unsafe(`alter index if exists ${PLATFORM_SCHEMA}.${from} rename to ${to}`)
  await sql.unsafe(`
    create or replace function ${PLATFORM_SCHEMA}.fc_person_id_is_permanent() returns trigger
    language plpgsql set search_path = pg_catalog as $$
    begin
      if new.row_id is distinct from old.row_id
         and coalesce(current_setting('featherbase.allow_person_id_change', true), '') <> 'on' then
        raise exception 'A person''s id is permanent: person % cannot be renamed', old.row_id;
      end if;
      return new;
    end $$`)
  await sql.unsafe(`drop trigger if exists user_person_id_is_permanent on ${Q('person')}`)
  await sql.unsafe(`create trigger person_id_is_permanent before update of row_id on ${Q('person')}
    for each row execute function ${PLATFORM_SCHEMA}.fc_person_id_is_permanent()`)

  // The sign-in table: "identity" signs in, "identifier" (0102) does not.
  await sql.unsafe(`alter table ${Q('user_identity')} rename to sign_in_identity`)
  await sql.unsafe(`alter table ${Q('sign_in_identity')} rename column user_id to person_id`)
  for (const [from, to] of [
    ['user_identity_pkey', 'sign_in_identity_pkey'],
    ['user_identity_subject_or_pending', 'sign_in_identity_subject_or_pending'],
    ['user_identity_user_id_fkey', 'sign_in_identity_person_id_fkey'],
    ['user_identity_method_fkey', 'sign_in_identity_method_fkey'],
  ])
    if (await constraintExists(from)) await sql.unsafe(`alter table ${Q('sign_in_identity')} rename constraint ${from} to ${to}`)
  for (const [from, to] of [
    ['user_identity_subject_uq', 'sign_in_identity_subject_uq'],
    ['user_identity_sign_in_name_uq', 'sign_in_identity_sign_in_name_uq'],
    ['user_identity_pending_uq', 'sign_in_identity_pending_uq'],
    ['user_identity_user_ix', 'sign_in_identity_person_ix'],
  ])
    await sql.unsafe(`alter index if exists ${PLATFORM_SCHEMA}.${from} rename to ${to}`)
  await sql.unsafe(`
    create or replace function ${PLATFORM_SCHEMA}.fc_cancel_email_invites() returns trigger
    language plpgsql set search_path = pg_catalog as $$
    begin
      if lower(trim(coalesce(old.email, ''))) is distinct from lower(trim(coalesce(new.email, ''))) then
        delete from ${PLATFORM_SCHEMA}.sign_in_identity
        where person_id = new.row_id and subject is null;
      end if;
      return new;
    end $$`)
  await sql.unsafe(`drop trigger if exists user_cancel_email_invites on ${Q('person')}`)
  await sql.unsafe(`create trigger person_cancel_email_invites after update of email on ${Q('person')}
    for each row execute function ${PLATFORM_SCHEMA}.fc_cancel_email_invites()`)

  // Metadata: table_def is keyed by name and column_def.parent has no
  // on-update cascade, so the row is copied, its columns repointed, the old
  // row removed.
  const [userDef] = await sql`select * from table_def where name = 'User'`
  if (userDef) {
    await sql`insert into table_def ${sql({ ...(userDef as Record<string, unknown>), name: 'Person', label: 'Person', id_pattern: `opaque:${PERSON_ID_PREFIX}` } as unknown as Record<string, never>)}`
    await sql`update column_def set parent = 'Person' where parent = 'User'`
    await sql`delete from table_def where name = 'User'`
  }
  await renameTableEverywhere('User', 'Person')

  // Built-ins: Administrator and Guest keep their ids and are never re-keyed,
  // merged or given identifiers.
  await sql.unsafe(`alter table ${Q('person')} add column if not exists built_in boolean not null default false`)
  await sql`update person set built_in = true where row_id in ${sql([...BUILT_IN_PERSONS])}`
  await addColumnDef('Person', { column_name: 'built_in', label: 'Built-in', column_type: 'Check', read_only: true, default_value: '0' })

  // RLS: a role holder is a person or a service account.
  await sql.unsafe(`
    create or replace function ${PLATFORM_SCHEMA}.fc_has_read(tbl text) returns boolean
    language sql stable security definer set search_path = pg_catalog as $$
      select ${PLATFORM_SCHEMA}.fc_session_user() = 'Administrator'
        or exists (
          select 1
          from ${PLATFORM_SCHEMA}.permission p
          join ${PLATFORM_SCHEMA}.has_role hr
            on hr.role = p.role
           and hr.parenttype in ('Person', 'Service Account')
           and hr.parent = ${PLATFORM_SCHEMA}.fc_session_user()
          where p.ref_table = tbl
            and coalesce(p.tier, 'basic') = 'basic'
            and p.can_read
        )
    $$`)
  invalidateMeta()
}

// --------------------------------------------------------------- step 2

const PRINCIPAL_FK = 'on delete restrict deferrable initially immediate'

async function addPrincipalPair(relation: string, metadataTable: string | null) {
  await sql.unsafe(`alter table ${Q(relation)}
    add column if not exists person varchar(140),
    add column if not exists service_account varchar(140)`)
  if (!(await constraintExists(`${relation}_person_fkey`)))
    await sql.unsafe(`alter table ${Q(relation)} add constraint ${relation}_person_fkey
      foreign key (person) references ${Q('person')}(row_id) ${PRINCIPAL_FK}`)
  if (!(await constraintExists(`${relation}_service_account_fkey`)))
    await sql.unsafe(`alter table ${Q(relation)} add constraint ${relation}_service_account_fkey
      foreign key (service_account) references ${Q('service_account')}(row_id) ${PRINCIPAL_FK}`)
  await sql.unsafe(`create index if not exists ${relation}_person_ix on ${Q(relation)} (person)`)
  await sql.unsafe(`create index if not exists ${relation}_service_account_ix on ${Q(relation)} (service_account)`)
  if (metadataTable) {
    await addColumnDef(metadataTable, { column_name: 'person', label: 'Person', column_type: 'Reference', reference_table: 'Person', in_list_view: true })
    await addColumnDef(metadataTable, { column_name: 'service_account', label: 'Service account', column_type: 'Reference', reference_table: 'Service Account', in_list_view: true })
  }
}

async function addExactlyOne(relation: string) {
  if (!(await constraintExists(`${relation}_one_principal`)))
    await sql.unsafe(`alter table ${Q(relation)} add constraint ${relation}_one_principal
      check ((person is null) <> (service_account is null))`)
}

async function createServiceAccountTable() {
  const [have] = await sql`select 1 from table_def where name = 'Service Account'`
  if (!have)
    await createTable({
      name: 'Service Account',
      module: 'Core',
      id_pattern: `opaque:${SERVICE_ACCOUNT_ID_PREFIX}`,
      title_column: 'label',
      system: true,
      columns: [
        { column_name: 'label', label: 'Name', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
        { column_name: 'api_rate_limit', label: 'API rate limit', column_type: 'Int' },
      ],
    } as Parameters<typeof createTable>[0])
  invalidateMeta()
}

interface Moved {
  serviceIds: string[]
  serviceLabels: Map<string, string>
}

/** Move service accounts out of person, and every principal reference onto
 *  the person / service_account pair. Nothing a service account holds is
 *  lost; a scope or share row naming no principal aborts (never fail-open). */
export async function splitPrincipals(): Promise<Moved> {
  await createServiceAccountTable()
  const hasType = await columnExists('person', 'user_type')
  const services = hasType
    ? await sql`select row_id, full_name, enabled, api_rate_limit, created_at, created_by, updated_at, updated_by
        from person where user_type = 'service' order by row_id`
    : []
  const serviceIds = services.map((s) => String(s.row_id))
  const serviceLabels = new Map(services.map((s) => [String(s.row_id), String(s.full_name ?? s.row_id)]))
  for (const s of services)
    await sql`insert into service_account ${sql({
      row_id: String(s.row_id),
      label: String(s.full_name ?? s.row_id),
      enabled: s.enabled === true,
      api_rate_limit: s.api_rate_limit ?? null,
      created_at: s.created_at,
      created_by: s.created_by,
      updated_at: s.updated_at,
      updated_by: s.updated_by,
      status: 'draft',
      position: 0,
    } as unknown as Record<string, never>)} on conflict (row_id) do nothing`

  // Tokens.
  await addPrincipalPair('access_token', null)
  if (await columnExists('access_token', 'owner')) {
    await sql`update access_token set service_account = owner where owner in ${sql(serviceIds.length ? serviceIds : [''])}`
    await sql`update access_token set person = owner where service_account is null`
    await sql.unsafe(`alter table ${Q('access_token')} drop column owner`)
  }
  await addExactlyOne('access_token')

  // Data Scope and Share: Tables, so the pair is metadata too.
  for (const [relation, table, old] of [['data_scope', 'Data Scope', 'user'], ['share', 'Share', 'user']] as const) {
    await addPrincipalPair(relation, table)
    if (await columnExists(relation, old)) {
      const orphans = await sql.unsafe(`
        select t.row_id, t."${old}" as principal from ${Q(relation)} t
        where t."${old}" is null or not exists (select 1 from ${Q('person')} p where p.row_id = t."${old}")`)
      if (orphans.length)
        throw new Error(
          `person-rename: ${table} rows name no existing account and cannot be moved; fix or remove them first:\n${orphans
            .map((o) => `  ${String(o.row_id)} → ${String(o.principal ?? '(blank)')}`)
            .join('\n')}`,
        )
      await sql.unsafe(`update ${Q(relation)} set service_account = "${old}" where "${old}" = any($1::text[])`, [serviceIds])
      await sql.unsafe(`update ${Q(relation)} set person = "${old}" where service_account is null`)
      await sql`delete from column_def where parent = ${table} and column_name = ${old}`
      await sql.unsafe(`alter table ${Q(relation)} drop column "${old}"`)
    }
    await addExactlyOne(relation)
  }

  // Roles: the pair is generated from parent/parenttype, outside column_def,
  // so the roles grid renders no pickers and the generic child insert works.
  if (serviceIds.length)
    await sql`update has_role set parenttype = 'Service Account' where parenttype = 'Person' and parent in ${sql(serviceIds)}`
  if (!(await columnExists('has_role', 'person'))) {
    await sql.unsafe(`alter table ${Q('has_role')}
      add column person varchar(140) generated always as (case when parenttype = 'Person' then parent end) stored,
      add column service_account varchar(140) generated always as (case when parenttype = 'Service Account' then parent end) stored`)
    await sql.unsafe(`alter table ${Q('has_role')} add constraint has_role_person_fkey
      foreign key (person) references ${Q('person')}(row_id) ${PRINCIPAL_FK}`)
    await sql.unsafe(`alter table ${Q('has_role')} add constraint has_role_service_account_fkey
      foreign key (service_account) references ${Q('service_account')}(row_id) ${PRINCIPAL_FK}`)
  }

  // Service accounts leave person; nothing that was theirs pointed at their
  // person row any more.
  if (serviceIds.length) {
    await sql`delete from password_reset where "user" in ${sql(serviceIds)}`
    await sql`delete from person where row_id in ${sql(serviceIds)}`
  }
  if (hasType) await sql.unsafe(`alter table ${Q('person')} drop column user_type`)
  invalidateMeta()
  return { serviceIds, serviceLabels }
}

// --------------------------------------------------------------- step 4

async function ensureIdMapTable() {
  await sql`
    create table if not exists person_id_map (
      old_id varchar(140) primary key,
      new_id varchar(140) not null unique,
      kind text not null check (kind in ('person', 'service_account')),
      mapped_at timestamptz not null default now()
    )`
}

async function counts() {
  const pair = async (relation: string) => {
    const [r] = await sql.unsafe(
      `select count(person)::int as person, count(service_account)::int as service_account from ${Q(relation)}`,
    )
    return { person: Number(r.person), service_account: Number(r.service_account) }
  }
  return {
    tokens: await pair('access_token'),
    scopeRows: await pair('data_scope'),
    shareRows: await pair('share'),
    roleRows: await pair('has_role'),
  }
}

export interface ReidResult {
  personMap: IdMapEntry[]
  serviceMap: (IdMapEntry & { label: string })[]
  touched: Map<string, number>
  scan: ScanHit[]
}

/** Step 4: the re-id, in the caller's transaction. Every principal FK is
 *  deferred so the key change and each referencing rewrite are checked
 *  together at the end; the scan then looks for any surviving old id in the
 *  registered columns and aborts on one. `rewrite` defaults to every
 *  classified column; a test passes fewer to prove the scan catches a missed
 *  handler. */
export async function reidPrincipals(
  columns: ClassifiedColumn[],
  opts: { rewrite?: ClassifiedColumn[]; serviceLabels?: Map<string, string> } = {},
): Promise<ReidResult> {
  await sql`select set_config('featherbase.allow_person_id_change', 'on', true)`
  await sql`set constraints all deferred`
  await ensureIdMapTable()
  const persons = await sql`
    select row_id from person where not built_in and row_id not like ${PERSON_ID_PREFIX.replace('_', '\\_') + '%'} order by row_id`
  const services = await sql`
    select row_id, label from service_account where row_id not like ${SERVICE_ACCOUNT_ID_PREFIX.replace('_', '\\_') + '%'} order by row_id`
  const personMap: IdMapEntry[] = persons.map((p) => ({ old_id: String(p.row_id), new_id: newPersonId(), kind: 'person' }))
  const serviceMap = services.map((s) => ({
    old_id: String(s.row_id),
    new_id: newServiceAccountId(),
    kind: 'service_account' as const,
    label: opts.serviceLabels?.get(String(s.row_id)) ?? String(s.label ?? s.row_id),
  }))
  const map: IdMapEntry[] = [...personMap, ...serviceMap.map(({ old_id, new_id, kind }) => ({ old_id, new_id, kind }))]
  await stageRewriteMap(sql, map)
  const touched = await rewriteThroughRegistry(sql, opts.rewrite ?? columns)
  const scan = await scanForOldIds(sql, columns)
  if (scan.length)
    throw new Error(`person-rename: old ids survive after the re-id; nothing was changed:\n${scan.map((h) => `  ${h.column}: ${h.rows} row(s)`).join('\n')}`)
  for (let i = 0; i < map.length; i += 500) {
    const chunk = map.slice(i, i + 500)
    await sql`insert into person_id_map (old_id, new_id, kind)
      select * from unnest(${chunk.map((m) => m.old_id)}::text[], ${chunk.map((m) => m.new_id)}::text[], ${chunk.map((m) => m.kind)}::text[])
      on conflict (old_id) do nothing`
  }
  await sql`set constraints all immediate`
  await sql`select set_config('featherbase.allow_person_id_change', '', true)`
  return { personMap, serviceMap, touched, scan }
}

export async function migratePersonRename(): Promise<PersonRenameReport> {
  const empty = { person: 0, service_account: 0 }
  if (!(await relationExists('user')) && (await relationExists('person'))) {
    return {
      alreadyApplied: true, persons: [], builtIns: [...BUILT_IN_PERSONS], serviceAccounts: [],
      tokens: empty, scopeRows: empty, shareRows: empty, roleRows: empty, rewritten: {}, conditionalRewritten: {},
      classification: await classifyColumns(), scan: [],
    }
  }
  await renameUserToPerson()
  const moved = await splitPrincipals()

  const classification = await classifyColumns()
  if (classification.unclassified.length)
    throw new Error(`person-rename: unclassified text columns; classify them in src/person-registry.ts first:\n${formatClassification({ classified: [], unclassified: classification.unclassified })}`)
  const reid = await reidPrincipals(classification.classified, { serviceLabels: moved.serviceLabels })
  const { personMap, serviceMap, touched, scan } = reid

  // Step 5: namespaces, enabled last.
  if (!(await constraintExists('person_id_namespace')))
    await sql.unsafe(`alter table ${Q('person')} add constraint person_id_namespace check (built_in or row_id like 'psn\\_%')`)
  if (!(await constraintExists('service_account_id_namespace')))
    await sql.unsafe(`alter table ${Q('service_account')} add constraint service_account_id_namespace check (row_id like 'svc\\_%')`)

  const conditional = classification.classified.filter((c) => c.class === 'conditional-id').map((c) => `${c.schema}.${c.relation}.${c.column}`)
  const rewritten = Object.fromEntries(touched)
  return {
    alreadyApplied: false,
    persons: personMap,
    builtIns: [...BUILT_IN_PERSONS],
    serviceAccounts: serviceMap,
    ...(await counts()),
    rewritten,
    conditionalRewritten: Object.fromEntries(Object.entries(rewritten).filter(([k]) => conditional.includes(k))),
    classification,
    scan,
  }
}

export function formatPersonRenameReport(r: PersonRenameReport, opts: { columns?: boolean; map?: boolean } = {}): string {
  if (r.alreadyApplied) return 'person-rename: already applied'
  const lines = [
    'person-rename report',
    `  persons re-keyed: ${r.persons.length} (built-ins kept: ${r.builtIns.join(', ')})`,
    `  service accounts moved and re-keyed: ${r.serviceAccounts.length}${r.serviceAccounts.length ? '\n    ' + r.serviceAccounts.map((s) => `${s.label}: ${s.old_id} → ${s.new_id}`).join('\n    ') : ''}`,
    `  tokens: ${r.tokens.person} person, ${r.tokens.service_account} service account`,
    `  data scope rows: ${r.scopeRows.person} person, ${r.scopeRows.service_account} service account`,
    `  share rows: ${r.shareRows.person} person, ${r.shareRows.service_account} service account`,
    `  role rows: ${r.roleRows.person} person, ${r.roleRows.service_account} service account`,
    `  conditional ids rewritten: ${Object.keys(r.conditionalRewritten).length ? Object.entries(r.conditionalRewritten).map(([k, n]) => `${k} ${n}`).join('; ') : 'none'}`,
    `  rows rewritten per column: ${Object.keys(r.rewritten).length ? '\n    ' + Object.entries(r.rewritten).map(([k, n]) => `${k}: ${n}`).join('\n    ') : 'none'}`,
    `  scan: ${r.scan.length ? r.scan.map((h) => `${h.column} ${h.rows}`).join('; ') : 'no old id survives in any registered column'}`,
  ]
  if (opts.map) lines.push('  id map:', ...[...r.persons, ...r.serviceAccounts].map((m) => `    ${m.old_id} → ${m.new_id}`))
  if (opts.columns) lines.push(formatClassification(r.classification))
  return lines.join('\n')
}
