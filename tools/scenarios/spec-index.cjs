'use strict';

// The effective spec as a list of scenarios (#1070, step 2): every
// `#### Scenario:` in openspec/specs, with the active changes' delta specs
// applied over them (ADDED and MODIFIED requirements replace the main
// requirement of the same name; REMOVED ones drop it). A scenario carries its
// fenced Gherkin steps, or none when it is still prose.
//
// Dependency-free (node:fs/node:path), so the Vitest binding and the check
// read the same index.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const OPENSPEC = path.join(ROOT, 'openspec');

const H1_RE = /^#\s+(.+?)\s*$/;
const DELTA_RE = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i;
const H2_RE = /^##\s+/;
const REQUIREMENT_RE = /^###\s+Requirement:\s*(.+?)\s*$/i;
const SCENARIO_RE = /^####\s+Scenario(?:\s+Outline)?:\s*(.+?)\s*$/i;
const GHERKIN_OPEN_RE = /^(`{3,})gherkin\s*$/;
const STEP_RE = /^\s*(Given|When|Then|And|But|\*)\s+(.*\S)\s*$/;
const EXAMPLES_RE = /^\s*(Examples|Scenarios):/;
const TABLE_RE = /^\s*\|(.*)\|\s*$/;
const cells = (row) => row.split('|').map((c) => c.trim());

/**
 * One spec.md: its title and requirements, each with its scenarios. In a
 * delta spec each requirement also says which section (ADDED, MODIFIED…) it
 * sits in.
 */
function parseSpec(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const spec = { file, title: null, requirements: [] };
  let section = null;
  let requirement = null;
  let scenario = null;
  let fence = null;
  lines.forEach((line, i) => {
    if (fence) {
      if (line.trim() === fence) {
        fence = null;
        return;
      }
      if (!scenario) return;
      if (EXAMPLES_RE.test(line)) {
        scenario.examples = { header: null, rows: [] };
        return;
      }
      const row = TABLE_RE.exec(line);
      if (row && scenario.examples) {
        if (!scenario.examples.header) scenario.examples.header = cells(row[1]);
        else scenario.examples.rows.push(Object.fromEntries(scenario.examples.header.map((h, c) => [h, cells(row[1])[c]])));
        return;
      }
      const step = STEP_RE.exec(line);
      if (step && !scenario.examples) scenario.steps.push({ keyword: step[1], text: step[2], line: i + 1 });
      return;
    }
    let m;
    if ((m = GHERKIN_OPEN_RE.exec(line))) {
      fence = m[1];
      if (scenario) scenario.fenced = true;
    } else if (!spec.title && (m = H1_RE.exec(line))) spec.title = m[1];
    else if ((m = DELTA_RE.exec(line))) {
      section = m[1].toUpperCase();
      requirement = scenario = null;
    } else if ((m = REQUIREMENT_RE.exec(line))) {
      requirement = { name: m[1], section, line: i + 1, scenarios: [] };
      spec.requirements.push(requirement);
      scenario = null;
    } else if ((m = SCENARIO_RE.exec(line)) && requirement) {
      scenario = { name: m[1], line: i + 1, fenced: false, steps: [], examples: null };
      requirement.scenarios.push(scenario);
    } else if (H2_RE.test(line)) {
      requirement = scenario = null;
      if (!DELTA_RE.test(line)) section = null;
    }
  });
  return spec;
}

function specFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(dir, d.name, 'spec.md'))
    .filter((f) => fs.existsSync(f));
}

function activeChanges() {
  const dir = path.join(OPENSPEC, 'changes');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive')
    .map((d) => d.name)
    .sort();
}

/**
 * Every scenario of the effective spec, in spec order:
 * { capability, title, requirement, scenario, steps, examples, fenced, source, file, line }.
 * `source` is 'main' or 'change:<id>'.
 */
function effectiveScenarios() {
  const caps = new Map(); // capability -> { title, requirements: Map(name -> { source, file, requirement }) }
  for (const file of specFiles(path.join(OPENSPEC, 'specs'))) {
    const capability = path.basename(path.dirname(file));
    const spec = parseSpec(file);
    const requirements = new Map();
    for (const r of spec.requirements) requirements.set(r.name, { source: 'main', file, requirement: r });
    caps.set(capability, { title: spec.title, requirements });
  }
  for (const change of activeChanges()) {
    for (const file of specFiles(path.join(OPENSPEC, 'changes', change, 'specs'))) {
      const capability = path.basename(path.dirname(file));
      const spec = parseSpec(file);
      if (!caps.has(capability)) caps.set(capability, { title: spec.title, requirements: new Map() });
      const cap = caps.get(capability);
      for (const r of spec.requirements) {
        if (r.section === 'REMOVED') cap.requirements.delete(r.name);
        else if (r.section === 'ADDED' || r.section === 'MODIFIED') cap.requirements.set(r.name, { source: `change:${change}`, file, requirement: r });
      }
    }
  }
  const out = [];
  for (const [capability, cap] of caps) {
    for (const { source, file, requirement } of cap.requirements.values()) {
      for (const s of requirement.scenarios) {
        out.push({
          capability,
          title: cap.title,
          requirement: requirement.name,
          scenario: s.name,
          steps: s.steps,
          // A Scenario Outline's rows; each runs the steps with its values.
          examples: s.examples ? s.examples.rows : null,
          fenced: s.fenced,
          source,
          file: path.relative(ROOT, file),
          line: s.line,
        });
      }
    }
  }
  return out;
}

/** The one effective scenario of `capability` named `name`, or an error saying why not. */
function findScenario(capability, name, all = effectiveScenarios()) {
  const hits = all.filter((s) => s.capability === capability && s.scenario === name);
  if (hits.length === 0) {
    const known = all.filter((s) => s.capability === capability);
    throw new Error(
      known.length
        ? `${capability} has no scenario "${name}". Its scenarios: ${known.map((s) => `"${s.scenario}"`).join(', ')}`
        : `No capability "${capability}" in openspec/specs or an active change`,
    );
  }
  if (hits.length > 1) throw new Error(`${capability} has ${hits.length} scenarios named "${name}"`);
  if (!hits[0].fenced) throw new Error(`${capability} › "${name}" has no fenced Gherkin yet, so there is nothing to run`);
  return hits[0];
}

module.exports = { parseSpec, effectiveScenarios, findScenario, ROOT };
