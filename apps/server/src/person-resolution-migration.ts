// Migration 0102 (OpenSpec change `person-resolution`, Phase 1a-i).
//
// DDL: btree_gist; the Identifier System Table with the generic rows (phone,
// email); the reviewer and sync roles; person_identifier with its history
// constraints; the tables later phases fill (fingerprints, matches, merges);
// person.replaced_by; ended sign-in identities; Sign In Method's identifier
// system; the core people_review default.
//
// Data (dev): code rows from the `employee_code` Custom Field (assigner ''),
// StyleHR record numbers and subjects from the warehouse's resolve file
// (`stylehr_record_ids.csv`, given as PEOPLE_RESOLVE_FILE or
// `cli people:plan --resolve`), `email` rows. A sign-in that cannot be
// resolved keeps working by its employee code and is listed. Nothing is
// merged. `cli people:plan` prints all of it.
import { readFileSync } from 'node:fs'
import { sql } from './db'
import { createTable } from './table-engine'
import { invalidateMeta } from './meta'
import { saveDoc } from './document'
import { PLATFORM_SCHEMA } from './platform-schema'
import { EDITED_BY, IDENTIFIER_KINDS, MATCH, NORMALISE_RULES, SENSITIVITIES } from './identifiers'
import { applySeedPack, saveIdentifierSystem, seedPackFile } from './seed-packs'
import { CORE_PEOPLE_REVIEW, newIdentifierId } from './person-identifiers'

