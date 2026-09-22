import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
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

  const staged = await mkdtemp(resolve(tmpdir(), 'featherbase-production-apps-'))
  try {
    const roots = [resolve(staged, '0.0.1'), resolve(staged, '2.1.0')]
    await cp(resolve(root, 'runtime-apps/fixtures/tasker-v1'), roots[0], { recursive: true })
    await mkdir(roots[1], { recursive: true })
    for (const file of ['package.json', 'featherbase.json'])
      await cp(resolve(root, 'runtime-apps/tasker', file), resolve(roots[1], file))
    await cp(resolve(root, 'runtime-apps/tasker/dist'), resolve(roots[1], 'dist'), { recursive: true })
    await verifyRuntimeArtifacts(PRODUCTION_TASKER_ARTIFACTS.map((artifact, index) => ({
      ...artifact,
      path: roots[index],
    })))
  } finally {
    await rm(staged, { recursive: true, force: true })
  }
})
