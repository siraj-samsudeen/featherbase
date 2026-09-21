// Literal artifact-order proof. Only the dedicated, stamped *_e2e database
// is disposable; never point this command at a development database.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const requireWeb = createRequire(resolve(root, 'apps/web/package.json'))
const { chromium, expect } = requireWeb('@playwright/test')
const postgres = requireWeb('postgres')
const database = process.env.RUNTIME_PROOF_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/featherbase_runtime_proof_e2e'
assert(new URL(database).pathname.endsWith('_e2e'), 'Proof database must end in _e2e')
const port = process.env.RUNTIME_PROOF_PORT ?? '8496'
const origin = `http://localhost:${port}`
const env = { ...process.env, DATABASE_URL: database, FEATHERBASE_ENV: 'test', PORT: port }
await mkdir(resolve(root, 'dist'), { recursive: true })
const output = await mkdtemp(resolve(root, 'dist/runtime-proof-'))
const core = resolve(output, 'core')
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`)
}
async function digest(directory) {
  const hash = createHash('sha256')
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue
      const file = resolve(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else hash.update(file.slice(directory.length)).update(await readFile(file))
    }
  }
  await walk(directory)
  return hash.digest('hex')
}

// Freeze core FIRST. tsc preserves boot-discovered controller/job modules.
run('pnpm', ['--filter', 'web', 'build'])
run('pnpm', ['--filter', 'server', 'exec', 'tsc', '--noEmit', 'false', '--outDir', resolve(core, 'apps/server')])
run('pnpm', ['--filter', 'shared', 'exec', 'tsc', '--noEmit', 'false', '--outDir', resolve(core, 'packages/shared')])
// tsc keeps extensionless imports. Make emitted JS resolve files rather than
// same-named controller/job directories; the source tree is never rewritten.
for (const entry of await readdir(core, { recursive: true })) {
  if (!entry.endsWith('.js')) continue
  const file = resolve(core, entry)
  const code = await readFile(file, 'utf8')
  await writeFile(file, code.replace(/((?:from\s*|import\s*(?:\(\s*)?)['"])(\.[^'"]+)(['"])/g,
    (match, prefix, specifier, quote) => existsSync(resolve(dirname(file), `${specifier}.js`))
      ? `${prefix}${specifier}.js${quote}` : match))
}
await cp(resolve(root, 'apps/web/dist'), resolve(core, 'apps/web/dist'), { recursive: true })
await writeFile(resolve(core, 'package.json'), '{"type":"module"}')
await writeFile(resolve(core, 'packages/shared/package.json'), '{"name":"shared","type":"module","main":"src/index.js"}')
await symlink(resolve(root, 'packages/shared/node_modules'), resolve(core, 'packages/shared/node_modules'))
await mkdir(resolve(core, 'apps/server/node_modules'))
for (const name of await readdir(resolve(root, 'apps/server/node_modules'))) {
  await symlink(name === 'shared' ? resolve(core, 'packages/shared') : resolve(root, 'apps/server/node_modules', name),
    resolve(core, 'apps/server/node_modules', name))
}
const before = await digest(core)
const sharedBefore = await digest(resolve(root, 'packages/shared'))
console.log(`CORE FROZEN ${before}`)

// Only now build and deliver the packages. Runtime reads the unpacked npm
// tarballs, not source directories or a workspace module import.
run('pnpm', ['apps:prepare'])
const paths = []
for (const name of ['tasker', 'other']) {
  const destination = resolve(output, name)
  await mkdir(destination)
  run('npm', ['pack', '--pack-destination', destination], resolve(root, 'runtime-apps', name))
  const archive = (await readdir(destination)).find(file => file.endsWith('.tgz'))
  run('tar', ['-xzf', resolve(destination, archive), '-C', destination])
  paths.push(resolve(destination, 'package'))
}
run('pnpm', ['--filter', 'server', 'e2e:reset'])
run('pnpm', ['--filter', 'server', 'migrate'])
run('pnpm', ['--filter', 'server', 'patches'])
let server
let browser
async function start(configured) {
  server = spawn(process.execPath, [resolve(core, 'apps/server/src/index.js')], {
    cwd: resolve(root, 'apps/server'), env: { ...env, FEATHERBASE_APP_PATHS: JSON.stringify(configured) }, stdio: 'inherit',
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(server.exitCode, null, 'Frozen server exited before ready')
    if (await fetch(`${origin}/api/ping`).then(r => r.ok).catch(() => false)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Frozen server did not become ready')
}
async function stop() {
  if (!server || server.exitCode !== null) return
  const exited = once(server, 'exit')
  server.kill('SIGTERM')
  await exited
}
let token
async function api(path, body, status = 200) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json()
  assert.equal(response.status, status, JSON.stringify(result))
  return result
}
try {
  await start(paths)
  token = (await api('/api/login', { usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' })).token
  for (const name of ['tasker', 'other']) await api('/api/install_app', { name }, 201)
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.goto(`${origin}/login`)
  await page.locator('input[name=email]').fill('Administrator')
  await page.locator('input[name=password]').fill(process.env.ADMIN_PASSWORD ?? 'admin')
  await page.locator('button[type=submit]').click()
  await page.waitForURL('**/admin**')
  await page.locator('a[href="/tasker/"]').click()
  await expect(page).toHaveURL(`${origin}/tasker/`)
  const capture = page.getByRole('textbox', { name: 'Quick capture' })
  await capture.fill('Package-delivered stock review')
  await capture.press('Enter')
  await expect(page.getByText('Package-delivered stock review')).toBeVisible()
  await page.getByRole('button', { name: 'Take it' }).click()
  await expect(page.getByRole('button', { name: 'Take it' })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'State for Package-delivered stock review' }).selectOption('In progress')
  await expect(page.getByRole('combobox', { name: 'State for Package-delivered stock review' })).toHaveValue('In progress')
  const done = page.getByRole('checkbox', { name: 'Mark Package-delivered stock review done' })
  await done.click()
  await expect(done).toBeChecked()
  await expect(page.getByRole('combobox', { name: 'State for Package-delivered stock review' })).toHaveValue('Done')
  await done.click()
  await expect(done).not.toBeChecked()
  await expect(page.getByRole('combobox', { name: 'State for Package-delivered stock review' })).toHaveValue('In progress')
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true })
  await page.getByRole('link', { name: 'Package-delivered stock review' }).click()
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Delivered after the core artifact was frozen.')
  await page.getByRole('button', { name: 'Save description' }).click()
  await expect(page.getByRole('button', { name: 'Save description' })).toBeEnabled()
  await page.screenshot({ path: resolve(output, 'inspector.png'), fullPage: true })
  await page.getByRole('link', { name: 'Close details' }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const firstTask = (await api('/api/table/tasker.task')).data[0]
  const task = await api(`/api/table/tasker.task/${firstTask.row_id}`)
  assert.equal(task.description, 'Delivered after the core artifact was frozen.')
  await api('/api/save_row', { table: 'other.task', row: { row_id: task.row_id, quantity: 37 } }, 201)
  const directUrl = new URL(process.env.QUERY_REPORT_DATABASE_URL ?? database)
  if (!process.env.QUERY_REPORT_DATABASE_URL) {
    directUrl.username = 'app_client'
    directUrl.password = 'app_client'
  }
  const direct = postgres(directUrl.toString(), { max: 1 })
  try {
    await assert.rejects(direct.begin(async tx => {
      await tx.unsafe('select * from other.task')
    }), error => error.code === '42501')
  } finally { await direct.end() }
  await api('/api/save_row', { table: 'Report', row: {
    row_id: 'Raw Tasker report', ref_table: 'User', report_type: 'Query Report',
    query: "select query_to_xml('select * from tasker.task', true, false, set_config('role', 'none', true))",
  } }, 201)
  await api('/api/run_query_report', { report: 'Raw Tasker report' }, 417)
  await api('/api/set_app_enabled', { name: 'tasker', enabled: false })
  // The browser is still open: this is a stale client, not just a new denied GET.
  await capture.fill('Must not save after disabling')
  await capture.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'disabled or unavailable' }).first()).toBeVisible()
  await page.screenshot({ path: resolve(output, 'disabled.png'), fullPage: true })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Application unavailable' })).toBeVisible()
  await page.screenshot({ path: resolve(output, 'unavailable.png'), fullPage: true })
  assert.deepEqual((await api('/api/app_catalog')).map(a => a.name), ['other'])
  let other = await api(`/api/table/other.task/${task.row_id}`)
  other = await api('/api/save_row', { table: 'other.task', row: { ...other, quantity: 23 } }, 201)
  await api('/api/run_query_report', { report: 'Raw Tasker report' }, 417)
  assert.equal(other.validation_runs, '2')
  await stop()
  await start(paths)
  await api('/api/table/tasker.task', undefined, 403)
  await api('/api/set_app_enabled', { name: 'tasker', enabled: true })
  await api('/api/set_app_enabled', { name: 'tasker', enabled: true })
  assert.equal((await api(`/api/table/tasker.task/${task.row_id}`)).task_state, 'In progress')
  other = await api('/api/save_row', { table: 'other.task', row: { ...other, quantity: 19 } }, 201)
  assert.equal(other.validation_runs, '3')
  await page.reload()
  await expect(page.getByText('Package-delivered stock review')).toBeVisible()
  await stop()
  await start([paths[1]])
  await api('/api/run_query_report', { report: 'Raw Tasker report' }, 417)
  await api('/api/save_row', { table: 'tasker.task', row: { ...task, is_done: true } }, 403)
  assert((await api('/api/apps')).installed.some(a => a.name === 'tasker' && !a.available && !a.active))
  await stop()
  await start(paths)
  assert.equal((await api(`/api/table/tasker.task/${task.row_id}`)).description, task.description)
  assert.equal(await digest(core), before, 'Core changed after package staging')
  assert.equal(await digest(resolve(root, 'packages/shared')), sharedBefore, 'Shared core dependency changed')
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ coreHash: before, coreUnchanged: true, stagedPackages: paths, database: new URL(database).pathname, journeys: ['install', 'capture', 'assign', 'complete', 'undo', 'inspect', 'disable-stale-client', 'restart', 'enable', 'missing-code', 'restore'], screenshots: ['desktop.png', 'inspector.png', 'mobile.png', 'disabled.png'] }, null, 2))
  console.log(`PKG-J1 PKG-J2 PASS — frozen core unchanged; evidence: ${output}`)
} finally {
  await browser?.close()
  await stop()
}
