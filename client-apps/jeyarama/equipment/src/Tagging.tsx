import { Button, fmtDate } from '@featherbase/shop-floor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { listAll, save } from './api'
import { isTag, rollSummary, tagFor, tagNumber } from './tagRules'

export interface TagRoll { row_id: string; updated_at: string; roll_name: string; sticker: string; first_no: number; last_no: number; team: string | null; issued_on: string | null; roll_state: string }
interface TagEvent { row_id: string; tag_no: string; event_kind: string; reason: string; created_by: string; created_at: string }

export const useRolls = () => useQuery({ queryKey: ['assets', 'rolls'], queryFn: () => listAll<TagRoll>('equipment.tag_roll', {
  fields: ['row_id', 'updated_at', 'roll_name', 'sticker', 'first_no', 'last_no', 'team', 'issued_on', 'roll_state'], order_by: 'first_no asc' }) })
const useTagEvents = () => useQuery({ queryKey: ['assets', 'tag-events'], queryFn: () => listAll<TagEvent>('equipment.tag_event', {
  fields: ['row_id', 'tag_no', 'event_kind', 'reason', 'created_by', 'created_at'], order_by: 'created_at desc' }) })
const useUsedTags = () => useQuery({ queryKey: ['assets', 'used-tags'], queryFn: async () =>
  (await listAll<{ row_id: string; tag_no: string | null }>('equipment.asset', { fields: ['row_id', 'tag_no'] })).filter(asset => asset.tag_no) })

/** The address a label's QR code opens: the asset with this tag. Rolls are printed before any asset exists. */
export function tagAddress(tag: string, origin = location.origin) {
  return `${origin}/equipment/#tag=${encodeURIComponent(tag)}`
}

