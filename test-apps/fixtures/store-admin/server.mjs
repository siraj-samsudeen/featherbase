// #919 fixture: an app whose jobs make store administrators. A Manager job
// reaches its store, a Head job every store. `faults` makes the provider fail.
export const platformVersion = '2026-10'
export const calls = { provider: 0 }
export const faults = {}
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const day = (value) => (value == null ? '' : String(value).slice(0, 10))
export const reachProviders = {
  async stores({ person, documents }) {
    calls.provider++
    if (faults.provider) throw faults.provider
    if (faults.result !== undefined) return faults.result
    const on = today()
    const jobs = (await documents.list('storeadmin.job', { filters: [['person', '=', person.id]], fields: ['job', 'store', 'starts_on', 'ends_on'] }))
      .filter((row) => day(row.starts_on) <= on && (!row.ends_on || on < day(row.ends_on)))
    if (jobs.some((row) => row.job === 'Head')) return [{ role: 'Shelf Manager', stores: '*' }]
    const stores = [...new Set(jobs.filter((row) => row.job === 'Manager').map((row) => row.store))]
    return stores.length ? [{ role: 'Shelf Manager', stores }] : []
  },
}
