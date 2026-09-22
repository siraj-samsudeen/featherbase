export const apiVersion = 1
export const calls = { handler: 0, resolver: 0, authorizer: 0, upstream: 0 }
export const faults = {}
export let escapedFacts
export const scopeResolvers = {
  async object({ payload, requestedStoreCodes, facts, reject }) {
    calls.resolver++
    if (faults.resolver) throw faults.resolver
    if (faults.scopeResult) return faults.scopeResult
    escapedFacts = facts
    if (payload.mutateClaim) {
      try { requestedStoreCodes.push('B') } catch {}
    }
    if (payload.line) {
      const line = await facts.get('scopeproof.line', payload.line)
      if (line.parent_id !== payload.id) reject()
    }
    const row = await facts.get('scopeproof.object', payload.id)
    if ('secret' in row || 'create' in facts) throw new Error('Scope facts escaped allowlist')
    return { storeCodes: row.stores }
  },
  async pairs({ payload }) {
    calls.resolver++
    return { storeCodes: payload.storeCodes, productScope: payload.pairs }
  },
}
export const authorizers = {
  async pairs({ authorization, facts, reject }) {
    calls.authorizer++
    if (faults.authorizer) throw faults.authorizer
    const current = await facts.get('scopeproof.access', authorization.user)
    const requested = authorization.productScope
    if (!Array.isArray(requested) || !requested.length || requested.some(pair =>
      !Array.isArray(pair) || pair.length !== 2 || !authorization.storeCodes.includes(pair[0]) ||
      !current.pairs.some(allowed => allowed[0] === pair[0] && allowed[1] === pair[1]))) reject()
    return true
  },
}
function result(context) {
  calls.handler++
  if (faults.handler) throw faults.handler
  calls.upstream++ // Observable stand-in for where a trusted package starts work.
  return { stores: context.authorization.storeCodes, marker: 37 }
}
export const reads = {
  stores(context) {
    if (Object.keys(context.documents).sort().join(',') !== 'activity,get,list') throw new Error('Mutable read context')
    return result(context)
  },
  object: result,
  product: result,
}
export const actions = {
  async write(context) {
    const output = result(context)
    await context.documents.create('scopeproof.effect', { row_id: context.payload.effect, value: output.stores.join(',') })
    return output
  },
  async discard(context) {
    const output = result(context)
    await context.documents.delete('scopeproof.object', context.payload.id, context.payload.updatedAt)
    return output
  },
  product: result,
}
