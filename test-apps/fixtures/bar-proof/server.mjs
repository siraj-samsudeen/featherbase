// #642 fixture (design E8): an app that declares a store picker for the shared
// top bar. The platform fills the picker from `stores`, under the reader's own
// scope; `malformed` answers a shape the bar cannot show, and `broken` fails.
// `waiting` is declared outbound and calls `hooks.wait`, which a test sets.
export const platformVersion = '2026-10'
export const hooks = { wait: async () => {} }
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
  async waiting() {
    await hooks.wait()
    return [{ value: 'N1', label: 'North' }]
  },
  by_report({ payload }) {
    return payload.report === 'none' ? [] : [{ value: payload.report, label: JSON.stringify(payload) }]
  },
  prepared_outbound: Object.assign(async function preparedOutbound({ prepared, documents }) {
    let own_read = 'allowed'
    try { await documents.list('barproof.note', { fields: ['body'] }) } catch { own_read = 'refused' }
    return [{ value: prepared[0], label: own_read }]
  }, {
    // #967: an outbound read's first step, in the transaction.
    async prepare({ documents }) {
      return (await documents.list('barproof.note', { fields: ['body'] })).map(row => row.body)
    },
  }),
}
