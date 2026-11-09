'use strict';

// Which spec scenarios a Vitest test proves (#1070), read from the
// test files without running them: a file names its capability once with
// `scenarioFor(test, '<capability>')`, then each `scenario('<name>', …)` is a
// binding. Every fenced scenario of the effective spec must be bound.

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./spec-index.cjs');

/** Where scenario tests may live. */
const TEST_DIRS = ['apps/server/test', 'apps/web/test'];
const FILE_RE = /\.test\.tsx?$/;
const CAPABILITY_RE = /scenarioFor\(\s*\w+\s*,\s*(['"`])([^'"`]+)\1\s*\)/g;
const SCENARIO_RE = /\bscenario\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (FILE_RE.test(entry.name)) out.push(full);
  }
  return out;
}

const unescape = (s) => s.replace(/\\(.)/g, '$1');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Every binding: { capability, scenario, file, line }, and the files that bind to more than one capability. */
function scenarioBindings() {
  const bindings = [];
  const problems = [];
  for (const dir of TEST_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const text = fs.readFileSync(file, 'utf8');
      const caps = [...text.matchAll(CAPABILITY_RE)].map((m) => m[2]);
      if (caps.length === 0) continue;
      const rel = path.relative(ROOT, file);
      if (new Set(caps).size > 1) {
        problems.push(`${rel} binds to more than one capability (${[...new Set(caps)].join(', ')}); keep one per file`);
        continue;
      }
      for (const m of text.matchAll(SCENARIO_RE)) {
        bindings.push({ capability: caps[0], scenario: unescape(m[2]), file: rel, line: lineOf(text, m.index) });
      }
    }
  }
  return { bindings, problems };
}

module.exports = { scenarioBindings };
