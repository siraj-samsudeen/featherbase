// The reviewed pre-fill list (#1205) read into one call per store. Made-up stores and people.
import { describe, expect, it } from 'vitest'
import { planFromCsv } from './prefill-plan.ts'

const CSV = [
  'store,dm_employee,dm_name,floor,section,staff_reporting,dms_on_section,proposal',
  'LKS,E1,Made-up One,First Floor,Sarees,11,1,pre-filled',
  'LKS,E1,Made-up One,First Floor,"Cotton, Syn Saree",4,2,"shared, majority: pre-filled, flagged"',
  'LKS,E2,Made-up Two,First Floor,"Cotton, Syn Saree",2,2,"shared, minority: left out"',
  'LKS,E2,Made-up Two,Second Floor,Toys,3,1,section in another store: left out',
  'HIL,E3,Made-up Three,,,0,0,no team with sections: set-up card',
  'HIL,E4,Made-up Four,Ground Floor,Bags,5,1,pre-filled',
  '',
].join('\r\n')

describe('planFromCsv', () => {
  it('keeps pre-filled rows, flags the shared majority, leaves the rest out, one call per store', () => {
    expect(planFromCsv(CSV)).toEqual({
      stores: [
        { store: 'LKS', managers: [{ employee: 'E1', sections: ['Sarees', 'Cotton, Syn Saree'], flagged: ['Cotton, Syn Saree'] }] },
        { store: 'HIL', managers: [{ employee: 'E4', sections: ['Bags'], flagged: [] }] },
      ],
      counts: { rows: 6, sections: 3, flagged: 1, left_out: 2, no_team: 1, managers: 2 },
    })
  })
  it('refuses a list without the columns it needs, or with a proposal it does not know', () => {
    expect(() => planFromCsv('store,section\nLKS,Sarees')).toThrow('The list needs the columns store, dm_employee, section, proposal')
    expect(() => planFromCsv(CSV.replace('pre-filled\r\nLKS', 'maybe\r\nLKS'))).toThrow('Row 1: unknown proposal "maybe"')
  })
  it('reads a quote inside a quoted field', () => {
    expect(planFromCsv('store,dm_employee,section,proposal\nLKS,E1,"Men""s Bottom",pre-filled').stores[0].managers[0].sections).toEqual(['Men"s Bottom'])
  })
})

describe('runPrefill', () => {
  it('sends one store a call, adds up the outcomes, and carries on past a store that fails', async () => {
    const sent: unknown[] = []
    const post = async (payload: { store: string }) => {
      sent.push(payload)
      if (payload.store === 'HIL') throw new Error('No store HIL')
      return { store: 'Lakeside', results: [{ employee: 'E1', name: 'One', outcome: 'pre-filled' as const, department: 'Womenswear', sections: ['Sarees'], notes: [] },
        { employee: 'E9', name: 'Nine', outcome: 'skipped' as const, notes: ['pre-filled before'] }] }
    }
    const { runPrefill } = await import('./prefill-plan.ts')
    const report = await runPrefill(planFromCsv(CSV).stores, post)
    expect(sent).toEqual([{ store: 'LKS', managers: planFromCsv(CSV).stores[0].managers }, { store: 'HIL', managers: planFromCsv(CSV).stores[1].managers }])
    expect(report.totals).toEqual({ 'pre-filled': 1, 'would pre-fill': 0, skipped: 1, refused: 0, failed_stores: 1 })
    expect(report.stores).toEqual([
      { store: 'LKS', results: [{ employee: 'E1', name: 'One', outcome: 'pre-filled', department: 'Womenswear', sections: ['Sarees'], notes: [] }, { employee: 'E9', name: 'Nine', outcome: 'skipped', notes: ['pre-filled before'] }] },
      { store: 'HIL', error: 'No store HIL' },
    ])
  })
})

describe('the load around the action (#1205)', () => {
  const report = {
    totals: { 'pre-filled': 1, 'would pre-fill': 0, skipped: 1, refused: 1, failed_stores: 1 },
    stores: [
      { store: 'LKS', results: [
        { employee: 'E1', name: 'One', outcome: 'pre-filled' as const, department: 'Sarees', sections: ['Sarees'], notes: [], bundle: 'J1:a', created: { department: 'D1', links: ['L1'], proposals: ['P1', 'P2'] } },
        { employee: 'E2', name: 'Two', outcome: 'skipped' as const, notes: ['pre-filled before'] },
        { employee: 'E3', name: 'Three', outcome: 'refused' as const, notes: ['not on the staff list'] }] },
      { store: 'HIL', error: 'No store HIL' },
    ],
  }
  it('asks the server for a dry run when told to', async () => {
    const { runPrefill } = await import('./prefill-plan.ts')
    const sent: unknown[] = []
    const dry = await runPrefill(planFromCsv(CSV).stores.slice(0, 1), async payload => { sent.push(payload); return { results: [{ employee: 'E1', name: 'One', outcome: 'would pre-fill' as const, notes: [] }] } }, true)
    expect(sent).toMatchObject([{ store: 'LKS', dry_run: true }])
    expect(dry.totals['would pre-fill']).toBe(1)
  })
  it('counts each store on its own', async () => {
    const { perStore } = await import('./prefill-plan.ts')
    expect(perStore(report)).toEqual([
      { store: 'LKS', 'pre-filled': 1, 'would pre-fill': 0, skipped: 1, refused: 1 },
      { store: 'HIL', error: 'No store HIL' },
    ])
  })
  it('records what was created, so the whole load can be taken back', async () => {
    const { createdRecord, runUndo } = await import('./prefill-plan.ts')
    const record = createdRecord(report)
    expect(record).toEqual({ bundles: ['J1:a'], rows: [{ store: 'LKS', employee: 'E1', name: 'One', department: 'Sarees', bundle: 'J1:a', created: { department: 'D1', links: ['L1'], proposals: ['P1', 'P2'] } }] })
    const sent: unknown[] = []
    const many = { bundles: Array.from({ length: 120 }, (_, i) => `B${i}`), rows: [] }
    const undone = await runUndo(many, async payload => { sent.push(payload); return { results: payload.bundles.map(bundle => ({ bundle, outcome: bundle === 'B0' ? 'not open' : 'undone' })) } })
    expect(sent.map(s => (s as { bundles: string[] }).bundles.length)).toEqual([50, 50, 20])
    expect(undone).toEqual({ undone: 119, not_open: 1 })
  })
})
