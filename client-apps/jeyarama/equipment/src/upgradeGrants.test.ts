import { describe, expect, it } from 'vitest'
import current from '../featherbase.json'
import prior from '../test-fixtures/featherbase-0.1.1.json'

// The platform refuses an upgrade that adds or widens a grant on a Table the app already had
// (runtime-packages, #437); only Tables the upgrade adds may arrive with new grants.
type Grant = { table: string; role: string; [flag: string]: unknown }
const canonical = (grant: Grant) => JSON.stringify(Object.keys(grant).sort().map(key => [key, grant[key]]))

describe('the upgrade from 0.1.1', () => {
  it('adds grants only on Tables it adds', () => {
    const added = new Set(current.migrations.filter(m => m.fromVersion >= '0.1.1').flatMap(m => m.operations)
      .filter(op => op.kind === 'addTable').map(op => (op as { table: { name: string } }).table.name))
    const held = new Set((prior.permissions as Grant[]).map(canonical))
    const widened = (current.permissions as Grant[]).filter(grant => !added.has(grant.table) && !held.has(canonical(grant)))
    expect(widened).toEqual([])
  })
})
