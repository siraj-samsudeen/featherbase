import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decide, suitesFor } from './ci-scope.mjs'

const pr = (...files) => decide({ event: 'pull_request', files })
const on = (decision) => Object.keys(decision).filter(key => decision[key]).sort()
const ALL = ['client_apps', 'coverage_merged', 'e2e', 'platform_checks', 'server', 'web']

test('prose runs only the fast checks', () => {
  assert.deepEqual(on(pr('README.md', 'docs/adr/0014-x.md', 'openspec/changes/a/design.md', '.github/PULL_REQUEST_TEMPLATE.md',
    'apps/web/README.md', 'client-apps/c/a/README.md', '.claude/settings.json', 'docs/images/a.png', 'LICENSE')), [])
})

test('a markdown file something reads is not prose', () => {
  assert.deepEqual(on(pr('docs/DEPLOY.md')), ['client_apps', 'platform_checks', 'server'])
  assert.deepEqual(on(pr('apps/web/e2e/fixtures/zones.claims.md')), ['coverage_merged', 'e2e', 'platform_checks', 'web'])
  assert.deepEqual(on(pr('client-apps/c/instances/a/privacy-notice.md')), ['client_apps'])
})

test('a client app runs its own tests and platform tests', () => {
  assert.deepEqual(on(pr('client-apps/c/a/src/x.ts', 'client-apps/c/a/package.json')), ['client_apps'])
})

test('an example app runs its own layers', () => {
  assert.deepEqual(on(pr('example-apps/tasker/src/x.ts')), ['tasker_tests'])
})

test('the server runs its suite and the client platform tests, not web or e2e', () => {
  assert.deepEqual(on(pr('apps/server/src/x.ts')), ['client_apps', 'platform_checks', 'server'])
})

test('web runs web and e2e, and so the merged coverage, not the server suite', () => {
  assert.deepEqual(on(pr('apps/web/src/x.tsx')), ['coverage_merged', 'e2e', 'platform_checks', 'web'])
})

test('a change that can reach anything runs everything', () => {
  for (const file of ['packages/shared/src/x.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.github/workflows/test.yml',
    '.github/labeler.yml', 'tools/prepare-apps.mjs', 'test-apps/other/package.json', 'init.sh', 'railway.json', 'apps/new/x.ts', 'something-new', '"docs/\\303\\251.txt"'])
    assert.deepEqual(on(pr(file)), ALL, file)
})

test('mixed changes take the union', () => {
  assert.deepEqual(on(pr('README.md', 'client-apps/c/a/x.ts')), ['client_apps'])
  assert.deepEqual(on(pr('apps/server/x.ts', 'apps/web/x.ts')), ALL)
  assert.deepEqual(on(pr('apps/server/x.ts', 'example-apps/t/x.ts')), ['client_apps', 'platform_checks', 'server', 'tasker_tests'])
  assert.deepEqual(on(pr('docs/a.md', 'pnpm-lock.yaml')), ALL)
})

test('Tasker\'s layers do not run twice beside the full suites', () => {
  assert.equal(pr('example-apps/t/x.ts', 'apps/web/x.ts').tasker_tests, false)
  assert.equal(decide({ event: 'push', files: [] }).tasker_tests, false)
})

test('only a pull request is scoped', () => {
  for (const event of ['push', 'workflow_dispatch', undefined])
    assert.deepEqual(on(decide({ event, files: ['README.md'] })), ALL)
})

test('an empty diff tells us nothing, so everything runs', () => {
  assert.deepEqual(on(pr()), ALL)
})

test('labels ask for more', () => {
  assert.deepEqual(on(decide({ event: 'pull_request', labels: ['run-all'], files: ['README.md'] })), ALL)
  // No merged coverage: the web suite it also needs did not run.
  assert.deepEqual(on(decide({ event: 'pull_request', labels: ['run-e2e'], files: ['apps/server/x.ts'] })), ['client_apps', 'e2e', 'platform_checks', 'server'])
})

test('merged coverage is only ever wanted when both its inputs run', () => {
  for (const files of [['README.md'], ['client-apps/c/a/x'], ['example-apps/t/x'], ['apps/server/x'], ['apps/web/x'], ['tools/x']]) {
    const d = pr(...files)
    assert.equal(d.coverage_merged, d.web && d.e2e, files[0])
  }
})

test('suitesFor returns no suites for prose', () => {
  assert.equal(suitesFor('docs/x.md').size, 0)
})

test('a spec or the acceptance suite runs e2e, where the acceptance suite runs (#738)', () => {
  assert.deepEqual([...suitesFor('openspec/changes/x/specs/list-view/spec.md')], ['e2e'])
  assert.deepEqual([...suitesFor('openspec/specs/list-view/spec.md')], ['e2e'])
  assert.deepEqual([...suitesFor('acceptance-tests/step-definitions/list-view.steps.js')], ['e2e'])
  assert.equal(suitesFor('openspec/changes/x/design.md').size, 0)
  assert.equal(suitesFor('acceptance-tests/README.md').size, 0)
})
