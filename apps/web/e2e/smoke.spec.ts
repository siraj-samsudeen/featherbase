import { anonymousTest as test, expect } from './fixtures'

test('app boots: root redirects to login and the form renders', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByTestId('login-form')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('legacy login query reaches the server redirect and preserves its return location', async ({ page }) => {
  await page.goto('/login?next=%2Ffeatherbase%2Fadmin%2Faccess-tokens')
  await expect(page).toHaveURL('/featherbase/login?next=%2Ffeatherbase%2Fadmin%2Faccess-tokens')
  await expect(page.getByTestId('login-form')).toBeVisible()
})

test('api is reachable through the web proxy', async ({ request }) => {
  const res = await request.get('/api/ping')
  expect(res.ok()).toBeTruthy()
  expect(await res.json()).toMatchObject({ message: 'pong', db: true })
})
