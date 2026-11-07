import { Button, fmtDate, fmtInstantIST } from '@featherbase/shop-floor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { listAll, myId, runAction, save, uploadAssetPhoto } from './api'
import { withinPlace } from './countRules'
import type { Count } from './Counts'
import { nameOf, useClasses, useLines, usePeople, usePlaces, useTypes, type CountLine, type Place } from './data'
import { placePath } from './jobRules'
import { GROUP_OWNED, TAG_STATUSES } from './tagRules'

interface AreaClose { row_id: string; area: string; close_day: string; labels_used: number; tagged_lines: number; other_lines: number; spoiled: number; signed_by: string; signed_at: string }
interface TagEvent { row_id: string; tag_no: string; event_kind: string; area: string | null; count: string | null; created_at: string }

const OWNERSHIP = ['Group owned', 'Leased', 'Vendor or brand supplied', 'Bank owned', 'Landlord owned']
const CONDITIONS = ['Working', 'Needs repair', 'Idle', 'Damaged']
const USAGE = ['In use', 'Idle', 'In store room', 'Not working']
/** Today in IST, the platform's display zone. */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const istDay = (instant: string | null | undefined) => instant ? new Date(Date.parse(instant) + 330 * 60_000).toISOString().slice(0, 10) : ''

function siteOf(id: string, places: Place[]): Place | undefined {
  let place = places.find(p => p.row_id === id)
  for (let hops = 0; place?.parent_place && hops < 10; hops++) place = places.find(p => p.row_id === place!.parent_place)
  return place
}
const blank = { tag_status: 'Tagged', tag_no: '', asset_type: '', asset_name: '', make: '', model: '', serial_no: '', condition: 'Working', usage: 'In use',
  ownership: GROUP_OWNED, owner_name: '', custodian: '', quantity: '1', tagged_by: '' }

