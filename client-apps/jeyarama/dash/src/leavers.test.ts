// The daily leaver check (data-warehouse #4336, an app job since featherbase
// #731): it disables people whose StyleHR record shows they have left. It only
// ever disables, skips System Managers, and refuses on a stale or implausible feed.
import { describe, expect, it } from 'vitest'
import {
  FEED_DAY_DATASET, LEAVER_CHECK_SUBJECT, RECORDS_DATASET, dayIn, disableLeavers, linkedPeople, planLeavers,
  type EmployeeRecord, type LeaverJobContext, type LinkedPerson,
} from './leavers.ts'
import { jobs } from './server.ts'
import manifest from '../featherbase.json' with { type: 'json' }

const TODAY = '2026-10-24'

const rec = (key: string, code: string, over: Partial<EmployeeRecord> = {}): EmployeeRecord => ({
  employee_key: key, employee_code: code, payroll_active: true, movement_active: true, date_of_joining: '2024-01-01', exit_date: null, ...over,
})
const who = (person: string, over: Partial<LinkedPerson> = {}): LinkedPerson => ({ person, full_name: null, privileged: false, record_ids: [], codes: [], ...over })
/** Enough active staff that one or two leavers stay under the limit. */
const crowd = (n: number) => Array.from({ length: n }, (_, i) => who(`p${i}`, { record_ids: [`9${i}`] }))
const crowdRecords = (n: number) => Array.from({ length: n }, (_, i) => rec(`9${i}`, `C-9${i}`))

describe('who counts as a leaver', () => {
  it('an exit date that has passed disables, with the date as the reason', () => {
    const plan = planLeavers([who('a', { record_ids: ['1'] })], [rec('1', 'C-1', { exit_date: '2026-10-09', movement_active: false })], TODAY, TODAY)
    expect(plan.refused).toBeNull()
    expect(plan.to_disable).toEqual([{ person: 'a', full_name: null, reason: 'exit date 09-Oct-2026 has passed', basis: 'exit date' }])
  })

  it('an exit date still in the future does not', () => {
    expect(planLeavers([who('a', { record_ids: ['1'] })], [rec('1', 'C-1', { exit_date: '2026-10-30' })], TODAY, TODAY).to_disable).toEqual([])
  })

  it('not being on payroll disables, unless the person joined too recently to have been paid', () => {
    const plan = planLeavers([who('old', { record_ids: ['1'] }), who('new', { record_ids: ['2'] })], [
      rec('1', 'C-1', { payroll_active: false, date_of_joining: '2025-01-01' }),
      rec('2', 'C-2', { payroll_active: false, date_of_joining: '2026-10-01' }),
    ], TODAY, TODAY)
    expect(plan.to_disable.map((l) => [l.person, l.basis])).toEqual([['old', 'not on payroll']])
    expect(plan.recent_joiners).toEqual(['new'])
  })

  it('a code shared by several records is a leaver only when every record has left', () => {
    const records = [
      rec('1', 'C-7', { payroll_active: false }), rec('2', 'C-7'),
      rec('3', 'C-8', { movement_active: false }), rec('4', 'C-8', { payroll_active: false }),
    ]
    const plan = planLeavers([who('shared-active', { codes: ['C-7'] }), who('shared-gone', { codes: ['c-8 '] })], records, TODAY, TODAY)
    expect(plan.to_disable.map((l) => [l.person, l.reason])).toEqual([['shared-gone', 'marked inactive in StyleHR']])
  })

  it('a record number decides over the code', () => {
    const plan = planLeavers([who('a', { record_ids: ['1'], codes: ['C-7'] })], [rec('1', 'C-7', { movement_active: false }), rec('2', 'C-7')], TODAY, TODAY)
    expect(plan.to_disable.map((l) => l.person)).toEqual(['a'])
  })

  it('a System Manager who has left is reported, not disabled; a link with no record is left alone', () => {
    const plan = planLeavers([who('boss', { privileged: true, record_ids: ['1'] }), who('ghost', { record_ids: ['404'] })],
      [rec('1', 'C-1', { movement_active: false })], TODAY, TODAY)
    expect(plan.to_disable).toEqual([])
    expect(plan.privileged_leavers.map((l) => l.person)).toEqual(['boss'])
    expect(plan.not_found).toEqual(['ghost'])
  })
})

