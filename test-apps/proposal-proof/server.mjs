export const platformVersion = '2026-10'
// Hands each helper call straight through, so the platform's own rules are what is proved.
export const actions = {
  async probe({ payload, baseTables, changeProposals }) {
    if (payload.op === 'list') return baseTables.list(payload.table, payload.args)
    if (payload.op === 'proposals') return changeProposals.list(payload.filter)
    if (payload.op === 'propose') return changeProposals.propose(payload.request)
    if (payload.op === 'approve') return changeProposals.approve(payload.id, payload.decision)
    if (payload.op === 'reject') return changeProposals.reject(payload.id, payload.decision)
    if (payload.op === 'needs_fresh_review') return changeProposals.needsFreshReview(payload.id, payload.decision)
    throw new Error('Unknown probe')
  },
}
export const reads = {
  async look({ payload, baseTables, changeProposals }) {
    return { canPropose: typeof changeProposals.propose === 'function', canDecide: typeof changeProposals.approve === 'function',
      rows: await baseTables.list(payload.table, payload.args), proposals: await changeProposals.list({}) }
  },
}
