import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { createServiceAccount } from '../src/service-accounts'
import { issueAccessToken } from '../src/auth'
import { permissionRefusal, tableWords } from '../src/refusals'
import { expectStatus } from './fixtures'

// #1010: a refusal speaks to whoever was refused and names the Table by its
// label; it never shows a person or service-account id.
const TABLE = 'Rf Gadget'

async function labelledTable(admin: { post: (path: string, body: unknown) => Promise<unknown> }) {
  await admin.post('/api/table_def', { name: TABLE, columns: [{ column_name: 'title', column_type: 'Data' }] })
  await sql`update table_def set label = 'Gadget' where name = ${TABLE}`
  invalidateMeta(TABLE)
}

const messageOf = async (response: Response) => ((await response.json()) as { error: { message: string } }).error.message

describe('permission refusals use words people use', () => {
  test('a person is told "you" and sees the Table label', async ({ admin, createUser }) => {
    await labelledTable(admin)
    const reader = await createUser({ roles: [] })
    const listed = await reader.fetch(`/api/table/${encodeURIComponent(TABLE)}`)
    await expectStatus(listed, 403)
    const message = await messageOf(listed)
    expect(message).toBe("You don't have read permission on Gadget.")
    expect(message).not.toMatch(/psn_|svc_/)

    const created = await reader.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: TABLE, row: { title: 'x' } }) })
    await expectStatus(created, 403)
    expect(await messageOf(created)).toBe("You don't have create permission on Gadget.")
  })

  test('a service account is named as one, not by its id', async ({ api, admin }) => {
    await labelledTable(admin)
    const bot = await createServiceAccount('refusal-bot', [], 'Administrator')
    const { token } = await issueAccessToken(bot.row_id, 'refusal check', null)
    const response = await api.fetch(`/api/table/${encodeURIComponent(TABLE)}`, { headers: { authorization: `Bearer ${token}` } })
    await expectStatus(response, 403)
    expect(await messageOf(response)).toBe("This service account doesn't have read permission on Gadget.")
  })

  test('a Table with no label, or none at all, keeps its name', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Rf Plain', columns: [{ column_name: 'title', column_type: 'Data' }] })
    expect(await tableWords('Rf Plain')).toBe('Rf Plain')
    expect(await tableWords('Rf Never Made')).toBe('Rf Never Made')
    expect((await permissionRefusal('Guest', 'Rf Never Made', 'write')).message).toBe("You don't have write permission on Rf Never Made.")
  })
})
