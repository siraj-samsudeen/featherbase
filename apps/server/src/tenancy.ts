import postgres from 'postgres'
import { sql } from './db'
import { config } from './config'
import { AppError } from './errors'

// PLAT-008: multi-tenancy, schema-per-site. Each site is an isolated Postgres
// SCHEMA (site_<name>) holding its own tab_* tables. A site-scoped client sets
// its search_path to ONLY that schema, so a query can never reach another
// site's tables — isolation is enforced by Postgres, not by app-level filters.
// A `public.site` registry maps an inbound Host to its schema; the resolver
// turns the request Host header into the site to serve.

function sanitize(site: string): string {
  const s = site.toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (!s) throw new AppError('ValidationError', 'Invalid site name')
  return s
}
export function siteSchema(site: string): string {
  return `site_${sanitize(site)}`
}

// One pooled client per site, each pinned to the site's schema.
const clients = new Map<string, ReturnType<typeof postgres>>()
export function siteClient(site: string): ReturnType<typeof postgres> {
  const schema = siteSchema(site)
  let c = clients.get(schema)
  if (!c) {
    c = postgres(config.databaseUrl, {
      prepare: false,
      onnotice: () => {},
      connection: { search_path: schema },
    })
    clients.set(schema, c)
  }
  return c
}

// Test/shutdown helper: close all site pools.
export async function closeSiteClients(): Promise<void> {
  await Promise.all([...clients.values()].map((c) => c.end()))
  clients.clear()
}

// The per-site "migrate": create the site's schema and its core tables. Real
// and idempotent — the same tab_doctype/tab_docfield/tab_user shape every site
// gets, independent of every other site.
export async function siteMigrate(site: string): Promise<void> {
  const schema = siteSchema(site)
  await sql.unsafe(`create schema if not exists "${schema}"`)
  const c = siteClient(site)
  await c.unsafe(`
    create table if not exists tab_doctype (
      name text primary key, module text, created_at timestamptz not null default now());
    create table if not exists tab_docfield (
      id bigserial primary key, parent text not null, fieldname text not null, fieldtype text not null);
    create table if not exists tab_user (
      name text primary key, email text unique, full_name text,
      enabled boolean not null default true, created_at timestamptz not null default now());
  `)
}

export async function createSite(site: string, host?: string): Promise<{ site: string; host: string; schema: string }> {
  const name = sanitize(site)
  const [exists] = await sql`select 1 from tab_site where name = ${name}`
  if (exists) throw new AppError('ConflictError', `Site ${name} already exists`)
  const resolvedHost = (host ?? `${name}.localhost`).toLowerCase()
  await siteMigrate(name)
  await sql`insert into tab_site ${sql({ name, host: resolvedHost, schema: siteSchema(name) })}`
  return { site: name, host: resolvedHost, schema: siteSchema(name) }
}

export async function listSites(): Promise<{ name: string; host: string; schema: string }[]> {
  const rows = await sql`select name, host, schema from tab_site order by name`
  return rows.map((r) => ({ name: r.name as string, host: r.host as string, schema: r.schema as string }))
}

// Resolve the site from a request Host header. Matches the registry by exact
// host first, then by leading subdomain label (alpha.example.com → alpha).
export async function resolveSite(hostHeader: string | undefined): Promise<string> {
  if (!hostHeader) throw new AppError('ValidationError', 'Missing Host header')
  const host = hostHeader.toLowerCase().split(':')[0]
  const [byHost] = await sql`select name from tab_site where host = ${host}`
  if (byHost) return byHost.name as string
  const label = host.split('.')[0]
  const [byLabel] = await sql`select name from tab_site where name = ${label}`
  if (byLabel) return byLabel.name as string
  throw new AppError('NotFoundError', `No site for host ${host}`)
}

// --- site-scoped data operations (all run on the site's own schema) ---------

function tableFor(name: string): string {
  return `tab_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`
}

export async function siteCreateDoctype(
  site: string,
  name: string,
  fields: { fieldname: string; fieldtype: string }[],
): Promise<{ name: string }> {
  const c = siteClient(site)
  const [dup] = await c`select 1 from tab_doctype where name = ${name}`
  if (dup) throw new AppError('ConflictError', `DocType ${name} already exists on this site`)
  await c.begin(async (tx) => {
    await tx`insert into tab_doctype ${tx({ name, module: 'Site' })}`
    for (const f of fields) await tx`insert into tab_docfield ${tx({ parent: name, fieldname: f.fieldname, fieldtype: f.fieldtype })}`
    const cols = fields.map((f) => `"${f.fieldname.replace(/[^a-z0-9_]/gi, '_')}" text`).join(', ')
    await tx.unsafe(`create table if not exists ${tableFor(name)} (name text primary key${cols ? ', ' + cols : ''})`)
  })
  return { name }
}

export async function siteListDoctypes(site: string): Promise<string[]> {
  const c = siteClient(site)
  const rows = await c`select name from tab_doctype order by name`
  return rows.map((r) => r.name as string)
}

export async function siteCreateUser(site: string, email: string, fullName?: string): Promise<{ name: string }> {
  const c = siteClient(site)
  await c`insert into tab_user ${c({ name: email, email, full_name: fullName ?? email })}
    on conflict (name) do nothing`
  return { name: email }
}

export async function siteListUsers(site: string): Promise<string[]> {
  const c = siteClient(site)
  const rows = await c`select name from tab_user order by name`
  return rows.map((r) => r.name as string)
}
