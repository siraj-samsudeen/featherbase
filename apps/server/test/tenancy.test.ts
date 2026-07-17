// NOT sandbox-migrated: tenancy uses its own per-site pooled clients
// (search_path-scoped), which bypass the db.ts sandbox seam by design.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { closeSiteClients, siteSchema } from '../src/tenancy'

// PLAT-008: two sites on one Postgres are fully independent — their DocTypes
// and users live in separate schemas, resolved from the Host header, and a
// request for one site never sees the other's data.

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
let adminToken = ''

async function req(path: string, host: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${adminToken}`,
      host,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })
}

async function cleanup() {
  await closeSiteClients()
  for (const s of ['alpha', 'beta']) await sql.unsafe(`drop schema if exists ${siteSchema(s)} cascade`)
  await sql`delete from tab_site where name in ('alpha', 'beta')`
}

beforeAll(async () => {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: 'Administrator', pwd: ADMIN_PWD }),
  })
  adminToken = ((await res.json()) as { token: string }).token
  await cleanup()
})

afterAll(cleanup)

describe('PLAT-008: multi-tenancy (schema-per-site)', () => {
  it('provisions two independent sites and keeps their data isolated', async () => {
    // Provision both sites (host defaults to <name>.localhost).
    for (const site of ['alpha', 'beta']) {
      const r = await app.request('/api/tenancy/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ site }),
      })
      expect(r.status).toBe(201)
    }

    // Populate alpha via its host.
    await req('/api/tenancy/doctype', 'alpha.localhost', { method: 'POST', body: JSON.stringify({ name: 'Widget', fields: [{ fieldname: 'sku', fieldtype: 'Data' }] }) })
    await req('/api/tenancy/user', 'alpha.localhost', { method: 'POST', body: JSON.stringify({ email: 'ann@alpha.test' }) })

    // Populate beta via its host.
    await req('/api/tenancy/doctype', 'beta.localhost', { method: 'POST', body: JSON.stringify({ name: 'Gadget', fields: [{ fieldname: 'code', fieldtype: 'Data' }] }) })
    await req('/api/tenancy/user', 'beta.localhost', { method: 'POST', body: JSON.stringify({ email: 'bob@beta.test' }) })

    // DocTypes are isolated per site.
    const aDocs = (await (await req('/api/tenancy/doctypes', 'alpha.localhost')).json()) as { site: string; doctypes: string[] }
    const bDocs = (await (await req('/api/tenancy/doctypes', 'beta.localhost')).json()) as { site: string; doctypes: string[] }
    expect(aDocs.site).toBe('alpha')
    expect(aDocs.doctypes).toEqual(['Widget'])
    expect(bDocs.doctypes).toEqual(['Gadget'])
    expect(aDocs.doctypes).not.toContain('Gadget')
    expect(bDocs.doctypes).not.toContain('Widget')

    // Users are isolated per site.
    const aUsers = (await (await req('/api/tenancy/users', 'alpha.localhost')).json()) as { users: string[] }
    const bUsers = (await (await req('/api/tenancy/users', 'beta.localhost')).json()) as { users: string[] }
    expect(aUsers.users).toEqual(['ann@alpha.test'])
    expect(bUsers.users).toEqual(['bob@beta.test'])
  })

  it('resolves the site from the Host header (subdomain label too)', async () => {
    // A fully-qualified host with the site as the leading label still resolves.
    const r = await req('/api/tenancy/doctypes', 'alpha.example.com', {})
    expect(r.status).toBe(200)
    expect(((await r.json()) as { site: string }).site).toBe('alpha')
  })

  it('rejects an unknown host (no cross-site fallback)', async () => {
    const r = await req('/api/tenancy/doctypes', 'ghost.localhost', {})
    expect(r.status).toBe(404)
  })

  it('stores each site’s tables in its own schema', async () => {
    const inAlpha = await sql.unsafe(`select to_regclass('${siteSchema('alpha')}.tab_widget') as t`)
    const inBeta = await sql.unsafe(`select to_regclass('${siteSchema('beta')}.tab_widget') as t`)
    expect(inAlpha[0].t).not.toBeNull() // alpha has the Widget table
    expect(inBeta[0].t).toBeNull() // beta does not
  })
})
