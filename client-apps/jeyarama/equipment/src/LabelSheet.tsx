import { Button } from '@featherbase/shop-floor'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { inSite, nameOf, sitesOf, useAssets, usePlaces, type Asset } from './data'
import { placePath } from './jobRules'

/** The address a label opens: this app's page for the asset. */
export function assetAddress(id: string, origin = location.origin) {
  return `${origin}/equipment/#asset=${encodeURIComponent(id)}`
}

function QrCode({ id }: { id: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    void QRCode.toString(assetAddress(id), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(markup => { if (live) setSvg(markup) })
    return () => { live = false }
  }, [id])
  return <span role="img" aria-label={`QR code for ${id}`} className="label-qr" dangerouslySetInnerHTML={{ __html: svg }} />
}

export function LabelSheet() {
  const places = usePlaces()
  const assets = useAssets()
  const [place, setPlace] = useState('')
  const placeName = nameOf(places.data, place, 'place_name')
  const shown: Asset[] = (assets.data ?? []).filter(asset => inSite(asset.place, place, places.data) && asset.book_status !== 'Retired')

  return <section aria-labelledby="labels-heading" className="labels">
    <div className="assets-heading labels-controls">
      <h1 id="labels-heading">QR labels</h1>
      <label>Place<select aria-label="Place" value={place} onChange={event => setPlace(event.target.value)}>
        <option value="">Choose a site</option>
        {sitesOf(places.data).map(p => <option key={p.row_id} value={p.row_id}>{p.place_name}</option>)}
      </select></label>
      {place && <Button type="button" variant="primary" onClick={() => window.print()} disabled={!shown.length}>Print labels</Button>}
    </div>
    {place && <section aria-label={`Labels for ${placeName}`} className="label-sheet">
      {shown.map(asset => <article key={asset.row_id} className="label">
        <QrCode id={asset.row_id} />
        <div><strong>{asset.row_id}</strong><span>{asset.asset_name}</span><span className="asset-muted">{placePath(asset.place, places.data ?? [])}</span></div>
      </article>)}
      {!shown.length && <p className="asset-muted">No assets in {placeName} yet.</p>}
    </section>}
  </section>
}
