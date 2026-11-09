// A signed-out visit to a runtime app's deep link is sent to sign in with the
// whole link, query included, as `next` (#1080, from
// e2e/runtime-login-return.spec.ts). The fragment never reaches the server;
// the login page inherits it (web login-return.test.ts).
import { expect } from 'vitest'
import { resolve } from 'node:path'
import { test } from './pg-test'
import { admitTasker } from './tasker-client'
import { discoverPackages } from '../src/runtime-packages'
import { expectStatus } from './fixtures'

test('a signed-out deep link into Tasker keeps its repeated and escaped query through the sign-in redirect', async ({ admin, api }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await admin.post('/api/install_app', { name: 'tasker' })
  await admitTasker(admin)

  const res = await api.fetch('/tasker/?review=deep-link&note=37%20cartons%2F83&review=again', {
    headers: { accept: 'text/html' },
  })
  await expectStatus(res, 302)
  expect(res.headers.get('location')).toBe(
    '/featherbase/login?next=%2Ftasker%2F%3Freview%3Ddeep-link%26note%3D37%2520cartons%252F83%26review%3Dagain',
  )
})