const Q = (relation: string) => `${PLATFORM_SCHEMA}.${relation}`


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
    parent: table, position: (maxidx as number) + 1, label: null, reference_table: null, reqd: false, unique: false,
    default_value: null, read_only: false, hidden: false, in_list_view: false, tier: 'basic', ...column,
  } as unknown as Record<string, never>)}`
}

// ------------------------------------------------------------------- DDL

export async function createIdentifierSystemTable() {
  const [have] = await sql`select 1 from table_def where name = 'Identifier System'`
  if (!have)
    await createTable({
      name: 'Identifier System',
      module: 'Core',
      id_pattern: 'prompt',
      title_column: 'label',
      system: true,
      columns: [
        { column_name: 'label', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'kind', column_type: 'Choice', choices: IDENTIFIER_KINDS.join('\n'), reqd: true, in_list_view: true },
        { column_name: 'source', column_type: 'Data', in_list_view: true },
        { column_name: 'match', column_type: 'Choice', choices: MATCH.join('\n'), default_value: 'Off', in_list_view: true },
        { column_name: 'sensitivity', column_type: 'Choice', choices: SENSITIVITIES.join('\n'), in_list_view: true },
        { column_name: 'advanced', label: 'Advanced', column_type: 'Section Break' },
        { column_name: 'normalise', column_type: 'Choice', choices: NORMALISE_RULES.join('\n') },
        { column_name: 'one_holder_at_a_time', label: 'One holder at a time', column_type: 'Check' },
        { column_name: 'one_per_person', label: 'One per person', column_type: 'Check' },
        { column_name: 'assigner_scoped', label: 'Values are scoped by assigner', column_type: 'Check' },
        { column_name: 'edited_by', column_type: 'Choice', choices: EDITED_BY.join('\n') },
        { column_name: 'retain_after_leaving_days', column_type: 'Int' },
        { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
        // Derived from Sensitivity by the controller; stored so every reader
        // agrees without recomputing (D2's "its three columns").
        { column_name: 'storage', column_type: 'Data', read_only: true },
        { column_name: 'display', column_type: 'Data', read_only: true },
        { column_name: 'tier', column_type: 'Data', read_only: true },
      ],
    } as Parameters<typeof createTable>[0])
  invalidateMeta()
}

const IDENTIFIER_FK = 'deferrable initially immediate'

async function createIdentifierTables() {
  await sql.unsafe(`create extension if not exists btree_gist`)
  await sql`
    create table if not exists person_identifier (
      id varchar(40) primary key,
      person_id varchar(140) not null,
      system varchar(140) not null,
      assigner varchar(140) not null default '',
      value varchar(255),
      value_hint varchar(16),
      valid daterange not null default daterange('-infinity'::date, null, '[)'),
      verified boolean not null default false,
      record_identifier_id varchar(40),
      worker_type varchar(40),
      one_holder boolean not null default false,
      one_per_person boolean not null default false,
      source varchar(140) not null,
      recorded_at timestamptz not null default now(),
      recorded_by varchar(140) not null,
      edited_at timestamptz,
      edited_by varchar(140),
      note text,
      constraint person_identifier_value_or_hint check (value is not null or value_hint is not null),
      constraint person_identifier_valid_not_empty check (not isempty(valid))
    )`
  if (!(await constraintExists('person_identifier_person_id_fkey')))
    await sql.unsafe(`alter table ${Q('person_identifier')} add constraint person_identifier_person_id_fkey
      foreign key (person_id) references ${Q('person')}(row_id) on delete restrict ${IDENTIFIER_FK}`)
  if (!(await constraintExists('person_identifier_system_fkey')))
    await sql.unsafe(`alter table ${Q('person_identifier')} add constraint person_identifier_system_fkey
      foreign key (system) references ${Q('identifier_system')}(row_id) on update cascade on delete restrict`)
  if (!(await constraintExists('person_identifier_record_fkey')))
    await sql.unsafe(`alter table ${Q('person_identifier')} add constraint person_identifier_record_fkey
      foreign key (record_identifier_id) references ${Q('person_identifier')}(id) on delete set null`)
  // One holder at a time: the same value in the same system under the same
  // assigner cannot be current on two rows whose periods overlap (D3).
  if (!(await constraintExists('person_identifier_one_holder')))
    await sql.unsafe(`alter table ${Q('person_identifier')} add constraint person_identifier_one_holder
      exclude using gist (system with =, assigner with =, value with =, valid with &&) where (one_holder and value is not null)`)
  await sql.unsafe(`create unique index if not exists person_identifier_one_per_person
    on ${Q('person_identifier')} (person_id, system) where upper_inf(valid) and one_per_person`)
  await sql.unsafe(`create index if not exists person_identifier_person_ix on ${Q('person_identifier')} (person_id)`)
  await sql.unsafe(`create index if not exists person_identifier_lookup_ix on ${Q('person_identifier')} (system, value)`)

  // Filled from Phase 1b on; created now so 0102 is the one person DDL step.
  await sql`
    create table if not exists person_identifier_fingerprint (
      identifier_id varchar(40) primary key references person_identifier(id) on delete cascade,
      fingerprint bytea,
      key_id text,
      erased_at timestamptz
    )`
  await sql`
    create table if not exists person_match (
      id varchar(40) primary key,
      system varchar(140) not null references identifier_system(row_id) on update cascade,
      assigner varchar(140) not null default '',
      anchor_identifier_id varchar(40) not null references person_identifier(id),
      strength text not null check (strength in ('strong', 'weak')),
      status text not null default 'open'
        check (status in ('open', 'deferred', 'later', 'merged', 'not-the-same-person', 'withdrawn')),
      snoozed_until timestamptz,
      decided_by varchar(140),
      decided_at timestamptz,
      decision_note text,
      reopened_at timestamptz,
      reopen_reason text,
      created_at timestamptz not null default now()
    )`
  await sql`create unique index if not exists person_match_anchor_uq on person_match (anchor_identifier_id)`
  await sql`
    create table if not exists person_match_member (
      match_id varchar(40) not null references person_match(id) on delete cascade,
      person_id varchar(140) not null,
      identifier_id varchar(40) not null references person_identifier(id),
      added_at timestamptz not null default now(),
      primary key (match_id, person_id)
    )`
  if (!(await constraintExists('person_match_member_person_fkey')))
    await sql.unsafe(`alter table ${Q('person_match_member')} add constraint person_match_member_person_fkey
      foreign key (person_id) references ${Q('person')}(row_id) on delete restrict ${IDENTIFIER_FK}`)
  await sql`
    create table if not exists person_merge (
      id varchar(40) primary key,
      survivor_id varchar(140) not null,
      loser_id varchar(140) not null,
      match_id varchar(40) references person_match(id),
      merged_by varchar(140) not null,
      merged_at timestamptz not null default now(),
      moved jsonb not null default '[]',
      deleted jsonb not null default '[]',
      survivorship jsonb not null default '{}',
      scope_choices jsonb not null default '{}',
      loser_enabled_before boolean,
      undone_at timestamptz,
      undone_by varchar(140),
      leftovers jsonb not null default '[]',
      note text
    )`

  // A replaced record is inert and points at its survivor (D1).
  await sql.unsafe(`alter table ${Q('person')} add column if not exists replaced_by varchar(140)`)
  if (!(await constraintExists('person_replaced_by_fkey')))
    await sql.unsafe(`alter table ${Q('person')} add constraint person_replaced_by_fkey
      foreign key (replaced_by) references ${Q('person')}(row_id) on delete restrict ${IDENTIFIER_FK}`)
  if (!(await constraintExists('person_replaced_is_disabled')))
    await sql.unsafe(`alter table ${Q('person')} add constraint person_replaced_is_disabled
      check (replaced_by is null or not enabled)`)
  await addColumnDef('Person', { column_name: 'replaced_by', label: 'Replaced by', column_type: 'Reference', reference_table: 'Person', read_only: true })
}

async function endableIdentities() {
  await sql.unsafe(`alter table ${Q('sign_in_identity')}
    add column if not exists ended_at timestamptz,
    add column if not exists ended_reason text,
    add column if not exists subject_kind text not null default 'record-id'`)
  if (!(await constraintExists('sign_in_identity_ended_reason')))
    await sql.unsafe(`alter table ${Q('sign_in_identity')} add constraint sign_in_identity_ended_reason
      check ((ended_at is null) = (ended_reason is null) and (ended_reason is null or ended_reason in ('left', 'moved', 'unlinked')))`)
  if (!(await constraintExists('sign_in_identity_subject_kind')))
    await sql.unsafe(`alter table ${Q('sign_in_identity')} add constraint sign_in_identity_subject_kind
      check (subject_kind in ('record-id', 'employee-code'))`)
  // Only a live identity is unique: an ended one stays as history, and the
  // same provider id can be linked afresh (D5).
  await sql.unsafe(`drop index if exists ${PLATFORM_SCHEMA}.sign_in_identity_subject_uq`)
  await sql.unsafe(`drop index if exists ${PLATFORM_SCHEMA}.sign_in_identity_sign_in_name_uq`)
  await sql.unsafe(`drop index if exists ${PLATFORM_SCHEMA}.sign_in_identity_pending_uq`)
  await sql.unsafe(`create unique index sign_in_identity_subject_uq on ${Q('sign_in_identity')} (method, subject) where ended_at is null`)
  await sql.unsafe(`create unique index sign_in_identity_sign_in_name_uq
    on ${Q('sign_in_identity')} (method, lower(sign_in_name)) where sign_in_name is not null and ended_at is null`)
  await sql.unsafe(`create unique index sign_in_identity_pending_uq
    on ${Q('sign_in_identity')} (method, pending_email) where subject is null and ended_at is null`)
  // A sign-in method can name the identifier system its subjects belong to.
  await sql.unsafe(`alter table ${Q('sign_in_method')} add column if not exists identifier_system varchar(140)`)
  await addColumnDef('Sign In Method', { column_name: 'identifier_system', label: 'Identifier system', column_type: 'Reference', reference_table: 'Identifier System' })
}

async function rolesAndSettings() {
  for (const role of ['Data Quality Manager', 'Identity Sync']) {
    const [have] = await sql`select 1 from role where row_id = ${role}`
    if (!have) await saveDoc('Role', { row_id: role }, 'Administrator', 'insert')
  }
  await addColumnDef('System Settings', { column_name: 'people_review', label: 'People review', column_type: 'JSON' })
  await sql`
    insert into single_value (table_name, field, value) values ('System Settings', 'people_review', ${JSON.stringify(CORE_PEOPLE_REVIEW)})
    on conflict (table_name, field) do nothing`
}

async function genericSystems() {
  for (const row of [
    { row_id: 'phone', label: 'Mobile phone', kind: 'contact', source: 'self', match: 'Suggest', sensitivity: 'Restricted' },
    { row_id: 'email', label: 'Email address', kind: 'contact', source: 'self', match: 'Suggest', sensitivity: 'Normal' },
  ]) {
    const [have] = await sql`select 1 from identifier_system where row_id = ${row.row_id}`
    if (!have) await saveIdentifierSystem(row)
  }
}

// ------------------------------------------------------------------ data

export interface ResolveRow {
  employee_code: string
  assigner: string
  stylehr_record_id: string
}

/** Read the warehouse's resolve file: UTF-8, comma-separated, header row
 *  `employee_code,assigner,stylehr_record_id` (D11). */
export function parseResolveFile(text: string): ResolveRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const at = (name: string) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`resolve file: missing column ${name} (want employee_code,assigner,stylehr_record_id)`)
    return i
  }
  const [c, a, r] = [at('employee_code'), at('assigner'), at('stylehr_record_id')]
  return lines.slice(1).map((line, n) => {
    const cells = line.split(',').map((x) => x.trim())
    if (!cells[c] || !cells[r]) throw new Error(`resolve file: line ${n + 2} needs an employee_code and a stylehr_record_id`)
    return { employee_code: cells[c], assigner: cells[a] ?? '', stylehr_record_id: cells[r] }
  })
}

export interface Listed {
  person: string
  full_name: string | null
  detail: string
}

export interface PersonResolutionPlan {
  seedPackApplied: boolean
  codeRows: number
  emailRows: number
  recordRows: number
  subjectsResolved: number
  unresolved: Listed[]
  colliding: Listed[]
  /** Two dev people holding the same employee code: no row, listed. */
  sharedCodes: Listed[]
  /** Every StyleHR sign-in that works today still works after (resolved, or kept by code). */
  parity: { liveStyleHrSignIns: number; keepWorking: number }
}

async function readResolveFile(path: string | undefined | null): Promise<ResolveRow[] | null> {
  if (!path) return null
  return parseResolveFile(readFileSync(path, 'utf8'))
}

/** Backfill identifier rows for dev and rewrite StyleHR subjects to record
 *  numbers. Idempotent: a row already written is not written again. */
async function migrateData(resolvePath: string | null | undefined): Promise<PersonResolutionPlan> {
  const plan: PersonResolutionPlan = {
    seedPackApplied: false, codeRows: 0, emailRows: 0, recordRows: 0, subjectsResolved: 0,
    unresolved: [], colliding: [], sharedCodes: [], parity: { liveStyleHrSignIns: 0, keepWorking: 0 },
  }
  const hasCode = await columnExists('person', 'employee_code')
  const [stylehr] = await sql`select row_id from sign_in_method where kind = 'delegated_password' and row_id = 'stylehr'`
  // The Jeyarama systems are needed exactly when there is Jeyarama data to
  // carry over; the pack is idempotent and DEPLOY.md applies it anyway.
  if (hasCode || stylehr) {
    await applySeedPack('jeyarama')
    plan.seedPackApplied = true
  }

  // Code rows from the employee_code Custom Field, assigner '' (adopted by
  // the sync later, D11).
  if (hasCode) {
    const people = await sql`
      select row_id, full_name, upper(trim(employee_code)) as code from person
      where employee_code is not null and trim(employee_code) <> '' and not built_in`
    const byCode = new Map<string, Record<string, unknown>[]>()
    for (const p of people) byCode.set(String(p.code), [...(byCode.get(String(p.code)) ?? []), p])
    for (const [code, holders] of byCode) {
      if (holders.length > 1) {
        for (const h of holders) plan.sharedCodes.push({ person: String(h.row_id), full_name: h.full_name as string | null, detail: `employee code ${code} is on ${holders.length} people` })
        continue
      }
      const p = holders[0]
      const [have] = await sql`
        select 1 from person_identifier where person_id = ${String(p.row_id)} and system = 'stylehr-employee-code' and value = ${code}`
      if (have) continue
      await sql`insert into person_identifier ${sql({
        id: newIdentifierId(), person_id: String(p.row_id), system: 'stylehr-employee-code', assigner: '', value: code,
        verified: true, one_holder: true, one_per_person: false, source: 'migration', recorded_by: 'migration',
      } as unknown as Record<string, never>)}`
      plan.codeRows++
    }
  }

  // Every address is also an email row (C7): the person's own, and the
  // verified address of every live Google link (what write-through gives a
  // link made from now on).
  for (const p of await sql`
    select row_id, lower(trim(email)) as email, 'person-email' as source from person where email is not null and trim(email) <> '' and not built_in
    union all
    select i.person_id, lower(trim(i.email)), 'sign-in' from sign_in_identity i
    join sign_in_method m on m.row_id = i.method and m.kind = 'google'
    join person p on p.row_id = i.person_id and not p.built_in
    where i.ended_at is null and i.subject is not null and i.email is not null and trim(i.email) <> ''`) {
    const [have] = await sql`select 1 from person_identifier where person_id = ${String(p.row_id)} and system = 'email' and value = ${String(p.email)}`
    if (have) continue
    await sql`insert into person_identifier ${sql({
      id: newIdentifierId(), person_id: String(p.row_id), system: 'email', assigner: '', value: String(p.email),
      verified: true, one_holder: false, one_per_person: false, source: String(p.source), recorded_by: 'migration',
    } as unknown as Record<string, never>)}`
    plan.emailRows++
  }

  // StyleHR subjects → record numbers, from the resolve file (C4).
  if (stylehr) {
    const resolve = await readResolveFile(resolvePath ?? process.env.PEOPLE_RESOLVE_FILE)
    const rowsByCode = new Map<string, ResolveRow[]>()
    for (const r of resolve ?? []) {
      const key = r.employee_code.trim().toUpperCase()
      rowsByCode.set(key, [...(rowsByCode.get(key) ?? []), r])
    }
    const identities = await sql`
      select i.id, i.person_id, i.subject, i.subject_kind, p.full_name
      from sign_in_identity i join person p on p.row_id = i.person_id
      where i.method = 'stylehr' and i.subject is not null and i.ended_at is null`
    plan.parity.liveStyleHrSignIns = identities.length
    for (const i of identities) {
      const person = String(i.person_id)
      const who = { person, full_name: (i.full_name as string | null) ?? null }
      if (i.subject_kind === 'record-id' && (await recordRowFor(person, String(i.subject)))) {
        plan.parity.keepWorking++
        continue
      }
      const code = String(i.subject).trim().toUpperCase()
      const matches = rowsByCode.get(code) ?? []
      if (matches.length !== 1) {
        // Kept working by its employee code until the sync resolves it.
        await sql`update sign_in_identity set subject_kind = 'employee-code' where id = ${String(i.id)}`
        if (matches.length === 0) plan.unresolved.push({ ...who, detail: `employee code ${code}${resolve ? ' not in the resolve file' : ' (no resolve file given)'}` })
        else plan.colliding.push({ ...who, detail: `employee code ${code} has ${matches.length} StyleHR records (firms ${matches.map((m) => m.assigner || '?').join(', ')})` })
        plan.parity.keepWorking++
        continue
      }
      const recordId = matches[0].stylehr_record_id.trim()
      await sql`update sign_in_identity set subject = ${recordId}, subject_kind = 'record-id' where id = ${String(i.id)}`
      const record = await recordRowFor(person, recordId)
      const recordRowId = record ?? newIdentifierId()
      if (!record) {
        await sql`insert into person_identifier ${sql({
          id: recordRowId, person_id: person, system: 'stylehr-employee-id', assigner: '', value: recordId,
          verified: true, one_holder: true, one_per_person: false, source: 'migration', recorded_by: 'migration',
        } as unknown as Record<string, never>)}`
        plan.recordRows++
      }
      await sql`
        update person_identifier set record_identifier_id = ${recordRowId}
        where person_id = ${person} and system = 'stylehr-employee-code' and value = ${code} and upper_inf(valid)`
      plan.subjectsResolved++
      plan.parity.keepWorking++
    }
  }
  return plan
}

async function recordRowFor(person: string, recordId: string): Promise<string | null> {
  const [row] = await sql`
    select id from person_identifier where person_id = ${person} and system = 'stylehr-employee-id' and value = ${recordId} and upper_inf(valid)`
  return row ? String(row.id) : null
}

export async function migratePersonResolution(opts: { resolveFile?: string | null } = {}): Promise<PersonResolutionPlan> {
  await createIdentifierSystemTable()
  await createIdentifierTables()
  await endableIdentities()
  await rolesAndSettings()
  await genericSystems()
  invalidateMeta()
  return migrateData(opts.resolveFile)
}

export function formatResolutionPlan(p: PersonResolutionPlan): string {
  const list = (items: Listed[]) =>
    items.length ? `\n    ${items.map((x) => `${x.full_name ? `${x.full_name} (${x.person})` : x.person} — ${x.detail}`).join('\n    ')}` : ' none'
  return [
    'person-resolution plan (0102, Phase 1a-i)',
    `  Jeyarama seed pack applied: ${p.seedPackApplied ? `yes (${seedPackFile('jeyarama')})` : 'no (no Jeyarama data)'}`,
    `  employee-code rows written (assigner ''): ${p.codeRows}`,
    `  email rows written: ${p.emailRows}`,
    `  StyleHR record-number rows written: ${p.recordRows}`,
    `  StyleHR sign-ins rewritten to the record number: ${p.subjectsResolved}`,
    `  StyleHR sign-ins kept working by employee code (not in the resolve file): ${p.unresolved.length}${list(p.unresolved)}`,
    `  StyleHR sign-ins kept working by employee code (code on 2+ StyleHR records — resolve by hand): ${p.colliding.length}${list(p.colliding)}`,
    `  employee codes on 2+ people here (no row written): ${p.sharedCodes.length}${list(p.sharedCodes)}`,
    `  PARITY: ${p.parity.liveStyleHrSignIns} live StyleHR sign-ins; ${p.parity.keepWorking} keep working`,
  ].join('\n')
}
