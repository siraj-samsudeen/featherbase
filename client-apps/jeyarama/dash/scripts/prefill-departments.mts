// Pre-fills Department Managers' departments from a reviewed list (#1205). One command, safe to rerun:
// each manager already set up, open or pre-filled before is skipped.
//
//   FEATHERBASE_TOKEN=<the loader's token> tsx scripts/prefill-departments.mts \
//     --url <instance> --file <reviewed.csv> [--out <folder>] [--dry-run]
//   FEATHERBASE_TOKEN=... tsx scripts/prefill-departments.mts --url <instance> --undo <created record.json>
//
// --dry-run asks the instance what each store would get and writes nothing anywhere but the backup.
// A real run first writes that dry run as its backup (what it is about to create), then runs, then
// writes the record of every Department and link it created; --undo <record> takes them all back,
// links first. Files go in --out (default: here), named with their keep-until date (#4365).
// The loader is a service account holding Dash Reader and Master Data Editor. The token is read from
// the environment only and never printed. Never run it on production without the owner's yes.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createdRecord, perStore, planFromCsv, runPrefill, runUndo } from '../src/prefill-plan.ts'

// The platform serves an app's actions only to callers that name the version they were written for.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const url = flag('--url')?.replace(/\/$/, '')
const token = process.env.FEATHERBASE_TOKEN
const out = flag('--out') ?? '.'
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
const keepUntil = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
const saved = (what: string, value: unknown) => {
  const path = join(out, `department-prefill-${what}-${stamp}__keep-until-${keepUntil}.json`)
  writeFileSync(path, JSON.stringify(value, null, 2))
  return path
}
if (!url || !token) throw new Error('Give --url, and the loader\'s token in FEATHERBASE_TOKEN')
const call = async <T>(action: string, payload: unknown): Promise<T> => {
  const response = await fetch(`${url}/api/app_actions/dash/${action}`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-featherbase-app-version': `dash@${version}` },
    body: JSON.stringify({ idempotencyKey: randomUUID(), payload }) })
  const body = await response.json() as { result?: T; error?: { message?: string } }
  if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
  return body.result as T
}

const undo = flag('--undo')
if (undo) {
  const record = JSON.parse(readFileSync(undo, 'utf8')) as { bundles: string[] }
  console.log(JSON.stringify({ took_back: await runUndo(record, payload => call('undo_prefill', payload)) }))
  process.exit(0)
}
const file = flag('--file')
if (!file) throw new Error('Give the reviewed list: --file <csv>')
const plan = planFromCsv(readFileSync(file, 'utf8'))
const post = (payload: unknown) => call<{ results: never[] }>('prefill_departments', payload)
const dry = await runPrefill(plan.stores, post, true)
const backup = saved(args.includes('--dry-run') ? 'dry-run' : 'backup', { plan: plan.counts, totals: dry.totals, stores: dry.stores })
console.log(JSON.stringify({ plan: plan.counts, dry_run: dry.totals, per_store: perStore(dry), file: backup }, null, 1))
if (args.includes('--dry-run')) process.exit(0)
const done = await runPrefill(plan.stores, post)
const record = saved('created', createdRecord(done))
console.log(JSON.stringify({ run: done.totals, per_store: perStore(done), created_record: record, undo: `--undo ${record}` }, null, 1))
