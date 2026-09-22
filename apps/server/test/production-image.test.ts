import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

const root = resolve('../..')

// @spec runtime_upgrade_recovery_boundary.packaged_upgrade_retains_exact_predecessor
test('the production image discovers exact Tasker predecessor and target artifacts', async () => {
  const [dockerfile, predecessor, target] = await Promise.all([
    readFile(resolve(root, 'apps/server/Dockerfile'), 'utf8'),
    readFile(resolve(root, 'runtime-apps/fixtures/tasker-v1/package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'runtime-apps/tasker/package.json'), 'utf8').then(JSON.parse),
  ])
  expect([predecessor.version, target.version]).toEqual(['0.0.1', '2.1.0'])

  expect(dockerfile).toContain(
    'COPY runtime-apps/fixtures/tasker-v1 /app/runtime-apps/tasker/0.0.1',
  )
  for (const file of ['package.json', 'featherbase.json', 'dist']) {
    expect(dockerfile).toContain(
      `COPY --from=tasker-build /app/runtime-apps/tasker/${file} /app/runtime-apps/tasker/2.1.0/${file}`,
    )
  }

  const configured = dockerfile.match(/^ENV FEATHERBASE_APP_PATHS='(.+)'$/m)?.[1]
  expect(configured).toBeDefined()
  expect(JSON.parse(configured!)).toEqual([
    '/app/runtime-apps/tasker/0.0.1',
    '/app/runtime-apps/tasker/2.1.0',
  ])
})
