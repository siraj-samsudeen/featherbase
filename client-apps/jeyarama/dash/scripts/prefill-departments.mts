// Pre-fills Department Managers' departments from a reviewed list (#1205). Safe to rerun: each
// manager already set up, open or pre-filled before is skipped.
//
//   FEATHERBASE_TOKEN=<a service account's token> \
//   node --experimental-strip-types scripts/prefill-departments.mts --url <instance> --file <reviewed.csv> [--dry-run]
//
// The token is read from the environment, never from the command line, and never printed. --dry-run
// prints the plan's counts and sends nothing. Never run it against production without the owner's yes.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { planFromCsv, runPrefill } from '../src/prefill-plan.ts'

// The platform serves an app's actions only to callers that name the version they were written for.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const file = flag('--file')
const url = flag('--url')?.replace(/\/$/, '')
if (!file) throw new Error('Give the reviewed list: --file <csv>')
const plan = planFromCsv(readFileSync(file, 'utf8'))
console.log(JSON.stringify({ plan: plan.counts, stores: plan.stores.length }))
if (args.includes('--dry-run')) process.exit(0)
const token = process.env.FEATHERBASE_TOKEN
if (!url || !token) throw new Error('Give --url, and the token in FEATHERBASE_TOKEN')
const report = await runPrefill(plan.stores, async payload => {
  const response = await fetch(`${url}/api/app_actions/dash/prefill_departments`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-featherbase-app-version': `dash@${version}` }, body: JSON.stringify({ idempotencyKey: randomUUID(), payload }) })
  const body = await response.json() as { result?: { results: never[] }; error?: { message?: string } }
  if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
  return body.result!
})
console.log(JSON.stringify(report, null, 2))
