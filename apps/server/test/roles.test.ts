import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { getRoles } from '../src/permissions'
import { areq } from './helpers'

const USER = 'roletest@x.com'

beforeAll(async () => {
  await sql`delete from tab_has_role where parent = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User',
      doc: { name: USER, email: USER, enabled: true },
    }),
  })
})

afterAll(async () => {
  await sql`delete from tab_has_role where parent = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
  await sql.end()
})

describe('PERM-001: role model', () => {
  it('a fresh user has only the implicit All role', async () => {
    expect(await getRoles(USER)).toEqual(['All'])
  })

  it('assigning roles via the API changes get_roles output; removing reverts it', async () => {
    const doc = (await (
      await areq(`/api/doc/User/${encodeURIComponent(USER)}`)
    ).json()) as Record<string, unknown>
    const assign = await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'User',
        doc: {
          name: USER,
          modified: doc.modified,
          roles: [{ role: 'System Manager' }, { role: 'Guest' }],
        },
      }),
    })
    expect(assign.status).toBe(201)
    expect(await getRoles(USER)).toEqual(['All', 'Guest', 'System Manager'])

    const doc2 = (await (
      await areq(`/api/doc/User/${encodeURIComponent(USER)}`)
    ).json()) as Record<string, unknown>
    const remove = await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'User',
        doc: { name: USER, modified: doc2.modified, roles: [{ role: 'Guest' }] },
      }),
    })
    expect(remove.status).toBe(201)
    expect(await getRoles(USER)).toEqual(['All', 'Guest'])
  })

  it('assigning a nonexistent role fails link validation', async () => {
    const doc = (await (
      await areq(`/api/doc/User/${encodeURIComponent(USER)}`)
    ).json()) as Record<string, unknown>
    const res = await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'User',
        doc: { name: USER, modified: doc.modified, roles: [{ role: 'Fake Role' }] },
      }),
    })
    expect(res.status).toBe(417)
  })

  it('whoami reports roles', async () => {
    const me = (await (await areq('/api/whoami')).json()) as { roles: string[] }
    expect(me.roles).toContain('System Manager')
    expect(me.roles).toContain('All')
  })
})
