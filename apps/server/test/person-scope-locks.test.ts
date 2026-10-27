// #660, Codex round 2: a declared identifier system cannot be turned off or
// made Secret while a provider is being handed its values. Not sandboxed: the
// request and the admin's change race on COMMITTED rows through separate pool
// connections, so the database's locks decide. Every row this file writes
// carries a unique prefix and is removed in finally.
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import type { AppScopeProviderContext } from 'shared'
import { sql } from '../src/db'
import { newIdentifierId } from '../src/person-identifiers'
import { resolvePersonScope, type ScopeProviderBinding } from '../src/person-scope'

const place = [{ label: 'North', filters: { store: ['N1'] } }]

async function fixture() {
  const p = `psn_lock${randomUUID().slice(0, 8)}`
  const system = `lock-${p.slice(8)}`
  await sql`insert into person ${sql({ row_id: p, email: null, full_name: p, enabled: true, created_by: 'Administrator', updated_by: 'Administrator' })}`
  await sql`insert into identifier_system (row_id, label, kind, sensitivity, match, enabled) values (${system}, ${system}, 'national-id', 'Restricted', 'Off', true)`
  await sql`insert into person_identifier ${sql({ id: newIdentifierId(), person_id: p, system, assigner: '', value: 'NAT-1', valid: '[2020-01-01,)',
    verified: true, one_holder: false, one_per_person: false, source: 'test', recorded_by: 'test' } as unknown as Record<string, never>)}`
  // A provider that waits at a barrier, so a change can be tried while it runs.
  const seen: AppScopeProviderContext['person'][] = []
  let entered!: () => void
  let release!: () => void
  const inside = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  let paused = false
  const binding: ScopeProviderBinding = { app: 'lockproof', title: 'Lock proof', version: '1.0.0', tables: [], identifiers: [system],
    provide: async ({ person }) => {
      seen.push(person)
      if (paused) { entered(); await gate }
      return place
    } }
  const cleanup = async () => {
    await sql`delete from person_identifier where person_id = ${p}`
    await sql`delete from identifier_system where row_id = ${system}`
    await sql`delete from person where row_id = ${p}`
  }
  return { p, system, seen, binding, inside, release, pause: () => { paused = true }, cleanup }
}

// Resolves once another backend waits on a lock to change the system's row.
async function waitingOnLock(system: string) {
  for (;;) {
    const [row] = await sql`select count(*)::int as n from pg_stat_activity
      where wait_event_type = 'Lock' and query like 'update %identifier_system set%' and query like ${`%${system}%`}`
    if (row.n > 0) return 'blocked'
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

for (const [change, update] of [
  ['made Secret', (system: string) => sql.unsafe(`update identifier_system set sensitivity = 'Secret', match = 'Off' where row_id = '${system}'`)],
  ['turned off', (system: string) => sql.unsafe(`update identifier_system set enabled = false where row_id = '${system}'`)],
] as const) {
  it(`a declared system ${change} while a provider runs waits for it, and the next request is not set up`, async () => {
    const f = await fixture()
    try {
      f.pause()
      const request = resolvePersonScope(f.p, f.binding)
      await Promise.race([f.inside, request])
      const admin = update(f.system).then(() => 'done')
      expect(await Promise.race([admin, waitingOnLock(f.system)])).toBe('blocked')
      f.release()
      expect(await request).toEqual(place)
      expect(f.seen[0].identifiers).toEqual({ [f.system]: [{ value: 'NAT-1', shared: false }] })
      expect(await admin).toBe('done')
      await expect(resolvePersonScope(f.p, f.binding)).rejects.toMatchObject({ type: 'NotSetUpError' })
      expect(f.seen).toHaveLength(1)
    } finally {
      f.release()
      await f.cleanup()
    }
  }, 30_000)
}

it('a declared system made Secret before the request answers not set up, and the provider never runs', async () => {
  const f = await fixture()
  try {
    await sql`update identifier_system set sensitivity = 'Secret', match = 'Off' where row_id = ${f.system}`
    await expect(resolvePersonScope(f.p, f.binding)).rejects.toMatchObject({ type: 'NotSetUpError' })
    expect(f.seen).toHaveLength(0)
  } finally {
    await f.cleanup()
  }
}, 30_000)
