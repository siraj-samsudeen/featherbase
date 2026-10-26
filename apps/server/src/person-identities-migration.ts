// Migration 0100 (OpenSpec change `person-identities`, design § Migration).
//
// planPersonIdentities() is READ-ONLY: it computes everything the upgrade will
// do from the data as it is, takes no locks beyond plain reads, and is what
// `cli identities:plan` prints before a deploy. migratePersonIdentities()
// computes the same plan first, then applies it, so the rehearsal and the
// real run cannot disagree.
import { sql } from './db'
import { switchedOn } from './env'

const mockOAuth = () => switchedOn('ALLOW_MOCK_OAUTH')
import { createTable, pgType } from './table-engine'
import { saveDoc } from './document'
import { invalidateMeta } from './meta'
import { PLATFORM_SCHEMA } from './platform-schema'
import { foldName, isReservedEmail, looksLikeEmail, newIdentityId } from './identities'
import { DEFAULT_WIRE } from './delegated-login'
import { NEW_PERSON_RULES, SIGN_IN_METHOD_KINDS } from 'shared'

const OLD_SETTINGS = [
  'google_client_id',
  'allowed_login_domains',
  'delegated_login_label',
  'delegated_login_url',
  'delegated_login_user_column',
] as const

// The 0005 seeds invented these two; a shipped migration is never edited, so
// they are cleared here (review minor 12).
const SEED_EMAILS: Record<string, string> = { Administrator: 'admin@example.com', Guest: 'guest@example.com' }

export interface Person {
  row_id: string
  full_name: string | null
  detail?: string
}

