import { Button, fmtDate, fmtInstantIST } from '@featherbase/shop-floor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, listAll, myId, runAction, save } from './api'
import { MISSING_DECISIONS, OUTCOMES, UNLISTED_DECISIONS, reviewLines, withinPlace } from './countRules'
import { nameOf, useAssets, usePeople, usePlaces, type Place } from './data'
import { placePath } from './jobRules'

export interface Count {
  row_id: string; updated_at: string; count_name: string; scope_place: string; count_kind: string; sample_size: number | null
  starts_on: string | null; ends_on: string | null; reviewer: string; count_state: string; snapshot_at: string | null; expected_total: number | null; closed_at: string | null
}
interface Counter { row_id: string; count: string; person: string }
interface Scan { row_id: string; count: string; asset: string | null; outcome: string; area: string; description: string | null; reason: string | null; manual: boolean; duplicate: boolean; created_by: string; created_at: string }
interface Decision { row_id: string; updated_at: string; count: string; asset: string | null; scan: string | null; decision: string }

const COUNT_FIELDS = ['row_id', 'updated_at', 'count_name', 'scope_place', 'count_kind', 'sample_size', 'starts_on', 'ends_on', 'reviewer', 'count_state', 'snapshot_at', 'expected_total', 'closed_at']
const SCAN_FIELDS = ['row_id', 'count', 'asset', 'outcome', 'area', 'description', 'reason', 'manual', 'duplicate', 'created_by', 'created_at']

export const useCounts = () => useQuery({ queryKey: ['assets', 'counts'], queryFn: () => listAll<Count>('equipment.count', { fields: COUNT_FIELDS, order_by: 'created_at desc' }) })
const useCounters = () => useQuery({ queryKey: ['assets', 'counters'], queryFn: () => listAll<Counter>('equipment.counter', { fields: ['row_id', 'count', 'person'] }) })
const useManagers = (enabled: boolean) => useQuery({ queryKey: ['assets', 'managers'], enabled,
  queryFn: () => api.get<{ data: { row_id: string; full_name: string }[] }>('/api/table_members/equipment.count_expected').then(result => result.data) })
const useScans = (count: string) => useQuery({ queryKey: ['assets', 'scans', count], queryFn: () => listAll<Scan>('equipment.scan', { fields: SCAN_FIELDS, filters: [['count', '=', count]], order_by: 'created_at asc' }) })
const useDecisions = (count: string) => useQuery({ queryKey: ['assets', 'decisions', count],
  queryFn: () => listAll<Decision>('equipment.count_decision', { fields: ['row_id', 'updated_at', 'count', 'asset', 'scan', 'decision'], filters: [['count', '=', count]] }) })

const isManager = (roles: string[]) => roles.some(role => role === 'Assets Manager' || role === 'System Manager')

function stageText(count: Count) {
  return count.count_state === 'Counting' ? `Counting · ${count.expected_total ?? 0} expected` : count.count_state
}

