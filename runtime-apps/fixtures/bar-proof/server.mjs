// #642 fixture (design E8): an app that declares a store picker for the shared
// top bar. The platform fills the picker from `stores`, under the reader's own
// scope; `malformed` answers a shape the bar cannot show, and `broken` fails.
export const platformVersion = '2026-10'
export const reads = {
  stores({ authorization }) {
    return authorization.places.map(place => ({ value: place.filters.store[0], label: place.label }))
  },
  malformed() {
    return [{ value: 'N1' }]
  },
  broken() {
    throw new Error('The store list is unavailable')
  },
}
