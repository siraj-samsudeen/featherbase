// #1223: What they cover. One person's or one department's sections, subcategories and buyers,
// rolled up across the hops a record page leaves out, with every gap named. The rules are the
// server's (coverage.ts); this page draws its answer.
import { useEffect, useState } from 'react'
import { Button, Card, EmptyState, Field, Notice, SearchInput, StatusPill } from '@featherbase/shop-floor'
import { read } from './api'
import { LoadFailed, Loading, Shell } from './sections-page'
import { RECORD, RecordLink } from './record-link'

interface SectionCover { id: string; name: string; floor: string | null; floor_id?: string | null; active: boolean; subcategories: number }
interface DepartmentCover { id: string; name: string; store: string; store_id?: string; manager: string | null; manager_code?: string | null; sections: SectionCover[]; gaps: string[]; ended?: boolean }
interface JobCover { job: string; job_id?: string | null; store: string; store_id?: string | null; floor: string | null; floor_id?: string | null; reports_to: string | null; reports_to_code?: string | null; sections: SectionCover[]; departments: DepartmentCover[]; whole_store: boolean; gaps: string[] }
/** #1223: one section's own page: what it holds and who works in it. */
interface SectionPage { id: string; name: string; active: boolean; store: string; store_id: string; floor: string | null; floor_id: string | null
  subcategories: { code: string; name: string }[]; staff: { code: string; name: string; job: string }[]; gaps: string[] }
interface MerchandiseCover { assignment?: string; responsibility: string; level: string; named: string; region: string | null; subcategories: { code: string; name: string }[]; more: number; gaps: string[] }
type Answer = { state: 'not_found' | 'not_allowed' }
  | { state: 'ok'; kind: 'employee'; own?: boolean; section_ids?: Record<string, string>; employee: { code: string; name: string; status: string }; jobs: JobCover[]; merchandise: MerchandiseCover[]; gaps: string[]; nothing: boolean; area_only?: boolean }
  | { state: 'ok'; kind: 'department'; department: DepartmentCover }
  | { state: 'ok'; kind: 'section'; section: SectionPage }

/** The address of one person's, or one department's, coverage. */
export const coverageAddress = (at: { employee?: string; department?: string; section?: string }) =>
  at.section ? `?view=coverage&section=${encodeURIComponent(at.section)}`
    : at.department ? `?view=coverage&department=${encodeURIComponent(at.department)}` : `?view=coverage&employee=${encodeURIComponent(at.employee ?? '')}`

/** "4 subcategories", or the gap in words. */
export function coverLine(section: Pick<SectionCover, 'subcategories' | 'active'>): string {
  const count = section.subcategories === 0 ? 'no subcategories' : `${section.subcategories} ${section.subcategories === 1 ? 'subcategory' : 'subcategories'}`
  return section.active ? count : `closed · ${count}`
}

function Sections({ sections }: { sections: SectionCover[] }) {
  if (!sections.length) return <p className="fd-muted text-sm">No sections.</p>
  return (
    <ul className="flex flex-col divide-y divide-border">
      {sections.map(s => (
        <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2" data-testid="cover-section">
          <span className="min-w-0 break-words font-medium"><RecordLink table={RECORD.section} id={s.id}>{s.name}</RecordLink>{s.floor && <span className="ml-2 text-sm font-normal"><RecordLink table={RECORD.floor} id={s.floor_id}>{s.floor}</RecordLink></span>}</span>
          {s.subcategories === 0 || !s.active
            ? <StatusPill tone="caution" data-testid="cover-gap">{coverLine(s)}</StatusPill>
            : <RecordLink table={RECORD.section} id={s.id} className="text-sm">{coverLine(s)}</RecordLink>}
        </li>
      ))}
    </ul>
  )
}

function DepartmentBlock({ department, linked }: { department: DepartmentCover; linked: boolean }) {
  const total = department.sections.reduce((n, s) => n + s.subcategories, 0)
  return (
    <div className={linked ? 'rounded-md border border-border p-3' : ''} data-testid="cover-department">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {linked ? <span className="font-medium">Department: <RecordLink table={RECORD.department} id={department.id}>{department.name}</RecordLink></span> : <span />}
        <span className="text-sm text-ink-muted"><RecordLink table={RECORD.department} id={department.id}>{`${department.sections.length} ${department.sections.length === 1 ? 'section' : 'sections'}`}</RecordLink> · <RecordLink table={RECORD.department} id={department.id}>{`${total} ${total === 1 ? 'subcategory' : 'subcategories'}`}</RecordLink></span>
      </div>
      <Sections sections={department.sections} />
    </div>
  )
}

