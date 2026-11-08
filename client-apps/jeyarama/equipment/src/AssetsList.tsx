import { fmtDate } from '@featherbase/shop-floor'
import { useState } from 'react'
import { inSite, nameOf, sitesOf, useAssets, useJobs, usePlaces, useTypes } from './data'
import { isOpen, localDay, placePath, warrantyNotice } from './jobRules'

export function AssetsList() {
  const assets = useAssets()
  const places = usePlaces()
  const types = useTypes()
  const jobs = useJobs()
  const [place, setPlace] = useState('')
  const [search, setSearch] = useState('')
  const today = localDay()
  const openAssets = new Set((jobs.data ?? []).filter(job => isOpen(job.job_state)).map(job => job.asset))
  const query = search.trim().toLowerCase()
  const shown = (assets.data ?? []).filter(asset => (!place || inSite(asset.place, place, places.data))
    && (!query || `${asset.tag_no ?? ''} ${asset.asset_name} ${asset.serial_no ?? ''} ${asset.sap_asset_no ?? ''} ${asset.legacy_id ?? ''}`.toLowerCase().includes(query)))

  return <section aria-labelledby="assets-heading">
    <div className="assets-heading">
      <h1 id="assets-heading">Assets</h1>
      <label>Place<select aria-label="Place" value={place} onChange={event => setPlace(event.target.value)}>
        <option value="">All sites</option>
        {sitesOf(places.data).map(p => <option key={p.row_id} value={p.row_id}>{p.place_name}</option>)}
      </select></label>
      <label className="assets-search">Search<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tag, name, serial, SAP or legacy number" /></label>
    </div>
    {assets.error && <p role="alert">{assets.error.message}</p>}
    <div className="assets-table-wrap">
      <table className="assets-table" aria-label="Assets">
        <thead><tr><th scope="col">Tag</th><th scope="col">Asset</th><th scope="col">Type</th><th scope="col">Place</th><th scope="col">Warranty until</th><th scope="col">Needs attention</th></tr></thead>
        <tbody>
          {shown.map(asset => {
            const warranty = warrantyNotice(asset.warranty_until, today)
            return <tr key={asset.row_id}>
              <td className="assets-tag">{asset.tag_no ?? 'Needs a tag'}</td>
              <td><a href={`#asset=${encodeURIComponent(asset.row_id)}`}>{asset.asset_name}</a></td>
              <td>{nameOf(types.data, asset.asset_type, 'type_name')}</td>
              <td>{placePath(asset.place, places.data ?? [])}</td>
              <td>{asset.warranty_until ? fmtDate(asset.warranty_until.slice(0, 10)) : '—'}</td>
              <td><div className="assets-flags">
                {openAssets.has(asset.row_id) && <span className="assets-flag" data-flag="job">Open job</span>}
                {warranty === 'soon' && <span className="assets-flag" data-flag="soon">Warranty ends soon</span>}
                {warranty === 'ended' && <span className="assets-flag" data-flag="ended">Warranty ended</span>}
              </div></td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
    {!shown.length && assets.data && <p className="asset-muted">No assets match.</p>}
  </section>
}
