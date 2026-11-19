// #1351: which sections the fill links to their plant, and which wait for a person. Made-up sites and plants.
import { describe, expect, it } from 'vitest'
import { planSectionPlants } from './section-plants.ts'

const PLANTS = [
  { row_id: 'P1', site: 'BAY' },
  { row_id: 'P2', site: 'LKS' }, { row_id: 'P3', site: 'LKS' },
  { row_id: 'P4', site: null },
]

describe('planSectionPlants', () => {
  it('links a section at a one-plant site to that plant', () => {
    expect(planSectionPlants([{ row_id: 'BAY-S1', site: 'BAY', plant: null }], PLANTS))
      .toEqual({ fill: [{ section: 'BAY-S1', site: 'BAY', plant: 'P1' }], left: [], kept: 0, elsewhere: [] })
  })

  it('leaves a section at a site with several plants, or none, for a person, naming the choices', () => {
    expect(planSectionPlants([
      { row_id: 'LKS-S1', site: 'LKS', plant: '' },
      { row_id: 'NGT-S1', site: 'NGT', plant: null },
    ], PLANTS)).toEqual({ fill: [], kept: 0, elsewhere: [], left: [
      { section: 'LKS-S1', site: 'LKS', plants: ['P2', 'P3'] },
      { section: 'NGT-S1', site: 'NGT', plants: [] },
    ] })
  })

  it('never touches a plant already set, and names one at another site for a person', () => {
    expect(planSectionPlants([
      { row_id: 'BAY-S2', site: 'BAY', plant: 'P3' },
      { row_id: 'LKS-S2', site: 'LKS', plant: 'P2' },
    ], PLANTS)).toEqual({ fill: [], left: [], kept: 2, elsewhere: [{ section: 'BAY-S2', site: 'BAY', plant: 'P3', plant_site: 'LKS' }] })
  })
})