/** Spec item 15: find a person by name or code; results carry the identity line. A typed code still works. */
function Lookup({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial)
  const [found, setFound] = useState<{ code: string; name: string; line: string }[]>([])
  useEffect(() => {
    if (q.trim().length < 2 || q === initial) { setFound([]); return }
    const timer = setTimeout(() => { read<{ code: string; name: string; line: string }[]>('coverage_people', { q }).then(setFound, () => setFound([])) }, 250)
    return () => clearTimeout(timer)
  }, [q, initial])
  return (
    <form className="relative flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (q.trim()) window.location.search = coverageAddress({ employee: found[0]?.code ?? q.trim() }) }}>
      <div className="w-80"><Field label="Find a person"><SearchInput placeholder="Name or code" value={q} onChange={e => setQ(e.target.value)} data-testid="cover-code" /></Field></div>
      <Button type="submit" variant="secondary">Show</Button>
      {found.length > 0 && (
        <ul className="absolute left-0 top-full z-10 mt-1 w-80 rounded-control border border-border bg-surface p-1 shadow-lg" data-testid="cover-results">
          {found.map(p => (
            <li key={p.code}>
              <a href={coverageAddress({ employee: p.code })} className="block rounded-control px-3 py-1.5 hover:bg-subtle">
                <span className="block text-sm font-medium text-action">{p.name}</span>
                <span className="block text-[13px] text-ink-muted">{p.line}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}

/** Spec item 17: a gap with its department and section names as links ("Kids › Girls Tops · no subcategories"). */
function GapLine({ gap, ids, departments = {} }: { gap: string; ids: Record<string, string>; departments?: Record<string, string> }) {
  const [head, rest] = gap.includes(' › ') ? gap.split(' › ', 2) as [string, string] : ['', gap]
  const name = Object.keys(ids).filter(n => rest.includes(n)).sort((a, b) => b.length - a.length)[0]
  const tail = !name ? <>{rest}</> : <>{rest.slice(0, rest.indexOf(name))}<RecordLink table={RECORD.section} id={ids[name]}>{name}</RecordLink>{rest.slice(rest.indexOf(name) + name.length)}</>
  return <>{head && <><RecordLink table={RECORD.department} id={departments[head]}>{head}</RecordLink> › </>}{tail}</>
}

/** The page's heading: whose coverage it is, by name. */
export function titleOf(answer: Answer | undefined): string {
  if (answer?.state !== 'ok') return 'What they cover'
  if (answer.kind === 'department') return `${answer.department.name} · ${answer.department.store}`
  if (answer.kind === 'section') return answer.section.name
  return answer.own ? 'What you cover' : `What ${answer.employee.name} covers`
}

function SectionView({ section }: { section: SectionPage }) {
  return (
    <div className="flex flex-col gap-4" data-testid="cover-section-page">
      <p className="text-sm">{section.floor && <><RecordLink table={RECORD.floor} id={section.floor_id}>{section.floor}</RecordLink> · </>}<RecordLink table={RECORD.site} id={section.store_id}>{section.store}</RecordLink></p>
      {section.gaps.length > 0 && <Notice tone="caution" data-testid="cover-gaps">{section.gaps.join(' · ')}</Notice>}
      <Card title={`Subcategories · ${section.subcategories.length}`}>
        <div className="p-4 text-sm">
          {section.subcategories.length
            ? <p>{section.subcategories.map((s, i) => <span key={s.code}>{i ? ', ' : ''}<RecordLink table={RECORD.subcategory} id={s.code}>{s.name}</RecordLink></span>)}</p>
            : <p className="fd-muted">No subcategories in this section yet.</p>}
        </div>
      </Card>
      <Card title={`Team · ${section.staff.length}`}>
        <ul className="flex flex-col divide-y divide-border p-4">
          {section.staff.map(p => <li key={`${p.code}-${p.job}`} className="flex justify-between gap-2 py-2 text-sm"><RecordLink table={RECORD.employee} id={p.code}>{p.name}</RecordLink><span className="text-ink-muted">{p.job}</span></li>)}
          {section.staff.length === 0 && <li className="fd-muted text-sm">No one works in this section yet.</li>}
        </ul>
      </Card>
    </div>
  )
}

export function WhatTheyCover() {
  const params = new URLSearchParams(window.location.search)
  const at = { employee: params.get('employee') ?? undefined, department: params.get('department') ?? undefined, section: params.get('section') ?? undefined }
  const [answer, setAnswer] = useState<Answer | undefined>()
  const [failed, setFailed] = useState(false)
  const load = () => { setFailed(false); read<Answer>('coverage', at).then(setAnswer, () => setFailed(true)) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [])
  return (
    <Shell current="coverage" testid="coverage" title={answer?.state === 'ok' && answer.kind === 'employee' && !answer.own
      ? <>What <RecordLink table={RECORD.employee} id={answer.employee.code}>{answer.employee.name}</RecordLink> covers</>
      : answer?.state === 'ok' && answer.kind === 'department'
        ? <><RecordLink table={RECORD.department} id={answer.department.id}>{answer.department.name}</RecordLink> · <RecordLink table={RECORD.site} id={answer.department.store_id}>{answer.department.store}</RecordLink></>
        : titleOf(answer)}>
      {!at.department && !at.section && <Lookup initial={at.employee ?? (answer?.state === 'ok' && answer.kind === 'employee' ? answer.employee.code : '')} key={answer ? 'answered' : 'waiting'} />}
      {!answer && !failed && <Loading />}
      {failed && <LoadFailed onRetry={load} />}
      {answer?.state === 'not_found' && <Card><EmptyState title="Nobody by that code" body="Check the employee code, or open someone from Your store." /></Card>}
      {answer?.state === 'not_allowed' && <Card data-testid="cover-not-allowed"><EmptyState title="You can see your own area only" body="Everyone sees what they cover themselves; Store and Floor Managers also see their own staff; the master data team sees everyone." /></Card>}
      {answer?.state === 'ok' && answer.kind === 'section' && <SectionView section={answer.section} />}
      {answer?.state === 'ok' && answer.kind === 'department' && (
        <Card title="Sections" data-testid="cover-department-page">
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-ink-muted">Department <RecordLink table={RECORD.department} id={answer.department.id}>{answer.department.name}</RecordLink> at <RecordLink table={RECORD.site} id={answer.department.store_id}>{answer.department.store}</RecordLink></p>
            <p className="text-sm text-ink-muted">Manager: {answer.department.manager && answer.department.manager_code
              ? <><RecordLink table={RECORD.employee} id={answer.department.manager_code}>{answer.department.manager}</RecordLink></>
              : answer.department.manager ?? 'none named'}{answer.department.ended ? ' · this department has ended' : ''}</p>
            {answer.department.gaps.length > 0 && <Notice tone="caution" data-testid="cover-gaps">{answer.department.gaps.map((g, i) => <span key={g}>{i ? ' · ' : ''}<GapLine gap={g} ids={Object.fromEntries(answer.department.sections.map(s => [s.name, s.id]))} /></span>)}</Notice>}
            <DepartmentBlock department={answer.department} linked={false} />
          </div>
        </Card>
      )}
      {answer?.state === 'ok' && answer.kind === 'employee' && (
        <>
          <p className="fd-muted" data-testid="cover-person">Employee <RecordLink table={RECORD.employee} id={answer.employee.code}>{answer.employee.code}</RecordLink>{answer.employee.status !== 'Current' ? ` · ${answer.employee.status}` : ''}. Every section and subcategory {answer.own ? 'your' : 'their'} jobs reach, with what is missing.</p>
          {answer.gaps.length > 0 && (
            <Notice tone="caution" data-testid="cover-gaps">
              <span className="font-medium">Gaps: </span>{answer.gaps.map((g, i) => <span key={g}>{i ? ' · ' : ''}<GapLine gap={g} ids={answer.section_ids ?? {}}
                departments={Object.fromEntries(answer.jobs.flatMap(j => j.departments).map(d => [d.name, d.id]))} /></span>)}
            </Notice>
          )}
          {answer.area_only && <p className="fd-muted text-sm" data-testid="cover-area-only">Showing only their jobs in your area.</p>}
          {answer.nothing && <Card><EmptyState title="No current job or merchandise assignment" body="Nothing to roll up yet." /></Card>}
          {answer.jobs.map((job, i) => (
            <Card key={i} data-testid="cover-job" title={<span className="inline-flex flex-wrap gap-x-1"><RecordLink table="Job Assignment" id={job.job_id}>{job.job}</RecordLink> · <RecordLink table={RECORD.site} id={job.store_id}>{job.store}</RecordLink>{job.floor && <> · <RecordLink table={RECORD.floor} id={job.floor_id}>{job.floor}</RecordLink></>}</span>}>
              <div className="flex flex-col gap-3 p-4">
                {job.reports_to && <p className="text-sm text-ink-muted">Reports to <RecordLink table={RECORD.employee} id={job.reports_to_code}>{job.reports_to}</RecordLink></p>}
                {job.whole_store && <p className="text-sm">Covers {job.job === 'Store Manager' ? 'the whole store' : 'every store in their reach'}: every section and subcategory there.</p>}
                {job.sections.length > 0 && <Sections sections={job.sections} />}
                {job.departments.map(d => <DepartmentBlock key={d.id} department={d} linked />)}
              </div>
            </Card>
          ))}
          {answer.merchandise.map((m, i) => (
            <Card key={`m${i}`} data-testid="cover-merchandise" title={<span className="inline-flex flex-wrap gap-x-1"><RecordLink table={RECORD.merchandise} id={m.assignment}>{m.responsibility}</RecordLink> · {m.level === 'category' ? <RecordLink table={RECORD.category} id={m.named}>{m.named}</RecordLink> : m.named}{m.region && <> · <RecordLink table={RECORD.region} id={m.region}>{m.region}</RecordLink></>}</span>}>
              <div className="p-4 text-sm">
                {m.subcategories.length
                  ? <p>{m.subcategories.map((s, k) => <span key={s.code}>{k ? ', ' : ''}<RecordLink table={RECORD.subcategory} id={s.code}>{s.name}</RecordLink></span>)}{m.more ? `, and ${m.more} more` : ''}</p>
                  : <p className="fd-muted">No subcategories.</p>}
              </div>
            </Card>
          ))}
        </>
      )}
    </Shell>
  )
}
