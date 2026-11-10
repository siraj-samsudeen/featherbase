// Writes the demo's rows as CSV files for review (#1123), one per Table, named after it, with a
// readable name beside each code. Nothing is loaded.
//
//   node client-apps/jeyarama/instances/demo/data/export-csv.mjs <folder>
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { banyan, EMAIL_DOMAIN } from './banyan.mjs'
import { TASKER, TICKETS, TICKET_TYPES, day } from './work.mjs'

const folder = process.argv[2]
if (!folder) throw new Error('Name the folder to write the CSV files in')
mkdirSync(folder, { recursive: true })
const cell = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v)
const write = (name, rows) => {
  const header = [...new Set(rows.flatMap(r => Object.keys(r)))]
  writeFileSync(resolve(folder, `${name}.csv`), [header.join(','), ...rows.map(r => header.map(h => cell(r[h])).join(','))].join('\n') + '\n')
}

const g = banyan()
const name = Object.fromEntries(g.Employee.map(e => [e.employee_code, e.name]))
const site = Object.fromEntries(g.Site.map(s => [s.code, s.name]))
const sub = Object.fromEntries(g.Subcategory.map(s => [s.row_id, s.subcategory]))
const sec = Object.fromEntries(g.Section.map(s => [s.row_id, s.name]))
const withNames = {
  Subcategory: r => ({ material_group_code: r.row_id, ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'row_id')) }),
  'Section Subcategory': r => ({ section_subcategory_id: r.section_subcategory_id, store: r.store, store_name: site[r.store], section: r.section, subcategory_code: r.subcategory,
    subcategory_name: sub[r.subcategory], starts_on: r.starts_on, ends_on: r.ends_on }),
  Employment: r => ({ employment_id: r.employment_id, employee: r.employee, employee_name: name[r.employee], ...Object.fromEntries(Object.entries(r).filter(([k]) => !['employment_id', 'employee'].includes(k))) }),
  'Job Assignment': r => ({ assignment_id: r.assignment_id, employee: r.employee, employee_name: name[r.employee], job: r.job, site: r.site, site_name: site[r.site],
    floor: r.floor, section: r.section, section_name: sec[r.section], reports_to: r.reports_to, reports_to_name: name[r.reports_to], acting: r.acting, starts_on: r.starts_on, ends_on: r.ends_on }),
}
for (const [table, rows] of Object.entries(g)) write(table, rows.map(withNames[table] ?? (r => r)))

const who = key => `${key.replace('_', '.')}@${EMAIL_DOMAIN}`
write('tasker.task', TASKER.tasks.map(([id, title, project, store, state, assignee, start, due, extra]) => ({ id: `DEMO-TASK-${id}`, title,
  project: TASKER.projects.find(p => p[0] === `DEMO-PROJECT-${project}`)?.[1] ?? '', store: store ? site[store] : '', state, assigned_to: who(assignee),
  start_date: day(start), due_date: day(due), urgent: extra.urgent ?? false, verifier: extra.verifier ? who(extra.verifier) : '',
  notes: [extra.explanation, ...(extra.comments ?? []), extra.evidence_note, extra.change_reason].filter(Boolean).join(' | ') })))
write('tasker.project', TASKER.projects.map(([id, project_name, description, verifier]) => ({ id, project_name, description, default_verifier: verifier ? who(verifier) : '' })))
const typeLabel = Object.fromEntries(TICKET_TYPES.map(t => [t.type_key, t.label]))
write('tickets.ticket', TICKETS.map(([id, raiser, kind, title, original, details, then, notes]) => ({ id, raised_by: who(raiser), type: typeLabel[kind] ?? kind, title, original,
  details: Object.entries(details).map(([k, v]) => `${k}: ${k === 'store' ? site[v] : v}`).join('; '), state: then?.[0] ?? 'New',
  assigned_to: then?.[1] ? who(then[1]) : '', public_update: then?.[2] ?? '', internal_notes: notes.join(' | ') })))
console.log(`Wrote ${Object.keys(g).length + 3} CSV files to ${folder}`)