/** A fresh, blind count: one line per item by area, two initials, and the site manager's daily area close. */
export function FreshCount({ count }: { count: Count & { freeze_from?: string | null; freeze_to?: string | null } }) {
  const queryClient = useQueryClient()
  const places = usePlaces()
  const types = useTypes()
  const classes = useClasses()
  const people = usePeople()
  const allLines = useLines()
  const counters = useQuery({ queryKey: ['assets', 'counters', count.row_id], queryFn: () => listAll<{ person: string }>('equipment.counter', { fields: ['person'], filters: [['count', '=', count.row_id]] }) })
  const closes = useQuery({ queryKey: ['assets', 'area-closes', count.row_id], queryFn: () => listAll<AreaClose>('equipment.area_close', {
    fields: ['row_id', 'area', 'close_day', 'labels_used', 'tagged_lines', 'other_lines', 'spoiled', 'signed_by', 'signed_at'], filters: [['count', '=', count.row_id]], order_by: 'signed_at desc' }) })
  const events = useQuery({ queryKey: ['assets', 'count-tag-events', count.row_id], queryFn: () => listAll<TagEvent>('equipment.tag_event', {
    fields: ['row_id', 'tag_no', 'event_kind', 'area', 'count', 'created_at'], filters: [['count', '=', count.row_id]] }) })
  const me = myId()
  const [area, setArea] = useState('')
  const [line, setLine] = useState(blank)
  const [photo, setPhoto] = useState<File | null>(null)
  const [spoiled, setSpoiled] = useState({ tag_no: '', reason: '' })
  const [labelsUsed, setLabelsUsed] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const allPlaces = places.data ?? []
  const areas = allPlaces.filter(place => place.row_id !== count.scope_place && withinPlace(place.row_id, count.scope_place, allPlaces))
    .map(place => ({ id: place.row_id, label: `${place.area_code ? `${place.area_code} · ` : ''}${placePath(place.row_id, allPlaces)}` })).sort((a, b) => a.label.localeCompare(b.label))
  const team = (counters.data ?? []).map(c => c.person)
  const site = siteOf(count.scope_place, allPlaces)
  const siteManager = site?.site_manager === me
  const counting = count.count_state === 'Counting'
  const person = (id: string | null | undefined) => nameOf(people.data, id, 'full_name')
  const lines = (allLines.data ?? []).filter(line => line.count === count.row_id)
  const areaLines = lines.filter(asset => asset.place === area)
  const today = istToday()
  const todayLines = areaLines.filter(asset => istDay(asset.counted_at) === today)
  const todaySpoiled = (events.data ?? []).filter(e => e.area === area && e.event_kind !== 'Reprinted' && istDay(e.created_at) === today).length
  const closedToday = (closes.data ?? []).some(c => c.area === area && String(c.close_day).slice(0, 10) === today)
  const type = (types.data ?? []).find(t => t.row_id === line.asset_type)
  const areaPlace = allPlaces.find(p => p.row_id === area)

  async function run(work: () => Promise<unknown>, reset: () => void) {
    setBusy(true); setError('')
    try { await work(); reset(); await queryClient.invalidateQueries({ queryKey: ['assets'] }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save') }
    finally { setBusy(false) }
  }
  const set = (field: keyof typeof blank) => (value: string) => setLine({ ...line, [field]: value })

  return <article className="count-page fresh-count">
    <h1>{count.count_name}</h1>
    <p className="asset-sub">{placePath(count.scope_place, allPlaces)} · fresh, blind count · {count.count_state}
      {count.freeze_from && count.freeze_to ? ` · movement freeze ${fmtDate(String(count.freeze_from).slice(0, 10))} to ${fmtDate(String(count.freeze_to).slice(0, 10))}` : ''}</p>
    <p className="asset-muted">Count without the SAP list. One person tags and photographs, the other records; both initial every line. Finance decides later.</p>
    {error && <p role="alert" className="counts-error">{error}</p>}
    <label className="fresh-area">Area<select aria-label="Area" value={area} onChange={event => { setArea(event.target.value); setLabelsUsed('') }}>
      <option value="">Choose the area you are counting</option>
      {areas.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
    </select></label>
    {areaPlace && <p className="asset-muted">Area custodian: {person(areaPlace.area_custodian) || 'not named'}{closedToday ? ' · closed for today' : ''}</p>}

    {area && counting && team.includes(me) && !closedToday && <form aria-label="Count line" className="asset-report fresh-line" onSubmit={event => {
      event.preventDefault()
      void run(async () => {
        const photoUrl = photo ? await uploadAssetPhoto(photo) : null
        await save('equipment.count_line', {
          count: count.row_id, place: area, tag_status: line.tag_status, tag_no: line.tag_status === 'Tagged' ? line.tag_no.trim().toUpperCase() : null,
          asset_type: line.asset_type, asset_name: line.asset_name.trim(), make: line.make.trim() || null, model: line.model.trim() || null, serial_no: line.serial_no.trim() || null,
          condition: line.condition, usage: line.usage, ownership: line.ownership, owner_name: line.ownership === GROUP_OWNED ? null : line.owner_name.trim(),
          custodian: line.custodian || null, quantity: Number(line.quantity || 1), tagged_by: line.tagged_by, photo: photoUrl,
        })
      }, () => { setLine({ ...blank, tagged_by: line.tagged_by, asset_type: line.asset_type }); setPhoto(null) })
    }}>
      <h2>Record a line</h2>
      <label>Tag status<select aria-label="Tag status" value={line.tag_status} onChange={e => set('tag_status')(e.target.value)}>{TAG_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
      {line.tag_status === 'Tagged' && <label>Tag<input aria-label="Tag" value={line.tag_no} onChange={e => set('tag_no')(e.target.value)} placeholder="JRA-000123" autoFocus /></label>}
      <label>Asset type<select aria-label="Asset type" value={line.asset_type} onChange={e => set('asset_type')(e.target.value)}>
        <option value="">Choose the type</option>{(types.data ?? []).map(t => <option key={t.row_id} value={t.row_id}>{t.type_name}</option>)}</select></label>
      {type && <p className="asset-muted fresh-hint">{nameOf(classes.data, type.asset_class, 'class_name') || 'No class yet'} · sticker: {type.sticker ?? 'Standard PET'}{type.counting_note ? ` · ${type.counting_note}` : ''}</p>}
      <label>Description<input aria-label="Description" value={line.asset_name} onChange={e => set('asset_name')(e.target.value)} placeholder="3-door upright chiller" /></label>
      <label>Make<input aria-label="Make" value={line.make} onChange={e => set('make')(e.target.value)} /></label>
      <label>Model<input aria-label="Model" value={line.model} onChange={e => set('model')(e.target.value)} /></label>
      <label>Serial<input aria-label="Serial" value={line.serial_no} onChange={e => set('serial_no')(e.target.value)} /></label>
      <label>Condition<select aria-label="Condition" value={line.condition} onChange={e => set('condition')(e.target.value)}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Usage<select aria-label="Usage" value={line.usage} onChange={e => set('usage')(e.target.value)}>{USAGE.map(u => <option key={u}>{u}</option>)}</select></label>
      <label>Ownership<select aria-label="Ownership" value={line.ownership} onChange={e => set('ownership')(e.target.value)}>{OWNERSHIP.map(o => <option key={o}>{o}</option>)}</select></label>
      {line.ownership !== GROUP_OWNED && <label>Owner’s name<input aria-label="Owner’s name" value={line.owner_name} onChange={e => set('owner_name')(e.target.value)} placeholder="Amul" /></label>}
      {line.tag_status === 'Bulk count, no tag' && <label>Quantity<input aria-label="Quantity" type="number" min="1" value={line.quantity} onChange={e => set('quantity')(e.target.value)} /></label>}
      <label>Custodian<select aria-label="Custodian" value={line.custodian} onChange={e => set('custodian')(e.target.value)}>
        <option value="">Not named</option>{(people.data ?? []).map(p => <option key={p.row_id} value={p.row_id}>{p.full_name}</option>)}</select></label>
      <label>Photo (tag and make plate)<input aria-label="Photo" type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /></label>
      <label>Tagged by<select aria-label="Tagged by" value={line.tagged_by} onChange={e => set('tagged_by')(e.target.value)}>
        <option value="">Your team mate</option>{team.filter(p => p !== me).map(p => <option key={p} value={p}>{person(p)}</option>)}</select></label>
      <p className="asset-muted fresh-hint">Recorded by you, {person(me) || 'you'}. Both initials go on the line.</p>
      <Button type="submit" variant="primary" disabled={busy || !line.asset_type || !line.asset_name.trim() || !line.tagged_by}>Record line</Button>
    </form>}

    {area && counting && team.includes(me) && !closedToday && <form aria-label="Spoiled label" className="asset-report tags-form" onSubmit={e => {
      e.preventDefault()
      void run(() => save('equipment.tag_event', { tag_no: spoiled.tag_no.trim().toUpperCase(), event_kind: 'Spoiled', reason: spoiled.reason.trim(), area, count: count.row_id }), () => setSpoiled({ tag_no: '', reason: '' }))
    }}>
      <label>Spoiled or skipped label<input aria-label="Spoiled tag" value={spoiled.tag_no} onChange={e => setSpoiled({ ...spoiled, tag_no: e.target.value })} placeholder="JRA-000124" /></label>
      <label>Reason<input aria-label="Spoiled reason" value={spoiled.reason} onChange={e => setSpoiled({ ...spoiled, reason: e.target.value })} placeholder="Torn while peeling" /></label>
      <Button type="submit" disabled={busy || !spoiled.tag_no.trim() || !spoiled.reason.trim()}>Log spoiled label</Button>
    </form>}

    {area && <section aria-label="Lines in this area">
      <h2>Lines in {areaPlace?.area_code ?? areaPlace?.place_name}</h2>
      <div className="assets-table-wrap"><table className="assets-table" aria-label="Count lines">
        <thead><tr><th scope="col">Tag</th><th scope="col">Type</th><th scope="col">Description</th><th scope="col">Make · model · serial</th><th scope="col">Condition</th><th scope="col">Ownership</th><th scope="col">Initials</th></tr></thead>
        <tbody>{areaLines.map((a: CountLine) => <tr key={a.row_id}>
          <td>{a.tag_no ?? a.tag_status}{a.tag_status === 'Bulk count, no tag' ? ` · ${a.quantity}` : ''}</td>
          <td>{nameOf(types.data, a.asset_type, 'type_name')}</td><td>{a.asset ? <a href={`#asset=${encodeURIComponent(a.asset)}`}>{a.asset_name}</a> : a.asset_name}</td>
          <td>{[a.make, a.model, a.serial_no].filter(Boolean).join(' · ') || '—'}</td><td>{a.condition}</td>
          <td>{a.ownership}{a.owner_name ? ` · ${a.owner_name}` : ''}</td><td>Tagged {person(a.tagged_by)} · recorded {person(a.recorded_by)}</td>
        </tr>)}</tbody>
      </table></div>
      {!areaLines.length && <p className="asset-muted">No lines in this area yet.</p>}

      <section aria-label="Close the area" className="asset-report fresh-close">
        <h2>Close {areaPlace?.area_code ?? 'the area'} for today</h2>
        <p>Today: {todayLines.filter(a => a.tag_status === 'Tagged').length} tagged lines, {todayLines.filter(a => a.tag_status !== 'Tagged').length} lines without a group tag, {todaySpoiled} spoiled labels.</p>
        {closedToday ? <p className="asset-muted">Signed for today.</p> : siteManager
          ? <form aria-label="Sign the area" onSubmit={e => { e.preventDefault(); void run(() => save('equipment.area_close', { count: count.row_id, area, labels_used: Number(labelsUsed) }), () => setLabelsUsed('')) }}>
            <label>Labels used from the roll<input aria-label="Labels used" type="number" min="0" value={labelsUsed} onChange={e => setLabelsUsed(e.target.value)} /></label>
            <Button type="submit" variant="primary" disabled={busy || labelsUsed === ''}>Sign as site manager</Button>
          </form>
          : <p className="asset-muted">The site manager, {person(site?.site_manager) || 'not named yet'}, signs here once the labels used are counted.</p>}
        <ul aria-label="Area closes">{(closes.data ?? []).filter(c => c.area === area).map(c => <li key={c.row_id}>
          {fmtDate(String(c.close_day).slice(0, 10))} · {c.tagged_lines} tagged, {c.other_lines} other, {c.spoiled} spoiled, {c.labels_used} labels used · signed by {person(c.signed_by)} {fmtInstantIST(c.signed_at)}
        </li>)}</ul>
      </section>
    </section>}
    <Recount count={count} lines={lines} team={team} person={person} onChanged={() => queryClient.invalidateQueries({ queryKey: ['assets'] })} />
  </article>
}

/** The independent recount: someone outside the team checks each sampled line; the pilot lead then loads the register. */
function Recount({ count, lines, team, person, onChanged }: { count: Count; lines: CountLine[]; team: string[]; person: (id: string | null | undefined) => string; onChanged: () => Promise<unknown> }) {
  const me = myId()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const sampled = lines.filter(line => line.for_recount)
  const wrong = sampled.filter(line => line.recount_result && line.recount_result !== 'Found as counted').length
  const done = sampled.filter(line => line.recount_result).length
  const independent = !team.includes(me)
  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await work(); await onChanged() } catch (err) { setError(err instanceof Error ? err.message : 'Could not save') } finally { setBusy(false) }
  }
  return <section aria-label="Independent recount" className="asset-report">
    <h2>Independent recount</h2>
    {error && <p role="alert" className="counts-error">{error}</p>}
    {!sampled.length ? <>
      <p className="asset-muted">Every line over Finance’s value threshold and a sample of the rest, checked by someone outside the count team.</p>
      <Button type="button" disabled={busy} onClick={() => void run(() => runAction('start_recount', { count: count.row_id }))}>Start independent recount</Button>
    </> : <>
      <p className="recount-error-rate">Error rate: <strong>{done ? Math.round((wrong / done) * 100) : 0}%</strong> ({wrong} of {done} recounted lines not found or different; {sampled.length - done} still to check)</p>
      <div className="assets-table-wrap"><table className="assets-table" aria-label="Recount sample">
        <thead><tr><th scope="col">Tag</th><th scope="col">Description</th><th scope="col">Result</th></tr></thead>
        <tbody>{sampled.map(line => <tr key={line.row_id}>
          <th scope="row">{line.tag_no}</th><td>{line.asset_name}{line.serial_no ? ` · S/N ${line.serial_no}` : ''}</td>
          <td>{independent
            ? <select aria-label={`Recount ${line.tag_no}`} disabled={busy} value={line.recount_result ?? ''} onChange={e => void run(() => save('equipment.count_line', { row_id: line.row_id, updated_at: line.updated_at, recount_result: e.target.value }))}>
              <option value="" disabled>Not checked yet</option>{['Found as counted', 'Found, details differ', 'Not found'].map(r => <option key={r}>{r}</option>)}</select>
            : line.recount_result ?? 'Not checked yet'}{line.recounted_by ? ` · ${person(line.recounted_by)}` : ''}</td>
        </tr>)}</tbody>
      </table></div>
      {!independent && <p className="asset-muted">You are on the count team, so someone else records the recount.</p>}
    </>}
    <h2>Load the register (phase 7)</h2>
    <p className="asset-muted">After SAP is updated, the group’s lines become register assets with their tags and SAP numbers. Third-party items stay out. {lines.filter(l => l.asset).length} of {lines.length} lines loaded.</p>
    <Button type="button" disabled={busy} onClick={() => void run(() => runAction('load_register', { count: count.row_id }))}>Load lines into the register</Button>
  </section>
}
