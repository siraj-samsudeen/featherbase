// A person's current `stylehr-employee-code` identifier rows (#408,
// person-resolution task 2.1) are what the manual procedures record: a joiner
// recorded by hand is found by that code.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { applySeedPack } from '../src/seed-packs'
import { configureDelegated } from './identity-fixtures'
import { expectStatus, makePerson } from './fixtures'

const CODE = 'stylehr-employee-code'

describe('the manual procedures record a code on the person', () => {
  test('a joiner recorded by hand is found by the picker by that code', async ({ admin }) => {
    await applySeedPack('jeyarama')
    const joiner = await makePerson({ full_name: 'Joiner Jaya' })
    await admin.post(`/api/people/${joiner}/identifiers`, { system: CODE, value: 'rr-0103', note: 'Joiner, HR mail 23-Oct' })
    const picked = (await admin.get<{ people: { row_id: string; label: string }[] }>('/api/people/pick?q=rr-0103')).people
    expect(picked).toEqual([{ row_id: joiner, label: 'Joiner Jaya · RR-0103' }])
  })
})

describe('a record number someone else holds (review on #385)', () => {
  test('linking it answers 409, not 500, and links nothing', async ({ admin }) => {
    await configureDelegated()
    const holder = await makePerson({ full_name: 'Record Holder' })
    const other = await makePerson({ full_name: 'Record Taker' })
    await sql`insert into person_identifier (id, person_id, system, value, one_holder, source, recorded_by)
      values ('pid_heldrecord1aaaaaaaaa', ${holder}, 'stylehr-employee-id', '55555', true, 'test', 'test')`
    const res = await admin.fetch(`/api/people/${other}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: '55555', sign_in_name: 'taker' }) })
    await expectStatus(res, 409)
    expect(await sql`select 1 from sign_in_identity where person_id = ${other}`).toHaveLength(0)
  })
})
