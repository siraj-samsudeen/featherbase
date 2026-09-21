import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

export const TASKER_SCENARIOS = {
  users: [
    { row_id: 'asha.local@example.test', email: 'asha.local@example.test', full_name: 'Asha Local', enabled: true },
    { row_id: 'dev.local@example.test', email: 'dev.local@example.test', full_name: 'Dev Local', enabled: true },
  ],
  projects: ['September stock review', 'Store opening readiness'],
  tasks: [
    { task_title: 'Triage supplier invoice mismatch', urgent: true },
    { task_title: 'Collect ideas for the Monday review', urgent: false },
    { task_title: 'Confirm warehouse count date', task_state: 'Blocked', explanation: 'Blocked until the warehouse confirms the night-shift roster.' },
    { task_title: 'Reconcile the first stock variance', project: 'September stock review', assigned_to: 'asha.local@example.test', task_state: 'In progress', urgent: true },
    { task_title: 'Photograph the receiving bay', project: 'September stock review' },
    { task_title: 'Confirm fire-safety inspection', project: 'Store opening readiness', task_state: 'On hold', explanation: 'On hold while the landlord supplies the renewed certificate.' },
    { task_title: 'Draft my discussion notes', personal_tasks_owner: 'Administrator' },
    { task_title: 'Archive last month’s launch checklist', project: 'Store opening readiness', task_state: 'Done', is_done: true },
  ],
  focus: ['Reconcile the first stock variance', 'Triage supplier invoice mismatch', 'Draft my discussion notes'],
}

export function requireLoopback(rawUrl) {
  const url = new URL(rawUrl)
  assert(['http:', 'https:'].includes(url.protocol), 'Tasker seed URL must use HTTP(S)')
  assert(['localhost', '127.0.0.1', '::1'].includes(url.hostname), 'Tasker seed refuses non-loopback URLs')
  return url.origin
}

function query(filters, fields = ['row_id']) {
  return `?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}&limit_page_length=20`
}

export async function seedTasker({ baseUrl, password = 'admin', fetchImpl = fetch, log = console.log }) {
  const origin = requireLoopback(baseUrl)
  let token
  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${origin}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${result.error?.message ?? JSON.stringify(result)}`)
    return result
  }
  token = (await request('/api/login', { method: 'POST', body: { usr: 'Administrator', pwd: password } })).token
  const catalog = await request('/api/app_catalog')
  if (!catalog.some((app) => app.name === 'tasker')) throw new Error('Tasker must be installed and enabled before seeding')

  async function ensure(table, key, value, row) {
    const found = (await request(`/api/table/${encodeURIComponent(table)}${query([[key, '=', value]], ['row_id', key])}`)).data
    if (found.length) return found[0]
    return request('/api/save_row', { method: 'POST', body: { table, row } })
  }
  for (const user of TASKER_SCENARIOS.users) await ensure('User', 'row_id', user.row_id, user)
  const projects = new Map()
  for (const project_name of TASKER_SCENARIOS.projects) {
    const project = await ensure('tasker.project', 'project_name', project_name, { project_name })
    projects.set(project_name, project.row_id)
  }
  const tasks = new Map()
  for (const scenario of TASKER_SCENARIOS.tasks) {
    const { explanation, project, ...values } = scenario
    const task = await ensure('tasker.task', 'task_title', scenario.task_title, {
      ...values,
      ...(project ? { project: projects.get(project) } : {}),
    })
    tasks.set(scenario.task_title, task.row_id)
    if (explanation) {
      const filters = [['ref_table', '=', 'tasker.task'], ['ref_name', '=', task.row_id], ['content', '=', explanation]]
      const comments = (await request(`/api/table/Comment${query(filters)}`)).data
      if (!comments.length) await request('/api/save_row', { method: 'POST', body: { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: task.row_id, content: explanation } } })
    }
  }
  const focusPath = `/api/user_settings/${encodeURIComponent('Task Management Focus')}`
  const current = (await request(focusPath)).settings?.task_ids ?? []
  const seededFocus = TASKER_SCENARIOS.focus.map((title) => tasks.get(title))
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
  })
}
