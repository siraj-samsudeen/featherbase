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
    expect(report.totals).toEqual({ 'pre-filled': 1, skipped: 1, refused: 0, failed_stores: 1 })
    expect(report.stores).toEqual([
      { store: 'LKS', results: [{ employee: 'E1', name: 'One', outcome: 'pre-filled', department: 'Womenswear', sections: ['Sarees'], notes: [] }, { employee: 'E9', name: 'Nine', outcome: 'skipped', notes: ['pre-filled before'] }] },
      { store: 'HIL', error: 'No store HIL' },
    ])
  })
})
