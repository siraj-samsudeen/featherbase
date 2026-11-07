// The store reach provider over a stand-in for the platform's provider read
// context (documents.list over declared Tables): rows in memory. Made-up
// stores, sites, clusters and people.
import { describe, expect, it } from 'vitest'
import manifest from '../featherbase.json' with { type: 'json' }
import { JOB_REACH, REACH_TABLES, STORE_ADMINISTRATOR, storeReachProvider } from './reach.ts'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]
const TODAY = '2026-11-07'

function documents(tables: Record<string, Row[]>, reads: string[] = []) {
  return {
    async list(table: string, args: { filters?: Filter[]; fields?: string[]; order_by?: string; limit_start?: number; limit_page_length?: number } = {}) {
      reads.push(table)
      if (!REACH_TABLES.includes(table)) throw new Error(`undeclared Table ${table}`)
      if (args.order_by !== 'row_id asc') throw new Error('pages need a stable order')
      const rows = (tables[table] ?? []).filter(row => (args.filters ?? []).every(([column, operator, value]) =>
        operator === '=' ? row[column] === value : operator === 'in' ? (value as unknown[]).includes(row[column]) : false))
      const fields = args.fields?.length ? args.fields : ['row_id']
      const start = args.limit_start ?? 0
      return rows.slice(start, start + Math.min(args.limit_page_length ?? 20, 500))
        .map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null])))
    },
  }
}

const masters = {
  'Site Master': [
    { row_id: 'LKS', cluster: 'SOUTH' }, { row_id: 'HIL', cluster: 'SOUTH' }, { row_id: 'RVR', cluster: 'NORTH' },
  ],
  Plant: [
    { row_id: '9901', plant_code: '9901', site: 'LKS' }, { row_id: '9902', plant_code: '9902', site: 'HIL' },
    { row_id: '9903', plant_code: '9903', site: 'RVR' },
  ],
}

const job = (person: string, jobName: string, place: Row = {}, period: Row = {}): Row =>
  ({ row_id: `${person}-${jobName}-${place.store ?? place.cluster}`, person, job: jobName, starts_on: '2026-01-01', ...place, ...period })

async function reach(person: string, jobs: Row[], reads: string[] = []) {
  return storeReachProvider({ today: () => TODAY })({ person: { id: person }, documents: documents({ ...masters, 'dash.job_assignment': jobs }, reads) })
}

describe('the store reach provider', () => {
  it('declares exactly the Tables it reads, and the job role it answers', () => {
    expect(manifest.administration.tables).toEqual(REACH_TABLES)
    expect(manifest.administration.jobRoles).toEqual([STORE_ADMINISTRATOR])
    expect(manifest.administration.provider in { store_reach: 1 }).toBe(true)
  })

  it('gives a Store Manager their store, and reads no master', async () => {
    const reads: string[] = []
    expect(await reach('p-1', [job('p-1', 'Store Manager', { store: '9901' })], reads))
      .toEqual([{ role: STORE_ADMINISTRATOR, stores: ['9901'] }])
    expect(reads).toEqual(['dash.job_assignment'])
  })

  it('gives a Cluster Manager every plant whose site is in their cluster', async () => {
    expect(await reach('p-2', [job('p-2', 'Cluster Manager', { store: '9903', cluster: 'SOUTH' })]))
      .toEqual([{ role: STORE_ADMINISTRATOR, stores: ['9901', '9902'] }])
  })

  it('joins a Store Manager\'s store with a cluster\'s, once each', async () => {
    expect(await reach('p-3', [
      job('p-3', 'Store Manager', { store: '9903' }), job('p-3', 'Cluster Manager', { store: '9901', cluster: 'SOUTH' }),
      job('p-3', 'Store Manager', { store: '9901' }),
    ])).toEqual([{ role: STORE_ADMINISTRATOR, stores: ['9901', '9902', '9903'] }])
  })

  it('gives a Director and a Chief Operating Officer every store', async () => {
    for (const name of ['Director', 'Chief Operating Officer'])
      expect(await reach('p-4', [job('p-4', name, { store: '9901' })])).toEqual([{ role: STORE_ADMINISTRATOR, stores: '*' }])
  })

  it('gives nothing for other jobs, ended or future jobs, a cluster with no sites, or another person\'s job', async () => {
    expect(await reach('p-5', [
      job('p-5', 'Floor Manager', { store: '9901' }), job('p-5', 'Team Leader', { store: '9901' }),
      job('p-5', 'Store Manager', { store: '9901' }, { ends_on: TODAY }),
      job('p-5', 'Store Manager', { store: '9902' }, { starts_on: '2026-11-08' }),
      job('p-5', 'Cluster Manager', { store: '9901', cluster: 'EAST' }),
      job('p-6', 'Director', { store: '9901' }),
    ])).toEqual([])
    expect(Object.keys(JOB_REACH)).toEqual(['Store Manager', 'Cluster Manager', 'Chief Operating Officer', 'Director'])
  })

  it('reads every page of a long job list', async () => {
    const jobs = Array.from({ length: 1200 }, (_, i) => job('p-7', 'Staff', { store: String(i) }))
    jobs.push(job('p-7', 'Store Manager', { store: '9902' }))
    expect(await reach('p-7', jobs)).toEqual([{ role: STORE_ADMINISTRATOR, stores: ['9902'] }])
  })

  it('protects every job that gives reach from a reach grant', () => {
    expect(manifest.administration.targets['dash.job_assignment'].protect.values.sort()).toEqual(Object.keys(JOB_REACH).sort())
  })
})
