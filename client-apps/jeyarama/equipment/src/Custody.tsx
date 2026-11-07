import { Button, fmtDate, fmtInstantIST } from '@featherbase/shop-floor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { listAll, myId, runAction, save } from './api'
import { nameOf, useAssets, usePeople, usePlaces } from './data'
import { localDay, placePath } from './jobRules'
import { clearanceState } from './transferRules'
import { useTransferLines, useTransfers } from './Transfers'

export interface Custody {
  row_id: string; updated_at: string; asset: string; custodian: string; custodian_kind: string; custody_state: string
  issued_at: string | null; responded_at: string | null; returned_at: string | null; note: string | null
}
interface Clearance { row_id: string; updated_at: string; person: string; reason: string; leaving_date: string; clearance_state: string; note: string | null }

const CUSTODY_FIELDS = ['row_id', 'updated_at', 'asset', 'custodian', 'custodian_kind', 'custody_state', 'issued_at', 'responded_at', 'returned_at', 'note']
export const OPEN_CUSTODY = ['Pending', 'Accepted', 'Not with me', 'Return requested']

export const useCustody = () => useQuery({ queryKey: ['assets', 'custody'], queryFn: () => listAll<Custody>('equipment.custody', { fields: CUSTODY_FIELDS, order_by: 'created_at desc' }) })
const useClearances = (enabled: boolean) => useQuery({ queryKey: ['assets', 'clearances'], enabled,
  queryFn: () => listAll<Clearance>('equipment.clearance', { fields: ['row_id', 'updated_at', 'person', 'reason', 'leaving_date', 'clearance_state', 'note'], order_by: 'leaving_date asc' }) })

export const isManager = (roles: string[]) => roles.some(role => role === 'Assets Manager' || role === 'System Manager')

const MY_STATE: Record<string, string> = {
  Pending: 'Waiting for you', Accepted: 'Accepted', 'Not with me': 'You said it is not with you', 'Return requested': 'Hand-back requested',
}