describe('a bad feed disables nobody', () => {
  it('refuses when the warehouse has no StyleHR day from yesterday or today', () => {
    const plan = planLeavers([who('a', { record_ids: ['1'] })], [rec('1', 'C-1', { movement_active: false })], '2026-10-22', TODAY)
    expect(plan.refused).toMatch(/stale/)
    expect(plan.to_disable).toEqual([])
    expect(planLeavers([], [], null, TODAY).refused).toMatch(/latest day none/)
    expect(planLeavers([], [], '2026-10-23', TODAY).refused).toMatch(/no StyleHR employee records/)
  })

  it('refuses when more than 5% of linked people would go at once', () => {
    const people = [...crowd(97), who('x1', { record_ids: ['1'] }), who('x2', { record_ids: ['2'] }), who('x3', { record_ids: ['3'] })]
    const gone = ['1', '2', '3'].map((k) => rec(k, `C-${k}`, { movement_active: false }))
    expect(planLeavers(people, [...crowdRecords(97), ...gone], TODAY, TODAY).refused).toBeNull()
    const many = [...crowd(90), ...Array.from({ length: 10 }, (_, i) => who(`g${i}`, { record_ids: [`5${i}`] }))]
    const manyGone = Array.from({ length: 10 }, (_, i) => rec(`5${i}`, `G-${i}`, { movement_active: false }))
    expect(planLeavers(many, [...crowdRecords(90), ...manyGone], TODAY, TODAY).refused).toMatch(/would disable 10 of 100 linked people, more than the limit of 5/)
  })
})

// ---------------------------------------------------------------- the job

type Listed = Awaited<ReturnType<LeaverJobContext['people']['list']>>[number]
const person = (id: string, over: Partial<Listed> = {}): Listed => ({ person: id, full_name: null, privileged: false, identifiers: {}, sign_ins: {}, ...over })

/** A job context over made-up people and a made-up warehouse, recording what the job did. */
function fakeJob(people: Listed[], feedDay: string | null, rows: EmployeeRecord[], opts: { managers?: number; failOn?: string } = {}) {
  const done = { disabled: [] as [string, string][], mail: [] as { subject: string; body: string }[], result: null as string | null, refused: null as string | null }
  const ctx: LeaverJobContext = {
    now: '2026-10-24T05:00:00.000Z', timeZone: 'Asia/Kolkata',
    datasets: {
      async live(name) {
        if (name === FEED_DAY_DATASET) return { rows: [{ latest_day: feedDay }] }
        if (name === RECORDS_DATASET) return { rows }
        throw new Error(`undeclared dataset ${name}`)
      },
    },
    people: {
      async list() { return people },
      async disable(id, reason) {
        if (id === opts.failOn) throw new Error('blocked')
        done.disabled.push([id, reason])
        return true
      },
    },
    email: { async systemManagers(message) { done.mail.push(message); return opts.managers ?? 1 } },
    setResult(text) { done.result = text },
    refuse(reason) { done.refused = reason },
  }
  return { ctx, done }
}

