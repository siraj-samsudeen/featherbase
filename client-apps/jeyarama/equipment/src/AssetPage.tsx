import { Button, fmtDate, fmtExact, fmtInstantIST } from '@featherbase/shop-floor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, api, save, uploadJobPhoto } from './api'
import { nameOf, useClasses, useEntities, useJobs, usePeople, usePlaces, useRestorations, useTypes, type Asset, type Job } from './data'
import { JobClock } from './JobClock'
import { LastVerified } from './Counts'
import { AssetMovements } from './Custody'
import { PRIORITIES, coverNotice, isOpen, localDay, placePath, warrantyNotice, workflowState } from './jobRules'

/** When each part of a repair happened, in Indian time. */
export function JobTimeline({ job }: { job: Job }) {
  const steps: [string, string | null][] = [
    ['Stopped working', job.failure_started_at], ['Reported', job.reported_at], ['Responded', job.responded_at],
    ['Repair started', job.repair_started_at], ['Restored', job.restored_at],
  ]
  return <ol className="job-timeline" aria-label="Timeline">
    {steps.map(([label, at]) => <li key={label} data-done={at ? 'yes' : 'no'}><b>{label}</b> {at ? fmtInstantIST(at) : '—'}</li>)}
  </ol>
}

export function JobDetails({ job }: { job: Job }) {
  const parts = [job.cause && `Cause: ${job.cause}`, job.spares && `Spares: ${job.spares}`, job.outside_service && `Outside service: ${job.outside_service}`].filter(Boolean)
  return parts.length ? <p className="job-details">{parts.join(' · ')}</p> : null
}

