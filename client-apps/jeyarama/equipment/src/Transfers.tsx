import { Button, fmtInstantIST } from '@featherbase/shop-floor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, listAll, myId, runAction, save } from './api'
import { withinPlace } from './countRules'
import { nameOf, useAssets, useEntities, usePeople, usePlaces } from './data'
import { placePath } from './jobRules'
import { FINAL_LINE_STATES, TRANSFER_KINDS, isOpenTransfer, receiptClock } from './transferRules'

export interface Transfer {
  row_id: string; updated_at: string; transfer_kind: string; from_place: string; to_place: string; vendor: string | null; to_entity: string | null
  reason: string; expected_receipt_at: string | null; transfer_state: string; approver: string | null; approved_at: string | null
  transporter: string | null; dispatched_at: string | null; received_at: string | null
  finance_reference: string | null; finance_confirmed_at: string | null; finance_confirmed_by: string | null; created_by: string; created_at: string
}
export interface TransferLine { row_id: string; updated_at: string; transfer: string; asset: string; line_state: string; dispatched_at: string | null; received_at: string | null; note: string | null }

const TRANSFER_FIELDS = ['row_id', 'updated_at', 'transfer_kind', 'from_place', 'to_place', 'vendor', 'to_entity', 'reason', 'expected_receipt_at', 'transfer_state',
  'approver', 'approved_at', 'transporter', 'dispatched_at', 'received_at', 'finance_reference', 'finance_confirmed_at', 'finance_confirmed_by', 'created_by', 'created_at']
const LINE_FIELDS = ['row_id', 'updated_at', 'transfer', 'asset', 'line_state', 'dispatched_at', 'received_at', 'note']

export const useTransfers = () => useQuery({ queryKey: ['assets', 'transfers'], queryFn: () => listAll<Transfer>('equipment.transfer', { fields: TRANSFER_FIELDS, order_by: 'created_at desc' }) })
export const useTransferLines = () => useQuery({ queryKey: ['assets', 'transfer-lines'], queryFn: () => listAll<TransferLine>('equipment.transfer_line', { fields: LINE_FIELDS }) })
const useManagers = () => useQuery({ queryKey: ['assets', 'managers'],
  queryFn: () => api.get<{ data: { row_id: string; full_name: string }[] }>('/api/table_members/equipment.count_expected').then(result => result.data) })

const isManager = (roles: string[]) => roles.some(role => role === 'Assets Manager' || role === 'System Manager')
const message = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback

function useRunner() {
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(step: () => Promise<unknown>, fallback: string) {
    setBusy(true); setError('')
    try {
      await step()
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
      return true
    } catch (err) { setError(message(err, fallback)); return false }
    finally { setBusy(false) }
  }
  return { error, busy, run }
}

function Clock({ transfer }: { transfer: Transfer }) {
  const clock = receiptClock(transfer, new Date())
  return <span className={`transfer-clock is-${clock.tone}`}>{clock.label}</span>
}

