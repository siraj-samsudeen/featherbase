import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { getSystemSettings } from '../src/settings'
import { areq } from './helpers'

// SET-004: global System Settings drive rendering and session lifetime.
// getSystemSettings falls back to defaults and reflects stored overrides;
// the /api/settings endpoint exposes the display subset to the client.

async function reset() {
  await sql`delete from single_value where doctype = 'System Settings'
    and field in ('date_format', 'currency', 'currency_precision', 'float_precision', 'session_hours')`
}

beforeEach(reset)
afterAll(async () => {
  await reset()
  await sql.end()
})

describe('SET-004: system settings', () => {
  it('returns sensible defaults when nothing is stored', async () => {
    const s = await getSystemSettings()
    expect(s.date_format).toBe('yyyy-mm-dd')
    expect(s.currency).toBe('USD')
    expect(s.currency_precision).toBe(2)
    expect(s.float_precision).toBe(2)
    expect(s.session_hours).toBe(8)
  })

  it('reflects stored overrides with typed numbers', async () => {
    for (const [field, value] of [
      ['date_format', 'dd-mm-yyyy'],
      ['currency', 'EUR'],
      ['currency_precision', '3'],
      ['float_precision', '4'],
    ]) {
      await sql`insert into single_value ${sql({ doctype: 'System Settings', field, value })}
        on conflict (doctype, field) do update set value = excluded.value`
    }
    const s = await getSystemSettings()
    expect(s.date_format).toBe('dd-mm-yyyy')
    expect(s.currency).toBe('EUR')
    expect(s.currency_precision).toBe(3)
    expect(s.float_precision).toBe(4)
  })

  it('/api/settings exposes only the display subset', async () => {
    const res = await areq('/api/settings')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(
      ['app_name', 'currency', 'currency_precision', 'date_format', 'float_precision'].sort(),
    )
    // session/time_zone are internal — never leaked to the display endpoint.
    expect(body).not.toHaveProperty('session_hours')
    expect(body).not.toHaveProperty('time_zone')
  })
})