function TagQr({ tag }: { tag: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    void QRCode.toString(tagAddress(tag), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(markup => { if (live) setSvg(markup) })
    return () => { live = false }
  }, [tag])
  return <span role="img" aria-label={`QR code for ${tag}`} className="label-qr" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** One label as the plan lays it out: group property, do-not-remove, the tag in large print and its QR code. */
export function TagLabel({ tag }: { tag: string }) {
  return <article className="label tag-label" aria-label={`Label ${tag}`}>
    <TagQr tag={tag} />
    <div className="tag-label-text">
      <span className="tag-label-owner">Jeyarama Group property</span>
      <strong className="tag-label-number">{tag}</strong>
      <span className="tag-label-warning">Please do not remove</span>
    </div>
  </article>
}

const isManager = (roles: string[]) => roles.some(role => role === 'Assets Manager' || role === 'System Manager')

/** Tag rolls, their log, label printing by range, and spoiled, skipped or reprinted numbers. */
export function TagsPage({ roles }: { roles: string[] }) {
  const queryClient = useQueryClient()
  const rolls = useRolls()
  const events = useTagEvents()
  const used = useUsedTags()
  const manager = isManager(roles)
  const [roll, setRoll] = useState({ roll_name: '', sticker: 'Standard PET', first: '', last: '', team: '' })
  const [print, setPrint] = useState({ first: '', last: '' })
  const [event, setEvent] = useState({ tag_no: '', event_kind: 'Spoiled', reason: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const usedTags = (used.data ?? []).map(asset => String(asset.tag_no))

  async function run(work: () => Promise<unknown>, reset: () => void) {
    setBusy(true); setError('')
    try { await work(); reset(); await queryClient.invalidateQueries({ queryKey: ['assets'] }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save') }
    finally { setBusy(false) }
  }
  const printFirst = isTag(print.first) ? tagNumber(print.first) : NaN, printLast = isTag(print.last) ? tagNumber(print.last) : NaN
  const printable = printFirst > 0 && printLast >= printFirst && printLast - printFirst < 500
    ? Array.from({ length: printLast - printFirst + 1 }, (_, index) => tagFor(printFirst + index)) : []

  return <section aria-labelledby="tags-heading" className="tags-page">
    <div className="assets-heading"><h1 id="tags-heading">Tags and labels</h1>
      <p className="asset-sub">One group series, JRA- and six digits, never reused. A label carries no SAP number, entity or site.</p></div>
    {error && <p role="alert" className="counts-error">{error}</p>}

    <h2>Tag roll log</h2>
    <div className="assets-table-wrap">
      <table className="assets-table" aria-label="Tag roll log">
        <thead><tr><th scope="col">Roll</th><th scope="col">Sticker</th><th scope="col">Numbers</th><th scope="col">Issued to</th><th scope="col">Used</th><th scope="col">Spoiled</th><th scope="col">Returned</th><th scope="col">Reprints</th><th scope="col">State</th></tr></thead>
        <tbody>{(rolls.data ?? []).map(r => {
          const summary = rollSummary(r, usedTags, events.data ?? [])
          return <tr key={r.row_id}>
            <th scope="row">{r.roll_name}</th><td>{r.sticker}</td><td>{tagFor(r.first_no)} to {tagFor(r.last_no)}</td>
            <td>{r.team ?? '—'}{r.issued_on ? ` · ${fmtDate(String(r.issued_on).slice(0, 10))}` : ''}</td>
            <td>{summary.used}</td><td>{summary.spoiled}</td><td>{r.roll_state === 'Returned' ? summary.returned : `${summary.unaccounted} not yet used`}</td><td>{summary.reprinted}</td>
            <td>{r.roll_state}{manager && r.roll_state === 'Issued' && <Button type="button" onClick={() => void run(() => save('equipment.tag_roll', { row_id: r.row_id, updated_at: r.updated_at, roll_state: 'Returned' }), () => {})}>Mark returned</Button>}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    {!rolls.data?.length && <p className="asset-muted">No tag rolls yet.</p>}

    {manager && <form aria-label="Add a tag roll" className="asset-report tags-form" onSubmit={e => { e.preventDefault(); void run(() => save('equipment.tag_roll', {
      roll_name: roll.roll_name.trim(), sticker: roll.sticker, first_no: Number(roll.first), last_no: Number(roll.last), team: roll.team.trim() || null, issued_on: new Date().toISOString().slice(0, 10),
    }), () => setRoll({ roll_name: '', sticker: 'Standard PET', first: '', last: '', team: '' })) }}>
      <h2>Add a tag roll</h2>
      <label>Roll<input aria-label="Roll" value={roll.roll_name} onChange={e => setRoll({ ...roll, roll_name: e.target.value })} placeholder="Standard PET roll 1" /></label>
      <label>Sticker<select aria-label="Sticker" value={roll.sticker} onChange={e => setRoll({ ...roll, sticker: e.target.value })}>
        {['Standard PET', 'Tamper-evident', 'Freezer-grade', 'Metal'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>First number<input aria-label="First number" type="number" min="1" value={roll.first} onChange={e => setRoll({ ...roll, first: e.target.value })} /></label>
      <label>Last number<input aria-label="Last number" type="number" min="1" value={roll.last} onChange={e => setRoll({ ...roll, last: e.target.value })} /></label>
      <label>Issued to<input aria-label="Issued to" value={roll.team} onChange={e => setRoll({ ...roll, team: e.target.value })} placeholder="Team A" /></label>
      <Button type="submit" variant="primary" disabled={busy || !roll.roll_name.trim() || !roll.first || !roll.last}>Add roll</Button>
    </form>}

    <form aria-label="Spoiled, skipped or reprinted tag" className="asset-report tags-form" onSubmit={e => { e.preventDefault(); void run(() => save('equipment.tag_event', {
      tag_no: event.tag_no.trim().toUpperCase(), event_kind: event.event_kind, reason: event.reason.trim(),
    }), () => setEvent({ tag_no: '', event_kind: 'Spoiled', reason: '' })) }}>
      <h2>Log a spoiled, skipped or reprinted tag</h2>
      <label>Tag<input aria-label="Tag" value={event.tag_no} onChange={e => setEvent({ ...event, tag_no: e.target.value })} placeholder="JRA-000045" /></label>
      <label>What happened<select aria-label="What happened" value={event.event_kind} onChange={e => setEvent({ ...event, event_kind: e.target.value })}>
        {['Spoiled', 'Skipped', 'Reprinted'].map(k => <option key={k}>{k}</option>)}</select></label>
      <label>Reason<input aria-label="Reason" value={event.reason} onChange={e => setEvent({ ...event, reason: e.target.value })} placeholder="Torn while peeling" /></label>
      <Button type="submit" variant="primary" disabled={busy || !event.tag_no.trim() || !event.reason.trim()}>Log it</Button>
    </form>
    {(events.data ?? []).length > 0 && <ul className="tags-events" aria-label="Tag events">
      {events.data!.slice(0, 20).map(e => <li key={e.row_id}>{e.tag_no} · {e.event_kind} · {e.reason} · {fmtDate(e.created_at.slice(0, 10))}</li>)}
    </ul>}

    <section aria-labelledby="print-heading" className="labels">
      <div className="labels-controls">
        <h2 id="print-heading">Print labels</h2>
        <label>From<input aria-label="Print from" value={print.first} onChange={e => setPrint({ ...print, first: e.target.value.toUpperCase() })} placeholder="JRA-000001" /></label>
        <label>To<input aria-label="Print to" value={print.last} onChange={e => setPrint({ ...print, last: e.target.value.toUpperCase() })} placeholder="JRA-000040" /></label>
        <Button type="button" variant="primary" disabled={!printable.length} onClick={() => window.print()}>Print labels</Button>
      </div>
      <p className="asset-muted">Up to 500 labels at a time. For a reprint, log it above with its reason first.</p>
      {printable.length > 0 && <section aria-label="Label sheet" className="label-sheet">{printable.map(tag => <TagLabel key={tag} tag={tag} />)}</section>}
    </section>
  </section>
}

/** A scanned label: open the asset with that tag, or say it isn't recorded yet. */
export function TagRoute({ tag }: { tag: string }) {
  const asset = useQuery({ queryKey: ['assets', 'by-tag', tag], queryFn: () => listAll<{ row_id: string }>('equipment.asset', { fields: ['row_id'], filters: [['tag_no', '=', tag]] }) })
  useEffect(() => {
    const found = asset.data?.[0]
    if (found) location.replace(`#asset=${encodeURIComponent(found.row_id)}`)
  }, [asset.data])
  if (asset.error) return <p role="alert">{asset.error.message}</p>
  if (!asset.data) return <p role="status">Finding {tag}…</p>
  if (!asset.data.length) return <section className="asset-page"><h1>{tag}</h1><p>No asset carries this tag yet. Record it in the count, or check the number.</p></section>
  return <p role="status">Opening {tag}…</p>
}
