import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { TASKER_SCENARIOS } from '../runtime-apps/tasker/development/scenarios.mjs'
export { TASKER_SCENARIOS }

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
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  const catalog = await request('/api/app_catalog')
  if (!catalog.some((app) => app.name === 'tasker')) throw new Error('Tasker must be installed and enabled before seeding')

  async function ensure(table, key, value, row) {
    const found = (await request(`/api/table/${encodeURIComponent(table)}${query([[key, '=', value]], ['row_id', key])}`)).data
    if (found.length) return found[0]
    return request(`/api/table/${encodeURIComponent(table)}`, { method: 'POST', body: row })
  }
  for (const user of TASKER_SCENARIOS.users) await ensure('User', 'row_id', user.row_id, user)
  const projects = new Map()
  for (const scenario of TASKER_SCENARIOS.projects) {
    const project = await ensure('tasker.project', 'row_id', scenario.row_id, scenario)
    projects.set(scenario.row_id, project.row_id)
  }
  const tasks = new Map()
  for (const scenario of TASKER_SCENARIOS.tasks) {
    const { explanation, project, ...values } = scenario
    const task = await ensure('tasker.task', 'row_id', scenario.row_id, {
      ...values,
      ...(project ? { project: projects.get(project) } : {}),
    })
    tasks.set(scenario.row_id, task.row_id)
    if (explanation) {
      const filters = [['ref_table', '=', 'tasker.task'], ['ref_name', '=', task.row_id], ['content', '=', explanation]]
      const comments = (await request(`/api/table/Comment${query(filters)}`)).data
      if (!comments.length) await request('/api/save_row', { method: 'POST', body: { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: task.row_id, content: explanation } } })
    }
  }
  const focusPath = `/api/user_settings/${encodeURIComponent('Task Management Focus')}`
  const current = (await request(focusPath)).settings?.task_ids ?? []
  const seededFocus = TASKER_SCENARIOS.focus.map((id) => tasks.get(id))
  const task_ids = [...seededFocus, ...current.filter((id) => !seededFocus.includes(id))]
  await request(focusPath, { method: 'PUT', body: { task_ids } })
  log(`Tasker development scenarios ready at ${origin}/tasker/ (${tasks.size} tasks, ${projects.size} projects)`)
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
