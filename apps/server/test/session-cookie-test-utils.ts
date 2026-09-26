import { expect } from 'vitest'
import { sql } from '../src/db'

export async function setSessionHours(hours: number) {
  await sql`
    insert into single_value (table_name, field, value)
    values ('System Settings', 'session_hours', ${String(hours)})
    on conflict (table_name, field) do update set value = excluded.value`
}

export function expectSessionCookie(
  response: Response,
  hours: number,
  issuedBetween: { before: number; after: number },
): string {
  const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith('sid='))
  expect(header).toBeDefined()
  expect(header).toMatch(new RegExp(`;\\s*Max-Age=${hours * 3600}(?:;|$)`, 'i'))
  expect(header).toMatch(/;\s*HttpOnly(?:;|$)/i)
  expect(header).toMatch(/;\s*SameSite=Lax(?:;|$)/i)
  expect(header).toMatch(/;\s*Path=\/(?:;|$)/i)

  const cookie = header!.split(';')[0]
  const token = decodeURIComponent(cookie.slice('sid='.length))
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
    exp: number
  }
  expect(payload.exp).toBeGreaterThanOrEqual(issuedBetween.before + hours * 3600)
  expect(payload.exp).toBeLessThanOrEqual(issuedBetween.after + hours * 3600)
  return cookie
}
