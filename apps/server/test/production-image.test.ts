import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { PRODUCTION_RUNTIME_ARTIFACTS, verifyRuntimeArtifacts } from '../scripts/verify-production-runtime-apps'

const root = resolve('../..')

// @spec runtime_upgrade_recovery_boundary.packaged_upgrade_retains_exact_predecessor
test('the production image discovers exact Tasker predecessor and target artifacts', async () => {
  const [dockerfile, predecessor, predecessorManifest, target] = await Promise.all([
    readFile(resolve(root, 'apps/server/Dockerfile'), 'utf8'),
    readFile(resolve(root, 'runtime-apps/fixtures/tasker-v1-production/package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'runtime-apps/fixtures/tasker-v1-production/featherbase.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'runtime-apps/tasker/package.json'), 'utf8').then(JSON.parse),
  ])
  expect([predecessor.version, target.version]).toEqual(['0.0.1', '2.1.0'])
  expect([predecessorManifest.server, predecessorManifest.client]).toEqual([
    'dist/server.mjs',
    'dist/client',
  ])

  expect(dockerfile).toContain(
    'COPY runtime-apps/fixtures/tasker-v1-production /app/runtime-apps/tasker/0.0.1',
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
    '/app/runtime-apps/feather_dash/0.1.3',
    '/app/runtime-apps/feather_dash/0.2.1',
  ])
  expect(dockerfile).toContain('RUN pnpm --filter server exec tsx scripts/verify-production-runtime-apps.ts')

  // The predecessor is checked directly because its reviewed bytes are tracked.
  // The target is built by Node 22 inside Docker and its digest is proved by the
  // final-stage RUN above; rebuilding it under a different host Node is not an
  // identity check because generated bundle bytes can differ by tool runtime.
  const staged = await mkdtemp(resolve(tmpdir(), 'featherbase-production-apps-'))
  try {
    const predecessorRoot = resolve(staged, '0.0.1')
    await cp(resolve(root, 'runtime-apps/fixtures/tasker-v1-production'), predecessorRoot, { recursive: true })
    await verifyRuntimeArtifacts([{ ...PRODUCTION_RUNTIME_ARTIFACTS[0], path: predecessorRoot }])
  } finally {
    await rm(staged, { recursive: true, force: true })
  }
})

// @spec runtime_upgrade_recovery_boundary.packaged_upgrade_preserves_unrelated_installed_apps
test('the production image retains exact installed Feather Dash artifacts', async () => {
  const dockerfile = await readFile(resolve(root, 'apps/server/Dockerfile'), 'utf8')
  expect(dockerfile).toContain(
    'COPY runtime-apps/fixtures/feather-dash-v0.1.3 /app/runtime-apps/feather_dash/0.1.3',
  )
  expect(dockerfile).toContain(
    'ENV FEATHER_DASH_FIXTURE=/app/runtime-apps/feather_dash/0.1.3/fixtures/source.json',
  )
  expect(dockerfile).toContain(
    'COPY runtime-apps/fixtures/feather-dash-v0.2.1 /app/runtime-apps/feather_dash/0.2.1',
  )
  expect(dockerfile).toContain(
    'ENV FEATHER_DASH_MOTHERDUCK_PRINCIPAL=motherduck_dive_service_account',
  )
  expect(dockerfile).toContain(
    'ENV NODE_OPTIONS="--import=/app/runtime-apps/feather_dash/0.1.3/dist/development-bootstrap.mjs --import=/app/runtime-apps/feather_dash/0.2.1/dist/development-bootstrap.mjs"',
  )

  const staged = await mkdtemp(resolve(tmpdir(), 'featherbase-production-dash-'))
  try {
    const oldRoot = resolve(staged, '0.1.3')
    const currentRoot = resolve(staged, '0.2.1')
    await cp(resolve(root, 'runtime-apps/fixtures/feather-dash-v0.1.3'), oldRoot, { recursive: true })
    await cp(resolve(root, 'runtime-apps/fixtures/feather-dash-v0.2.1'), currentRoot, { recursive: true })
    await verifyRuntimeArtifacts([
      { ...PRODUCTION_RUNTIME_ARTIFACTS[2], path: oldRoot },
      { ...PRODUCTION_RUNTIME_ARTIFACTS[3], path: currentRoot },
    ])
  } finally {
    await rm(staged, { recursive: true, force: true })
  }
})
