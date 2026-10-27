// `cli people:resolve <csv>` (person-resolution C4, D11): after the release,
// move each StyleHR sign-in from its employee code to its StyleHR record
// number, from the warehouse's resolve file. Not part of 0102 (review
// decision): a sign-in keeps working by code until this runs, and running it
// again changes nothing. One transaction; `--dry-run` rolls it back.
//
// The file: UTF-8, comma-separated, header `employee_code,assigner,stylehr_record_id`.
import { readFileSync } from 'node:fs'
import { sql, withTransaction } from './db'
import { writeThroughIdentity } from './person-identifiers'

interface ResolveRow {
  employee_code: string
  assigner: string
  stylehr_record_id: string
}

/** Parse the warehouse's resolve file. */
export function parseResolveFile(text: string): ResolveRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const at = (name: string) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`resolve file: missing column ${name} (want employee_code,assigner,stylehr_record_id)`)
    return i
  }
  const [c, a, r] = [at('employee_code'), at('assigner'), at('stylehr_record_id')]
  return lines.slice(1).map((line, n) => {
    const cells = line.split(',').map((x) => x.trim())
    if (!cells[c] || !cells[r]) throw new Error(`resolve file: line ${n + 2} needs an employee_code and a stylehr_record_id`)
    return { employee_code: cells[c], assigner: cells[a] ?? '', stylehr_record_id: cells[r] }
  })
}

interface ResolvedEntry {
  person: string
  full_name: string | null
  detail: string
}

interface ResolveReport {
  live: number
  resolved: ResolvedEntry[]
  alreadyResolved: number
  notInFile: ResolvedEntry[]
  /** The code names 2+ StyleHR records (codes repeat across firms). */
  colliding: ResolvedEntry[]
  /** The record number is already another person's (a live sign-in or a current row). */
  heldElsewhere: ResolvedEntry[]
}

const METHOD = 'stylehr'

/** Resolve every live StyleHR sign-in still keyed by employee code. */
export async function resolveStyleHrSubjects(rows: ResolveRow[]): Promise<ResolveReport> {
  const [method] = await sql`select identifier_system from sign_in_method where row_id = ${METHOD}`
  if (!method) throw new Error('people:resolve: there is no StyleHR sign-in method here')
  const recordSystem = method.identifier_system ? String(method.identifier_system) : null
  if (!recordSystem) throw new Error('people:resolve: the StyleHR method names no identifier system; run `cli seed-pack apply jeyarama` first')

  const byCode = new Map<string, ResolveRow[]>()
  for (const r of rows) {
    const key = r.employee_code.trim().toUpperCase()
    byCode.set(key, [...(byCode.get(key) ?? []), r])
  }
  const report: ResolveReport = { live: 0, resolved: [], alreadyResolved: 0, notInFile: [], colliding: [], heldElsewhere: [] }
  const identities = await sql`
    select i.id, i.person_id, i.subject, i.subject_kind, p.full_name
    from sign_in_identity i join person p on p.row_id = i.person_id
    where i.method = ${METHOD} and i.subject is not null and i.ended_at is null
    order by p.full_name, i.person_id`
  report.live = identities.length
  for (const i of identities) {
    const person = String(i.person_id)
    const who = { person, full_name: (i.full_name as string | null) ?? null }
    if (i.subject_kind === 'record-id') {
      report.alreadyResolved++
      continue
    }
    const code = String(i.subject).trim().toUpperCase()
    const matches = byCode.get(code) ?? []
    if (matches.length === 0) {
      report.notInFile.push({ ...who, detail: `employee code ${code} is not in the file` })
      continue
    }
    if (matches.length > 1) {
      report.colliding.push({ ...who, detail: `employee code ${code} has ${matches.length} StyleHR records (firms ${matches.map((m) => m.assigner || '?').join(', ')}) — resolve by hand` })
      continue
    }
    const recordId = matches[0].stylehr_record_id.trim()
    const [otherLink] = await sql`
      select person_id from sign_in_identity
      where method = ${METHOD} and subject = ${recordId} and ended_at is null and id <> ${String(i.id)}`
    const [otherRow] = await sql`
      select person_id from person_identifier
      where system = ${recordSystem} and value = ${recordId} and upper_inf(valid) and person_id <> ${person}`
    if (otherLink || otherRow) {
      const holder = String((otherLink ?? otherRow).person_id)
      const [h] = await sql`select coalesce(nullif(trim(full_name), ''), '@' || username, email) as name from person where row_id = ${holder}`
      report.heldElsewhere.push({ ...who, detail: `record ${recordId} (code ${code}) is already held by ${(h?.name as string | null) ?? 'another person'} (${holder})` })
      continue
    }
    await sql`update sign_in_identity set subject = ${recordId}, subject_kind = 'record-id' where id = ${String(i.id)}`
    // The ordinary write-through: the record-number row, as a new link writes it.
    await writeThroughIdentity(String(i.id))
    const [record] = await sql`
      select id from person_identifier where person_id = ${person} and system = ${recordSystem} and value = ${recordId} and upper_inf(valid)`
    if (record)
      await sql`
        update person_identifier set record_identifier_id = ${String(record.id)}
        where person_id = ${person} and system = 'stylehr-employee-code' and value = ${code} and upper_inf(valid)`
    report.resolved.push({ ...who, detail: `${code} → record ${recordId}` })
  }
  return report
}

const DRY_RUN = new Error('people:resolve dry run')

/** Read the file and resolve, in one transaction (rolled back for a dry run). */
export async function runPeopleResolve(file: string, opts: { dryRun?: boolean } = {}): Promise<ResolveReport> {
  const rows = parseResolveFile(readFileSync(file, 'utf8'))
  let report: ResolveReport | null = null
  try {
    await withTransaction(async () => {
      report = await resolveStyleHrSubjects(rows)
      if (opts.dryRun) throw DRY_RUN
    })
  } catch (err) {
    if (err !== DRY_RUN) throw err
  }
  return report as unknown as ResolveReport
}

export function formatResolveReport(r: ResolveReport, opts: { dryRun?: boolean } = {}): string {
  const list = (items: ResolvedEntry[]) =>
    items.length ? `\n    ${items.map((x) => `${x.full_name ? `${x.full_name} (${x.person})` : x.person} — ${x.detail}`).join('\n    ')}` : ' none'
  return [
    `people:resolve${opts.dryRun ? ' (dry run — rolled back)' : ''}: ${r.live} live StyleHR sign-ins`,
    `  moved to the record number: ${r.resolved.length}${list(r.resolved)}`,
    `  already on a record number: ${r.alreadyResolved}`,
    `  kept by employee code — not in the file: ${r.notInFile.length}${list(r.notInFile)}`,
    `  kept by employee code — code on 2+ StyleHR records: ${r.colliding.length}${list(r.colliding)}`,
    `  kept by employee code — record already another person's: ${r.heldElsewhere.length}${list(r.heldElsewhere)}`,
  ].join('\n')
}
