import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'

// #101 Phase 5: routine detection — destinations (lists/pages, never rows)
// opened on >= 5 distinct days inside 14; fewer than 2 such targets is no
// routine at all.

const DAY = 86_400_000

async function seed(user: string, key: string, kind: string, days: number[]) {
  for (const d of days) {
    await sql`insert into user_event ${sql({
      name: `rt-${key}-${d}`.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 130),
      created_by: user,
      updated_by: user,
      created_at: new Date(),
      updated_at: new Date(),
      status: 'draft',
      kind,
      ref_key: key,
      label: key.split(':')[1] ?? key,
      sub_label: kind === 'list' ? 'status = Open' : null,
      path: `/admin/${key.split(':')[1] ?? key}`,
      occurred_at: new Date(Date.now() - d * DAY),
    })}`
  }
}

describe('#101: GET /api/routine_suggestion', () => {
  test('two habitual list targets make a routine; occasional and row visits do not', async ({
    admin,
  }) => {
    await seed('Administrator', 'list:Customer?', 'list', [1, 2, 3, 4, 5])
    await seed('Administrator', 'page:query-report/Sales', 'page', [1, 2, 3, 5, 6, 8])
    await seed('Administrator', 'list:Item?', 'list', [1, 3]) // only 2 days
    await seed('Administrator', 'row:Customer/C-1', 'row', [1, 2, 3, 4, 5, 6]) // rows never count

    const res = await admin.get<{ targets: Array<Record<string, unknown>> }>(
      '/api/routine_suggestion',
    )
    const keys = res.targets.map((t) => t.key)
    expect(keys).toContain('list:Customer?')
    expect(keys).toContain('page:query-report/Sales')
    expect(keys).not.toContain('list:Item?')
    expect(keys).not.toContain('row:Customer/C-1')
    const customer = res.targets.find((t) => t.key === 'list:Customer?')!
    expect(customer).toMatchObject({ sub: 'status = Open', days: 5 })
  })

  test('a single habitual target is not a routine', async ({ admin }) => {
    await seed('Administrator', 'list:Customer?', 'list', [1, 2, 3, 4, 5])
    const res = await admin.get<{ targets: unknown[] }>('/api/routine_suggestion')
    expect(res.targets).toHaveLength(0)
  })

  test('no history means no suggestion', async ({ admin }) => {
    const res = await admin.get<{ targets: unknown[] }>('/api/routine_suggestion')
    expect(res.targets).toHaveLength(0)
  })
})
