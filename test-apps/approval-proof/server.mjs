export const platformVersion = '2026-10'
// #627: who counts as the site lead of a row: the lead of the Shelf Site its `site` names.
export const approvalResolvers = {
  async site_lead({ row, documents }) {
    if (!row.site) return []
    const sites = await documents.list('Shelf Site', { fields: ['lead'], filters: [['code', '=', row.site]] })
    return sites.map(site => site.lead).filter(Boolean)
  },
  // Reads a Table it never declared, so it names nobody.
  async broken({ documents }) {
    await documents.list('Person', { fields: ['row_id'] })
    return ['someone']
  },
  // The same site lead, read by the site's row id.
  async by_id({ row, documents }) {
    const site = await documents.get('Shelf Site', row.site)
    return [site.lead]
  },
  // Two reads at once, a related filter, a read left running: each names nobody.
  async racing({ documents }) {
    await Promise.all([documents.list('Shelf Site'), documents.list('Shelf Site')])
    return ['someone']
  },
  async related({ documents }) {
    await documents.list('Shelf Site', { filters: [['code', 'related', 'A']] })
    return ['someone']
  },
  async forgotten({ documents }) {
    void documents.list('Shelf Site').catch(() => {})
    return ['someone']
  },
  // Not a list of people, so nobody.
  async not_a_list() {
    return 'someone'
  },
}
