import { Button, fmtDate, fmtExact, fmtINR } from '@featherbase/shop-floor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { listAll, myId, runAction, save } from './api'
import { inSite, nameOf, sitesOf, useLines, usePeople, usePlaces, type Place } from './data'
import { reconciliation, sapStatus } from './tagRules'

interface SapRecord { row_id: string; plant: string; sap_company_code: string | null; sap_asset_no: string; sap_asset_sub: string | null; description: string; sap_class_code: string | null
  capitalized_on: string | null; book_value: string | null; quantity: number | null; serial_no: string | null; old_tag: string | null; invoice_ref: string | null; location_text: string | null; cost_centre: string | null }
interface SapMatch { row_id: string; updated_at: string; sap_book: string; line: string; method: string; second_checker: string | null; checked: boolean; matched_by: string }
export interface CountException { row_id: string; updated_at: string; outcome: string; line: string | null; sap_asset_no: string | null; detail: string; owner: string | null; due_on: string | null
  approval_ref: string | null; exception_state: string; raised_by: string; approved_by: string | null }
interface FinancePerson { row_id: string; person: string; finance_role: string }

const METHODS = ['Serial number', 'Old tag', 'Invoice or PO', 'Description, place and date']
const OUTCOMES = ['Matched', 'In books, not found', 'Found, not in books', 'Wrong location or cost centre', 'Damaged or idle', 'Duplicate SAP records']
const BOOK_COLUMNS = ['sap_asset_no', 'sap_asset_sub', 'description', 'sap_class_code', 'capitalized_on', 'book_value', 'quantity', 'serial_no', 'old_tag', 'invoice_ref', 'location_text', 'cost_centre'] as const

const useBook = () => useQuery({ queryKey: ['assets', 'sap-book'], queryFn: () => listAll<SapRecord>('equipment.sap_book', { fields: ['row_id', 'plant', 'sap_company_code', ...BOOK_COLUMNS], order_by: 'sap_asset_no asc' }) })
const useMatches = () => useQuery({ queryKey: ['assets', 'sap-matches'], queryFn: () => listAll<SapMatch>('equipment.sap_match', { fields: ['row_id', 'updated_at', 'sap_book', 'line', 'method', 'second_checker', 'checked', 'matched_by'] }) })
export const useExceptions = () => useQuery({ queryKey: ['assets', 'exceptions'], queryFn: () => listAll<CountException>('equipment.exception', {
  fields: ['row_id', 'updated_at', 'outcome', 'line', 'sap_asset_no', 'detail', 'owner', 'due_on', 'approval_ref', 'exception_state', 'raised_by', 'approved_by'], order_by: 'created_at desc' }) })
export const useFinancePeople = () => useQuery({ queryKey: ['assets', 'finance-people'], queryFn: () => listAll<FinancePerson>('equipment.finance_person', { fields: ['row_id', 'person', 'finance_role'] }) })

/** A pasted cell as a calendar day: 12-03-2023, 12/03/2023 or 2023-03-12. */
function day(value: string) {
  const text = value.trim()
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text)
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}
const amount = (value: string) => { const n = Number(value.replace(/[₹,\s]/g, '')); return Number.isFinite(n) && value.trim() ? n : null }
const recordNo = (r: SapRecord) => `${r.sap_asset_no}-${r.sap_asset_sub ?? '0'}`

