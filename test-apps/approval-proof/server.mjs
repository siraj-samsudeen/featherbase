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
}