describe('the job', () => {
  it('is the one the manifest declares, shipped off, reading only its own datasets', () => {
    const [job] = manifest.jobs
    expect(job).toMatchObject({ name: 'disable_leavers', enabled: false, sign_in_methods: ['stylehr'], datasets: [RECORDS_DATASET, FEED_DAY_DATASET] })
    expect(jobs.disable_leavers).toBe(disableLeavers)
    expect(manifest.datasets.map((d) => d.name)).toEqual(expect.arrayContaining(job.datasets))
  })

  it('links a person by record number, employee code or the record number their StyleHR sign-in carries', () => {
    expect(linkedPeople([
      person('by-record', { identifiers: { 'stylehr-employee-id': ['1'] } }),
      person('by-code', { identifiers: { 'stylehr-employee-code': ['C-2'] } }),
      person('by-sign-in', { sign_ins: { stylehr: ['3'] } }),
      person('unlinked', { sign_ins: { stylehr: [] } }),
    ]).map((p) => [p.person, p.record_ids, p.codes])).toEqual([['by-record', ['1'], []], ['by-code', [], ['C-2']], ['by-sign-in', ['3'], []]])
  })

  it('disables the leaver, skips the System Manager, and mails the summary', async () => {
    const { ctx, done } = fakeJob([
      person('gone', { full_name: 'Gone Person', sign_ins: { stylehr: ['101'] } }),
      person('here', { identifiers: { 'stylehr-employee-code': ['C-102'] } }),
      person('boss', { full_name: 'Gone Boss', privileged: true, identifiers: { 'stylehr-employee-id': ['103'] } }),
    ], TODAY, [rec('101', 'C-101', { exit_date: '2026-10-20' }), rec('102', 'C-102'), rec('103', 'C-103', { movement_active: false })])
    await disableLeavers(ctx)
    expect(done.disabled).toEqual([['gone', 'left: exit date 20-Oct-2026 has passed']])
    expect(done.mail).toHaveLength(1)
    expect(done.mail[0].subject).toBe(LEAVER_CHECK_SUBJECT)
    expect(done.mail[0].body).toContain('Gone Person: exit date 20-Oct-2026 has passed')
    expect(done.mail[0].body).toContain('Gone Boss')
    expect(done.result).toBe('leaver check: disabled 1 of 3 linked people; summary sent to 1 System Manager(s)')
  })

  it('a stale feed disables nobody, mails why, and ends the run as refused', async () => {
    const { ctx, done } = fakeJob([person('gone', { sign_ins: { stylehr: ['301'] } })], '2026-10-20', [rec('301', 'C-301', { movement_active: false })], { managers: 0 })
    await disableLeavers(ctx)
    expect(done.disabled).toEqual([])
    expect(done.mail[0].body).toContain('It disabled nobody')
    expect(done.refused).toMatch(/^disabled nobody: the warehouse's StyleHR data is stale .*; summary reached nobody: no System Manager has an email address$/)
  })

  it('one failed save does not stop the others or the summary, and fails the run', async () => {
    const { ctx, done } = fakeJob([person('a', { sign_ins: { stylehr: ['601'] } }), person('b', { sign_ins: { stylehr: ['602'] } })],
      TODAY, [rec('601', 'C-601', { movement_active: false }), rec('602', 'C-602', { movement_active: false })], { failOn: 'a' })
    await expect(disableLeavers(ctx)).rejects.toThrow(/could not disable 1: a: blocked/)
    expect(done.disabled.map(([id]) => id)).toEqual(['b'])
    expect(done.mail[0].body).toContain('1 could not be disabled')
  })

  it('with nothing to report it sends no mail; with nobody linked it reads no warehouse', async () => {
    const quiet = fakeJob([person('here', { sign_ins: { stylehr: ['1'] } })], TODAY, [rec('1', 'C-1')])
    await disableLeavers(quiet.ctx)
    expect(quiet.done.mail).toEqual([])
    expect(quiet.done.result).toBe('leaver check: disabled 0 of 1 linked people; nothing to report; no summary sent')
    const none = fakeJob([person('elsewhere')], null, [])
    none.ctx.datasets.live = async () => { throw new Error('read the warehouse') }
    await disableLeavers(none.ctx)
    expect(none.done.result).toBe('leaver check: nobody is linked to StyleHR; nothing to check')
  })

  it("counts today in the instance's time zone", () => {
    expect(dayIn('2026-10-23T19:00:00.000Z', 'Asia/Kolkata')).toBe('2026-10-24')
    expect(dayIn('2026-10-23T19:00:00.000Z', 'UTC')).toBe('2026-10-23')
  })
})
