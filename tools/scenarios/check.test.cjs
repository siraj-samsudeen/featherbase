'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check } = require('./check.cjs');
const { parseSpec } = require('./spec-index.cjs');

const s = (capability, scenario, fenced = true) => ({ capability, scenario, requirement: 'R', title: capability, steps: [], fenced, source: 'main', file: `openspec/specs/${capability}/spec.md`, line: 1 });
const b = (capability, scenario, file = 'apps/server/test/x.test.ts') => ({ capability, scenario, file, line: 1 });
const run = (scenarios, bindings, problems = []) => check({ scenarios, bound: { bindings, problems } });

test('a fenced scenario with no test is a problem, even in a capability with no bindings', () => {
  const { rows, problems } = run([s('naming', 'One')], []);
  assert.equal(rows[0].runner, 'unbound');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /naming › "One" .* has no test/);
});

test('each fenced scenario of a capability needs its own test; prose needs none', () => {
  const { rows, problems } = run([s('naming', 'One'), s('naming', 'Two'), s('naming', 'Prose', false)], [b('naming', 'One')]);
  assert.deepEqual(rows.map((r) => r.runner), ['vitest', 'unbound', 'prose']);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /naming › "Two" .* has no test/);
});

test('a binding to a scenario the spec does not have is refused', () => {
  const { problems } = run([s('naming', 'One')], [b('naming', 'One'), b('naming', 'Renamed away')]);
  assert.match(problems.join('\n'), /binds "Renamed away", which naming does not have/);
});

test('a scenario bound twice is refused', () => {
  const { problems } = run([s('naming', 'One')], [b('naming', 'One', 'a.test.ts'), b('naming', 'One', 'b.test.ts')]);
  assert.match(problems.join('\n'), /bound twice: a\.test\.ts:1 and b\.test\.ts:1/);
});

test('the scanner\'s own problems are reported', () => {
  const { problems } = run([], [], ['x.test.ts binds to more than one capability']);
  assert.deepEqual(problems, ['x.test.ts binds to more than one capability']);
});

test('a spec is read into requirements, scenarios, steps and outline examples', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenarios-'));
  const file = path.join(dir, 'spec.md');
  fs.writeFileSync(
    file,
    [
      '# Naming',
      '## ADDED Requirements',
      '### Requirement: Rows are numbered',
      '#### Scenario: First rows',
      '```gherkin',
      'Given a table "Plant"',
      'When the user adds three plants',
      'Then the plants are numbered 1, 2 and 3',
      '```',
      '#### Scenario: Still prose',
      '- **WHEN** something',
      '#### Scenario Outline: Each prefix',
      '```gherkin',
      'Given a prefix "<prefix>"',
      'Then ids start "<first>"',
      'Examples:',
      '  | prefix | first |',
      '  | PL-    | PL-1  |',
      '```',
    ].join('\n'),
  );
  const spec = parseSpec(file);
  assert.equal(spec.title, 'Naming');
  const [req] = spec.requirements;
  assert.equal(req.section, 'ADDED');
  assert.deepEqual(req.scenarios.map((x) => [x.name, x.fenced, x.steps.length]), [['First rows', true, 3], ['Still prose', false, 0], ['Each prefix', true, 2]]);
  assert.deepEqual(req.scenarios[2].examples.rows, [{ prefix: 'PL-', first: 'PL-1' }]);
});

test('Vitest outcomes mark each bound scenario, and a failed one is a problem', () => {
  const { readResults } = require('./check.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenarios-'));
  const file = path.join(dir, 'server.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      testResults: [
        {
          assertionResults: [
            { ancestorTitles: ['naming'], title: 'One', status: 'passed' },
            { ancestorTitles: ['naming'], title: 'Each prefix [PL-, PL-1]', status: 'passed' },
            { ancestorTitles: ['naming'], title: 'Each prefix [ST-, ST-1]', status: 'failed' },
          ],
        },
      ],
    }),
  );
  const outcomes = readResults([file]);
  assert.equal(outcomes.get('naming › One'), 'passed');
  assert.equal(outcomes.get('naming › Each prefix'), 'failed', 'an Outline fails when any row does');
  const { rows } = check({ scenarios: [s('naming', 'One')], bound: { bindings: [b('naming', 'One')], problems: [] }, outcomes });
  assert.equal(rows[0].outcome, 'passed');
});

test('the report runs every file that binds a scenario, wherever it lives under the app', () => {
  const { boundFiles } = require('./bindings.cjs');
  const bindings = [
    b('naming', 'One', 'apps/server/test/scenarios/naming.test.ts'),
    b('naming', 'Two', 'apps/server/test/scenarios/naming.test.ts'),
    b('roles', 'Three', 'apps/server/test/permissions.test.ts'),
    b('roles', 'Four', 'apps/web/test/admin/roles.test.tsx'),
  ];
  assert.deepEqual(boundFiles(bindings, 'server'), ['test/permissions.test.ts', 'test/scenarios/naming.test.ts']);
  assert.deepEqual(boundFiles(bindings, 'web'), ['test/admin/roles.test.tsx']);
});
