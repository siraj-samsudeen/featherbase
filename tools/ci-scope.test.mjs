import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decide, suitesFor } from './ci-scope.mjs'

const pr = (...files) => decide({ event: 'pull_request', files })
const on = (decision) => Object.keys(decision).filter(key => decision[key]).sort()
const ALL = ['acceptance', 'client_apps', 'coverage_merged', 'platform_checks', 'server', 'smoke', 'web']

test('prose runs only the fast checks', () => {
  assert.deepEqual(on(pr('README.md', 'adr/0014-x.md', 'openspec/changes/a/design.md', '.github/PULL_REQUEST_TEMPLATE.md',
    'apps/web/README.md', 'client-apps/c/a/README.md', '.claude/settings.json', 'docs/images/a.png', 'LICENSE')), [])
})

test("the process template's files run only the fast checks", () => {
  assert.deepEqual(on(pr('.copier-answers.yml', 'opencode.json', 'skills-lock.json', 'scripts/create-labels.sh',
    '.opencode/commands/opsx-apply.md', '.opencode/agent/senior-qa.md', '.opencode/skills/x/SKILL.md')), [])
})

test('a markdown file something reads is not prose', () => {
  assert.deepEqual(on(pr('docs/DEPLOY.md')), ['client_apps', 'platform_checks', 'server'])
  assert.deepEqual(on(pr('apps/web/e2e/fixtures/example.md')), ['acceptance', 'coverage_merged', 'platform_checks', 'smoke', 'web'])
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
  assert.deepEqual(on(pr('apps/web/src/x.tsx')), ['acceptance', 'coverage_merged', 'platform_checks', 'smoke', 'web'])
})

test('a change that can reach anything runs everything', () => {
  for (const file of ['packages/shared/src/x.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.github/workflows/test.yml',
    '.github/labeler.yml', '.github/actions/install-chromium/action.yml', 'tools/prepare-apps.mjs', 'test-apps/other/package.json', 'init.sh', '.railway/railway.ts', 'apps/new/x.ts', 'something-new', '"docs/\\303\\251.txt"'])
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
  assert.deepEqual(on(decide({ event: 'pull_request', labels: ['run-e2e'], files: ['apps/server/x.ts'] })), ['acceptance', 'client_apps', 'platform_checks', 'server', 'smoke'])
})

test('merged coverage is only ever wanted when both its inputs run', () => {
  for (const files of [['README.md'], ['client-apps/c/a/x'], ['example-apps/t/x'], ['apps/server/x'], ['apps/web/x'], ['tools/x']]) {
    const d = pr(...files)
    assert.equal(d.coverage_merged, d.web && d.smoke && d.acceptance, files[0])
  }
})

test('suitesFor returns no suites for prose', () => {
  assert.equal(suitesFor('docs/x.md').size, 0)
})

test("a spec runs only its capability's scenarios: nothing else reads a spec", () => {
  const d = pr('openspec/specs/list-view/spec.md', 'openspec/changes/x/specs/core-forms/spec.md', 'openspec/changes/x/design.md')
  assert.deepEqual(on(d), ['acceptance', 'acceptance_capabilities'])
  assert.equal(d.acceptance_capabilities, 'core-forms,list-view')
  assert.equal(d.smoke, false)
  assert.equal(d.web, false)
})

test('a capability with no Gherkin runs no scenarios', () => {
  const d = decide({ event: 'pull_request', files: ['openspec/specs/prose/spec.md'], hasScenarios: () => false })
  assert.deepEqual(on(d), [])
})

test('an archived spec does not run', () => {
  assert.deepEqual(on(pr('openspec/changes/archive/2026-11-05-x/specs/list-view/spec.md')), [])
})

test('a Dash change with its spec runs the app tests and that spec, not the platform suites', () => {
  const d = pr('client-apps/jeyarama/dash/src/x.ts', 'openspec/specs/dash-people/spec.md')
  assert.deepEqual(on(d), ['acceptance', 'acceptance_capabilities', 'client_apps'])
})

test('all of acceptance wins over a capability', () => {
  for (const other of ['acceptance-tests/step-definitions/list-view.steps.js', 'apps/web/src/x.tsx', 'tools/x.mjs']) {
    const d = pr('openspec/specs/list-view/spec.md', other)
    assert.equal(d.acceptance, true, other)
    assert.equal(d.acceptance_capabilities, '', other)
  }
})

test('the step definitions run all of acceptance and not the smoke test', () => {
  assert.deepEqual(on(pr('acceptance-tests/step-definitions/list-view.steps.js')), ['acceptance'])
  assert.equal(suitesFor('acceptance-tests/README.md').size, 0)
})

test('a spec in an unusual place runs all of acceptance rather than guessing', () => {
  const d = pr('openspec/somewhere/spec.md')
  assert.equal(d.acceptance, true)
  assert.equal(d.acceptance_capabilities, '')
})

test('a workflow other than this one has no effect on these suites', () => {
  assert.deepEqual(on(pr('.github/workflows/image-check.yml', '.github/workflows/publish-image.yml')), [])
  assert.deepEqual(on(pr('.github/workflows/test.yml')), ALL)
})

test('a push runs all of acceptance, whatever changed', () => {
  const d = decide({ event: 'push', files: ['openspec/specs/list-view/spec.md'] })
  assert.deepEqual(on(d), ALL)
  assert.equal(d.acceptance_capabilities, '')
})
