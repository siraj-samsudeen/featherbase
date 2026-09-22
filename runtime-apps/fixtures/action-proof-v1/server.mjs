export const apiVersion = 1
export let escapedDocuments
export const actions = {
  async transform({ payload, documents, reject }) {
    if (!payload || typeof payload !== 'object' || typeof payload.source !== 'string' || typeof payload.updatedAt !== 'string')
      reject('Expected source and updatedAt', { source: 'Required', updatedAt: 'Required' })
    const source = await documents.get('actionproof.work', payload.source)
    const destination = await documents.create('actionproof.destination', { title: `${source.title} / destination` })
    await documents.update('actionproof.work', { row_id: payload.source, updated_at: payload.updatedAt, destination: destination.row_id })
    await documents.create('Comment', { ref_table: 'actionproof.work', ref_name: payload.source, content: 'Moved with 37 units, not 17' })
    if (payload.fail) throw new Error('Deliberate handler failure')
    return { destination: destination.row_id, source: payload.source, marker: 37 }
  },
  async discard({ payload, documents, reject }) {
    if (!payload || typeof payload.source !== 'string' || typeof payload.updatedAt !== 'string') reject('Expected source and updatedAt')
    const counts = await documents.deletionState('actionproof.work', payload.source)
    if (payload.explain && Object.values(counts).some(Boolean)) return { deleted: false, counts }
    await documents.delete('actionproof.work', payload.source, payload.updatedAt)
    return { deleted: true, source: payload.source }
  },
  async probe(context) {
    const { payload, documents } = context
    if (payload.operation === 'shape') return Object.keys(context).sort()
    if (payload.operation === 'escape') { escapedDocuments = documents; return true }
    if (payload.operation === 'unawaited') {
      void documents.create('actionproof.destination', { title: 'Must roll back' }).catch(() => {})
      return true
    }
    if (payload.operation === 'swallow') {
      try { await documents.create('Permission', { row_id: 'forbidden' }) } catch {}
      return true
    }
    if (payload.operation === 'nonjson') {
      await documents.create('actionproof.destination', { title: 'Cannot replay undefined' })
      return undefined
    }
    if (payload.operation === 'parallel') return Promise.all([documents.get('actionproof.work', payload.source), documents.get('actionproof.work', payload.source)])
    return documents[payload.operation](payload.table, payload.values ?? payload.source)
  },
}
