import { Button, fmtDate, fmtExact, fmtInstantIST } from '@featherbase/shop-floor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, api, save, uploadJobPhoto } from './api'
import { nameOf, useJobs, usePlaces, useTypes, type Asset } from './data'
import { JobClock } from './JobClock'
import { PRIORITIES, isOpen, localDay, warrantyNotice } from './jobRules'

export function AssetPage({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const asset = useQuery({ queryKey: ['assets', 'asset', id], queryFn: () => api.get<Asset>(`/api/table/equipment.asset/${encodeURIComponent(id)}`) })
  const places = usePlaces()
  const types = useTypes()
  const jobs = useJobs()
  const [problem, setProblem] = useState('')
  const [priority, setPriority] = useState<string>('Normal')
  const [photo, setPhoto] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  if (asset.error) return <p role="alert">{asset.error instanceof ApiError && asset.error.status === 404 ? 'This label’s asset is not in the register.' : asset.error.message}</p>
  if (!asset.data) return <p role="status">Loading asset…</p>
  const a = asset.data
  const mine = (jobs.data ?? []).filter(job => job.asset === id)
  const open = mine.filter(job => isOpen(job.job_state))
  const past = mine.filter(job => !isOpen(job.job_state))
  const warranty = warrantyNotice(a.warranty_until, localDay())

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

  return <article className="asset-page">
    <h1>{a.asset_name}</h1>
    <p className="asset-sub">{[a.row_id, nameOf(places.data, a.place, 'place_name'), a.area].filter(Boolean).join(' · ')}</p>
    <dl className="asset-facts">
      <div><dt>Type</dt><dd>{nameOf(types.data, a.asset_type, 'type_name')}</dd></div>
      <div><dt>Status</dt><dd>{a.asset_status}</dd></div>
      {(a.make || a.model) && <div><dt>Make and model</dt><dd>{[a.make, a.model].filter(Boolean).join(' ')}</dd></div>}
      {a.serial_no && <div><dt>Serial number</dt><dd>{a.serial_no}</dd></div>}
    </dl>
    {a.warranty_until && <p className={`asset-warranty ${warranty ? `is-${warranty}` : ''}`}>
      {warranty === 'ended' ? `Warranty ended ${fmtDate(a.warranty_until.slice(0, 10))}` : `Warranty until ${fmtDate(a.warranty_until.slice(0, 10))}`}
    </p>}

    <section aria-labelledby="open-jobs" className="asset-jobs">
      <h2 id="open-jobs">Open jobs</h2>
      {open.length ? <ul>{open.map(job => <li key={job.row_id}>
        <strong>{job.problem}</strong> <span className="asset-muted">{job.priority} · {job.job_state}</span> <JobClock job={job} />
      </li>)}</ul> : <p className="asset-muted">No open jobs.</p>}
    </section>

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
      {past.length ? <ul>{past.map(job => <li key={job.row_id}>
        <strong>{job.problem}</strong> <span className="asset-muted">{job.job_state} · reported {fmtInstantIST(job.reported_at)}</span>
        {job.work_done && <p>{job.work_done}{job.repair_cost != null && ` · ${fmtExact(Number(job.repair_cost))}`}</p>}
      </li>)}</ul> : <p className="asset-muted">No past jobs.</p>}
    </section>
  </article>
}
