'use strict';

// pnpm check:scenarios (#1070): every fenced scenario of the effective spec
// (main specs and active change deltas) runs as exactly one Vitest test.
// Each fenced scenario needs a bound test (tools/scenarios/bindings.cjs), and
// each binding must name a scenario the spec has. A scenario still in prose
// needs none.
//
// It also writes scenarios-report/index.html: every capability, requirement
// and scenario with its Gherkin and the test that runs it. `pnpm
// scenarios:report` also runs the bound tests and marks each scenario passed
// or failed.

const fs = require('node:fs');
const path = require('node:path');
const { effectiveScenarios, ROOT } = require('./spec-index.cjs');
const { scenarioBindings } = require('./bindings.cjs');

/**
 * Outcomes from Vitest JSON reports (`--reporter=json --outputFile=…`): a
 * test's title is its scenario's name (an Outline row adds " [values]").
 */
function readResults(files) {
  const outcomes = new Map();
  for (const file of files) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const suite of json.testResults ?? []) {
      for (const t of suite.assertionResults ?? []) {
        const capability = t.ancestorTitles?.[0];
        const name = t.title.replace(/ \[[^\]]*\]$/, '');
        const k = `${capability} › ${name}`;
        const was = outcomes.get(k);
        // An Outline passes only when every row does.
        outcomes.set(k, was === 'failed' || t.status === 'failed' ? 'failed' : t.status);
      }
    }
  }
  return outcomes;
}

function check({ scenarios = effectiveScenarios(), bound = scenarioBindings(), outcomes = new Map() } = {}) {
  const { bindings, problems: bindingProblems } = bound;
  const problems = [...bindingProblems];
  const key = (cap, name) => `${cap} › ${name}`;
  const byKey = new Map();
  for (const b of bindings) {
    const k = key(b.capability, b.scenario);
    if (byKey.has(k)) problems.push(`${k} is bound twice: ${byKey.get(k).file}:${byKey.get(k).line} and ${b.file}:${b.line}`);
    else byKey.set(k, b);
  }
  const known = new Set(scenarios.map((s) => key(s.capability, s.scenario)));
  for (const b of bindings)
    if (!known.has(key(b.capability, b.scenario))) problems.push(`${b.file}:${b.line} binds "${b.scenario}", which ${b.capability} does not have`);

  const rows = scenarios.map((s) => {
    const binding = byKey.get(key(s.capability, s.scenario));
    const runner = !s.fenced ? 'prose' : binding ? 'vitest' : 'unbound';
    if (runner === 'unbound')
      problems.push(`${s.capability} › "${s.scenario}" (${s.file}:${s.line}) has no test; each fenced scenario needs a scenario(...) test`);
    return { ...s, runner, binding, outcome: outcomes.get(key(s.capability, s.scenario)) };
  });
  return { rows, problems };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function report(rows) {
  const caps = new Map();
  for (const r of rows) {
    if (!caps.has(r.capability)) caps.set(r.capability, { title: r.title, requirements: new Map() });
    const reqs = caps.get(r.capability).requirements;
    if (!reqs.has(r.requirement)) reqs.set(r.requirement, []);
    reqs.get(r.requirement).push(r);
  }
  const count = (runner) => rows.filter((r) => r.runner === runner).length;
  const badge = (r) =>
    `<span class="b ${r.runner}">${r.runner}</span>` + (r.outcome ? ` <span class="o ${r.outcome}">${r.outcome === 'passed' ? '✓' : r.outcome === 'failed' ? '✗' : r.outcome}</span>` : '');
  const where = (r) => (r.binding ? `<code>${esc(r.binding.file)}:${r.binding.line}</code>` : '');
  const body = [...caps]
    .map(([cap, c]) => {
      const capRows = [...c.requirements.values()].flat();
      const summary = ['vitest', 'unbound', 'prose'].map((k) => [k, capRows.filter((r) => r.runner === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(' · ');
      const reqs = [...c.requirements]
        .map(
          ([req, list]) =>
            `<h3>${esc(req)}</h3>` +
            list
              .map(
                (r) =>
                  `<details><summary>${badge(r)} ${esc(r.scenario)} ${where(r)}${r.source !== 'main' ? ` <em>${esc(r.source)}</em>` : ''}</summary>` +
                  (r.steps.length ? `<pre>${r.steps.map((st) => `${esc(st.keyword)} ${esc(st.text)}`).join('\n')}</pre>` : '<p>Prose: no Gherkin yet.</p>') +
                  `</details>`,
              )
              .join(''),
        )
        .join('');
      return `<section><h2>${esc(c.title ?? cap)} <small>${esc(cap)} — ${summary}</small></h2>${reqs}</section>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>Spec scenarios</title>
<style>body{font:14px system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#111}h2{margin-top:32px;border-bottom:1px solid #ddd}h2 small{font-weight:400;color:#666;font-size:13px}h3{font-size:14px;margin:14px 0 4px;color:#333}details{margin:2px 0 2px 12px}pre{background:#f6f6f6;padding:8px;margin:4px 0 8px}code{color:#555;font-size:12px}.b{display:inline-block;min-width:64px;text-align:center;border-radius:4px;font-size:11px;padding:1px 4px;color:#fff}.vitest{background:#2f7d32}.unbound{background:#c62828}.prose{background:#999}.o{font-weight:700}.passed{color:#2f7d32}.failed{color:#c62828}</style>
<h1>Spec scenarios</h1><p>${rows.length} scenarios: ${count('vitest')} on Vitest, ${count('unbound')} unbound, ${count('prose')} prose.</p>${body}`;
}

if (require.main === module) {
  // `--results a.json b.json`: Vitest JSON reports, to show each bound scenario's outcome.
  const at = process.argv.indexOf('--results');
  const outcomes = at >= 0 ? readResults(process.argv.slice(at + 1)) : new Map();
  const { rows, problems } = check({ outcomes });
  const out = path.join(ROOT, 'scenarios-report');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), report(rows));
  const n = (runner) => rows.filter((r) => r.runner === runner).length;
  console.log(
    `check-scenarios: ${rows.length} scenarios — ${n('vitest')} on Vitest, ${n('unbound')} unbound, ${n('prose')} prose. Report: scenarios-report/index.html`,
  );
  const failed = rows.filter((r) => r.outcome === 'failed');
  for (const r of failed) problems.push(`${r.capability} › "${r.scenario}" failed (${r.binding.file}:${r.binding.line})`);
  if (problems.length) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
}

module.exports = { check, report, readResults };
