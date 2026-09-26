import { anonymousTest as test, expect, ensureRuntimeApp, ADMIN_PWD } from './fixtures'

let taskId: string

test.beforeAll(async ({ request }) => {
  const headers = await ensureRuntimeApp(request, 'tasker')
  const saved = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'tasker.task',
      row: { task_title: 'Selected through sign-in' },
    },
  })
  if (!saved.ok())
    throw new Error(`seed selected task: ${saved.status()} ${await saved.text()}`)
  taskId = ((await saved.json()) as { row_id: string }).row_id
})

test('signed-out runtime app query and selected-work fragment survive password sign-in', async ({ page }) => {
  await page.goto(`/tasker?review=deep-link&note=37%20cartons%2F83&review=again#task=${taskId}`)
  await expect(page).toHaveURL(
    new RegExp(`/featherbase/login\\?next=%2Ftasker%2F%3Freview%3Ddeep-link%26note%3D37%2520cartons%252F83%26review%3Dagain#task=${taskId}$`),
  )

  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')

  await expect(page).toHaveURL(`/tasker/?review=deep-link&note=37%20cartons%2F83&review=again#task=${taskId}`)
  await expect(page.getByRole('heading', { name: 'Selected through sign-in' })).toBeVisible()
  await expect(page.getByLabel('Task details')).toBeVisible()
})
