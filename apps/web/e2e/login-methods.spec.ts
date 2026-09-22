import { anonymousTest as test, expect } from './fixtures'

// @spec provider_configuration_is_an_authentication_boundary
// @spec stylehr_activation_is_closed_without_a_confirmed_contract
test('unconfigured hosted providers do not replace the native-account fallback', async ({ page }) => {
  await page.goto('/featherbase/login')
  await expect(page.getByLabel('Featherbase password', { exact: true })).toBeVisible()
  await expect(page.getByText('StyleHR', { exact: false })).toBeVisible()
  await expect(page.getByTestId('google-login')).toHaveCount(0)
  await expect(page.getByTestId('microsoft-login')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled()
})

// @spec hosted_login_validates_subject_and_browser_operation
test('a forged browser operation cannot issue a session', async ({ request }) => {
  const response = await request.get('/api/auth/callback?state=forged&code=synthetic-code', { maxRedirects: 0 })
  expect(response.status()).toBe(401)
  expect(response.headers()['set-cookie'] ?? '').not.toMatch(/(?:^|,\s*)sid=/)
})

// @spec external_enrollment_requires_explicit_authority
test('retired email-impersonation routes cannot authenticate or provision', async ({ request }) => {
  for (const route of ['/api/oauth/mock/consent', '/api/oauth/google/login', '/api/oauth/google/callback']) {
    const response = await request.get(route, { maxRedirects: 0 })
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(response.headers()['set-cookie'] ?? '').not.toMatch(/(?:^|,\s*)sid=/)
  }
})