/** The asset accountant's page: the plant's SAP book, matching by method, and the reconciliation. */
export function SapPage() {
  const queryClient = useQueryClient()
  const places = usePlaces()
  const assets = useLines()
  const book = useBook()
  const matches = useMatches()
  const exceptions = useExceptions()
  const finance = useFinancePeople()
  const people = usePeople()
  const me = myId()
  const plants = sitesOf(places.data).filter(site => site.sap_plant)
  const [plant, setPlant] = useState('')
  const [paste, setPaste] = useState('')
  const [matching, setMatching] = useState<{ record: string; tags: string; method: string; checker: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (book.error) return <section className="sap-page"><h1>SAP matching</h1><p role="alert">Only an asset accountant opens the SAP book: {book.error.message}</p></section>

  const site = plants.find(p => p.sap_plant === plant) ?? plants[0]
  const plantCode = plant || site?.sap_plant || ''
  const records = (book.data ?? []).filter(r => r.plant === plantCode)
  const siteAssets = (assets.data ?? []).filter(a => site && inSite(a.place, site.row_id, places.data))
  const assetById = new Map((assets.data ?? []).map(a => [a.row_id, a]))
  const plantOf = (assetId: string) => {
    const asset = assetById.get(assetId)
    const owner = (places.data ?? []).find(p => p.place_level === 'Site' && inSite(asset?.place, p.row_id, places.data)) as Place | undefined
    return owner?.sap_plant ?? null
  }
  const recordMatches = (id: string) => (matches.data ?? []).filter(m => m.sap_book === id)
  const figures = reconciliation({
    book: records.map(r => ({ row_id: r.row_id, book_value: r.book_value, quantity: r.quantity })),
    matches: (matches.data ?? []).filter(m => records.some(r => r.row_id === m.sap_book)).map(m => ({ sap_book: m.sap_book, asset: m.line })),
    assets: siteAssets.map(a => ({ row_id: a.row_id, tag_status: a.tag_status ?? null })),
    exceptions: exceptions.data ?? [],
  })
  const accountants = (finance.data ?? []).filter(f => f.finance_role === 'Asset accountant' && f.person !== me)
  const toCheck = (matches.data ?? []).filter(m => m.second_checker === me && !m.checked)

  async function run(work: () => Promise<unknown>, reset: () => void) {
    setBusy(true); setError('')
    try { await work(); reset(); await queryClient.invalidateQueries({ queryKey: ['assets'] }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save') }
    finally { setBusy(false) }
  }
  async function load() {
    const rows = paste.split('\n').map(line => line.split('\t')).filter(cells => cells.length >= 3 && cells[0].trim())
    for (const cells of rows) {
      const value = (index: number) => (cells[index] ?? '').trim()
      await save('equipment.sap_book', { plant: plantCode, sap_company_code: null, sap_asset_no: value(0), sap_asset_sub: value(1) || '0', description: value(2), sap_class_code: value(3) || null,
        capitalized_on: day(value(4)), book_value: amount(value(5)), quantity: Number(value(6)) || 1, serial_no: value(7) || null, old_tag: value(8) || null,
        invoice_ref: value(9) || null, location_text: value(10) || null, cost_centre: value(11) || null })
    }
  }
  async function match() {
    const wanted = matching!.tags.split(/[\s,]+/).map(tag => tag.trim().toUpperCase()).filter(Boolean)
    const ids = wanted.map(tag => {
      const asset = (assets.data ?? []).find(a => a.tag_no === tag)
      if (!asset) throw new Error(`${tag} is not on a count line; check the tag number`)
      return asset.row_id
    })
    await runAction('match_sap', { sap_book: matching!.record, lines: ids, method: matching!.method, second_checker: matching!.checker || null })
  }

  return <section aria-labelledby="sap-heading" className="sap-page">
    <div className="assets-heading"><h1 id="sap-heading">SAP matching</h1>
      <p className="asset-sub">Held only by the asset accountant. Match in order: serial, old tag, invoice or PO, then description with a second person checking.</p></div>
    {error && <p role="alert" className="counts-error">{error}</p>}
    <label>Plant<select aria-label="Plant" value={plantCode} onChange={e => setPlant(e.target.value)}>
      {plants.map(p => <option key={p.row_id} value={p.sap_plant!}>{p.sap_plant} · {p.place_name}</option>)}</select></label>

    <div role="group" aria-label="Reconciliation" className="sap-figures">
      <div><span>Book match rate</span><strong>{figures.matchRate}%</strong></div>
      <div data-tone={figures.valueNotFound ? 'bad' : undefined}><span>Value not yet found</span><strong>{fmtINR(figures.valueNotFound)}</strong></div>
      <div><span>Found, not in books</span><strong>{figures.foundNotInBooks}</strong></div>
      <div><span>Tag coverage</span><strong>{figures.tagCoverage}%</strong></div>
      <div data-tone={figures.openExceptions ? 'warn' : undefined}><span>Open exceptions</span><strong>{figures.openExceptions}</strong></div>
    </div>

    {toCheck.length > 0 && <section aria-label="Matches for you to check" className="asset-report">
      <h2>Matches for you to check</h2>
      {toCheck.map(m => <p key={m.row_id}>{assetById.get(m.line)?.tag_no} to {recordNo((book.data ?? []).find(r => r.row_id === m.sap_book)!)} by {nameOf(people.data, m.matched_by, 'full_name')} ·
        <Button type="button" onClick={() => void run(() => save('equipment.sap_match', { row_id: m.row_id, updated_at: m.updated_at, checked: true }), () => {})}>Confirm check</Button></p>)}
    </section>}

    <div className="assets-table-wrap"><table className="assets-table" aria-label="SAP book">
      <thead><tr><th scope="col">SAP no.</th><th scope="col">Book record</th><th scope="col">Book value</th><th scope="col">Qty</th><th scope="col">Tags · method</th><th scope="col">Status</th><th scope="col" /></tr></thead>
      <tbody>{records.map(r => {
        const found = recordMatches(r.row_id)
        const status = sapStatus({ quantity: r.quantity, plant: r.plant }, found.map(m => ({ plant: plantOf(m.line) })))
        return <tr key={r.row_id}>
          <th scope="row">{recordNo(r)}</th>
          <td>{r.description}{r.capitalized_on ? ` · cap. ${fmtDate(String(r.capitalized_on).slice(0, 10))}` : ''}{r.serial_no ? ` · S/N ${r.serial_no}` : ''}</td>
          <td>{r.book_value ? fmtExact(Number(r.book_value)) : '—'}</td><td>{r.quantity ?? 1}</td>
          <td>{found.map(m => `${assetById.get(m.line)?.tag_no ?? m.line} · ${m.method}${m.second_checker ? (m.checked ? ', checked' : ', check pending') : ''}`).join('; ') || '—'}</td>
          <td><span className="sap-status" data-status={status.startsWith('Found ') ? 'partial' : status}>{status}</span></td>
          <td><Button type="button" onClick={() => setMatching({ record: r.row_id, tags: '', method: 'Serial number', checker: '' })}>Match tags</Button></td>
        </tr>
      })}</tbody>
    </table></div>
    {!records.length && <p className="asset-muted">No SAP records for this plant yet. Paste the extract below.</p>}

    {matching && <form aria-label="Match tags" className="asset-report tags-form" onSubmit={e => { e.preventDefault(); void run(match, () => setMatching(null)) }}>
      <h2>Match {recordNo(records.find(r => r.row_id === matching.record)!)}</h2>
      <label>Tags<input aria-label="Tags" value={matching.tags} onChange={e => setMatching({ ...matching, tags: e.target.value })} placeholder="JRA-000123, JRA-000124" /></label>
      <label>Method<select aria-label="Method" value={matching.method} onChange={e => setMatching({ ...matching, method: e.target.value })}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
      {matching.method === 'Description, place and date' && <label>Second person checks<select aria-label="Second person checks" value={matching.checker} onChange={e => setMatching({ ...matching, checker: e.target.value })}>
        <option value="">Choose who checks</option>{accountants.map(f => <option key={f.person} value={f.person}>{nameOf(people.data, f.person, 'full_name')}</option>)}</select></label>}
      <Button type="submit" variant="primary" disabled={busy || !matching.tags.trim()}>Match</Button>
      <Button type="button" onClick={() => setMatching(null)}>Never mind</Button>
    </form>}

    <form aria-label="Paste the SAP extract" className="asset-report" onSubmit={e => { e.preventDefault(); void run(load, () => setPaste('')) }}>
      <h2>Paste the SAP extract for plant {plantCode}</h2>
      <p className="asset-muted">Copy the rows from Excel, in this column order: asset number, sub-number, description, class code, capitalized on, book value, quantity, serial, old tag, invoice or PO, location, cost centre.</p>
      <textarea aria-label="SAP extract rows" rows={5} value={paste} onChange={e => setPaste(e.target.value)} />
      <Button type="submit" variant="primary" disabled={busy || !paste.trim() || !plantCode}>Load rows</Button>
    </form>
  </section>
}

/** Every difference with its owner, due date, approval reference and state; approved only by an independent Finance Controller. */
export function ExceptionsPage({ roles }: { roles: string[] }) {
  const queryClient = useQueryClient()
  const exceptions = useExceptions()
  const assets = useLines()
  const people = usePeople()
  const me = myId()
  const controller = roles.includes('Assets Finance Controller')
  const [draft, setDraft] = useState({ outcome: 'In books, not found', tag: '', sap_asset_no: '', detail: '', owner: '', due_on: '' })
  const [refs, setRefs] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (exceptions.error) return <section><h1>Exceptions</h1><p role="alert">{exceptions.error.message}</p></section>
  const person = (id: string | null) => nameOf(people.data, id, 'full_name')

  async function run(work: () => Promise<unknown>, reset: () => void) {
    setBusy(true); setError('')
    try { await work(); reset(); await queryClient.invalidateQueries({ queryKey: ['assets'] }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save') }
    finally { setBusy(false) }
  }
  return <section aria-labelledby="exceptions-heading" className="exceptions-page">
    <div className="assets-heading"><h1 id="exceptions-heading">Exceptions</h1>
      <p className="asset-sub">Nobody approves their own work: the count team never matches, and the asset accountant never approves a write-off.</p></div>
    {error && <p role="alert" className="counts-error">{error}</p>}
    <div className="assets-table-wrap"><table className="assets-table" aria-label="Exceptions log">
      <thead><tr><th scope="col">Difference</th><th scope="col">Outcome</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Approval</th><th scope="col">State</th><th scope="col" /></tr></thead>
      <tbody>{(exceptions.data ?? []).map(x => <tr key={x.row_id}>
        <th scope="row">{[x.line ? assets.data?.find(a => a.row_id === x.line)?.tag_no ?? '' : '', x.sap_asset_no].filter(Boolean).join(' · ')}{x.line || x.sap_asset_no ? ' — ' : ''}{x.detail}</th>
        <td>{x.outcome}</td><td>{person(x.owner) || '—'}</td><td>{x.due_on ? fmtDate(String(x.due_on).slice(0, 10)) : '—'}</td>
        <td>{x.approval_ref ?? '—'}{x.approved_by ? ` · ${person(x.approved_by)}` : ''}</td>
        <td><span className="sap-status" data-status={x.exception_state}>{x.exception_state}</span></td>
        <td>
          {controller && x.exception_state === 'Open' && x.raised_by !== me && <form aria-label={`Approve ${x.detail}`} className="exception-approve" onSubmit={e => {
            e.preventDefault(); void run(() => save('equipment.exception', { row_id: x.row_id, updated_at: x.updated_at, exception_state: 'Approved', approval_ref: (refs[x.row_id] ?? '').trim() }), () => {})
          }}>
            <input aria-label="Approval reference" value={refs[x.row_id] ?? ''} onChange={e => setRefs({ ...refs, [x.row_id]: e.target.value })} placeholder="FC/ATK/007" />
            <Button type="submit" variant="primary" disabled={busy}>Approve</Button>
          </form>}
          {x.exception_state !== 'Closed' && (x.owner === me || controller || roles.includes('Assets Accountant')) && x.exception_state === 'Approved' &&
            <Button type="button" onClick={() => void run(() => save('equipment.exception', { row_id: x.row_id, updated_at: x.updated_at, exception_state: 'Closed' }), () => {})}>Close</Button>}
        </td>
      </tr>)}</tbody>
    </table></div>
    {!exceptions.data?.length && <p className="asset-muted">No exceptions yet.</p>}

    <form aria-label="Raise an exception" className="asset-report tags-form" onSubmit={e => {
      e.preventDefault()
      const asset = draft.tag.trim() ? (assets.data ?? []).find(a => a.tag_no === draft.tag.trim().toUpperCase()) : undefined
      void run(async () => {
        if (draft.tag.trim() && !asset) throw new Error(`${draft.tag.trim().toUpperCase()} is not on a count line`)
        await save('equipment.exception', { outcome: draft.outcome, line: asset?.row_id ?? null, sap_asset_no: draft.sap_asset_no.trim() || null, detail: draft.detail.trim(),
          owner: draft.owner || null, due_on: draft.due_on || null })
      }, () => setDraft({ outcome: 'In books, not found', tag: '', sap_asset_no: '', detail: '', owner: '', due_on: '' }))
    }}>
      <h2>Raise an exception</h2>
      <label>Outcome<select aria-label="Outcome" value={draft.outcome} onChange={e => setDraft({ ...draft, outcome: e.target.value })}>{OUTCOMES.map(o => <option key={o}>{o}</option>)}</select></label>
      <label>Tag<input aria-label="Exception tag" value={draft.tag} onChange={e => setDraft({ ...draft, tag: e.target.value })} placeholder="JRA-000412" /></label>
      <label>SAP record<input aria-label="SAP record" value={draft.sap_asset_no} onChange={e => setDraft({ ...draft, sap_asset_no: e.target.value })} placeholder="200081-0" /></label>
      <label>Difference<input aria-label="Difference" value={draft.detail} onChange={e => setDraft({ ...draft, detail: e.target.value })} placeholder="EAS gate pair not found in any area" /></label>
      <label>Owner<select aria-label="Exception owner" value={draft.owner} onChange={e => setDraft({ ...draft, owner: e.target.value })}>
        <option value="">Choose the owner</option>{(people.data ?? []).map(p => <option key={p.row_id} value={p.row_id}>{p.full_name}</option>)}</select></label>
      <label>Due on<input aria-label="Due on" type="date" value={draft.due_on} onChange={e => setDraft({ ...draft, due_on: e.target.value })} /></label>
      <Button type="submit" variant="primary" disabled={busy || !draft.detail.trim()}>Raise exception</Button>
    </form>
  </section>
}