/** Places a count may record in: the counted place and everything inside it. */
function countAreas(count: Count, places: Place[]) {
  return places.filter(place => withinPlace(place.row_id, count.scope_place, places))
    .map(place => ({ id: place.row_id, label: placePath(place.row_id, places) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function CountsPage({ roles }: { roles: string[] }) {
  const queryClient = useQueryClient()
  const counts = useCounts()
  const counters = useCounters()
  const places = usePlaces()
  const people = usePeople()
  const managerView = isManager(roles)
  const managers = useManagers(managerView)
  const me = myId()
  const [name, setName] = useState('')
  const [scope, setScope] = useState('')
  const [kind, setKind] = useState('Full')
  const [sampleSize, setSampleSize] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [reviewer, setReviewer] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const allPlaces = places.data ?? []
  const countersOf = (count: string) => (counters.data ?? []).filter(c => c.count === count).map(c => c.person)
  const shown = (counts.data ?? []).filter(count => managerView || count.reviewer === me || countersOf(count.row_id).includes(me))

  async function plan(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const count = await save<Count>('equipment.count', {
        count_name: name.trim(), scope_place: scope, count_kind: kind, reviewer,
        ...(kind === 'Sample' ? { sample_size: Number(sampleSize) } : {}), ...(startsOn ? { starts_on: startsOn } : {}), ...(endsOn ? { ends_on: endsOn } : {}),
      })
      for (const person of chosen) await save('equipment.counter', { count: count.row_id, person })
      setName(''); setScope(''); setKind('Full'); setSampleSize(''); setStartsOn(''); setEndsOn(''); setReviewer(''); setChosen([])
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not plan the count') }
    finally { setBusy(false) }
  }

  async function start(count: Count) {
    setError('')
    try {
      await runAction('start_count', { row_id: count.row_id, updated_at: count.updated_at })
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not start the count') }
  }

  return <section aria-labelledby="counts-heading" className="counts">
    <div className="assets-heading"><h1 id="counts-heading">Verification counts</h1></div>
    {error && <p role="alert" className="counts-error">{error}</p>}
    <div className="assets-table-wrap">
      <table className="assets-table" aria-label="Counts">
        <thead><tr><th scope="col">Count</th><th scope="col">Place</th><th scope="col">Kind</th><th scope="col">Dates</th><th scope="col">Stage</th><th scope="col">Open</th></tr></thead>
        <tbody>
          {shown.map(count => <tr key={count.row_id}>
            <td>{count.count_name}</td>
            <td>{placePath(count.scope_place, allPlaces)}</td>
            <td>{count.count_kind}{count.count_kind === 'Sample' && count.sample_size ? ` · ${count.sample_size}` : ''}</td>
            <td>{[count.starts_on, count.ends_on].filter(Boolean).map(day => fmtDate(String(day).slice(0, 10))).join(' to ') || '—'}</td>
            <td>{stageText(count)}</td>
            <td className="counts-actions">
              {managerView && count.count_state === 'Planned' && <Button type="button" variant="primary" onClick={() => void start(count)}>Start count</Button>}
              {countersOf(count.row_id).includes(me) && count.count_state !== 'Planned' && <a href={`#count=${encodeURIComponent(count.row_id)}`}>Record items</a>}
              {(managerView || count.reviewer === me) && count.count_state !== 'Planned' && <a href={`#review=${encodeURIComponent(count.row_id)}`}>Review</a>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {!shown.length && counts.data && <p className="asset-muted">No counts yet.</p>}

    {managerView && <section aria-labelledby="plan-count" className="asset-report counts-plan">
      <h2 id="plan-count">Plan a count</h2>
      <form onSubmit={event => void plan(event)}>
        <label>Count name<input value={name} onChange={event => setName(event.target.value)} placeholder="ATK full count, Nov 2026" /></label>
        <label>Place to count<select value={scope} onChange={event => setScope(event.target.value)}>
          <option value="">Choose a site or area</option>
          {allPlaces.map(place => ({ id: place.row_id, label: placePath(place.row_id, allPlaces) })).sort((a, b) => a.label.localeCompare(b.label))
            .map(place => <option key={place.id} value={place.id}>{place.label}</option>)}
        </select></label>
        <label>Kind<select value={kind} onChange={event => setKind(event.target.value)}>
          {['Full', 'Sample', 'Targeted', 'Custodian self-check'].map(value => <option key={value}>{value}</option>)}
        </select></label>
        {kind === 'Sample' && <label>Sample size<input type="number" min="1" value={sampleSize} onChange={event => setSampleSize(event.target.value)} /></label>}
        <div className="counts-dates">
          <label>Starts on<input type="date" value={startsOn} onChange={event => setStartsOn(event.target.value)} /></label>
          <label>Ends on<input type="date" value={endsOn} onChange={event => setEndsOn(event.target.value)} /></label>
        </div>
        <label>Reviewer<select value={reviewer} onChange={event => { setReviewer(event.target.value); setChosen(chosen.filter(person => person !== event.target.value)) }}>
          <option value="">Choose an Assets Manager</option>
          {(managers.data ?? []).map(person => <option key={person.row_id} value={person.row_id}>{person.full_name}</option>)}
        </select></label>
        <fieldset>
          <legend>Counters</legend>
          {(people.data ?? []).filter(person => person.row_id !== reviewer).map(person => <label key={person.row_id} className="asset-radio">
            <input type="checkbox" checked={chosen.includes(person.row_id)} onChange={() => setChosen(chosen.includes(person.row_id) ? chosen.filter(p => p !== person.row_id) : [...chosen, person.row_id])} /> {person.full_name}
          </label>)}
        </fieldset>
        <Button type="submit" variant="primary" disabled={busy || !name.trim() || !scope || !reviewer}>Plan count</Button>
      </form>
    </section>}
  </section>
}

/** What a counter sees: their areas and their own numbers, never the expected list. */
export function CountPage({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const count = useQuery({ queryKey: ['assets', 'count', id], queryFn: () => api.get<Count>(`/api/table/equipment.count/${encodeURIComponent(id)}`) })
  const places = usePlaces()
  const assets = useAssets()
  const scans = useScans(id)
  const decisions = useDecisions(id)
  const me = myId()
  const [area, setArea] = useState('')
  const [tag, setTag] = useState('')
  const [typed, setTyped] = useState(false)
  const [why, setWhy] = useState('')
  const [outcome, setOutcome] = useState<string>('Found here')
  const [condition, setCondition] = useState('')
  const [description, setDescription] = useState('')
  const [newTag, setNewTag] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (count.error) return <p role="alert">{count.error.message}</p>
  if (!count.data) return <p role="status">Loading count…</p>
  const c = count.data
  const allPlaces = places.data ?? []
  const areas = countAreas(c, allPlaces)
  const areaLabel = areas.find(a => a.id === area)?.label ?? ''
  const mineHere = (scans.data ?? []).filter(scan => scan.created_by === me && scan.area === area).length
  const recount = (decisions.data ?? []).filter(d => d.decision === 'Recount' && d.asset)

  async function record(row: Record<string, unknown>, reset: () => void) {
    setBusy(true); setError('')
    try {
      await save('equipment.scan', { count: id, area, ...row })
      reset()
      await queryClient.invalidateQueries({ queryKey: ['assets', 'scans', id] })
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not record the item') }
    finally { setBusy(false) }
  }

  const recording = c.count_state === 'Counting' || c.count_state === 'In review'
  return <article className="count-page">
    <h1>{c.count_name}</h1>
    <p className="asset-sub">{placePath(c.scope_place, allPlaces)} · {c.count_kind} count · {c.count_state}</p>
    {c.count_state === 'Planned' && <p>This count hasn’t started yet.</p>}
    {c.count_state === 'Closed' && <p>This count is closed.</p>}
    {c.count_state === 'In review' && <section aria-labelledby="recount-heading" className="asset-jobs">
      <h2 id="recount-heading">Sent back for recount</h2>
      {recount.length ? <ul>{recount.map(d => <li key={d.row_id}>{d.asset} · {nameOf(assets.data, d.asset, 'asset_name')}</li>)}</ul>
        : <p className="asset-muted">Nothing to recount.</p>}
    </section>}
    {recording && <>
      <label className="count-area">Area<select value={area} onChange={event => setArea(event.target.value)}>
        <option value="">Choose where you are</option>
        {areas.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select></label>
      {area && <p role="status" className="count-progress">You have recorded {mineHere} {mineHere === 1 ? 'item' : 'items'} in {areaLabel}</p>}
      {error && <p role="alert" className="counts-error">{error}</p>}
      <section aria-labelledby="record-heading" className="asset-report">
        <h2 id="record-heading">Record a tagged item</h2>
        <form onSubmit={event => {
          event.preventDefault()
          void record({ outcome, ...(condition ? { condition } : {}), ...(typed ? { typed_tag: tag.trim(), reason: why.trim() } : { asset: tag.trim() }) },
            () => { setTag(''); setTyped(false); setWhy(''); setCondition('') })
        }}>
          <label>Tag<input value={tag} onChange={event => setTag(event.target.value)} placeholder="AST-0001" autoComplete="off" /></label>
          <label className="asset-radio"><input type="checkbox" checked={typed} onChange={event => setTyped(event.target.checked)} /> Typed by hand</label>
          {typed && <label>Why typed?<input value={why} onChange={event => setWhy(event.target.value)} placeholder="Label torn" /></label>}
          <label>Outcome<select value={outcome} onChange={event => setOutcome(event.target.value)}>
            {OUTCOMES.map(value => <option key={value} value={value}>{value === 'Belongs elsewhere' ? 'Found, but belongs elsewhere' : value}</option>)}
          </select></label>
          <label>Condition (optional)<select value={condition} onChange={event => setCondition(event.target.value)}>
            <option value="">Not noted</option>
            {['Working', 'Needs repair', 'Damaged'].map(value => <option key={value}>{value}</option>)}
          </select></label>
          <Button type="submit" variant="primary" disabled={busy || !area || !tag.trim()}>Record</Button>
        </form>
      </section>
      <section aria-labelledby="unlisted-heading" className="asset-report">
        <h2 id="unlisted-heading">Not on the list</h2>
        <p className="asset-muted">An item here with no tag, or one the register doesn’t know.</p>
        <form onSubmit={event => {
          event.preventDefault()
          void record({ outcome: 'Not on the list', description: description.trim(), reason: reason.trim(), ...(newTag.trim() ? { new_tag: newTag.trim() } : {}) },
            () => { setDescription(''); setNewTag(''); setReason('') })
        }}>
          <label>Description<input value={description} onChange={event => setDescription(event.target.value)} placeholder="Blue plastic crate stand" /></label>
          <label>New tag stuck<input value={newTag} onChange={event => setNewTag(event.target.value)} placeholder="Tag number, if you stuck one" /></label>
          <label>Reason<input value={reason} onChange={event => setReason(event.target.value)} placeholder="No tag found" /></label>
          <Button type="submit" disabled={busy || !area}>Record item not on the list</Button>
        </form>
      </section>
    </>}
  </article>
}

const OUTCOME_ROWS: [string, keyof ReturnType<typeof reviewLines>['counts']][] = [
  ['Found here', 'found'], ['Damaged', 'damaged'], ['Idle', 'idle'], ['Found elsewhere', 'elsewhere'],
  ['Missing', 'missing'], ['Moved since the start', 'moved'], ['Not on the list', 'unlisted'], ['Duplicate', 'duplicate'],
]

/** The reviewer's page: every outcome, recount, decisions, close. */
export function ReviewPage({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const count = useQuery({ queryKey: ['assets', 'count', id], queryFn: () => api.get<Count>(`/api/table/equipment.count/${encodeURIComponent(id)}`) })
  const expected = useQuery({ queryKey: ['assets', 'expected', id],
    queryFn: () => listAll<{ asset: string; expected_place: string | null }>('equipment.count_expected', { fields: ['asset', 'expected_place'], filters: [['count', '=', id]] }) })
  const scans = useScans(id)
  const decisions = useDecisions(id)
  const assets = useAssets()
  const places = usePlaces()
  const people = usePeople()
  const [error, setError] = useState('')

  if (count.error) return <p role="alert">{count.error.message}</p>
  if (expected.error) return <p role="alert">Only an Assets Manager can review a count: {expected.error.message}</p>
  if (!count.data || !expected.data || !scans.data || !decisions.data || !assets.data) return <p role="status">Loading review…</p>
  const c = count.data
  const allPlaces = places.data ?? []
  const review = reviewLines({
    expected: expected.data,
    scans: scans.data.map(s => ({ row_id: s.row_id, asset: s.asset, outcome: s.outcome, duplicate: Boolean(s.duplicate) })),
    placeNow: new Map(assets.data.map(a => [a.row_id, a.place])),
    decisions: decisions.data,
  })
  const scanById = new Map(scans.data.map(s => [s.row_id, s]))
  const decisionFor = (key: { asset?: string; scan?: string }) => decisions.data!.find(d => (key.asset ? d.asset === key.asset : d.scan === key.scan))
  const assetName = (asset: string | null) => nameOf(assets.data, asset, 'asset_name')
  const deciding = c.count_state === 'In review'

  async function refresh() { await queryClient.invalidateQueries({ queryKey: ['assets'] }) }
  async function setStage(stage: string) {
    setError('')
    try { await save('equipment.count', { row_id: c.row_id, updated_at: c.updated_at, count_state: stage }); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not change the count') }
  }
  async function decide(key: { asset?: string; scan?: string }, decision: string) {
    setError('')
    const existing = decisionFor(key)
    try {
      const saved = await save<Decision>('equipment.count_decision', existing ? { row_id: existing.row_id, updated_at: existing.updated_at, decision } : { count: c.row_id, ...key, decision })
      // Known at once, so a quick second change updates this decision instead of adding another.
      queryClient.setQueryData<Decision[]>(['assets', 'decisions', id], (rows = []) => [...rows.filter(row => row.row_id !== saved.row_id), saved])
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the decision') }
  }

  const unlistedLabel = (scanId: string) => {
    const scan = scanById.get(scanId)!
    return scan.asset ? `${assetName(scan.asset)} (${scan.asset}, registered elsewhere)` : scan.description ?? scanId
  }

  return <article className="review-page">
    <h1>Review: {c.count_name}</h1>
    <p className="asset-sub">{placePath(c.scope_place, allPlaces)} · {c.count_kind} count · expected list fixed {fmtInstantIST(c.snapshot_at)}</p>
    <p>Stage: <strong>{c.count_state}</strong>{c.closed_at ? ` · closed ${fmtInstantIST(c.closed_at)}` : ''}</p>
    <div className="review-actions">
      {c.count_state === 'Counting' && <Button type="button" variant="primary" onClick={() => void setStage('In review')}>Move to review</Button>}
      {c.count_state === 'In review' && <Button type="button" variant="primary" onClick={() => void setStage('Closed')}>Close count</Button>}
    </div>
    {error && <p role="alert" className="counts-error">{error}</p>}
    <p className="asset-muted">Decisions change nothing in the register or in SAP. Retirement and capitalization still go through Finance in SAP.</p>

    <div className="assets-table-wrap review-outcomes">
      <table className="assets-table" aria-label="Outcomes">
        <tbody>
          <tr><th scope="row">Expected</th><td>{review.expected}</td></tr>
          {OUTCOME_ROWS.map(([label, key]) => <tr key={key}><th scope="row">{label}</th><td>{review.counts[key]}</td></tr>)}
        </tbody>
      </table>
    </div>

    <section aria-labelledby="missing-heading" className="asset-jobs">
      <h2 id="missing-heading">Missing</h2>
      {review.lines.missing.length ? <ul className="review-lines">{review.lines.missing.map(asset => <li key={asset}>
        <span><strong>{assetName(asset)}</strong> <span className="asset-muted">{asset} · expected in {placePath(expected.data!.find(e => e.asset === asset)?.expected_place ?? '', allPlaces)}</span></span>
        <select aria-label={`Decision for ${assetName(asset)}`} disabled={!deciding} value={decisionFor({ asset })?.decision ?? ''} onChange={event => void decide({ asset }, event.target.value)}>
          <option value="" disabled>Choose a decision</option>
          {MISSING_DECISIONS.map(value => <option key={value}>{value}</option>)}
        </select>
      </li>)}</ul> : <p className="asset-muted">Nothing missing.</p>}
    </section>

    <section aria-labelledby="moved-heading" className="asset-jobs">
      <h2 id="moved-heading">Moved since the start</h2>
      {review.lines.moved.length ? <ul>{review.lines.moved.map(asset => <li key={asset}>
        {assetName(asset)} · now in {placePath(assets.data!.find(a => a.row_id === asset)?.place ?? '', allPlaces)}
      </li>)}</ul> : <p className="asset-muted">Nothing moved.</p>}
    </section>

    <section aria-labelledby="unlisted-review-heading" className="asset-jobs">
      <h2 id="unlisted-review-heading">Not on the list</h2>
      {review.lines.unlisted.length ? <ul className="review-lines">{review.lines.unlisted.map(scanId => <li key={scanId}>
        <span><strong>{unlistedLabel(scanId)}</strong> <span className="asset-muted">
          in {placePath(scanById.get(scanId)!.area, allPlaces)} · {nameOf(people.data, scanById.get(scanId)!.created_by, 'full_name')}{scanById.get(scanId)!.reason ? ` · ${scanById.get(scanId)!.reason}` : ''}
        </span></span>
        <select aria-label={`Decision for ${scanById.get(scanId)!.asset ? assetName(scanById.get(scanId)!.asset) : scanById.get(scanId)!.description ?? scanId}`} disabled={!deciding}
          value={decisionFor({ scan: scanId })?.decision ?? ''} onChange={event => void decide({ scan: scanId }, event.target.value)}>
          <option value="" disabled>Choose a decision</option>
          {UNLISTED_DECISIONS.map(value => <option key={value}>{value}</option>)}
        </select>
      </li>)}</ul> : <p className="asset-muted">Nothing unlisted.</p>}
    </section>

    <section aria-labelledby="found-heading" className="asset-jobs">
      <h2 id="found-heading">Found</h2>
      <ul>
        {([['damaged', 'Damaged'], ['idle', 'Idle'], ['elsewhere', 'Found elsewhere'], ['found', 'Found here']] as const).flatMap(([key, label]) =>
          review.lines[key].map(asset => <li key={`${key}-${asset}`}>{assetName(asset)} · {label}</li>))}
      </ul>
      {review.lines.duplicate.length > 0 && <p className="asset-muted">Duplicates: {review.lines.duplicate.map(scanId => assetName(scanById.get(scanId)?.asset ?? null) || scanId).join(', ')}</p>}
    </section>
  </article>
}

/** The asset page's line: when the asset was last recorded in a count, and how. */
export function LastVerified({ asset }: { asset: string }) {
  const scans = useQuery({ queryKey: ['assets', 'asset-scans', asset],
    queryFn: () => listAll<Scan>('equipment.scan', { fields: SCAN_FIELDS, filters: [['asset', '=', asset]], order_by: 'created_at desc' }) })
  const counts = useCounts()
  const last = scans.data?.[0]
  if (!last) return scans.data ? <p className="asset-muted">Not yet verified in a count.</p> : null
  const countName = counts.data?.find(c => c.row_id === last.count)?.count_name ?? last.count
  return <p className="asset-verified">{`Last verified ${fmtInstantIST(last.created_at).split(' ')[0]} · ${last.outcome} · ${countName}`}</p>
}
