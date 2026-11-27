#!/usr/bin/env node
// #1409: set up the Store Sales proof on a local development instance, with
// made-up figures. It makes a small "warehouse" (a schema in a sibling
// database), connects it as a Data Source, installs Store Sales, copies
// `sales` from that warehouse, and loads `targets` as a stand-in from
// targets.csv. Afterwards the Store Sales page shows both, with the
// platform's sample-data line for the targets; the Datasets page in the Admin
// switches `targets` to the warehouse.
//
//   FEATHERBASE_APP_PATHS='["<repo>/test-apps/fixtures/stand-in-proof"]' \
//   STAND_IN_PROOF_WAREHOUSE_URL=postgres://localhost/<your database>_standin_wh pnpm dev
//   node test-apps/fixtures/stand-in-proof/demo.mjs http://localhost:<API_PORT>
//
// Loopback only, and only a server that says it is a development instance.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const origin = new URL(process.argv[2] ?? 'http://localhost:8000').origin
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('This demo runs against a local server only')
const warehouseUrl = process.env.STAND_IN_PROOF_WAREHOUSE_URL
if (!warehouseUrl) throw new Error('Set STAND_IN_PROOF_WAREHOUSE_URL to the made-up warehouse database (the server needs the same variable)')
const csv = readFileSync(new URL('./targets.csv', import.meta.url), 'utf8')

let token
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + path, {
    method,
    headers: { 'content-type': 'application/json', 'X-Featherbase-App-Version': 'storesales@1.0.0', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(`${method} ${path} (${response.status}): ${answer.error?.message ?? JSON.stringify(answer)}`), { status: response.status })
  return answer
}

const ping = await request('/api/ping')
if (ping.environment !== 'development') throw new Error(`This demo runs on a development instance, not '${ping.environment}'`)
token = (await request('/api/login', { usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' })).token

// The made-up warehouse: sales it already has, and the targets it gets later.
const psql = (...args) => execFileSync('psql', [warehouseUrl, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PSQLRC: '/dev/null' } })
psql('-c', `drop schema if exists standin_proof cascade; create schema standin_proof;
  create table standin_proof.sales (store text, business_day date, amount numeric, units integer);
  create table standin_proof.targets (store text, month date, target numeric, units integer, confirmed boolean);
  insert into standin_proof.sales values
    ('Northgate', '2026-11-24', 182500.75, 410), ('Northgate', '2026-11-25', 176300, 395), ('Northgate', '2026-11-26', 191250.5, 428),
    ('Riverside', '2026-11-24', 91200, 230), ('Riverside', '2026-11-25', 88450.25, 221), ('Riverside', '2026-11-26', 97800, 246),
    ('Hilltop', '2026-11-24', 64300, 151), ('Hilltop', '2026-11-25', 61900.5, 147), ('Hilltop', '2026-11-26', 70150, 166);
  insert into standin_proof.targets values
    ('Northgate', '2026-11-01', 5200000, 11800, true), ('Riverside', '2026-11-01', 2650000, 6500, true), ('Hilltop', '2026-11-01', 1900000, 4400, true);`)

const exists = async (path) => request(path).then(() => true, (error) => (error.status === 404 ? false : Promise.reject(error)))
if (!(await request('/api/apps')).installed.some((app) => app.name === 'storesales')) await request('/api/install_app', { name: 'storesales' })
if (!(await exists('/api/table/Data%20Source/storesales-warehouse')))
  await request('/api/table/Data%20Source', { row_id: 'storesales-warehouse', engine: 'postgres', url_env: 'STAND_IN_PROOF_WAREHOUSE_URL', access: 'read_only' })

// `sales` is read once so the platform knows it is wanted, then refreshed from the warehouse.
await request('/api/app_reads/storesales/sales', { payload: {} })
await request('/api/enqueue_job', { method: 'refresh_datasets' })
const loaded = await request('/api/datasets/storesales/targets/load_stand_in', { csv, note: 'From the planning workbook, before the targets model lands.', expected_by: '2026-12-15' })
console.log(`Store Sales is ready: sales comes from the warehouse, and targets is a stand-in of ${loaded.rows} rows.`)
console.log(`Open the Store Sales page and the Admin's Datasets page on this instance's web address.`)
