import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { TASKER_SCENARIOS } from '../example-apps/tasker/development/scenarios.mjs'
export { TASKER_SCENARIOS }
const { version } = JSON.parse(readFileSync(new URL('../example-apps/tasker/package.json', import.meta.url), 'utf8'))

export function requireLoopback(rawUrl) {
  const url = new URL(rawUrl)
  assert(['http:', 'https:'].includes(url.protocol), 'Tasker seed URL must use HTTP(S)')
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Tasker seed refuses non-loopback URLs')
  return url.origin
}

function query(filters, fields = ['row_id']) {
  return `?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}&limit_page_length=20`
}

export async function seedTasker({ baseUrl, password = 'admin', expectedEnvironment = 'development', fetchImpl = fetch, log = console.log }) {
  const origin = requireLoopback(baseUrl)
  let token
  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${origin}${path}`, {
      method,
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `tasker@${version}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.redirected || new URL(response.url).origin !== origin) {
      throw new Error(`${method} ${path} refused a redirect or cross-origin response`)
    }
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${result.error?.message ?? JSON.stringify(result)}`)
    return result
  }
  const identity = await request('/api/ping')
  if (identity.message !== 'pong' || identity.environment !== expectedEnvironment) {
    throw new Error(`Tasker seed expected Featherbase environment '${expectedEnvironment}', got '${identity.environment ?? 'unknown'}'`)
  }
  if (identity.database_server_local !== true) throw new Error('Tasker seed refuses a remote PostgreSQL server')
  token = (await request('/api/login', { method: 'POST', body: { usr: 'Administrator', pwd: password } })).token
  // This development fixture explicitly admits its known example accounts.
  // Installing Tasker never admits administrators or other people implicitly.
  const installed = await request('/api/apps')
  if (!installed.installed.some(app => app.name === 'tasker' && app.enabled))
    throw new Error('Tasker must be installed and enabled before seeding')
  async function admit(personId) {
    const person = await request(`/api/table/Person/${encodeURIComponent(personId)}`)
    if (!person.roles.some(row => row.role === 'Tasker Member')) await request('/api/save_row', {
      method: 'POST', body: { table: 'Person', row: { row_id: person.row_id, updated_at: person.updated_at, roles: [...person.roles, { role: 'Tasker Member' }] } },
    })
  }
  await admit('Administrator')
  const catalog = await request('/api/app_catalog')
  if (!catalog.some((app) => app.name === 'tasker')) throw new Error('Tasker must be installed and enabled before seeding')

  async function ensure(table, key, value, row, identity = {}) {
    const fields = [...new Set(['row_id', key, ...Object.keys(identity)])]
    const found = (await request(`/api/table/${encodeURIComponent(table)}${query([[key, '=', value]], fields)}`)).data
    if (found.length) {
      for (const [field, expected] of Object.entries(identity)) {
        if (found[0][field] !== expected)
          throw new Error(`Tasker seed ID collision in ${table}: ${value} has unexpected ${field}`)
      }
      return found[0]
    }
    return request(`/api/table/${encodeURIComponent(table)}`, { method: 'POST', body: row })
  }
  // person-rename: people are found by email and get minted psn_ ids; a
  // scenario names a person by email.
  const people = new Map()
  for (const user of TASKER_SCENARIOS.users) {
    const person = await ensure('Person', 'email', user.email, user, { full_name: user.full_name })
    await admit(person.row_id)
    people.set(user.email, person.row_id)
  }
  const personId = (value) => (value && people.has(value) ? people.get(value) : value)
  for (const store of TASKER_SCENARIOS.stores)
    await ensure('tasker.store', 'row_id', store.row_id, store, { store_name: store.store_name })
  const projects = new Map()
  for (const scenario of TASKER_SCENARIOS.projects) {
    const project = await ensure('tasker.project', 'row_id', scenario.row_id, scenario, { project_name: scenario.project_name })
    projects.set(scenario.row_id, project.row_id)
  }
  const tasks = new Map()
  for (const scenario of TASKER_SCENARIOS.tasks) {
    const { explanation, comments = [], project, after = [], ...values } = scenario
    const existed = (await request(`/api/table/tasker.task${query([['row_id', '=', scenario.row_id]])}`)).data.length > 0
    const task = await ensure('tasker.task', 'row_id', scenario.row_id, {
      ...values,
      ...(values.assigned_to ? { assigned_to: personId(values.assigned_to) } : {}),
      ...(values.verifier ? { verifier: personId(values.verifier) } : {}),
      ...(values.personal_tasks_owner ? { personal_tasks_owner: personId(values.personal_tasks_owner) } : {}),
      ...(project ? { project: projects.get(project) } : {}),
    }, { task_title: scenario.task_title })
    tasks.set(scenario.row_id, task.row_id)
    // Later steps (submitting, moving a date) run once, when the task is first created.
    let current = task
    if (!existed) for (const step of after)
      current = await request('/api/save_row', { method: 'POST', body: { table: 'tasker.task', row: { row_id: task.row_id, updated_at: current.updated_at, ...step } } })
    for (const content of [...(explanation ? [explanation] : []), ...comments]) {
      const filters = [['ref_table', '=', 'tasker.task'], ['ref_name', '=', task.row_id], ['content', '=', content]]
      const comments = (await request(`/api/table/Comment${query(filters)}`)).data
      if (!comments.length) await request('/api/save_row', { method: 'POST', body: { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: task.row_id, content } } })
    }
  }
  // Issues: store managers and function heads are set only where none is named yet.
  for (const [storeId, person] of Object.entries(TASKER_SCENARIOS.storeManagers ?? {})) {
    const store = await request(`/api/table/tasker.store/${encodeURIComponent(storeId)}`)
    if (!store.store_manager) await request('/api/save_row', { method: 'POST', body: { table: 'tasker.store', row: { row_id: store.row_id, updated_at: store.updated_at, store_manager: personId(person) } } })
  }
  for (const [owner_function, person] of Object.entries(TASKER_SCENARIOS.functionHeads ?? {}))
    await ensure('tasker.function_head', 'owner_function', owner_function, { owner_function, head: personId(person) })
  for (const rule of TASKER_SCENARIOS.slaRules ?? []) await ensure('tasker.sla_rule', 'row_id', rule.row_id, rule)
  let issueCount = 0
  for (const scenario of TASKER_SCENARIOS.issues ?? []) {
    const { after = [], ...values } = scenario
    const existed = (await request(`/api/table/tasker.issue${query([['row_id', '=', scenario.row_id]])}`)).data.length > 0
    let issue = await ensure('tasker.issue', 'row_id', scenario.row_id, {
      ...values, owner: personId(values.owner) ?? null, verifier: personId(values.verifier) ?? null,
    }, { issue_title: scenario.issue_title })
    // Read the issue before each step: the escalation job re-saves open issues, so the previous save's updated_at can be stale.
    if (!existed) for (const step of after) {
      const { updated_at } = await request(`/api/table/tasker.issue/${encodeURIComponent(issue.row_id)}`)
      issue = await request('/api/save_row', { method: 'POST', body: { table: 'tasker.issue', row: { row_id: issue.row_id, updated_at, ...step } } })
    }
    issueCount++
  }
  log(`Tasker issues ready (${issueCount} issues)`)
  const focusPath = `/api/user_settings/${encodeURIComponent('Task Management Focus')}`
  const current = (await request(focusPath)).settings?.task_ids ?? []
  const seededFocus = TASKER_SCENARIOS.focus.map((id) => tasks.get(id))
  const task_ids = [...seededFocus, ...current.filter((id) => !seededFocus.includes(id))]
  await request(focusPath, { method: 'PUT', body: { task_ids } })
  await request(`/api/user_settings/${encodeURIComponent('tasker.projects')}`, {
    method: 'PUT', body: { project_ids: TASKER_SCENARIOS.projectStars.map((id) => projects.get(id)) },
  })
  await request(`/api/user_settings/${encodeURIComponent('tasker.preferences')}`, {
    method: 'PUT', body: { mode: TASKER_SCENARIOS.detailMode },
  })
  log(`Tasker development scenarios ready at ${origin}/tasker/ (${tasks.size} tasks, ${projects.size} projects, ${TASKER_SCENARIOS.stores.length} stores)`)
  return { origin, projects: Object.fromEntries(projects), tasks: Object.fromEntries(tasks), focus: task_ids }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
  await seedTasker({
    baseUrl: arg('--url') ?? process.env.FEATHERBASE_URL ?? 'http://127.0.0.1:8000',
    password: process.env.ADMIN_PASSWORD ?? 'admin',
    expectedEnvironment: arg('--expected-environment') ?? 'development',
  })
}