export function AssetPage({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const asset = useQuery({ queryKey: ['assets', 'asset', id], queryFn: () => api.get<Asset>(`/api/table/equipment.asset/${encodeURIComponent(id)}`) })
  const places = usePlaces()
  const types = useTypes()
  const entities = useEntities()
  const people = usePeople()
  const jobs = useJobs()
  const restorations = useRestorations()
  const [problem, setProblem] = useState('')
  const [priority, setPriority] = useState<string>('Normal')
  const [photo, setPhoto] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  if (asset.error) return <p role="alert">{asset.error instanceof ApiError && asset.error.status === 404 ? 'This label’s asset is not in the register.' : asset.error.message}</p>
  if (!asset.data) return <p role="status">Loading asset…</p>
  const a = asset.data
  const today = localDay()
  const confirmations = new Map((restorations.data ?? []).map(r => [r.job, r]))
  const confirmedIds = new Set(confirmations.keys())
  const mine = (jobs.data ?? []).filter(job => job.asset === id)
  const open = mine.filter(job => isOpen(job.job_state))
  const waiting = mine.filter(job => job.job_state === 'Fixed' && !confirmedIds.has(job.row_id))
  const past = mine.filter(job => job.job_state === 'Cancelled' || (job.job_state === 'Fixed' && confirmedIds.has(job.row_id)))
  const warranty = warrantyNotice(a.warranty_until, today)
  const cover = coverNotice(a, today)
  const entity = (entityId: string | null) => {
    const found = entities.data?.find(e => e.row_id === entityId)
    return found ? `${found.short_name || found.entity_name} · ${found.entity_status}` : '—'
  }
  const hasSap = a.sap_company_code || a.sap_asset_no || a.sap_equipment_no || a.legacy_id

  async function report(event: React.FormEvent) {
    event.preventDefault()
    setSending(true); setError(''); setSent(false)
    try {
      const photoUrl = photo ? await uploadJobPhoto(photo) : null
      await save('equipment.job', { asset: id, problem: problem.trim(), priority, ...(photoUrl ? { photo: photoUrl } : {}) })
      setProblem(''); setPriority('Normal'); setPhoto(null); setSent(true)
      await queryClient.invalidateQueries({ queryKey: ['assets', 'jobs'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the report')
    } finally {
      setSending(false)
    }
  }

  async function confirm(job: Job) {
    setConfirmError('')
    try {
      await save('equipment.restoration', { job: job.row_id })
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Could not confirm the repair')
    }
  }

  return <article className="asset-page">
    <h1>{a.asset_name}</h1>
    <p className="asset-sub">{`${a.tag_no ?? a.row_id} · ${placePath(a.place, places.data ?? [])}`}</p>
    <TagFacts asset={a} />
    <ul className="asset-states" aria-label="States">
      <li data-state="books">Books: {a.book_status}</li>
      <li data-state="condition">Condition: {a.condition}</li>
      <li data-state="custody">Custody: {a.custody_status}</li>
      <li data-state="workflow">Workflow: {workflowState(mine, confirmedIds)}</li>
    </ul>
    <dl className="asset-facts">
      <div><dt>Type</dt><dd>{nameOf(types.data, a.asset_type, 'type_name')}</dd></div>
      {(a.make || a.model) && <div><dt>Make and model</dt><dd>{[a.make, a.model].filter(Boolean).join(' ')}</dd></div>}
      {a.serial_no && <div><dt>Serial number</dt><dd>{a.serial_no}</dd></div>}
    </dl>
    {a.warranty_until && <p className={`asset-warranty ${warranty ? `is-${warranty}` : ''}`}>
      {warranty === 'ended' ? `Warranty ended ${fmtDate(a.warranty_until.slice(0, 10))}` : `Warranty until ${fmtDate(a.warranty_until.slice(0, 10))}`}
    </p>}
    {a.amc_until && <p className="asset-muted">AMC{a.amc_vendor ? ` with ${a.amc_vendor}` : ''} until {fmtDate(a.amc_until.slice(0, 10))}</p>}
    <LastVerified asset={a.row_id} />
    <AssetMovements asset={a.row_id} />

    <section aria-labelledby="from-sap" className="asset-sap">
      <h2 id="from-sap">From SAP</h2>
      <p className="asset-muted">SAP is the record for these. Assets shows them and doesn’t change them.</p>
      {hasSap ? <dl className="asset-facts">
        <div><dt>Company code</dt><dd>{a.sap_company_code ?? '—'}</dd></div>
        <div><dt>Asset no. / sub</dt><dd>{a.sap_asset_no ? `${a.sap_asset_no} / ${a.sap_asset_sub ?? '0'}` : '—'}</dd></div>
        <div><dt>Equipment no.</dt><dd>{a.sap_equipment_no ?? '—'}</dd></div>
        <div><dt>Legacy ID</dt><dd>{a.legacy_id ?? '—'}</dd></div>
      </dl> : <p>Not yet linked to SAP.</p>}
      {a.sap_refreshed_at && <p className="asset-muted">Refreshed {fmtInstantIST(a.sap_refreshed_at)}</p>}
    </section>

    <section aria-labelledby="ownership" className="asset-sap">
      <h2 id="ownership">Ownership</h2>
      <dl className="asset-facts">
        <div><dt>Legal owner</dt><dd>{entity(a.owner_entity)}</dd></div>
        <div><dt>Operator</dt><dd>{entity(a.operator_entity)}</dd></div>
        <div><dt>Cost centre</dt><dd>{a.cost_centre ?? '—'}</dd></div>
        <div><dt>Custodian</dt><dd>{a.custodian ? nameOf(people.data, a.custodian, 'full_name') : '—'}{a.location_custodian ? ' (location custodian)' : ''}</dd></div>
      </dl>
    </section>

    <section aria-labelledby="open-jobs" className="asset-jobs">
      <h2 id="open-jobs">Open jobs</h2>
      {open.length ? <ul>{open.map(job => <li key={job.row_id}>
        <strong>{job.problem}</strong> <span className="asset-muted">{job.priority} · {job.job_state}</span> <JobClock job={job} />
        {cover && <p className="job-cover">{cover}. Check cover before paying for work.</p>}
      </li>)}</ul> : <p className="asset-muted">No open jobs.</p>}
    </section>

    {waiting.length > 0 && <section aria-labelledby="confirm-jobs" className="asset-jobs asset-confirm">
      <h2 id="confirm-jobs">Waiting for you to confirm</h2>
      {waiting.map(job => <article key={job.row_id} aria-label={job.problem} className="confirm-item">
        <p><strong>{job.problem}</strong> <JobClock job={job} /></p>
        {job.work_done && <p>{job.work_done}{job.repair_cost != null && ` · ${fmtExact(Number(job.repair_cost))}`}</p>}
        <JobDetails job={job} />
        <JobTimeline job={job} />
        {cover && <p className="job-cover">{cover}</p>}
        <Button type="button" variant="primary" onClick={() => void confirm(job)}>Confirm it works</Button>
      </article>)}
      {confirmError && <p role="alert">{confirmError}</p>}
    </section>}

    <section aria-labelledby="report-fault" className="asset-report">
      <h2 id="report-fault">Report a fault</h2>
      <form onSubmit={event => void report(event)}>
        <label>What’s wrong?<input value={problem} onChange={event => setProblem(event.target.value)} placeholder="Not cooling" /></label>
        <fieldset>
          <legend>How urgent</legend>
          {PRIORITIES.map(value => <div key={value} className="asset-radio">
            <label><input type="radio" name="priority" value={value} checked={priority === value} onChange={() => setPriority(value)} aria-describedby={`priority-${value}`} /> {value}</label>
            <span id={`priority-${value}`} className="asset-muted">{value === 'Urgent' ? 'fix in 4 hours' : value === 'High' ? 'fix within a day' : 'fix within 3 days'}</span>
          </div>)}
        </fieldset>
        <label>Photo (optional)<input type="file" accept="image/*" capture="environment" onChange={event => setPhoto(event.target.files?.[0] ?? null)} /></label>
        {error && <p role="alert">{error}</p>}
        {sent && <p role="status">Report sent. A technician will pick it up.</p>}
        <Button type="submit" variant="primary" disabled={sending || !problem.trim()}>Send report</Button>
      </form>
    </section>

    <section aria-labelledby="past-jobs" className="asset-jobs">
      <h2 id="past-jobs">Past jobs</h2>
      {past.length ? <ul>{past.map(job => {
        const confirmation = confirmations.get(job.row_id)
        return <li key={job.row_id}>
          <strong>{job.problem}</strong> <span className="asset-muted">
            {confirmation ? `Closed · confirmed ${fmtInstantIST(confirmation.created_at)}` : job.job_state} · reported {fmtInstantIST(job.reported_at)}
          </span>
          {job.work_done && <p>{job.work_done}{job.repair_cost != null && ` · ${fmtExact(Number(job.repair_cost))}`}</p>}
          <JobDetails job={job} />
        </li>
      })}</ul> : <p className="asset-muted">No past jobs.</p>}
    </section>
  </article>
}

/** The plan's four labels on every item, and its tag and SAP book value. */
function TagFacts({ asset }: { asset: Asset }) {
  const classes = useClasses()
  return <dl className="asset-tag-facts" aria-label="Tag and labels">
    <div><dt>Tag</dt><dd>{asset.tag_no ?? asset.tag_status ?? 'Needs a tag'}</dd></div>
    <div><dt>Class</dt><dd>{nameOf(classes.data, asset.asset_class, 'class_name') || '—'}</dd></div>
    <div><dt>Control category</dt><dd>{asset.control_category ?? 'Finance sets this during matching'}</dd></div>
    <div><dt>Ownership</dt><dd>{asset.ownership ?? 'Group owned'}{asset.owner_name ? ` · ${asset.owner_name}` : ''}</dd></div>
    {asset.book_value && <div><dt>Book value</dt><dd>{fmtExact(Number(asset.book_value))}</dd></div>}
  </dl>
}