export function TransfersPage({ roles }: { roles: string[] }) {
  const managerView = isManager(roles)
  const transfers = useTransfers()
  const lines = useTransferLines()
  const places = usePlaces()
  const assets = useAssets()
  const entities = useEntities()
  const me = myId()
  const { error, busy, run } = useRunner()
  const [kind, setKind] = useState<string>('Between sites')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [vendor, setVendor] = useState('')
  const [toEntity, setToEntity] = useState('')
  const [reason, setReason] = useState('')
  const [receiveBy, setReceiveBy] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const allPlaces = places.data ?? []
  const placeOptions = allPlaces.map(p => ({ id: p.row_id, label: placePath(p.row_id, allPlaces) })).sort((a, b) => a.label.localeCompare(b.label))
  const allLines = lines.data ?? []
  const onOpen = new Set(allLines.filter(l => !(FINAL_LINE_STATES as readonly string[]).includes(l.line_state)
    && isOpenTransfer(transfers.data?.find(t => t.row_id === l.transfer)?.transfer_state ?? '')).map(l => l.asset))
  const candidates = from ? (assets.data ?? []).filter(a => withinPlace(a.place, from, allPlaces) && !onOpen.has(a.row_id) && a.custody_status !== 'In transit') : []
  const itemsOf = (transfer: string) => allLines.filter(l => l.transfer === transfer)

  async function request(event: React.FormEvent) {
    event.preventDefault()
    const done = await run(async () => {
      const transfer = await save<Transfer>('equipment.transfer', {
        transfer_kind: kind, from_place: from, to_place: to, reason: reason.trim(),
        ...(kind === 'Repair with vendor' ? { vendor: vendor.trim() } : {}), ...(kind === 'Between companies' ? { to_entity: toEntity } : {}),
        ...(receiveBy ? { expected_receipt_at: new Date(`${receiveBy}T23:59:00+05:30`).toISOString() } : {}),
      })
      try {
        for (const asset of chosen) await save('equipment.transfer_line', { transfer: transfer.row_id, asset })
      } catch (err) {
        await save('equipment.transfer', { row_id: transfer.row_id, updated_at: transfer.updated_at, transfer_state: 'Cancelled' })
        throw err
      }
    }, 'Could not request the transfer')
    if (done) { setReason(''); setVendor(''); setToEntity(''); setReceiveBy(''); setChosen([]) }
  }

  const decide = (t: Transfer, transfer_state: string) =>
    run(() => save('equipment.transfer', { row_id: t.row_id, updated_at: t.updated_at, transfer_state }), 'Could not save the decision')

  return <section aria-labelledby="transfers-heading" className="transfers">
    <div className="assets-heading"><h1 id="transfers-heading">Transfers</h1></div>
    {error && <p role="alert" className="counts-error">{error}</p>}
    <div className="assets-table-wrap">
      <table className="assets-table" aria-label="Transfers">
        <thead><tr><th scope="col">Transfer</th><th scope="col">Kind</th><th scope="col">From → To</th><th scope="col">Items</th><th scope="col">Reason</th><th scope="col">Stage</th><th scope="col">Receipt</th><th scope="col">Next</th></tr></thead>
        <tbody>
          {(transfers.data ?? []).map(t => <tr key={t.row_id}>
            <td><a href={`#transfer=${encodeURIComponent(t.row_id)}`}>{t.row_id}</a></td>
            <td>{t.transfer_kind}</td>
            <td>{placePath(t.from_place, allPlaces)} → {t.transfer_kind === 'Repair with vendor' && t.vendor ? `${t.vendor} → ` : ''}{placePath(t.to_place, allPlaces)}</td>
            <td>{itemsOf(t.row_id).length}</td>
            <td>{t.reason}</td>
            <td><span className="transfer-stage">{t.transfer_state}</span></td>
            <td><Clock transfer={t} /></td>
            <td><div className="counts-actions">
              {t.transfer_state === 'Requested' && (t.created_by === me
                ? <span className="asset-muted">Waiting for another manager</span>
                : managerView && <>
                  <Button type="button" variant="primary" disabled={busy} onClick={() => void decide(t, 'Approved')}>Approve</Button>
                  <Button type="button" disabled={busy} onClick={() => void decide(t, 'Rejected')}>Reject</Button>
                </>)}
              {managerView && t.transfer_state === 'Approved' && <a href={`#transfer=${encodeURIComponent(t.row_id)}`}>Dispatch</a>}
              {managerView && t.transfer_state === 'Dispatched' && <a href={`#transfer=${encodeURIComponent(t.row_id)}`}>Receive</a>}
              {t.transfer_state === 'Received' && t.transfer_kind === 'Between companies' && !t.finance_confirmed_at && <span className="transfer-finance">Needs Finance and tax approval</span>}
            </div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {!transfers.data?.length && transfers.data && <p className="asset-muted">No transfers yet.</p>}

    {managerView && <section aria-labelledby="request-transfer" className="asset-report counts-plan">
      <h2 id="request-transfer">Request a transfer</h2>
      <form onSubmit={event => void request(event)}>
        <label>Kind<select aria-label="Kind" value={kind} onChange={event => setKind(event.target.value)}>
          {TRANSFER_KINDS.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label>From<select aria-label="From" value={from} onChange={event => { setFrom(event.target.value); setChosen([]) }}>
          <option value="">Choose where it leaves</option>
          {placeOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select></label>
        <label>To<select aria-label="To" value={to} onChange={event => setTo(event.target.value)}>
          <option value="">Choose where it goes</option>
          {placeOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select></label>
        {kind === 'Repair with vendor' && <label>Vendor<input value={vendor} onChange={event => setVendor(event.target.value)} /></label>}
        {kind === 'Between companies' && <>
          <label>New owner<select aria-label="New owner" value={toEntity} onChange={event => setToEntity(event.target.value)}>
            <option value="">Choose the company</option>
            {(entities.data ?? []).map(e => <option key={e.row_id} value={e.row_id}>{e.short_name || e.entity_name}</option>)}
          </select></label>
          <p className="transfer-finance">Needs Finance and tax approval. Ownership changes only after Finance confirms the SAP transaction.</p>
        </>}
        <label>Reason<input value={reason} onChange={event => setReason(event.target.value)} /></label>
        <label>Expected receipt date<input type="date" value={receiveBy} onChange={event => setReceiveBy(event.target.value)} /></label>
        <p className="asset-muted">Left blank, it is a day after dispatch within a site and three days otherwise.</p>
        <fieldset>
          <legend>Items</legend>
          {candidates.map(a => <label key={a.row_id} className="asset-radio">
            <input type="checkbox" checked={chosen.includes(a.row_id)} onChange={() => setChosen(chosen.includes(a.row_id) ? chosen.filter(x => x !== a.row_id) : [...chosen, a.row_id])} /> {a.asset_name}
          </label>)}
          {from && !candidates.length && <p className="asset-muted">Nothing here can be moved.</p>}
          {!from && <p className="asset-muted">Choose where it leaves to see its assets.</p>}
        </fieldset>
        <Button type="submit" variant="primary" disabled={busy || !from || !to || !reason.trim() || !chosen.length}>Request transfer</Button>
      </form>
    </section>}
  </section>
}

/** A tag from a QR label, or the bare asset ID. */
function tagToAsset(tag: string): string {
  const trimmed = tag.trim()
  const match = /asset=([^&\s]+)/.exec(trimmed)
  return match ? decodeURIComponent(match[1]) : trimmed
}

export function TransferPage({ id, roles }: { id: string; roles: string[] }) {
  const managerView = isManager(roles)
  const transfers = useTransfers()
  const lines = useTransferLines()
  const places = usePlaces()
  const assets = useAssets()
  const entities = useEntities()
  const people = usePeople()
  const managers = useManagers()
  const me = myId()
  const { error, busy, run } = useRunner()
  const [transporter, setTransporter] = useState('')
  const [tag, setTag] = useState('')
  const [scanned, setScanned] = useState<string[]>([])
  const [outcomes, setOutcomes] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [sapReference, setSapReference] = useState('')
  const t = transfers.data?.find(x => x.row_id === id)
  if (!transfers.data) return <p role="status">Loading transfer…</p>
  if (!t) return <p role="alert">This transfer is not in the register.</p>
  const allPlaces = places.data ?? []
  const items = (lines.data ?? []).filter(l => l.transfer === id)
  const assetName = (asset: string) => nameOf(assets.data, asset, 'asset_name')
  const personName = (person: string | null) => person ? nameOf([...(people.data ?? []), ...(managers.data ?? [])], person, 'full_name') : '—'
  const entityName = (entity: string | null) => { const e = entities.data?.find(x => x.row_id === entity); return e ? e.short_name || e.entity_name : '—' }

  return <article className="transfer-page">
    <p><a href="#transfers">← All transfers</a></p>
    <h1>{t.row_id} · {t.transfer_kind}</h1>
    <p className="transfer-route">{placePath(t.from_place, allPlaces)} → {t.vendor ? `${t.vendor} → ` : ''}{placePath(t.to_place, allPlaces)} · <span className="transfer-stage">{t.transfer_state}</span></p>
    {error && t.transfer_state !== 'Approved' && <p role="alert" className="counts-error">{error}</p>}
    <dl className="transfer-facts">
      <dt>Reason</dt><dd>{t.reason}</dd>
      <dt>Requested by</dt><dd>{personName(t.created_by)} · {fmtInstantIST(t.created_at)}</dd>
      <dt>Approved by</dt><dd>{t.approver ? `${personName(t.approver)} · ${t.approved_at ? fmtInstantIST(t.approved_at) : ''}` : '—'}</dd>
      <dt>Transporter or vendor</dt><dd>{t.transporter ?? '—'}</dd>
      <dt>Dispatched</dt><dd>{t.dispatched_at ? fmtInstantIST(t.dispatched_at) : '—'}</dd>
      {t.to_entity && <><dt>New owner</dt><dd>{entityName(t.to_entity)}</dd></>}
    </dl>
    {t.expected_receipt_at && <p className="transfer-due">Receive by {fmtInstantIST(t.expected_receipt_at)} · <Clock transfer={t} /></p>}

    <section aria-labelledby="transfer-items" className="asset-jobs">
      <h2 id="transfer-items">Items</h2>
      <ul>{items.map(l => <li key={l.row_id}><a href={`#asset=${encodeURIComponent(l.asset)}`}>{assetName(l.asset)}</a> · {l.line_state}
        {l.received_at && <span className="asset-muted"> · {fmtInstantIST(l.received_at)}</span>}{l.note && <span className="asset-muted"> · {l.note}</span>}</li>)}</ul>
    </section>

    {managerView && t.transfer_state === 'Approved' && <section aria-labelledby="dispatch" className="asset-report counts-plan">
      <h2 id="dispatch">Dispatch</h2>
      <p className="asset-muted">Scan each item out. Custody becomes {t.transfer_kind === 'Repair with vendor' ? 'With vendor' : 'In transit'}; the place changes only when it is received.</p>
      <label>Transporter or vendor<input value={transporter} onChange={event => setTransporter(event.target.value)} placeholder="Vehicle number, transporter or vendor" /></label>
      <form className="transfer-scan" onSubmit={event => {
        event.preventDefault()
        const asset = tagToAsset(tag)
        if (asset && !scanned.includes(asset)) setScanned([...scanned, asset])
        setTag('')
      }}>
        <label>Scan tag<input value={tag} onChange={event => setTag(event.target.value)} placeholder="Scan the QR label or type the asset ID" /></label>
        <Button type="submit" disabled={!tag.trim()}>Add</Button>
      </form>
      <ul aria-label="Scanned" className="transfer-scanned">
        {scanned.map(asset => <li key={asset}>{assetName(asset)}{items.some(l => l.asset === asset) ? '' : ' · not on this transfer'}</li>)}
      </ul>
      <p className="asset-muted">{scanned.filter(a => items.some(l => l.asset === a)).length} of {items.length} scanned</p>
      {error && <p role="alert">{error}</p>}
      <Button type="button" variant="primary" disabled={busy || !transporter.trim()}
        onClick={() => void run(() => runAction('dispatch_transfer', { transfer: t.row_id, transporter, scanned }), 'Could not dispatch')}>Dispatch</Button>
    </section>}

    {managerView && t.transfer_state === 'Dispatched' && <section aria-labelledby="receive" className="asset-report counts-plan">
      <h2 id="receive">Receive</h2>
      <p className="asset-muted">Receive each item as it arrives. A refused item goes back to where it left.</p>
      <ul className="transfer-receive">
        {items.map(l => {
          const name = assetName(l.asset)
          return <li key={l.row_id} aria-label={name}>
            <b>{name}</b> <span className="asset-muted">{l.line_state}</span>
            {l.line_state === 'Dispatched' && <span className="counts-actions">
              <select aria-label={`Outcome for ${name}`} value={outcomes[l.row_id] ?? ''} onChange={event => setOutcomes({ ...outcomes, [l.row_id]: event.target.value })}>
                <option value="">How did it arrive?</option>
                <option>Received good</option><option>Received damaged</option><option value="Refused">Refuse and send back</option>
              </select>
              <input aria-label={`Note for ${name}`} placeholder="Note" value={notes[l.row_id] ?? ''} onChange={event => setNotes({ ...notes, [l.row_id]: event.target.value })} />
              <Button type="button" variant="primary" disabled={busy || !outcomes[l.row_id]}
                onClick={() => void run(() => runAction('receive_line', { line: l.row_id, outcome: outcomes[l.row_id], note: notes[l.row_id] ?? '' }), 'Could not receive')}>Receive</Button>
            </span>}
            {l.line_state === 'Refused' && <Button type="button" disabled={busy}
              onClick={() => void run(() => runAction('receive_line', { line: l.row_id, outcome: 'Returned to source' }), 'Could not send it back')}>Back at {placePath(t.from_place, allPlaces)}</Button>}
          </li>
        })}
      </ul>
    </section>}

    {t.transfer_kind === 'Between companies' && <section aria-labelledby="finance" className="asset-report counts-plan transfer-finance-box">
      <h2 id="finance">Finance confirmation</h2>
      <p className="transfer-finance">Needs Finance and tax approval. Ownership moves to {entityName(t.to_entity)} only after Finance confirms the SAP transaction; no scan changes it.</p>
      {t.finance_confirmed_at
        ? <p role="status">Finance confirmed {t.finance_reference} on {fmtInstantIST(t.finance_confirmed_at)} · recorded by {personName(t.finance_confirmed_by)}</p>
        : t.transfer_state !== 'Received' ? <p className="asset-muted">Recorded once every item is received.</p>
        : t.created_by === me ? <p className="asset-muted">Someone other than the requester records it.</p>
        : managerView && <form onSubmit={event => { event.preventDefault(); void run(() => runAction('confirm_finance', { transfer: t.row_id, sap_reference: sapReference }), 'Could not record the confirmation') }}>
          <label>SAP transaction reference<input value={sapReference} onChange={event => setSapReference(event.target.value)} placeholder="ABUMN document number" /></label>
          <Button type="submit" variant="primary" disabled={busy || !sapReference.trim()}>Confirm Finance</Button>
        </form>}
    </section>}
  </article>
}
