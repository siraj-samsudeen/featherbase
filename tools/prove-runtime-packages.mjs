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
import { seedTasker, TASKER_SCENARIOS } from './seed-tasker-development.mjs'
import { proveTaskerAcceptance } from './prove-tasker-acceptance.mjs'

const root = resolve(import.meta.dirname, '..')
const taskerPackage = JSON.parse(await readFile(resolve(root, 'runtime-apps/tasker/package.json'), 'utf8'))
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
for (const name of ['tasker', 'other', 'action-proof']) {
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
async function api(path, body, status = 200, appVersion = `tasker@${taskerPackage.version}`) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(appVersion ? { 'X-Featherbase-App-Version': appVersion } : {}) },
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
  await api('/api/install_app', { name: 'actionproof' }, 201)
  const actionSource = await api('/api/save_row', { table: 'actionproof.work', row: { row_id: 'packaged-source', title: '73 packed units' } }, 201)
  const actionRequest = { idempotencyKey: 'packaged-action', payload: { source: actionSource.row_id, updatedAt: actionSource.updated_at } }
  await api('/api/app_actions/actionproof/transform', { ...actionRequest, payload: { ...actionRequest.payload, fail: true } }, 500)
  assert.equal((await api('/api/table/actionproof.destination')).total, 0)
  // @spec action_writes_and_replay_are_atomic
  const actionResults = await Promise.all(Array.from({ length: 8 }, () => api('/api/app_actions/actionproof/transform', actionRequest)))
  for (const result of actionResults) assert.deepEqual(result, actionResults[0])
  assert.equal((await api('/api/table/actionproof.destination')).total, 1)
  const actionActivity = await api(`/api/activity/actionproof.work/${actionSource.row_id}`)
  assert.equal(actionActivity.comments.length, 1)
  assert.equal(actionActivity.versions.length, 1)
  // @spec guarded_action_deletion_preserves_retained_work.core_attachment_and_share_refusal_replays
  const retainedSource = await api('/api/save_row', { table: 'actionproof.work', row: { row_id: 'packaged-retained', title: 'Retain 47 units' } }, 201)
  for (const file_name of ['invoice-17.txt', 'photo-43.png'])
    await api('/api/save_row', { table: 'File', row: { file_name, ref_table: 'actionproof.work', ref_name: retainedSource.row_id } }, 201)
  await api('/api/save_row', { table: 'Share', row: { share_table: 'actionproof.work', share_name: retainedSource.row_id, user: 'Administrator', read: true } }, 201)
  const retentionRequest = { idempotencyKey: 'packaged-retention', payload: { source: retainedSource.row_id, updatedAt: retainedSource.updated_at, explain: true } }
  await api('/api/app_actions/actionproof/transform', { idempotencyKey: 'retention-rollback', payload: { ...retentionRequest.payload, fail: true } }, 500)
  const retentionResult = await api('/api/app_actions/actionproof/discard', retentionRequest)
  assert.deepEqual(retentionResult, { result: { deleted: false, counts: { comments: 0, versions: 0, references: 0, files: 2, shares: 1 } } })
  assert.equal((await api('/api/table/actionproof.destination')).total, 1)
  const seeded = await seedTasker({
    baseUrl: origin,
    password: process.env.ADMIN_PASSWORD ?? 'admin',
    expectedEnvironment: 'test',
    log: (message) => console.log(`SEEDED ${message}`),
  })
  await api('/api/save_row', { table: 'tasker.task', row: {
    task_title: 'Impossible dual destination',
    project: seeded.projects['DEV-TASKER-PROJECT-STOCK-REVIEW'],
    personal_tasks_owner: 'Administrator',
  } }, 417)
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.goto(`${origin}/tasker/`)
  await page.waitForURL('**/featherbase/login?next=%2Ftasker%2F')
  await page.locator('input[name=email]').fill('Administrator')
  await page.locator('input[name=password]').fill(process.env.ADMIN_PASSWORD ?? 'admin')
  await page.locator('button[type=submit]').click()
  await expect(page).toHaveURL(`${origin}/tasker/`)
  await page.goto(`${origin}/admin/User?proof=compatibility#deep-link`)
  await expect(page).toHaveURL(`${origin}/featherbase/admin/User?proof=compatibility#deep-link`)
  await page.locator('a[href="/tasker/"]').click()
  await expect(page).toHaveURL(`${origin}/tasker/`)
  await proveTaskerAcceptance({ page, api, expect, output, origin })
  await expect(page.getByText('Triage supplier invoice mismatch')).toBeVisible()
  await expect(page.getByText('Collect ideas for the Monday review')).toBeVisible()
  await expect(page.getByText('Blocked until the warehouse confirms the night-shift roster.')).toBeVisible()
  const urgentInbox = page.locator('article').filter({ hasText: 'Triage supplier invoice mismatch' })
  const ordinaryInbox = page.locator('article').filter({ hasText: 'Collect ideas for the Monday review' })
  await expect(urgentInbox.getByRole('button', { name: /Remove urgent flag/ })).toHaveText(/Urgent/)
  await expect(ordinaryInbox.getByRole('button', { name: /Mark urgent/ })).toHaveText(/Not urgent/)
  await page.screenshot({ path: resolve(output, 'seeded-inbox.png'), fullPage: true })

  await page.getByRole('button', { name: /My Work/ }).click()
  const workTitles = await page.locator('main article a[href^="#task="]').allTextContents()
  assert.deepEqual(workTitles.slice(0, 3), TASKER_SCENARIOS.focus.map(id => TASKER_SCENARIOS.tasks.find(task => task.row_id === id).task_title))
  await page.screenshot({ path: resolve(output, 'seeded-my-work.png'), fullPage: true })

  await page.getByRole('button', { name: 'Projects' }).click()
  await page.getByLabel('Projects', { exact: true }).getByRole('button', { name: 'September stock review', exact: true }).click()
  await expect(page.getByText('Reconcile the first stock variance')).toBeVisible()
  await expect(page.getByLabel('Starred projects').getByRole('button', { name: 'September stock review' })).toBeVisible()
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByRole('textbox', { name: 'Rename project' }).fill('Stock review — September')
  await page.getByRole('textbox', { name: 'Rename project' }).press('Enter')
  await expect(page.getByRole('heading', { name: 'Stock review — September' })).toBeVisible()
  const unassignedProjectTask = page.locator('article').filter({ hasText: 'Photograph the receiving bay' })
  await unassignedProjectTask.getByRole('button', { name: 'Take it' }).click()
  await expect(unassignedProjectTask.getByRole('button', { name: 'Take it' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Together' }).click()
  await expect(page.getByRole('heading', { name: /Unassigned/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Administrator/ })).toBeVisible()
  await expect(page.getByText('Archive last month’s launch checklist')).toHaveCount(0)
  await page.screenshot({ path: resolve(output, 'together.png'), fullPage: true })

  await page.getByRole('button', { name: /My Work/ }).click()
  const seededTask = page.locator('article').filter({ hasText: 'Reconcile the first stock variance' })
  const seededDone = seededTask.getByRole('checkbox', { name: 'Mark Reconcile the first stock variance done' })
  await seededDone.click()
  await expect(seededDone).toBeChecked()
  await expect(seededTask.getByRole('combobox', { name: 'State for Reconcile the first stock variance' })).toHaveValue('Done')
  await seededDone.click()
  await expect(seededDone).not.toBeChecked()
  await expect(seededTask.getByRole('combobox', { name: 'State for Reconcile the first stock variance' })).toHaveValue('In progress')

  await page.getByRole('button', { name: /Inbox/ }).click()
  const capture = page.getByRole('textbox', { name: 'Quick capture' })
  await capture.fill('Package-delivered stock review')
  await capture.press('Enter')
  await expect(page.getByText('Package-delivered stock review')).toBeVisible()
  const packageTaskRow = page.locator('article').filter({ hasText: 'Package-delivered stock review' })
  await packageTaskRow.getByRole('button', { name: 'Take it' }).click()
  await expect(packageTaskRow.getByRole('button', { name: 'Take it' })).toHaveCount(0)
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
  await page.getByRole('button', { name: 'Inspector', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Inspector', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Edit task', exact: true }).click()
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Delivered after the core artifact was frozen.')
  await page.getByRole('button', { name: 'Save task', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit task', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Add comment' }).fill('Verified in the independently built Tasker package.')
  await page.getByRole('button', { name: 'Comment' }).click()
  await expect(page.getByTestId('task-activity')).toContainText('Verified in the independently built Tasker package.')
  await expect(page.getByTestId('task-activity')).toContainText('description: empty → Delivered after the core artifact was frozen.')
  const inspectorBox = await page.getByRole('complementary', { name: 'Task details' }).boundingBox()
  const captureBox = await capture.boundingBox()
  assert(inspectorBox && captureBox)
  assert(
    captureBox.x + captureBox.width <= inspectorBox.x,
    `Task inspector overlaps quick capture: ${JSON.stringify({ captureBox, inspectorBox })}`,
  )
  await page.screenshot({ path: resolve(output, 'inspector.png'), fullPage: true })
  await page.getByRole('button', { name: 'Focus', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Focused task details' })).toBeVisible()
  await page.screenshot({ path: resolve(output, 'focus-detail.png'), fullPage: true })
  await page.getByRole('button', { name: 'Compact', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Focused task details' })).toHaveCount(0)
  await page.screenshot({ path: resolve(output, 'compact-detail.png'), fullPage: true })
  await page.getByRole('button', { name: 'Inspector', exact: true }).click()
  for (const [width, screenshot] of [[900, 'inspector-tablet.png'], [375, 'inspector-mobile.png']]) {
    await page.setViewportSize({ width, height: 400 })
    const compactInspectorBox = await page.getByRole('complementary', { name: 'Task details' }).boundingBox()
    assert(compactInspectorBox)
    assert.equal(compactInspectorBox.x, 0)
    assert.equal(compactInspectorBox.width, width)
    await expect(page.getByRole('link', { name: 'Close' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('tasker-compact-inspector-open'))).toBe(true)
    const lockedAt = await page.evaluate(() => ({
      top: document.documentElement.scrollTop,
      locked: document.documentElement.classList.contains('tasker-compact-inspector-open'),
      overflow: getComputedStyle(document.body).overflow,
    }))
    assert(lockedAt.locked)
    assert.equal(lockedAt.overflow, 'hidden')
    const inspector = page.getByRole('complementary', { name: 'Task details' })
    await inspector.evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: resolve(output, screenshot) })
    assert(await inspector.evaluate(element => element.scrollHeight > element.clientHeight))
    await inspector.hover()
    await page.mouse.wheel(0, 250)
    assert.equal(await page.evaluate(() => document.documentElement.scrollTop), lockedAt.top)
    await inspector.evaluate(element => { element.scrollTop = 100 })
    assert((await inspector.evaluate(element => element.scrollTop)) > 0)
  }
  await page.getByRole('link', { name: 'Close' }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('tasker-compact-inspector-open'))).toBe(false)
  await page.evaluate(() => window.scrollTo(0, 200))
  assert((await page.evaluate(() => window.scrollY)) > 0)
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const packageFilter = encodeURIComponent(JSON.stringify([['task_title', '=', 'Package-delivered stock review']]))
  const packageTask = (await api(`/api/table/tasker.task?filters=${packageFilter}&fields=%5B%22row_id%22%5D`)).data[0]
  assert(packageTask, 'Captured package task is absent from the API')
  const task = await api(`/api/table/tasker.task/${packageTask.row_id}`)
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
  assert.deepEqual(await api('/api/app_actions/actionproof/transform', actionRequest), actionResults[0])
  assert.deepEqual(await api('/api/app_actions/actionproof/discard', retentionRequest), retentionResult)
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
  await api('/api/app_actions/actionproof/transform', actionRequest, 403)
  await api('/api/run_query_report', { report: 'Raw Tasker report' }, 417)
  await api('/api/save_row', { table: 'tasker.task', row: { ...task, is_done: true } }, 403)
  assert((await api('/api/apps')).installed.some(a => a.name === 'tasker' && !a.available && !a.active))
  await stop()
  await start(paths)
  assert.deepEqual(await api('/api/app_actions/actionproof/transform', actionRequest), actionResults[0])
  await writeFile(resolve(output, 'action-evidence.json'), JSON.stringify({
    database: new URL(database).pathname, source: actionSource.row_id,
    result: actionResults[0], concurrentIdenticalRequests: actionResults.length,
    destinationCount: (await api('/api/table/actionproof.destination')).total,
    activity: actionActivity, rollbackBeforeRetry: true, restartReplay: true,
    missingCodeRefused: true, restoredReplay: true,
    retentionResult, retentionRollbackAndRestart: true,
  }, null, 2))
  assert.equal((await api(`/api/table/tasker.task/${task.row_id}`)).description, task.description)
  // @spec runtime_upgrade_preserves_owned_work.tasker_description_is_generic_migration
  // Independently prove preserved v1 -> the literal current v2 package.
  // Reset only this same stamped disposable database after stopping the server.
  await stop()
  run('pnpm', ['--filter', 'server', 'e2e:reset'])
  run('pnpm', ['--filter', 'server', 'migrate'])
  run('pnpm', ['--filter', 'server', 'patches'])
  const v1 = resolve(output, 'preserved-tasker-v1')
  await cp(resolve(root, 'runtime-apps/fixtures/tasker-v1'), v1, { recursive: true })
  const v2 = paths[0]
  const v1Digest = await digest(v1)
  const upgradePaths = [v1, v2, ...paths.slice(1)]
  await start([v1, ...paths.slice(1)])
  token = (await api('/api/login', { usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' })).token
  await api('/api/install_app', { name: 'tasker' }, 201)
  const projectBefore = await api('/api/save_row', { table: 'tasker.project', row: { project_name: 'Preserved upgrade project' } }, 201)
  const projectId = projectBefore.row_id
  const preservedTask = await api('/api/save_row', { table: 'tasker.task', row: {
    task_title: 'Preserved 37 cartons', project: projectId, assigned_to: 'Administrator', urgent: true, task_state: 'Blocked',
  } }, 201)
  await api('/api/save_row', { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: preservedTask.row_id, content: 'Retain this evidence' } }, 201)
  await page.goto(`${origin}/tasker/`)
  await page.evaluate(token => localStorage.setItem('fc_token', token), token)
  const preferencesBefore = await api('/api/user_settings/tasker.preferences')
  const commentsBefore = await api('/api/table/Comment?limit_page_length=1000')
  await stop()
  await start(upgradePaths)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tasker v1 upgrade fixture' })).toBeVisible()
  const plan = await api('/api/preview_app_upgrade', { name: 'tasker', version: '2.0.0' })
  assert.equal(plan.currentVersion, '0.0.1')
  assert.deepEqual(plan.tables, ['tasker.project'])
  assert.equal(plan.migrations[0].id, 'project_description')
  // Restart before commit does not silently upgrade.
  await stop()
  await start(upgradePaths)
  assert.deepEqual(await api(`/api/table/tasker.project/${projectId}`), projectBefore)
  const upgrade = { name: 'tasker', version: '2.0.0', planId: plan.planId }
  await api('/api/upgrade_app', upgrade)
  await api('/api/table/tasker.project', undefined, 403)
  await stop()
  await start(upgradePaths)
  assert.equal((await api('/api/apps')).installed.find(a => a.name === 'tasker').activationPending, true)
  await api('/api/upgrade_app', upgrade)
  await api('/api/activate_app_upgrade', { name: 'tasker', version: '2.0.0' })
  // The retained v1 browser cannot write against the upgraded contract.
  const staleBrowser = await page.evaluate(async () => {
    const response = await fetch('/api/save_row', { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('fc_token')}`,
      'X-Featherbase-App-Version': 'tasker@0.0.1',
    }, body: JSON.stringify({ table: 'tasker.task', row: { task_title: 'Must not save from v1' } }) })
    return { status: response.status, body: await response.json() }
  })
  assert.equal(staleBrowser.status, 409)
  assert.match(staleBrowser.body.error.message, /was upgraded/)
  const upgradedProject = await api(`/api/table/tasker.project/${projectId}`, undefined, 200, 'tasker@2.0.0')
  assert.deepEqual(upgradedProject, { ...projectBefore, description: null })
  const description = '## Upgrade proof\n\n**37** cartons; keep the original project.'
  await api('/api/save_row', { table: 'tasker.project', row: { ...upgradedProject, description } }, 201, 'tasker@2.0.0')
  assert.deepEqual(await api('/api/user_settings/tasker.preferences'), preferencesBefore)
  assert.deepEqual(await api('/api/table/Comment?limit_page_length=1000'), commentsBefore)
  await page.reload()
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: 'Open project Preserved upgrade project' }).click()
  await expect(page.getByRole('region', { name: 'Project description' })).toContainText('37 cartons')
  await expect(page.getByRole('link', { name: 'Preserved 37 cartons' })).toBeVisible()
  await page.screenshot({ path: resolve(output, 'upgraded-project-markdown.png'), fullPage: true })
  const browserRead = await page.evaluate(async id => {
    const response = await fetch(`/api/table/tasker.project/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('fc_token')}`, 'X-Featherbase-App-Version': 'tasker@2.0.0' } })
    return { status: response.status, row: await response.json() }
  }, projectId)
  assert.equal(browserRead.status, 200)
  assert.equal(browserRead.row.description, description)
  assert.deepEqual(await api(`/api/table/tasker.task/${preservedTask.row_id}`), preservedTask)
  await stop()
  await start([v1, ...paths.slice(1)]) // Prior artifact is not a rollback for committed schema.
  await api('/api/table/tasker.project', undefined, 403, 'tasker@2.0.0')
  await stop()
  await start(upgradePaths)
  assert.equal((await api(`/api/table/tasker.project/${projectId}`, undefined, 200, 'tasker@2.0.0')).description, description)
  assert.equal(await digest(v1), v1Digest, 'Prior artifact was modified')
  await writeFile(resolve(output, 'upgrade-evidence.json'), JSON.stringify({
    plan, priorArtifact: v1, targetArtifact: v2, priorUnchanged: true,
    browserRead, restartBeforeCommit: true, restartPendingActivation: true,
    staleBrowserRejected: true, restoredTargetAfterMissing: true,
  }, null, 2))
  assert.equal(await digest(core), before, 'Core changed after package staging')
  assert.equal(await digest(resolve(root, 'packages/shared')), sharedBefore, 'Shared core dependency changed')
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ coreHash: before, coreUnchanged: true, stagedPackages: paths, database: new URL(database).pathname, seededScenarios: TASKER_SCENARIOS, seededRows: seeded, journeys: ['install', 'seed', 'inbox-content', 'projects-content', 'project-rename', 'private-project-tabs', 'together', 'private-focus-order', 'urgent-and-not-urgent', 'blocked-explanation', 'invalid-dual-destination', 'capture', 'self-assign', 'complete', 'undo-state-restoration', 'integrated-comment-history', 'three-detail-modes', 'inspect-responsive', 'disable-stale-client', 'restart', 'enable', 'missing-code', 'restore'], screenshots: ['seeded-inbox.png', 'seeded-my-work.png', 'together.png', 'desktop.png', 'inspector.png', 'focus-detail.png', 'compact-detail.png', 'inspector-tablet.png', 'inspector-mobile.png', 'mobile.png', 'disabled.png', 'unavailable.png'] }, null, 2))
  console.log(`PKG-J1 PKG-J2 PASS — frozen core unchanged; evidence: ${output}`)
} finally {
  await browser?.close()
  await stop()
}
