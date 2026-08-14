/* Checklists sample app + DEMO CONTENT. The structure — templates, runs,
 * roles, permissions, and the section-opening fixture template — is the
 * registered app manifest (src/sample-apps/checklists.ts): this script
 * installs it over POST /api/install_app exactly as a user would (skipped
 * if the structure is already present), then seeds, over the HTTP API of a
 * running server, what a demo needs and a real deployment would not:
 *
 * - Two Checklist Runs for today off the fixture template — one mid-way
 *   (a few items ticked), one untouched — so the checklist view's list,
 *   progress bars and submit gate all have something to show.
 *
 * Run with the app up (./init.sh):
 *
 *   pnpm --filter server seed:checklists
 *
 * Idempotent: existing structure is adopted and runs are only seeded when
 * today has none.
 */

const BASE = process.env.SERVER_URL ?? 'http://localhost:8000'
const ADMIN = process.env.ADMIN_USER ?? 'Administrator'
const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

let token = ''

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
  return (await r.json()) as T
}

const login = async () => {
  token = (
    await json<{ token: string }>(
      await req('/api/login', { method: 'POST', body: JSON.stringify({ usr: ADMIN, pwd: ADMIN_PWD }) }),
    )
  ).token
}

async function main() {
  await login()

  const meta = await req('/api/table/Checklist%20Run:meta')
  if (!meta.ok) {
    const r = await req('/api/install_app', { method: 'POST', body: JSON.stringify({ name: 'checklists' }) })
    if (r.status !== 201) throw new Error(`install checklists: ${r.status} ${await r.text()}`)
    console.log('installed the checklists app')
  } else {
    console.log('checklists structure already present — adopted')
  }

  const templates = await json<{ data: { name: string }[] }>(
    await req('/api/table/Checklist%20Template?fields=%5B%22name%22%5D&limit_page_length=1'),
  )
  const template = templates.data[0]?.name
  if (!template) throw new Error('no Checklist Template found after install')

  const today = new Date().toISOString().slice(0, 10)
  const existing = await json<{ data: { name: string }[] }>(
    await req(
      `/api/table/Checklist%20Run?filters=${encodeURIComponent(JSON.stringify([['run_date', '=', today]]))}&fields=%5B%22name%22%5D`,
    ),
  )
  if (existing.data.length) {
    console.log(`today already has ${existing.data.length} run(s) — nothing to seed`)
    return
  }

  type Run = { name: string; updated_at: string; items: Record<string, unknown>[] }
  const save = async (row: Record<string, unknown>) =>
    json<Run>(
      await req('/api/save_row', {
        method: 'POST',
        body: JSON.stringify({ table: 'Checklist Run', row }),
      }),
    )

  // One run mid-way: the first three items ticked.
  const kurti = await save({ template, store: 'ATK', section: 'Kurti', team_leader: 'Priya S' })
  await save({
    name: kurti.name,
    updated_at: kurti.updated_at,
    items: kurti.items.map((it, i) => (i < 3 ? { ...it, done: true } : it)),
  })
  // One untouched.
  await save({ template, store: 'ATK', section: 'Women Ethnic Sets', team_leader: 'Deepa R' })
  console.log('seeded 2 runs for today')
}

await main()
