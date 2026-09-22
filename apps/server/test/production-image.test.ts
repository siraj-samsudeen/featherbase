import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { PRODUCTION_TASKER_ARTIFACTS, verifyRuntimeArtifacts } from '../scripts/verify-production-runtime-apps'

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
  expect(dockerfile).toContain('RUN pnpm --filter server exec tsx scripts/verify-production-runtime-apps.ts')

  // The predecessor is checked directly because its reviewed bytes are tracked.
  // The target is built by Node 22 inside Docker and its digest is proved by the
  // final-stage RUN above; rebuilding it under a different host Node is not an
  // identity check because generated bundle bytes can differ by tool runtime.
  const staged = await mkdtemp(resolve(tmpdir(), 'featherbase-production-apps-'))
  try {
    const predecessorRoot = resolve(staged, '0.0.1')
    await cp(resolve(root, 'runtime-apps/fixtures/tasker-v1'), predecessorRoot, { recursive: true })
    await verifyRuntimeArtifacts([{ ...PRODUCTION_TASKER_ARTIFACTS[0], path: predecessorRoot }])
  } finally {
    await rm(staged, { recursive: true, force: true })
  }
})
