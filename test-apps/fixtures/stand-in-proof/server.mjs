// #1409 fixture: Store Sales, an app with two datasets. In the proof, `sales`
// comes from the warehouse and `targets` is a stand-in until the warehouse has
// it. Nothing here knows which is which: the handlers read both the same way,
// and the platform marks the stand-in.
export const platformVersion = '2026-10'

export const reads = {
  // What the page shows: both datasets, and a view record for the targets.
  async overview({ datasets, recordView }) {
    const sales = await datasets.active('sales')
    const targets = await datasets.active('targets')
    await recordView({ dataset: 'targets' })
    return { sales, targets }
  },
  // A page that shows no stand-in.
  async sales({ datasets }) {
    return { sales: await datasets.active('sales') }
  },
  // One dataset read the way the payload says: `active` or `live`, with filters.
  ask: ({ datasets, payload }) => datasets[payload.how ?? 'active'](payload.dataset, payload.filters),
  ask_outbound: ({ datasets, payload }) => datasets[payload.how ?? 'active'](payload.dataset, payload.filters),
}
