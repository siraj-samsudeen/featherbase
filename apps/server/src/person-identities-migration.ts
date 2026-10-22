// Migration 0100 (OpenSpec change `person-identities`, design § Migration).
// Lives in src/ so `cli identities:plan` can run the very same code inside a
// rolled-back transaction and print the same report before a deploy.
import { sql } from './db'
import { createTable } from './table-engine'
import { saveDoc } from './document'
import { invalidateMeta } from './meta'
import { foldName, isReservedEmail } from './identities'

const OLD_SETTINGS = [
  'google_client_id',
  'allowed_login_domains',
  'delegated_login_label',
  'delegated_login_url',
  'delegated_login_user_column',
] as const

export interface PersonIdentitiesReport {
  methods: string[]
  emailsTrimmed: number
  emailsCleared: number
  googleInvites: number
  delegatedLinked: number
  /** Real-email users who never signed in with Google: an administrator invites them explicitly. */
  listedForGoogleInvite: string[]
  /** Users sharing one delegated login ID: migrated with no sign-in name (test mode still finds them). */
  duplicateSignInNames: string[]
  /** Delegated users whose id differs from their employee code (report only). */
  idNotEmployeeCode: string[]
}

function slug(value: string): string {
  return foldName(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'delegated'
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from information_schema.columns
    where table_schema = 'featherbase' and table_name = ${table} and column_name = ${column}`
  return Boolean(row)
}

export async function migratePersonIdentities(): Promise<PersonIdentitiesReport> {
  const report: PersonIdentitiesReport = {
    methods: [],
    emailsTrimmed: 0,
    emailsCleared: 0,
    googleInvites: 0,
    delegatedLinked: 0,
    listedForGoogleInvite: [],
    duplicateSignInNames: [],
    idNotEmployeeCode: [],
  }

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
        { column_name: 'kind', column_type: 'Choice', choices: 'password\ngoogle\ndelegated_password', reqd: true, in_list_view: true },
        { column_name: 'label', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
        { column_name: 'new_person', column_type: 'Choice', choices: 'refuse\ncreate_if_email_domain_allowed\ncreate', default_value: 'refuse', in_list_view: true },
        { column_name: 'allowed_email_domains', column_type: 'Data' },
        { column_name: 'self_link', column_type: 'Check', default_value: '0' },
        { column_name: 'client_id', column_type: 'Data' },
        { column_name: 'service_url', column_type: 'Text' },
        { column_name: 'settings', column_type: 'JSON' },
      ],
    } as Parameters<typeof createTable>[0])
  invalidateMeta()

  const settingRows = await sql`
    select field, value from single_value
    where table_name = 'System Settings' and field in ${sql([...OLD_SETTINGS])}`
  const setting = (f: (typeof OLD_SETTINGS)[number]) =>
    String(settingRows.find((r) => r.field === f)?.value ?? '').trim()

  const ensureMethod = async (row: Record<string, unknown>) => {
    const [exists] = await sql`select 1 from sign_in_method where row_id = ${String(row.row_id)}`
    if (!exists) await saveDoc('Sign In Method', row, 'Administrator')
    report.methods.push(String(row.row_id))
  }
  await ensureMethod({ row_id: 'password', kind: 'password', label: 'Password', enabled: true, new_person: 'refuse', self_link: true })
  await ensureMethod({
    row_id: 'google',
    kind: 'google',
    label: 'Google',
    enabled: true,
    new_person: 'create_if_email_domain_allowed',
    allowed_email_domains: setting('allowed_login_domains'),
    self_link: true,
    client_id: setting('google_client_id'),
  })
  let delegatedKey: string | null = null
  const delegatedUrl = setting('delegated_login_url')
  if (delegatedUrl) {
    let host = 'delegated'
    try {
      host = new URL(delegatedUrl).hostname
    } catch {
      // A malformed URL leaves the method in place but unusable, as before.
    }
    const label = setting('delegated_login_label') || host
    delegatedKey = slug(label)
    await ensureMethod({
      row_id: delegatedKey,
      kind: 'delegated_password',
      label,
      enabled: true,
      new_person: 'refuse',
      self_link: false,
      service_url: delegatedUrl,
    })
  }

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
  // An invite tied to the contact email dies with that email (design D5),
  // whichever path changes it: the Admin, the generic API or a roster PATCH.
  await sql.unsafe(`
    create or replace function featherbase.fc_cancel_email_invites() returns trigger
    language plpgsql set search_path = pg_catalog as $$
    begin
      if old.email is not null and lower(trim(old.email)) is distinct from lower(trim(new.email)) then
        delete from featherbase.user_identity
        where user_id = new.row_id and subject is null and pending_email = lower(trim(old.email));
      end if;
      return new;
    end $$`)
  // `on` is not a relation keyword the platform qualifier rewrites: qualify by hand.
  await sql`drop trigger if exists user_cancel_email_invites on featherbase."user"`
  await sql`create trigger user_cancel_email_invites after update of email on featherbase."user"
    for each row execute function featherbase.fc_cancel_email_invites()`

  // 3. Email becomes optional contact data; nothing invented is kept.
  await sql`update column_def set reqd = false, "unique" = false where parent = 'User' and column_name = 'email'`
  const trimmed = await sql`
    update "user" set email = trim(email) where email is not null and email <> trim(email) returning row_id`
  report.emailsTrimmed = trimmed.length
  const withEmail = await sql`select row_id, email from "user" where email is not null`
  const clear = withEmail.filter((r) => !String(r.email).trim() || isReservedEmail(String(r.email))).map((r) => String(r.row_id))
  if (clear.length) await sql`update "user" set email = null where row_id in ${sql(clear)}`
  report.emailsCleared = clear.length

  // 4. Only now, with placeholders gone, may two real addresses collide.
  const dupes = await sql`
    select lower(email) as email, array_agg(row_id order by row_id) as users from "user"
    where email is not null group by lower(email) having count(*) > 1`
  if (dupes.length)
    throw new Error(
      `person-identities: these accounts share an email ignoring case; fix them first:\n${dupes
        .map((d) => `  ${d.email}: ${(d.users as string[]).join(', ')}`)
        .join('\n')}`,
    )
  await sql`alter table "user" drop constraint if exists user_email_uq`
  await sql`create unique index if not exists user_email_lower_uq on "user" (lower(email)) where email is not null`
  invalidateMeta()

  // 5a. Google: a one-time invite only for people who really signed in with Google.
  const invites = await sql`
    insert into user_identity (id, user_id, method, subject, pending_email, linked_by)
    select 'uid_' || substr(md5(random()::text || u.row_id), 1, 12), u.row_id, 'google', null, lower(u.email), 'migration'
    from "user" u
    where u.social_login = 'google' and u.email is not null and coalesce(u.user_type, 'human') <> 'service'
      and not exists (
        select 1 from user_identity i join sign_in_method m on m.row_id = i.method
        where i.user_id = u.row_id and m.kind = 'google')
    on conflict do nothing
    returning id`
  report.googleInvites = invites.length
  const listed = await sql`
    select u.row_id from "user" u
    where u.email is not null and coalesce(u.user_type, 'human') <> 'service'
      and u.social_login is distinct from 'google' and u.row_id not in ('Administrator', 'Guest')
      and not exists (
        select 1 from user_identity i join sign_in_method m on m.row_id = i.method
        where i.user_id = u.row_id and m.kind = 'google')
    order by u.row_id`
  report.listedForGoogleInvite = listed.map((r) => String(r.row_id))

  // 5b. The connected service: the old User column becomes linked identities.
  const column = setting('delegated_login_user_column')
  if (delegatedKey && /^[a-z_][a-z0-9_]*$/.test(column) && (await columnExists('user', column))) {
    const linked = await sql`
      select row_id, trim(${sql(column)}) as name from "user"
      where coalesce(trim(${sql(column)}), '') <> '' and coalesce(user_type, 'human') <> 'service'
      order by row_id`
    const counts = new Map<string, number>()
    for (const r of linked) counts.set(foldName(String(r.name)), (counts.get(foldName(String(r.name))) ?? 0) + 1)
    for (const r of linked) {
      const shared = (counts.get(foldName(String(r.name))) ?? 0) > 1
      if (shared) report.duplicateSignInNames.push(`${r.row_id} (${r.name})`)
      const [row] = await sql`
        insert into user_identity (id, user_id, method, subject, sign_in_name, linked_by)
        values (${'uid_' + Math.random().toString(36).slice(2, 14)}, ${String(r.row_id)}, ${delegatedKey},
                ${String(r.row_id)}, ${shared ? null : String(r.name)}, 'migration')
        on conflict do nothing returning id`
      if (row) report.delegatedLinked++
    }
    // Report only: the subject is the account id, which the roster sync makes
    // the employee code; list anyone for whom that is not so.
    if (await columnExists('user', 'employee_code')) {
      const odd = await sql`
        select row_id from "user"
        where coalesce(trim(${sql(column)}), '') <> '' and coalesce(user_type, 'human') <> 'service'
          and trim(coalesce(employee_code, '')) is distinct from row_id
        order by row_id`
      report.idNotEmployeeCode = odd.map((r) => String(r.row_id))
    }
    // 6. The old column stays as roster data; say it no longer signs anyone in.
    const label = `${(await sql`select label from sign_in_method where row_id = ${delegatedKey}`)[0]?.label ?? 'Service'} ID (roster copy — sign-in uses linked identities)`
    await sql`update custom_field set label = ${label} where dt = 'User' and column_name = ${column}`
    await sql`update column_def set label = ${label} where parent = 'User' and column_name = ${column}`
  }

  // 7. The System Settings sign-in columns are gone; their values now live in rows.
  await sql`delete from column_def where parent = 'System Settings' and column_name in ${sql([...OLD_SETTINGS])}`
  await sql`delete from single_value where table_name = 'System Settings' and field in ${sql([...OLD_SETTINGS])}`
  invalidateMeta()
  return report
}

export function formatReport(r: PersonIdentitiesReport): string {
  const list = (items: string[]) => (items.length ? `\n    ${items.join('\n    ')}` : ' none')
  return [
    `person-identities: sign-in methods ${r.methods.join(', ')}`,
    `  emails trimmed: ${r.emailsTrimmed}; placeholder/blank emails cleared: ${r.emailsCleared}`,
    `  Google invites created (signed in with Google before): ${r.googleInvites}`,
    `  connected-service identities linked: ${r.delegatedLinked}`,
    `  listed for an explicit Google invite (real email, never signed in with Google):${list(r.listedForGoogleInvite)}`,
    `  shared login IDs, linked with no sign-in name (test mode still finds them):${list(r.duplicateSignInNames)}`,
    `  account id differs from employee code (relink if wrong):${list(r.idNotEmployeeCode)}`,
  ].join('\n')
}
