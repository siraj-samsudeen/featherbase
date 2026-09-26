import { anonymousTest as test, expect, ensureRuntimeApp, ADMIN_PWD } from './fixtures'

let taskId: string
let taskHeaders: { Authorization: string; 'X-Featherbase-App-Version': string }

test.beforeAll(async ({ request }) => {
  taskHeaders = await ensureRuntimeApp(request, 'tasker')
  const saved = await request.post('/api/save_row', {
    headers: taskHeaders,
    data: {
      table: 'tasker.task',
      row: { task_title: 'Selected through sign-in' },
    },
  })
  if (!saved.ok())
    throw new Error(`seed selected task: ${saved.status()} ${await saved.text()}`)
  taskId = ((await saved.json()) as { row_id: string }).row_id
})

test.afterAll(async ({ request }) => {
  const path = `/api/table/${encodeURIComponent('tasker.task')}/${encodeURIComponent(taskId)}`
  const current = await request.get(path, { headers: taskHeaders })
  if (current.status() === 404) return
  if (!current.ok()) throw new Error(`load selected task cleanup revision: ${current.status()} ${await current.text()}`)
  const { updated_at } = (await current.json()) as { updated_at: string }
  const deleted = await request.delete(`${path}?updated_at=${encodeURIComponent(updated_at)}`, { headers: taskHeaders })
  if (!deleted.ok()) throw new Error(`delete selected task: ${deleted.status()} ${await deleted.text()}`)
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// The login form is label-friendly, so sign-in becomes DSL verbs; the exact
// URL round-trip (query + hash fragment) is a `toHaveURL` regex that
// `assertPath`/`refutePath` — exact-match only — cannot express, so it stays
// a step, as does the by-role/by-label heading check that follows it.
test('signed-out runtime app query and selected-work fragment survive password sign-in', async ({ session }) => {
  await session.visit(`/tasker?review=deep-link&note=37%20cartons%2F83&review=again#task=${taskId}`)
  await session.step('bounces to login preserving the return location', async ({ page }) => {
    await expect(page).toHaveURL(
      new RegExp(`/featherbase/login\\?next=%2Ftasker%2F%3Freview%3Ddeep-link%26note%3D37%2520cartons%252F83%26review%3Dagain#task=${taskId}$`),
    )
  })

  await session.fillIn('Email or username', 'Administrator').fillIn('Password', ADMIN_PWD).clickButton('Sign in')

  await session.step('lands back on the deep link with the selected task shown', async ({ page }) => {
    await expect(page).toHaveURL(`/tasker/?review=deep-link&note=37%20cartons%2F83&review=again#task=${taskId}`)
    await expect(page.getByRole('heading', { name: 'Selected through sign-in' })).toBeVisible()
    await expect(page.getByLabel('Task details')).toBeVisible()
  })
})
