// #1277: Who Would Gain Or Lose Access for the whole company reads every Table once and compares each person in
// memory. On staging (about 9,200 people) the read asked the database per person and ran past Railway's 5 minutes.
// Made-up company only (big-world.test-support.ts).
import { describe, expect, it } from 'vitest'
import { accessChanges, explainPerson } from './business-roles-server'
import { bigContext, platformRoles, seededBigWorld } from './big-world.test-support'

type Row = Record<string, unknown>
type Answer = Awaited<ReturnType<typeof accessChanges>>
const rowsOf = (answer: Answer) => new Map(answer.groups.flatMap(g => g.people).map(p => [p.person, p]))
/** Everyone the comparison covers: the staff list, anyone given a role by hand or a report directly. */
const populationOf = (tables: Record<string, Row[]>) => [...new Set([...tables.Employee.map(e => String(e.person)), ...tables['dash.role_assignment'].map(h => String(h.person)),
  ...tables['dash.report_access'].map(a => String(a.person ?? ''))].filter(Boolean))].sort()

describe('the whole company at once', () => {
  it('gives every person exactly what Explain, comparing them one at a time, gives', async () => {
    const tables = await seededBigWorld({ people: 1_500, stores: 24, seed: 11 })
    const answer = await accessChanges(bigContext(tables, { peopleRoles: platformRoles }).ctx as never)
    const bulk = rowsOf(answer)
    const people = populationOf(tables)
    expect(answer.people).toBe(people.length)
    // One person at a time: their own reads, and their roles asked for alone.
    const { ctx: one, counted } = bigContext(tables, { peopleRoles: platformRoles, bulkRoles: false })
    const kinds = new Set<string>()
    for (const person of people) {
      one.payload = { person }
      const explained = await explainPerson(one as never)
      const row = bulk.get(person)
      for (const kind of explained.change.kinds) kinds.add(kind)
      const { kinds: k, stores_gained, stores_lost, stores_changed, gained, lost, decisions, every_report } = explained.change
      expect([person, row ? { kinds: row.kinds, stores_gained: row.stores_gained, stores_lost: row.stores_lost, stores_changed: row.stores_changed, gained: row.gained, lost: row.lost,
        decisions: row.decisions, every_report: row.every_report, roles: row.roles } : null])
        .toEqual([person, k.length ? { kinds: k, stores_gained, stores_lost, stores_changed, gained, lost, decisions, every_report, roles: [...new Set(explained.roles.map(r => r.name))].sort() } : null])
    }
    // The population is varied: changes of every kind the rules can give here, and some who keep what they have.
    expect([[...kinds].sort(), bulk.size < people.length, counted.rolesOf]).toEqual([['decision', 'loses_dash', 'needs_dash_role', 'reports', 'stores'], true, people.length])
  }, 120_000)

  it('reads each Table once, in pages, and every person\'s roles in one read, however many people there are', async () => {
    const shapes = async (people: number) => {
      const tables = await seededBigWorld({ people, stores: 60 })
      const { ctx, counted } = bigContext(tables, { peopleRoles: platformRoles })
      await accessChanges(ctx as never)
      const reads = new Set(counted.reads.map(r => `${r.table} ${r.filters.map(([column, op]) => `${column} ${op}`).join(', ')}`))
      return { reads: [...reads].sort(), total: counted.reads.length, rolesOf: counted.rolesOf, rolesOfMany: counted.rolesOfMany, people }
    }
    const [small, large] = [await shapes(1_000), await shapes(10_000)]
    // The same reads whatever the size; no read names one record; a page holds 500 rows.
    expect([large.reads, large.rolesOf, large.rolesOfMany]).toEqual([small.reads, 0, 1])
    expect(large.reads.filter(r => / = |=$/.test(r))).toEqual([])
    expect(large.total).toBeLessThan(200)
  }, 120_000)

  it('compares 10,000 people well within the platform\'s time', async () => {
    const tables = await seededBigWorld({ people: 10_000, stores: 60 })
    const { ctx } = bigContext(tables, { peopleRoles: platformRoles })
    const started = performance.now()
    const answer = await accessChanges(ctx as never)
    const seconds = (performance.now() - started) / 1000
    expect([answer.people > 9_500, answer.changed > 0, seconds < 20]).toEqual([true, true, true])
  }, 120_000)

  it('reads someone the platform names no roles for as holding none', async () => {
    const tables = await seededBigWorld({ people: 200, stores: 6 })
    const { ctx } = bigContext(tables, { peopleRoles: platformRoles })
    const none = { ...ctx, people: { ...ctx.people, rolesOfMany: async () => ({}) } }
    const answer = await accessChanges(none as never)
    const reference = await accessChanges(bigContext(tables, { peopleRoles: () => [] }).ctx as never)
    expect(answer.groups).toEqual(reference.groups)
  }, 60_000)
})