export interface PersonIdentitiesPlan {
  methods: { key: string; kind: string; label: string; enabled: boolean }[]
  emailsTrimmed: Person[]
  emailsCleared: Person[]
  /** The 0005 seed addresses among them: those accounts sign in by user id from now on. */
  seedEmailsCleared: Person[]
  /** Two remaining addresses equal ignoring case: the upgrade stops on these. */
  duplicateEmails: { email: string; users: string[] }[]
  googleInvites: (Person & { address: string })[]
  /** Signed in with Google before, but id and email name different addresses: invited on the email. */
  googleIdEmailDiffer: Person[]
  /** Real email, never signed in with Google: an administrator invites them explicitly. */
  listedForGoogleInvite: Person[]
  delegatedLinks: (Person & { sign_in_name: string | null })[]
  /** People sharing one delegated login ID: linked with no sign-in name (test mode still finds them). */
  duplicateSignInNames: Person[]
  /** Delegated users whose id differs from their employee code (report only). */
  idNotEmployeeCode: Person[]
  parity: { canSignInToday: number; keepWayIn: number; exceptions: Person[] }
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from information_schema.columns
    where table_schema = ${PLATFORM_SCHEMA} and table_name = ${table} and column_name = ${column}`
  return Boolean(row)
}

async function tableExists(table: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from information_schema.tables where table_schema = ${PLATFORM_SCHEMA} and table_name = ${table}`
  return Boolean(row)
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The old delegated configuration was ON only with a usable URL and a User
 *  column; the migrated row keeps exactly that (review minor 2). Its key is the
 *  provider host's first label (stylehr.in → `stylehr`), not the label. */
function oldDelegated(url: string, label: string, column: string) {
  if (!url) return null
  let parsed: URL | null = null
  try {
    parsed = new URL(url)
  } catch {
    parsed = null
  }
  const usable = Boolean(parsed) && (parsed!.protocol === 'https:' || (parsed!.protocol === 'http:' && LOCAL_HOSTS.has(parsed!.hostname)))
  const host = parsed?.hostname.replace(/^(www|api|login|auth)\./, '') ?? ''
  const key = (host.split('.')[0] || 'delegated').replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'delegated'
  return { key, label: label || host || key, url, enabled: usable && Boolean(column) }
}

export async function planPersonIdentities(): Promise<PersonIdentitiesPlan> {
  const settingRows = await sql`
    select field, value from single_value
    where table_name = 'System Settings' and field in ${sql([...OLD_SETTINGS])}`
  const setting = (f: (typeof OLD_SETTINGS)[number]) =>
    String(settingRows.find((r) => r.field === f)?.value ?? '').trim()
  const haveMethods = await tableExists('sign_in_method')
  const existingMethods = haveMethods ? await sql`select row_id, kind, label, enabled, client_id from sign_in_method` : []
  const haveIdentities = await tableExists('user_identity')

  const delegated = oldDelegated(setting('delegated_login_url'), setting('delegated_login_label'), setting('delegated_login_user_column'))
  const column = setting('delegated_login_user_column')
  const columnOk = Boolean(delegated) && /^[a-z_][a-z0-9_]*$/.test(column) && (await columnExists('user', column))
  const hasEmployeeCode = await columnExists('user', 'employee_code')

  const methods = [
    { key: 'password', kind: 'password', label: 'Password', enabled: true },
    { key: 'google', kind: 'google', label: 'Google', enabled: Boolean(setting('google_client_id')) || mockOAuth() },
    ...(delegated ? [{ key: delegated.key, kind: 'delegated_password', label: delegated.label, enabled: delegated.enabled }] : []),
  ].map((m) => {
    const have = existingMethods.find((r) => r.row_id === m.key)
    return have ? { key: m.key, kind: String(have.kind), label: String(have.label), enabled: have.enabled === true } : m
  })

  // social_login is read once, here, and dropped by the migration.
  const hasSocialLogin = await columnExists('user', 'social_login')
  const users = await sql`
    select u.row_id, u.full_name, u.email, u.enabled,
      ${hasSocialLogin ? sql`u.social_login` : sql`null::text`} as social_login,
      coalesce(u.user_type, 'human') as user_type,
      (u.password_hash is not null) as has_password,
      ${columnOk ? sql`trim(${sql(column)})` : sql`null::text`} as delegated_name,
      ${hasEmployeeCode ? sql`trim(employee_code)` : sql`null::text`} as employee_code,
      (u.row_id = 'Administrator' or exists (
        select 1 from has_role r where r.parent = u.row_id and r.role in ('System Manager', 'Administrator'))) as privileged
    from "user" u order by u.row_id`
  const linkedGoogle = new Set<string>()
  const linkedDelegated = new Set<string>()
  if (haveIdentities) {
    for (const r of await sql`
      select i.user_id, m.kind from user_identity i join sign_in_method m on m.row_id = i.method`) {
      if (r.kind === 'google') linkedGoogle.add(String(r.user_id))
      if (r.kind === 'delegated_password') linkedDelegated.add(String(r.user_id))
    }
  }
  const person = (u: Record<string, unknown>, detail?: string): Person => ({
    row_id: String(u.row_id),
    full_name: (u.full_name as string | null) ?? null,
    ...(detail ? { detail } : {}),
  })

  const plan: PersonIdentitiesPlan = {
    methods,
    emailsTrimmed: [],
    emailsCleared: [],
    seedEmailsCleared: [],
    duplicateEmails: [],
    googleInvites: [],
    googleIdEmailDiffer: [],
    listedForGoogleInvite: [],
    delegatedLinks: [],
    duplicateSignInNames: [],
    idNotEmployeeCode: [],
    parity: { canSignInToday: 0, keepWayIn: 0, exceptions: [] },
  }

  // Email after the clean-up, per person.
  const kept = new Map<string, string | null>()
  for (const u of users) {
    const raw = u.email == null ? null : String(u.email)
    let next: string | null = raw == null ? null : raw.trim()
    if (raw != null && raw !== raw.trim()) plan.emailsTrimmed.push(person(u, raw.trim()))
    if (next != null && (!next || isReservedEmail(next) || SEED_EMAILS[String(u.row_id)] === next)) {
      plan.emailsCleared.push(person(u, raw!))
      if (SEED_EMAILS[String(u.row_id)] === next) plan.seedEmailsCleared.push(person(u, `${next}: sign in as ${u.row_id} instead`))
      next = null
    }
    kept.set(String(u.row_id), next)
  }
  const byEmail = new Map<string, string[]>()
  for (const [id, email] of kept) if (email) byEmail.set(foldName(email), [...(byEmail.get(foldName(email)) ?? []), id])
  for (const [email, ids] of byEmail) if (ids.length > 1) plan.duplicateEmails.push({ email, users: ids })

  // Google: a one-time invite only for people who really signed in with Google
  // (review M1), on their email — or on their id when that is the address and
  // the email is empty (review A-M3).
  const invited = new Set<string>()
  for (const u of users) {
    const id = String(u.row_id)
    if (u.user_type === 'service' || linkedGoogle.has(id)) continue
    const email = kept.get(id)
    const idAddress = looksLikeEmail(id) && !isReservedEmail(id) ? id : null
    if (u.social_login === 'google') {
      if (email && idAddress && foldName(email) !== foldName(idAddress)) plan.googleIdEmailDiffer.push(person(u, `id ${id}, email ${email}`))
      const address = email ?? idAddress
      if (address && !invited.has(foldName(address))) {
        invited.add(foldName(address))
        plan.googleInvites.push({ ...person(u), address: foldName(address) })
      }
    } else if (email && !['Administrator', 'Guest'].includes(id)) plan.listedForGoogleInvite.push(person(u, email))
  }

  // The connected service: the old User column becomes linked identities.
  if (delegated && columnOk) {
    const named = users.filter((u) => u.user_type !== 'service' && u.delegated_name)
    const counts = new Map<string, number>()
    for (const u of named) counts.set(foldName(String(u.delegated_name)), (counts.get(foldName(String(u.delegated_name))) ?? 0) + 1)
    for (const u of named) {
      const shared = (counts.get(foldName(String(u.delegated_name))) ?? 0) > 1
      if (shared) plan.duplicateSignInNames.push(person(u, String(u.delegated_name)))
      if (!linkedDelegated.has(String(u.row_id)))
        plan.delegatedLinks.push({ ...person(u), sign_in_name: shared ? null : String(u.delegated_name) })
      if (hasEmployeeCode && (u.employee_code ?? '') !== u.row_id) plan.idNotEmployeeCode.push(person(u, `employee code ${u.employee_code ?? '—'}`))
    }
  }

  // Parity: everyone who can sign in today keeps a way in, or is named.
  const googleOn = Boolean(setting('google_client_id')) || mockOAuth() ||
    existingMethods.some((m) => m.kind === 'google' && m.enabled && (m.client_id || mockOAuth()))
  const delegatedOn = Boolean(delegated?.enabled && columnOk)
  const linkedAfter = new Set([...plan.delegatedLinks.map((d) => d.row_id), ...linkedDelegated])
  const invitedAfter = new Set([...plan.googleInvites.map((g) => g.row_id), ...linkedGoogle])
  for (const u of users) {
    const id = String(u.row_id)
    if (!u.enabled || u.user_type === 'service' || id === 'Guest') continue
    // Google matched by email or id; a placeholder address never had a Google account.
    const viaGoogleToday = googleOn && Boolean(kept.get(id) ?? (looksLikeEmail(id) && !isReservedEmail(id) ? id : null))
    const viaDelegatedToday = delegatedOn && Boolean(u.delegated_name) && !u.privileged
    const today = u.has_password || viaGoogleToday || viaDelegatedToday
    if (!today) continue
    plan.parity.canSignInToday++
    const after = u.has_password || (delegatedOn && !u.privileged && linkedAfter.has(id)) || (googleOn && invitedAfter.has(id))
    if (after) plan.parity.keepWayIn++
    else plan.parity.exceptions.push(person(u, viaGoogleToday ? 'Google by email only: invite after the deploy' : 'no way in after the upgrade'))
  }
  return plan
}

async function addActivityColumns() {
  // Login rows record the method and test mode (review minor 8).
  for (const [column_name, column_type, label] of [
    ['sign_in_method', 'Data', 'Sign-in Method'],
    ['test_mode', 'Check', 'Test Mode'],
  ] as const) {
    const [have] = await sql`select 1 from column_def where parent = 'Activity Log' and column_name = ${column_name}`
    if (have) continue
    await sql.unsafe(`alter table ${PLATFORM_SCHEMA}.activity_log add column if not exists "${column_name}" ${pgType(column_type)}`)
    const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'Activity Log'`
    await sql`insert into column_def ${sql({
      parent: 'Activity Log', position: (maxidx as number) + 1, column_name, label, column_type,
      reqd: false, unique: false, default_value: null, read_only: true, hidden: false, in_list_view: false, tier: 'basic',
    })}`
  }
}

// People who sign up get an opaque id, so their chosen name lives in
// `username` (unique ignoring case). And `row_id` is the permanent person id
// (the warehouse person_id): a trigger refuses changing it unless a migration
// deliberately sets featherbase.allow_person_id_change = 'on'.
async function addUsernameAndPermanence() {
  const [have] = await sql`select 1 from column_def where parent = 'User' and column_name = 'username'`
  if (!have) {
    await sql.unsafe(`alter table ${PLATFORM_SCHEMA}."user" add column if not exists "username" ${pgType('Data')}`)
    const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'User'`
    await sql`insert into column_def ${sql({
      parent: 'User', position: (maxidx as number) + 1, column_name: 'username', label: 'Username', column_type: 'Data',
      reqd: false, unique: false, default_value: null, read_only: false, hidden: false, in_list_view: false, tier: 'basic',
    })}`
  }
  await sql.unsafe(`create unique index if not exists user_username_lower_uq on ${PLATFORM_SCHEMA}."user" (lower(username)) where username is not null`)
  await sql.unsafe(`
    create or replace function ${PLATFORM_SCHEMA}.fc_person_id_is_permanent() returns trigger
    language plpgsql set search_path = pg_catalog as $$
    begin
      if new.row_id is distinct from old.row_id
         and coalesce(current_setting('featherbase.allow_person_id_change', true), '') <> 'on' then
        raise exception 'A person''s id is permanent: user % cannot be renamed', old.row_id;
      end if;
      return new;
    end $$`)
  await sql.unsafe(`drop trigger if exists user_person_id_is_permanent on ${PLATFORM_SCHEMA}."user"`)
  await sql.unsafe(`create trigger user_person_id_is_permanent before update of row_id on ${PLATFORM_SCHEMA}."user"
    for each row execute function ${PLATFORM_SCHEMA}.fc_person_id_is_permanent()`)
}

export async function migratePersonIdentities(): Promise<PersonIdentitiesPlan> {
  const plan = await planPersonIdentities()
  if (plan.duplicateEmails.length)
    throw new Error(
      `person-identities: these accounts share an email ignoring case; fix them first:\n${plan.duplicateEmails
        .map((d) => `  ${d.email}: ${d.users.join(', ')}`)
        .join('\n')}`,
    )
  const settingRows = await sql`
    select field, value from single_value where table_name = 'System Settings' and field in ${sql([...OLD_SETTINGS])}`
  const setting = (f: (typeof OLD_SETTINGS)[number]) =>
    String(settingRows.find((r) => r.field === f)?.value ?? '').trim()

  // 1. The Sign In Method Table and its rows, copied from System Settings.
  const [haveTable] = await sql`select 1 from table_def where name = 'Sign In Method'`
  if (!haveTable)
    await createTable({
      name: 'Sign In Method',
      module: 'Core',
      id_pattern: 'prompt',
      title_column: 'label',
      system: true,
      columns: [
        { column_name: 'kind', column_type: 'Choice', choices: SIGN_IN_METHOD_KINDS.join('\n'), reqd: true, in_list_view: true },
        { column_name: 'label', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
        { column_name: 'new_person', column_type: 'Choice', choices: NEW_PERSON_RULES.join('\n'), default_value: 'refuse', in_list_view: true },
        { column_name: 'allowed_email_domains', column_type: 'Data' },
        { column_name: 'self_link', column_type: 'Check', default_value: '0' },
        { column_name: 'client_id', column_type: 'Data' },
        { column_name: 'service_url', column_type: 'Text' },
        { column_name: 'settings', column_type: 'JSON' },
      ],
    } as Parameters<typeof createTable>[0])
  invalidateMeta()
  const ensureMethod = async (row: Record<string, unknown>) => {
    const [exists] = await sql`select 1 from sign_in_method where row_id = ${String(row.row_id)}`
    if (!exists) await saveDoc('Sign In Method', row, 'Administrator')
  }
  await ensureMethod({ row_id: 'password', kind: 'password', label: 'Password', enabled: true, new_person: 'refuse', self_link: true })
  // On only when it can work: a client id, or the dev mock (Codex P2 on #371).
  const googleUsable = Boolean(setting('google_client_id')) || mockOAuth()
  await ensureMethod({
    row_id: 'google',
    kind: 'google',
    label: 'Google',
    enabled: googleUsable,
    new_person: 'create_if_email_domain_allowed',
    allowed_email_domains: setting('allowed_login_domains'),
    self_link: true,
    client_id: setting('google_client_id'),
  })
  const delegated = oldDelegated(setting('delegated_login_url'), setting('delegated_login_label'), setting('delegated_login_user_column'))
  if (delegated)
    await ensureMethod({
      row_id: delegated.key,
      kind: 'delegated_password',
      label: delegated.label,
      enabled: delegated.enabled,
      new_person: 'refuse',
      self_link: false,
      service_url: delegated.url,
      // The old code spoke StyleHR's wire format; it is now written down.
      settings: DEFAULT_WIRE,
    })

  // 2. Linked identities, their constraints, and the invite-cancelling trigger.
  await sql`
    create table if not exists user_identity (
      id varchar(40) primary key,
      user_id varchar(140) not null references "user"(row_id) on update cascade on delete cascade,
      method varchar(140) not null references sign_in_method(row_id) on update cascade on delete restrict,
      subject varchar(255),
      sign_in_name varchar(255),
      email varchar(255),
      display_name varchar(255),
      pending_email varchar(255),
      linked_at timestamptz not null default now(),
      linked_by varchar(140) not null,
      last_used_at timestamptz,
      constraint user_identity_subject_or_pending check ((subject is null) = (pending_email is not null))
    )`
  await sql`create unique index if not exists user_identity_subject_uq on user_identity (method, subject)`
  await sql`create unique index if not exists user_identity_sign_in_name_uq
    on user_identity (method, lower(sign_in_name)) where sign_in_name is not null`
  await sql`create unique index if not exists user_identity_pending_uq
    on user_identity (method, pending_email) where subject is null`
  await sql`create index if not exists user_identity_user_ix on user_identity (user_id)`
  // Any real change of the person's email — set, changed or cleared — cancels
  // EVERY unclaimed invite they hold, whatever address it was for (Codex P1 on
  // #371): an administrator re-invites deliberately. Whichever path changes the
  // email. `on` is not a relation keyword the platform qualifier rewrites, so
  // these statements qualify by hand.
  await sql.unsafe(`
    create or replace function ${PLATFORM_SCHEMA}.fc_cancel_email_invites() returns trigger
    language plpgsql set search_path = pg_catalog as $$
    begin
      if lower(trim(coalesce(old.email, ''))) is distinct from lower(trim(coalesce(new.email, ''))) then
        delete from ${PLATFORM_SCHEMA}.user_identity
        where user_id = new.row_id and subject is null;
      end if;
      return new;
    end $$`)
  await sql.unsafe(`drop trigger if exists user_cancel_email_invites on ${PLATFORM_SCHEMA}."user"`)
  await sql.unsafe(`create trigger user_cancel_email_invites after update of email on ${PLATFORM_SCHEMA}."user"
    for each row execute function ${PLATFORM_SCHEMA}.fc_cancel_email_invites()`)
  await addActivityColumns()
  await addUsernameAndPermanence()

  // 3. Email becomes optional contact data; nothing invented is kept.
  await sql`update column_def set reqd = false, "unique" = false where parent = 'User' and column_name = 'email'`
  await sql`update "user" set email = trim(email) where email is not null and email <> trim(email)`
  const clear = plan.emailsCleared.map((p) => p.row_id)
  if (clear.length) await sql`update "user" set email = null where row_id in ${sql(clear)}`

  // 4. Uniqueness ignoring case, now that placeholders are gone.
  await sql`alter table "user" drop constraint if exists user_email_uq`
  await sql`create unique index if not exists user_email_lower_uq on "user" (lower(email)) where email is not null`
  invalidateMeta()

  // 5. Identities, exactly as planned.
  for (const g of plan.googleInvites)
    await sql`insert into user_identity ${sql({ id: newIdentityId(), user_id: g.row_id, method: 'google', subject: null, pending_email: g.address, linked_by: 'migration' })}
      on conflict do nothing`
  if (delegated)
    for (const d of plan.delegatedLinks)
      await sql`insert into user_identity ${sql({ id: newIdentityId(), user_id: d.row_id, method: delegated.key, subject: d.row_id, sign_in_name: d.sign_in_name, linked_by: 'migration' })}
        on conflict do nothing`

  // 5b. social_login was only ever "signed in with Google once"; the invites
  // above are its last use. Linked identities replace it.
  await sql`delete from column_def where parent = 'User' and column_name = 'social_login'`
  await sql.unsafe(`alter table ${PLATFORM_SCHEMA}."user" drop column if exists social_login`)
  invalidateMeta()

  // 6. The old column stays as roster data; say it no longer signs anyone in.
  const column = setting('delegated_login_user_column')
  if (delegated && /^[a-z_][a-z0-9_]*$/.test(column)) {
    const label = `${delegated.label} ID (roster copy — sign-in uses linked identities)`
    await sql`update custom_field set label = ${label} where dt = 'User' and column_name = ${column}`
    await sql`update column_def set label = ${label} where parent = 'User' and column_name = ${column}`
  }

  // 7. The System Settings sign-in columns are gone; their values live in rows.
  await sql`delete from column_def where parent = 'System Settings' and column_name in ${sql([...OLD_SETTINGS])}`
  await sql`delete from single_value where table_name = 'System Settings' and field in ${sql([...OLD_SETTINGS])}`
  invalidateMeta()
  return plan
}

export function formatPlan(p: PersonIdentitiesPlan): string {
  const who = (x: Person) => `${x.full_name && x.full_name !== x.row_id ? `${x.full_name} (${x.row_id})` : x.row_id}${x.detail ? ` — ${x.detail}` : ''}`
  const list = (items: Person[]) => (items.length ? `\n    ${items.map(who).join('\n    ')}` : ' none')
  return [
    `person-identities plan`,
    `  sign-in methods: ${p.methods.map((m) => `${m.key} (${m.kind}, ${m.label}, ${m.enabled ? 'on' : 'off'})`).join('; ')}`,
    `  emails trimmed: ${p.emailsTrimmed.length}${list(p.emailsTrimmed)}`,
    `  placeholder/blank/seed emails cleared: ${p.emailsCleared.length}${list(p.emailsCleared)}`,
    `  seed addresses cleared — these accounts can no longer sign in by that email, only by their id:${list(p.seedEmailsCleared)}`,
    `  addresses that collide ignoring case (the upgrade STOPS): ${p.duplicateEmails.length ? p.duplicateEmails.map((d) => `${d.email}: ${d.users.join(', ')}`).join('; ') : 'none'}`,
    `  Google invites (signed in with Google before): ${p.googleInvites.length}${list(p.googleInvites.map((g) => ({ ...g, detail: g.address })))}`,
    `  Google users whose id and email differ (invited on the email):${list(p.googleIdEmailDiffer)}`,
    `  listed for an explicit Google invite after the deploy (real email, never signed in with Google): ${p.listedForGoogleInvite.length}${list(p.listedForGoogleInvite)}`,
    `  connected-service identities to link: ${p.delegatedLinks.length}`,
    `  shared login IDs, linked with no sign-in name (test mode still finds them):${list(p.duplicateSignInNames)}`,
    `  account id differs from employee code (relink if wrong):${list(p.idNotEmployeeCode)}`,
    `  PARITY: ${p.parity.canSignInToday} people can sign in today; ${p.parity.keepWayIn} keep a way in; ${p.parity.exceptions.length} exception(s)${list(p.parity.exceptions)}`,
  ].join('\n')
}
