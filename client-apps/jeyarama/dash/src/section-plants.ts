// #1351: links each section to the plant its sales are filed under, where that is not a guess. A section
// with no plant, at a site holding exactly one plant (active or not), gets that plant. A site with several
// plants, or none, is left for a person, with its choices named. A plant already set is never touched, so
// a person's choice stands and a rerun changes nothing it changed before.
export interface SectionRow { row_id: string; site: string | null; plant: string | null }
export interface PlantRow { row_id: string; site: string | null }
export interface SectionPlantPlan {
  fill: { section: string; site: string; plant: string }[]
  left: { section: string; site: string; plants: string[] }[]
  kept: number
}

export function planSectionPlants(sections: readonly SectionRow[], plants: readonly PlantRow[]): SectionPlantPlan {
  const atSite = new Map<string, string[]>()
  for (const plant of plants) if (plant.site) atSite.set(plant.site, [...atSite.get(plant.site) ?? [], plant.row_id])
  const plan: SectionPlantPlan = { fill: [], left: [], kept: 0 }
  for (const section of sections) {
    if (section.plant) { plan.kept++; continue }
    const site = section.site ?? ''
    const choices = (atSite.get(site) ?? []).toSorted()
    if (choices.length === 1) plan.fill.push({ section: section.row_id, site, plant: choices[0] })
    else plan.left.push({ section: section.row_id, site, plants: choices })
  }
  return plan
}
