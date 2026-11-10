// #559 fixture: an app that provides people's scope from its own roster
// Table. `faults` lets a test make the provider misbehave.
export const platformVersion = '2026-10'
export const calls = { provider: 0, person: undefined }
export const faults = {}
// A Date column reads as an ISO timestamp; a reason names the day.
const day = (value) => String(value).slice(0, 10)
export const scopeProviders = {
  async positions({ person, documents }) {
    calls.provider++
    calls.person = person
    // Tries to add a value to what the platform handed over.
    if (faults.addIdentifier) person.identifiers[faults.addIdentifier].push('ADDED')
    if (faults.provider) throw faults.provider
    if (faults.result !== undefined) return faults.result
    // An instance Table the provider declared; tests mark it, or not.
    if (faults.readInstance) await documents.list('Roster Extra')
    if (faults.readUndeclared) await documents.list('scopeproof.object')
    if (faults.parallel) await Promise.all([documents.list('placeroster.position'), documents.list('placeroster.position')])
    if (faults.getInstance) {
      // Echoes any child rows the read handed over.
      const row = await documents.get('Roster Extra', faults.getInstance)
      return [{ label: 'Extra', filters: { line: (row.lines ?? []).map(line => line.code) } }]
    }
    if (faults.getRow) {
      const row = await documents.get('placeroster.position', faults.getRow)
      return [{ label: row.place, filters: { store: [row.store] } }]
    }
    const rows = await documents.list('placeroster.position', {
      filters: [['person', '=', person.id]], fields: ['place', 'store', 'section', 'basis', 'assumed', 'reason', 'since', 'until'], order_by: 'place asc', limit_page_length: 500,
    })
    // Rows with one place label make one place covering all their values.
    const places = new Map()
    for (const row of rows) {
      const place = places.get(row.place) ?? { label: row.place, filters: { store: [], section: [] }, confirmation: { section: {} } }
      if (!place.filters.store.includes(row.store)) place.filters.store.push(row.store)
      if (!place.filters.section.includes(row.section)) place.filters.section.push(row.section)
      if (row.basis && !place.basis) place.basis = row.basis
      // #628: each row may say why it gives the place, and from when.
      if (row.reason) (place.reasons ??= []).push({ text: row.reason, ...(row.since ? { since: day(row.since) } : {}), ...(row.until ? { until: day(row.until) } : {}) })
      place.confirmation.section[row.section] = row.assumed ? 'assumed' : 'confirmed'
      places.set(row.place, place)
    }
    return [...places.values()]
  },
}
