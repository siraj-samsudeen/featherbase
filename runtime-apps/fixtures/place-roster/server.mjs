// #559 fixture: an app that provides people's scope from its own roster
// Table. `faults` lets a test make the provider misbehave.
export const platformVersion = '2026-10'
export const calls = { provider: 0 }
export const faults = {}
export const scopeProviders = {
  async positions({ person, documents }) {
    calls.provider++
    if (faults.provider) throw faults.provider
    if (faults.result !== undefined) return faults.result
    // An instance Table the provider declared; tests mark it, or not.
    if (faults.readInstance) await documents.list('Roster Extra')
    if (faults.readUndeclared) await documents.list('scopeproof.object')
    if (faults.parallel) await Promise.all([documents.list('placeroster.position'), documents.list('placeroster.position')])
    if (faults.getRow) {
      const row = await documents.get('placeroster.position', faults.getRow)
      return [{ label: row.place, filters: { store: [row.store] } }]
    }
    const rows = await documents.list('placeroster.position', {
      filters: [['person', '=', person.id]], fields: ['place', 'store', 'section', 'basis', 'assumed'], order_by: 'place asc',
    })
    return rows.map(row => ({
      label: row.place,
      filters: { store: [row.store], section: [row.section] },
      ...(row.basis ? { basis: row.basis } : {}),
      confirmation: { section: { [row.section]: row.assumed ? 'assumed' : 'confirmed' } },
    }))
  },
}