function message(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

export function CustodyPage({ roles }: { roles: string[] }) {
  const queryClient = useQueryClient()
  const managerView = isManager(roles)
  const custody = useCustody()
  const assets = useAssets()
  const people = usePeople()
  const places = usePlaces()
  const clearances = useClearances(managerView)
  const me = myId()
  const [asset, setAsset] = useState('')
  const [person, setPerson] = useState('')
  const [kind, setKind] = useState('Employee')
  const [leaver, setLeaver] = useState('')
  const [reason, setReason] = useState('Leaving')
  const [leavingDate, setLeavingDate] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const rows = custody.data ?? []
  const open = rows.filter(c => OPEN_CUSTODY.includes(c.custody_state))
  const mine = open.filter(c => c.custodian === me)
  const assetName = (id: string) => nameOf(assets.data, id, 'asset_name')
  const personName = (id: string) => nameOf(people.data, id, 'full_name')
  const held = new Set(open.map(c => c.asset))
  const issuable = (assets.data ?? []).filter(a => !held.has(a.row_id) && a.custody_status !== 'In transit' && a.custody_status !== 'With vendor')

  async function run(step: () => Promise<unknown>, fallback: string) {
    setBusy(true); setError('')
    try {
      await step()
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
    } catch (err) { setError(message(err, fallback)) }
    finally { setBusy(false) }
  }

  const answer = (c: Custody, custody_state: string) => run(() => save('equipment.custody', { row_id: c.row_id, updated_at: c.updated_at, custody_state }), 'Could not save your answer')

  return <section aria-labelledby="custody-heading" className="custody">
    <div className="assets-heading"><h1 id="custody-heading">Custody</h1></div>
    {error && <p role="alert" className="counts-error">{error}</p>}

    <section aria-labelledby="your-assets" className="asset-jobs">
      <h2 id="your-assets">Your assets</h2>
      {mine.length ? <ul className="custody-mine">
        {mine.map(c => <li key={c.row_id} aria-label={assetName(c.asset)}>
          <div><a href={`#asset=${encodeURIComponent(c.asset)}`}>{assetName(c.asset)}</a>
            <span className="asset-muted"> · {c.custodian_kind === 'Location custodian' ? 'as location custodian' : 'issued to you'} · since {c.issued_at ? fmtInstantIST(c.issued_at) : '—'}</span></div>
          <b>{MY_STATE[c.custody_state] ?? c.custody_state}</b>
          <span className="counts-actions">
            {c.custody_state === 'Pending' && <>
              <Button type="button" variant="primary" disabled={busy} onClick={() => void answer(c, 'Accepted')}>Accept</Button>
              <Button type="button" disabled={busy} onClick={() => void answer(c, 'Not with me')}>Not with me</Button>
            </>}
            {c.custody_state === 'Accepted' && <Button type="button" disabled={busy} onClick={() => void answer(c, 'Return requested')}>Hand back</Button>}
          </span>
        </li>)}
      </ul> : <p className="asset-muted">Nothing is in your custody.</p>}
    </section>

    {managerView && <>
      <section aria-labelledby="issue-asset" className="asset-report counts-plan">
        <h2 id="issue-asset">Issue an asset</h2>
        <form onSubmit={event => { event.preventDefault(); void run(async () => {
          await runAction('issue_custody', { asset, person, kind })
          setAsset(''); setPerson('')
        }, 'Could not issue the asset') }}>
          <label>Asset<select aria-label="Asset" value={asset} onChange={event => setAsset(event.target.value)}>
            <option value="">Choose an asset</option>
            {issuable.map(a => <option key={a.row_id} value={a.row_id}>{a.asset_name}</option>)}
          </select></label>
          <label>Person<select aria-label="Person" value={person} onChange={event => setPerson(event.target.value)}>
            <option value="">Choose who holds it</option>
            {(people.data ?? []).map(p => <option key={p.row_id} value={p.row_id}>{p.full_name}</option>)}
          </select></label>
          <label>Issued as<select aria-label="Issued as" value={kind} onChange={event => setKind(event.target.value)}>
            <option value="Employee">Employee (their own equipment)</option>
            <option value="Location custodian">Location custodian (shared equipment)</option>
          </select></label>
          <p className="asset-muted">It stays pending until they accept it or say it is not with them.</p>
          <Button type="submit" variant="primary" disabled={busy || !asset || !person}>Issue</Button>
        </form>
      </section>

      <h2 className="custody-subheading">Who holds what</h2>
      <div className="assets-table-wrap">
        <table className="assets-table" aria-label="Custody">
          <thead><tr><th scope="col">Asset</th><th scope="col">Held by</th><th scope="col">As</th><th scope="col">Where</th><th scope="col">State</th><th scope="col">Since</th><th scope="col">Take back</th></tr></thead>
          <tbody>
            {open.map(c => {
              const a = assets.data?.find(x => x.row_id === c.asset)
              return <tr key={c.row_id} data-state={c.custody_state}>
                <td><a href={`#asset=${encodeURIComponent(c.asset)}`}>{assetName(c.asset)}</a></td>
                <td>{personName(c.custodian)}</td>
                <td>{c.custodian_kind}</td>
                <td>{a ? placePath(a.place, places.data ?? []) : ''}</td>
                <td><span className="custody-state">{c.custody_state}</span></td>
                <td>{c.issued_at ? fmtInstantIST(c.issued_at) : '—'}</td>
                <td><Button type="button" disabled={busy} onClick={() => void run(() => runAction('return_custody', { custody: c.row_id }), 'Could not take the asset back')}>
                  {c.custody_state === 'Return requested' ? 'Accept return' : 'Take back'}</Button></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      {!open.length && custody.data && <p className="asset-muted">No asset is in anyone’s custody.</p>}

      <section aria-labelledby="clearances" className="asset-jobs custody-clearances">
        <h2 id="clearances">Clearances</h2>
        <p className="asset-muted">For people leaving or moving. Each asset they hold is returned or reassigned. After the leaving date, unreturned assets go to HR and Operations. Assets never holds pay.</p>
        <table className="assets-table" aria-label="Clearances">
          <thead><tr><th scope="col">Person</th><th scope="col">Reason</th><th scope="col">Leaving date</th><th scope="col">Assets held</th><th scope="col">Status</th><th scope="col"></th></tr></thead>
          <tbody>
            {(clearances.data ?? []).map(cl => {
              const holding = open.filter(c => c.custodian === cl.person)
              const status = clearanceState(cl, holding.length, localDay())
              return <tr key={cl.row_id}>
                <td>{personName(cl.person)}</td>
                <td>{cl.reason}</td>
                <td>{fmtDate(cl.leaving_date.slice(0, 10))}</td>
                <td>{holding.map(c => assetName(c.asset)).join(', ') || '—'}</td>
                <td><span className={status.startsWith('Escalate') ? 'custody-escalate' : undefined}>{status}</span></td>
                <td>{status === 'Ready to close' && <Button type="button" disabled={busy}
                  onClick={() => void run(() => save('equipment.clearance', { row_id: cl.row_id, updated_at: cl.updated_at, clearance_state: 'Cleared' }), 'Could not clear')}>Mark cleared</Button>}</td>
              </tr>
            })}
          </tbody>
        </table>
        <form className="custody-clearance-form" onSubmit={event => { event.preventDefault(); void run(async () => {
          await save('equipment.clearance', { person: leaver, reason, leaving_date: leavingDate })
          setLeaver(''); setLeavingDate('')
        }, 'Could not open the clearance') }}>
          <label>Person leaving or moving<select aria-label="Person leaving or moving" value={leaver} onChange={event => setLeaver(event.target.value)}>
            <option value="">Choose a person</option>
            {(people.data ?? []).map(p => <option key={p.row_id} value={p.row_id}>{p.full_name}</option>)}
          </select></label>
          <label>Reason<select aria-label="Clearance reason" value={reason} onChange={event => setReason(event.target.value)}>
            <option>Leaving</option><option>Moving</option>
          </select></label>
          <label>Leaving date (from HR)<input type="date" value={leavingDate} onChange={event => setLeavingDate(event.target.value)} /></label>
          <Button type="submit" disabled={busy || !leaver || !leavingDate}>Open clearance</Button>
        </form>
      </section>
    </>}
  </section>
}

/** Every custody and transfer an asset has been through, newest first. */
export function AssetMovements({ asset }: { asset: string }) {
  const custody = useCustody()
  const lines = useTransferLines()
  const transfers = useTransfers()
  const people = usePeople()
  const places = usePlaces()
  const allPlaces = places.data ?? []
  const entries: { at: string; key: string; body: React.ReactNode }[] = []
  for (const c of (custody.data ?? []).filter(c => c.asset === asset)) {
    const who = nameOf(people.data, c.custodian, 'full_name')
    const answer = c.custody_state === 'Returned' ? '' : ` · ${c.custody_state}`
    if (c.issued_at) entries.push({ at: c.issued_at, key: `${c.row_id}-issued`,
      body: <>Issued to {who}{c.custodian_kind === 'Location custodian' ? ' as location custodian' : ''}{answer}</> })
    if (c.returned_at) entries.push({ at: c.returned_at, key: `${c.row_id}-returned`, body: <>Returned by {who}</> })
  }
  for (const line of (lines.data ?? []).filter(l => l.asset === asset)) {
    const t = transfers.data?.find(x => x.row_id === line.transfer)
    if (!t) continue
    entries.push({ at: line.received_at ?? line.dispatched_at ?? t.created_at, key: line.row_id, body: <>
      <a href={`#transfer=${encodeURIComponent(t.row_id)}`}>{t.row_id}</a> {t.transfer_kind}: {placePath(t.from_place, allPlaces)} → {placePath(t.to_place, allPlaces)} · {line.line_state}
    </> })
  }
  entries.sort((a, b) => b.at.localeCompare(a.at))
  return <section aria-labelledby="movements" className="asset-jobs">
    <h2 id="movements">Custody and movements</h2>
    {!custody.data || !lines.data || !transfers.data ? <p role="status">Loading history…</p> : entries.length ? <ul className="asset-movements">
      {entries.map(e => <li key={e.key}><time>{fmtInstantIST(e.at)}</time> <span>{e.body}</span></li>)}
    </ul> : <p className="asset-muted">Never issued or moved.</p>}
  </section>
}
