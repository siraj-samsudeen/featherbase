import { Button, fmtExact } from '@featherbase/shop-floor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { listAll, myId, save } from './api'
import { nameOf, sitesOf, useClasses, usePeople, usePlaces, useTypes } from './data'
import { useFinancePeople } from './Finance'
import { placePath } from './jobRules'

const STICKERS = ['Standard PET', 'Tamper-evident', 'Freezer-grade', 'Metal', 'No sticker']
interface Threshold { row_id: string; updated_at: string; site: string; capital_threshold: string | null; recount_threshold: string | null; recount_percent: number | null }

/** What the pilot lead and Finance set before D1: classes, types, area codes, site managers, Finance people and thresholds. */
export function SetupPage({ roles }: { roles: string[] }) {
  const queryClient = useQueryClient()
  const classes = useClasses()
  const types = useTypes()
  const places = usePlaces()
  const people = usePeople()
  const finance = useFinancePeople()
  const controller = roles.includes('Assets Finance Controller')
  const manager = roles.some(role => role === 'Assets Manager' || role === 'System Manager')
  const canCode = manager || controller || roles.includes('Assets Accountant')
  const thresholds = useQuery({ queryKey: ['assets', 'thresholds'], enabled: controller || manager,
    queryFn: () => listAll<Threshold>('equipment.control_setting', { fields: ['row_id', 'updated_at', 'site', 'capital_threshold', 'recount_threshold', 'recount_percent'] }) })
  const [drafts, setDrafts] = useState<Record<string, Record<string, string | boolean>>>({})
  const [newClass, setNewClass] = useState('')
  const [newType, setNewType] = useState({ type_name: '', asset_class: '', sticker: 'Standard PET' })
  const [newFinance, setNewFinance] = useState({ person: '', finance_role: 'Asset accountant' })
  const [error, setError] = useState('')
  const me = myId()
  const draft = (id: string) => drafts[id] ?? {}
  const edit = (id: string, field: string, value: string | boolean) => setDrafts({ ...drafts, [id]: { ...draft(id), [field]: value } })
  const person = (id: string | null | undefined) => nameOf(people.data, id, 'full_name')
  const peopleOptions = (people.data ?? []).map(p => <option key={p.row_id} value={p.row_id}>{p.full_name}</option>)

  async function run(work: () => Promise<unknown>, reset: () => void = () => {}) {
    setError('')
    try { await work(); reset(); await queryClient.invalidateQueries({ queryKey: ['assets'] }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save') }
  }
  const saveRow = (table: string, row: { row_id: string; updated_at?: string }) => run(() => save(table, { row_id: row.row_id, updated_at: row.updated_at, ...draft(row.row_id) }),
    () => setDrafts({ ...drafts, [row.row_id]: {} }))

  return <section aria-labelledby="setup-heading" className="setup-page">
    <div className="assets-heading"><h1 id="setup-heading">Pilot setup</h1>
      <p className="asset-sub">The pilot lead keeps the lists so every store uses the same ones; Finance adds SAP class codes and thresholds.</p></div>
    {error && <p role="alert" className="counts-error">{error}</p>}

    <h2>Asset classes</h2>
    <div className="assets-table-wrap"><table className="assets-table" aria-label="Asset classes">
      <thead><tr><th scope="col">Class</th><th scope="col">SAP class code</th><th scope="col">Confirmed by Finance</th><th scope="col" /></tr></thead>
      <tbody>{(classes.data ?? []).map(c => <tr key={c.row_id}>
        <th scope="row">{c.class_name}</th>
        <td><input aria-label={`${c.class_name} SAP class code`} disabled={!canCode} value={String(draft(c.row_id).sap_class_code ?? c.sap_class_code ?? '')} onChange={e => edit(c.row_id, 'sap_class_code', e.target.value)} /></td>
        <td><input type="checkbox" aria-label={`${c.class_name} code confirmed`} disabled={!canCode} checked={Boolean(draft(c.row_id).code_confirmed ?? c.code_confirmed)} onChange={e => edit(c.row_id, 'code_confirmed', e.target.checked)} /></td>
        <td>{canCode && <Button type="button" aria-label={`Save ${c.class_name}`} onClick={() => void saveRow('equipment.asset_class', c)}>Save</Button>}</td>
      </tr>)}</tbody>
    </table></div>
    {manager && <form className="tags-form" aria-label="Add a class" onSubmit={e => { e.preventDefault(); void run(() => save('equipment.asset_class', { class_name: newClass.trim() }), () => setNewClass('')) }}>
      <label>New class<input aria-label="New class" value={newClass} onChange={e => setNewClass(e.target.value)} /></label><Button type="submit" disabled={!newClass.trim()}>Add class</Button>
    </form>}

    <h2>Asset types</h2>
    <div className="assets-table-wrap"><table className="assets-table" aria-label="Asset types">
      <thead><tr><th scope="col">Type</th><th scope="col">Class</th><th scope="col">Sticker</th><th scope="col">Counting note</th><th scope="col">Engineering</th><th scope="col" /></tr></thead>
      <tbody>{(types.data ?? []).map(t => <tr key={t.row_id}>
        <th scope="row">{t.type_name}</th>
        <td><select aria-label={`${t.type_name} class`} disabled={!manager} value={String(draft(t.row_id).asset_class ?? t.asset_class ?? '')} onChange={e => edit(t.row_id, 'asset_class', e.target.value)}>
          <option value="">No class</option>{(classes.data ?? []).map(c => <option key={c.row_id} value={c.row_id}>{c.class_name}</option>)}</select></td>
        <td><select aria-label={`${t.type_name} sticker`} disabled={!manager} value={String(draft(t.row_id).sticker ?? t.sticker ?? 'Standard PET')} onChange={e => edit(t.row_id, 'sticker', e.target.value)}>
          {STICKERS.map(s => <option key={s}>{s}</option>)}</select></td>
        <td><input aria-label={`${t.type_name} counting note`} disabled={!manager} value={String(draft(t.row_id).counting_note ?? t.counting_note ?? '')} onChange={e => edit(t.row_id, 'counting_note', e.target.value)} /></td>
        <td><input type="checkbox" aria-label={`${t.type_name} maintained by Engineering`} disabled={!manager} checked={Boolean(draft(t.row_id).engineering_maintained ?? t.engineering_maintained)} onChange={e => edit(t.row_id, 'engineering_maintained', e.target.checked)} /></td>
        <td>{manager && <Button type="button" aria-label={`Save ${t.type_name}`} onClick={() => void saveRow('equipment.asset_type', t)}>Save</Button>}</td>
      </tr>)}</tbody>
    </table></div>
    {manager && <form className="tags-form" aria-label="Add a type" onSubmit={e => { e.preventDefault(); void run(() => save('equipment.asset_type', { ...newType, type_name: newType.type_name.trim(), asset_class: newType.asset_class || null }),
      () => setNewType({ type_name: '', asset_class: '', sticker: 'Standard PET' })) }}>
      <label>New type<input aria-label="New type" value={newType.type_name} onChange={e => setNewType({ ...newType, type_name: e.target.value })} /></label>
      <label>Class<select aria-label="New type class" value={newType.asset_class} onChange={e => setNewType({ ...newType, asset_class: e.target.value })}>
        <option value="">Choose</option>{(classes.data ?? []).map(c => <option key={c.row_id} value={c.row_id}>{c.class_name}</option>)}</select></label>
      <label>Sticker<select aria-label="New type sticker" value={newType.sticker} onChange={e => setNewType({ ...newType, sticker: e.target.value })}>{STICKERS.map(s => <option key={s}>{s}</option>)}</select></label>
      <Button type="submit" disabled={!newType.type_name.trim()}>Add type</Button>
    </form>}

    <h2>Areas and site managers</h2>
    <div className="assets-table-wrap"><table className="assets-table" aria-label="Areas and site managers">
      <thead><tr><th scope="col">Place</th><th scope="col">Area code</th><th scope="col">Area custodian</th><th scope="col">Site manager</th><th scope="col" /></tr></thead>
      <tbody>{(places.data ?? []).filter(p => p.place_level === 'Site' || p.place_level === 'Area').sort((a, b) => placePath(a.row_id, places.data ?? []).localeCompare(placePath(b.row_id, places.data ?? []))).map(p => <tr key={p.row_id}>
        <th scope="row">{placePath(p.row_id, places.data ?? [])}</th>
        <td>{p.place_level === 'Area' ? <input aria-label={`${p.place_name} area code`} disabled={!manager} value={String(draft(p.row_id).area_code ?? p.area_code ?? '')} onChange={e => edit(p.row_id, 'area_code', e.target.value)} /> : '—'}</td>
        <td>{p.place_level === 'Area' ? <select aria-label={`${p.place_name} area custodian`} disabled={!manager} value={String(draft(p.row_id).area_custodian ?? p.area_custodian ?? '')} onChange={e => edit(p.row_id, 'area_custodian', e.target.value)}>
          <option value="">Not named</option>{peopleOptions}</select> : '—'}</td>
        <td>{p.place_level === 'Site' ? <select aria-label={`${p.place_name} site manager`} disabled={!manager} value={String(draft(p.row_id).site_manager ?? p.site_manager ?? '')} onChange={e => edit(p.row_id, 'site_manager', e.target.value)}>
          <option value="">Not named</option>{peopleOptions}</select> : '—'}</td>
        <td>{manager && <Button type="button" aria-label={`Save ${p.place_name}`} onClick={() => void saveRow('equipment.place', p)}>Save</Button>}</td>
      </tr>)}</tbody>
    </table></div>

    <h2>Finance people</h2>
    <p className="asset-muted">Who acts as asset accountant or finance controller; they also need the matching Assets role.</p>
    <ul aria-label="Finance people">{(finance.data ?? []).map(f => <li key={f.row_id}>{person(f.person)} · {f.finance_role}</li>)}</ul>
    {manager && <form className="tags-form" aria-label="Name a Finance person" onSubmit={e => { e.preventDefault(); void run(() => save('equipment.finance_person', newFinance), () => setNewFinance({ person: '', finance_role: 'Asset accountant' })) }}>
      <label>Person<select aria-label="Finance person" value={newFinance.person} onChange={e => setNewFinance({ ...newFinance, person: e.target.value })}><option value="">Choose</option>{peopleOptions}</select></label>
      <label>Acts as<select aria-label="Acts as" value={newFinance.finance_role} onChange={e => setNewFinance({ ...newFinance, finance_role: e.target.value })}>
        <option>Asset accountant</option><option>Finance controller</option></select></label>
      <Button type="submit" disabled={!newFinance.person}>Add</Button>
    </form>}

    {(controller || manager) && <>
      <h2>Finance thresholds</h2>
      <div className="assets-table-wrap"><table className="assets-table" aria-label="Finance thresholds">
        <thead><tr><th scope="col">Site</th><th scope="col">Capital asset from (₹)</th><th scope="col">Always recount from (₹)</th><th scope="col">Recount sample (%)</th><th scope="col" /></tr></thead>
        <tbody>{sitesOf(places.data).map(site => {
          const row = (thresholds.data ?? []).find(t => t.site === site.row_id)
          const key = `threshold:${site.row_id}`
          const value = (field: keyof Threshold) => String(draft(key)[field] ?? row?.[field] ?? '')
          return <tr key={site.row_id}>
            <th scope="row">{site.place_name}</th>
            {(['capital_threshold', 'recount_threshold', 'recount_percent'] as const).map(field => <td key={field}>{controller
              ? <input type="number" min="0" aria-label={`${site.place_name} ${field.replace('_', ' ')}`} value={value(field)} onChange={e => edit(key, field, e.target.value)} />
              : row?.[field] ? (field === 'recount_percent' ? `${row[field]}%` : fmtExact(Number(row[field]))) : '—'}</td>)}
            <td>{controller && <Button type="button" aria-label={`Save thresholds for ${site.place_name}`} onClick={() => void run(() => save('equipment.control_setting', {
              ...(row ? { row_id: row.row_id, updated_at: row.updated_at } : { site: site.row_id }),
              ...Object.fromEntries(Object.entries(draft(key)).map(([field, v]) => [field, v === '' ? null : Number(v)])),
            }), () => setDrafts({ ...drafts, [key]: {} }))}>Save</Button>}</td>
          </tr>
        })}</tbody>
      </table></div>
      {!controller && <p className="asset-muted">Only the Finance Controller sets these. Signed in as {person(me) || 'you'}.</p>}
    </>}
  </section>
}
