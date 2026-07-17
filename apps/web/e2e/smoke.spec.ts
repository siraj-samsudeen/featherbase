import { expect, test } from '@playwright/test'

test('app boots: root redirects to login and the form renders', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByTestId('login-form')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('api is reachable through the web proxy', async ({ request }) => {
  const res = await request.get('/api/ping')
  expect(res.ok()).toBeTruthy()
  expect(await res.json()).toEqual({ message: 'pong', db: true })
})
