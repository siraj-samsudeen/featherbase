export const platformVersion = '2026-10'
// Hands each helper call straight through, so the platform's own rules are what is proved.
export const actions = {
  async probe({ payload, baseTables, changeProposals }) {
    if (payload.op === 'parallel') return Promise.all([changeProposals.list({}), changeProposals.list({})])
    if (payload.op === 'unawaited') { void changeProposals.list({}).catch(() => {}); return true }
    if (payload.op === 'unawaited_failing') { void baseTables.list('Placement', { fields: ['label'], filters: [['label', 'no such operator', 'x']] }).catch(() => {}); return true }
    if (payload.op === 'authority') return { may: await changeProposals.mayDecide(payload.maker, payload.approvers), route: await changeProposals.routeFor(payload.maker, payload.approvers) }
    if (payload.op === 'serialize') return changeProposals.serialize(payload.key) ?? null
    if (payload.op === 'list') return baseTables.list(payload.table, payload.args)
    if (payload.op === 'proposals') return changeProposals.list(payload.filter)
    if (payload.op === 'lock') { await changeProposals.lockRow(payload.table, payload.row); await changeProposals.serialize(payload.key); return true }
    // A rule no row can hold: at most one row per label. The check only means anything under the lock.
    if (payload.op === 'add_once') {
      await changeProposals.serialize(payload.key)
      const placed = await baseTables.list('Placement', { fields: ['label'], filters: [['label', '=', payload.label]] })
      if (placed.length) return changeProposals.needsFreshReview(payload.id, { approvers: payload.decision.approvers, reason: 'Already placed' })
      return changeProposals.approve(payload.id, payload.decision)
    }
    if (payload.op === 'propose') return changeProposals.propose(payload.request)
    if (payload.op === 'approve') return changeProposals.approve(payload.id, payload.decision)
    if (payload.op === 'reject') return changeProposals.reject(payload.id, payload.decision)
    if (payload.op === 'withdraw') return changeProposals.withdraw(payload.id)
    if (payload.op === 'confirm') return changeProposals.confirm(payload.id, payload.decision)
    if (payload.op === 'undo') return changeProposals.undo(payload.id, payload.decision)
    if (payload.op === 'needs_fresh_review') return changeProposals.needsFreshReview(payload.id, payload.decision)
    throw new Error('Unknown probe')
  },
}
export const reads = {
  async look({ payload, baseTables, changeProposals }) {
    if (payload.modeOf) return changeProposals.modeOf(payload.modeOf)
    if (payload.authority) return { may: await changeProposals.mayDecide(payload.authority.maker, payload.authority.approvers), route: await changeProposals.routeFor(payload.authority.maker, payload.authority.approvers) }
    return { canPropose: typeof changeProposals.propose === 'function', canDecide: typeof changeProposals.approve === 'function',
      rows: await baseTables.list(payload.table, payload.args), proposals: await changeProposals.list({}) }
  },
}
