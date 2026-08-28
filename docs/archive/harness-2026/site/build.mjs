#!/usr/bin/env node
/**
 * Featherbase Explorer — static site builder.
 * Frozen alongside the rest of docs/archive/harness-2026/ (issue #236): the
 * site never had a working public deploy, so this only matters for opening
 * the archived index.html locally. Zero dependencies. Reads the archived
 * feature inventory, scans tests & src for feature-ID mentions, renders the
 * curated markdown library, and emits:
 *   index.html     — full standalone page (open locally)
 *   artifact.html  — body fragment (Claude artifact publishing)
 * Run: node docs/archive/harness-2026/site/build.mjs   (from the repo root)
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../docs/archive/harness-2026/site
const ROOT = join(HERE, '../../../..'); // repo root — this script now lives 4 levels down
const REPO = 'https://github.com/siraj-samsudeen/featherbase';
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ------------------------------------------------------------------ *
 * 1. Features + code/test scan
 * ------------------------------------------------------------------ */
// The feature inventory is frozen history (docs/archive/harness-2026/README.md):
// self-attested statuses from the 2026-07 build, kept because the IDs are still
// cited in tests and PROGRESS. Nothing writes it any more.
const harness = JSON.parse(read('docs/archive/harness-2026/harness/features.json'));
const features = harness.features.map(f => ({ ...f, tests: [], src: [] }));
const byId = Object.fromEntries(features.map(f => [f.id, f]));

function walk(dir, exts, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(abs, e);
    if (statSync(p).isDirectory()) walk(join(dir, e), exts, out);
    else if (exts.some(x => e.endsWith(x))) out.push(join(dir, e));
  }
  return out;
}
const ID_RE = /\b([A-Z][A-Z0-9]{1,5}-\d{3})\b/g;
function scan(files, bucket) {
  for (const f of files) {
    const text = read(f);
    const counts = {};
    let m;
    while ((m = ID_RE.exec(text))) if (byId[m[1]]) counts[m[1]] = (counts[m[1]] || 0) + 1;
    for (const [id, n] of Object.entries(counts)) byId[id][bucket].push({ file: f.replaceAll('\\', '/'), n });
  }
}
scan(walk('apps/server/test', ['.ts']), 'tests');
scan(walk('apps/web/test', ['.ts', '.tsx']), 'tests');
scan(walk('apps/web/e2e', ['.ts']), 'tests');
scan(walk('apps/server/src', ['.ts']), 'src');
scan(walk('apps/web/src', ['.ts', '.tsx']), 'src');
features.forEach(f => { f.tests.sort((a, b) => b.n - a.n); f.src.sort((a, b) => b.n - a.n); });

/* ------------------------------------------------------------------ *
 * 2. Category explanations + key files (hand-curated)
 * ------------------------------------------------------------------ */
const cats = {
  metadata: { title: 'Metadata engine', short: 'Tables as data; physical tables, validation and meta generated from JSON.',
    files: ['apps/server/src/doctype-engine.ts', 'apps/server/src/meta.ts'],
    how: 'A Table (the feature titles say "DocType" — the pre-rename word) is rows in table_def/column_def. Saving one runs createTableDDL in doctype-engine.ts — a real Postgres table under its bare name, no prefix, with the standard columns (created_by, created_at, updated_at, status, position) — and Zod validators derive from the same metadata, so schema, validation and UI share one source. meta.ts caches the processed definition and invalidates on change.' },
  'document-engine': { title: 'Document engine', short: 'The save/submit/delete lifecycle: hooks, child tables, one transaction.',
    files: ['apps/server/src/document.ts', 'apps/server/src/query.ts', 'apps/server/src/controllers.ts'],
    how: 'Every mutation goes through document.ts: validate → before_save → DB write → after_save inside one transaction, including child-table reconciliation, naming series, link integrity and conflict detection. Controllers registered per DocType hook into that chain; query.ts builds filtered list queries.' },
  'rest-api': { title: 'REST API', short: 'The /api/table surface, action registry, RPC methods, auth, tokens.',
    files: ['apps/server/src/index.ts', 'apps/server/src/actions.ts', 'apps/server/src/methods.ts', 'apps/server/src/auth.ts'],
    how: 'Since PR #63 the surface is one action registry (actions.ts): generated CRUD at /api/table/:table (GET list, POST create, GET/PATCH/DELETE per row, plus :count/:meta/:actions discovery), row actions like :submit/:cancel/:amend, and the /api/method/* RPC whitelist in methods.ts. PATCH replaced PUT so runtime-added columns are never silently nulled; every action declares effect read|write so a mutating GET is structurally impossible. Auth: sid cookie + Bearer token.' },
  permissions: { title: 'Permissions', short: 'Role Permissions, tiers, own-rows-only, Data Scopes — plus Postgres RLS.',
    files: ['apps/server/src/permissions.ts', 'apps/server/migrations/0010_rls.sql'],
    how: 'permissions.ts evaluates Permission rows (role × right × tier — tiers are basic/restricted, formerly permlevel 0–9), "own rows only" scoping (formerly if_owner) and Data Scope reference filters on every read and write; list queries get the same restrictions compiled into WHERE clauses. Underneath, migration 0010 adds real Postgres RLS for the desk_client role as defense in depth.' },
  'desk-ui': { title: 'Admin UI', short: 'One generic ListView and FormView render every Table from metadata.',
    files: ['apps/web/src/pages/DeskLayout.tsx', 'apps/web/src/components', 'apps/web/src/pages/TableBuilder.tsx'],
    how: 'The Admin UI (formerly "Desk") is deliberately generic: a single ListView and FormView read the Table metadata and render any model — columns, Reference typeaheads, sub-table grids, section layout — with zero per-model frontend code. DeskLayout provides the shell (sidebar grouped by module, command bar); TableBuilder edits Table definitions themselves.' },
  reports: { title: 'Reports', short: 'Query reports (safe SQL), script reports, charts.',
    files: ['apps/server/src/query-report.ts', 'apps/server/src/script-report.ts', 'apps/server/src/report-chart.ts'],
    how: 'Query reports run a single read-only SELECT with named {filter} placeholders bound as parameters inside a READ ONLY transaction — power without letting reports mutate. Script reports run registered server functions; report-chart.ts feeds the chart widgets.' },
  printing: { title: 'Printing', short: 'Server-side PDF via headless Chromium; print formats.',
    files: ['apps/server/src/print.ts', 'apps/web/src/pages/PrintView.tsx'],
    how: 'print.ts renders a document’s print view in headless Chromium (resolved from the environment, never hardcoded) and streams a PDF; PrintView.tsx is the same HTML a browser prints.' },
  workflow: { title: 'Workflow', short: 'State machines on a status field: states, transitions, role gates.',
    files: ['apps/server/src/workflow.ts'],
    how: 'A Workflow doc defines states and role-gated transitions over a state field on the target DocType; workflow.ts validates every save against legal transitions and applies transition side effects. The HD Ticket helpdesk flow is the shipped example.' },
  customization: { title: 'Customization', short: 'Custom fields, metadata overrides, sandboxed server scripts.',
    files: ['apps/server/src/custom-fields.ts', 'apps/server/src/customizations.ts', 'apps/server/src/server-scripts.ts'],
    how: 'Site-level changes layer on top of shipped metadata instead of editing it: custom-fields.ts adds real columns at runtime, Metadata Overrides (formerly property setters) store per-property overlays, and server-scripts.ts runs site-authored logic in a sandbox — the seed of the upgrade-safe overlay the design doc formalizes as D13.' },
  'background-jobs': { title: 'Background jobs', short: 'A Postgres-backed queue: enqueue, drain, retries, scheduled jobs.',
    files: ['apps/server/src/jobs.ts', 'apps/server/src/jobs'],
    how: 'tab_background_job is the queue; jobs.ts enqueues (transactionally with the triggering save) and drainJobs executes with retries. Scheduled/recurring jobs live in jobs/ — assignment, SLA escalation, email pulls ride this.' },
  realtime: { title: 'Realtime', short: 'WebSocket push: doc updates, list refreshes, progress.',
    files: ['apps/server/src/realtime.ts'],
    how: 'realtime.ts runs the ws server; saves publish doc/list events the Desk subscribes to, so open lists and forms refresh without polling.' },
  email: { title: 'Email', short: 'Accounts, queue, notifications, inbound rules, auto email reports.',
    files: ['apps/server/src/email.ts', 'apps/server/src/email-rules.ts', 'apps/server/src/auto-email-report.ts'],
    how: 'Outbound mail goes through a queue table (rendered at delivery time); email-rules.ts turns inbound mail into documents (the helpdesk’s ticket-from-email), and auto-email-report.ts mails report results on schedule.' },
  files: { title: 'Files', short: 'Disk-backed uploads, attachments, thumbnails.',
    files: ['apps/server/src/storage.ts', 'apps/server/src/thumbnails.ts'],
    how: 'storage.ts stores uploads on disk with File docs carrying metadata and permissions; thumbnails.ts renders previews via the same Chromium used for printing.' },
  website: { title: 'Website & portal', short: 'Public web forms and the logged-in portal over the same engine.',
    files: ['apps/server/src/webform.ts', 'apps/server/src/website.ts', 'apps/web/src/pages/WebForm.tsx', 'apps/web/src/pages/Portal.tsx'],
    how: 'Web Forms expose a DocType subset publicly (the generic intake surface); the Portal gives external users a narrow, permission-gated view of their own documents — both reuse the document engine and permission stack unchanged.' },
  i18n: { title: 'i18n', short: 'Translation table + language switching.',
    files: ['apps/server/src/i18n.ts'],
    how: 'tab_translation maps (language, source_text) → translated text; the Desk loads the active language’s bundle and falls back to source strings.' },
  system: { title: 'System', short: 'Settings, audit trail, global search.',
    files: ['apps/server/src/settings.ts', 'apps/server/src/audit.ts', 'apps/server/src/search.ts'],
    how: 'System/singles settings via the single_value store, an audit/activity trail on document events, and global search across DocTypes power the awesomebar.' },
  import: { title: 'Import', short: 'CSV/Excel → a Table and its rows: inference, mapping, dry run, log.',
    files: ['packages/shared/src/import.ts', 'apps/server/src/actions/collection-import.ts', 'apps/web/src/pages/ImportWizard.tsx', 'apps/web/src/lib/parse-file.ts'],
    how: 'A pure inference layer in packages/shared turns a parsed sheet into a proposed Table (sanitized column names, sampled types, Choice detection, coerced values); the server\'s :import collection action pushes every row through the normal saveDoc lifecycle — permissions, validation, id patterns, automation — so an import is just many ordinary saves, with per-row errors instead of an all-or-nothing failure. The wizard adds multi-sheet plans, mapping onto existing Tables, dry runs, and an Import Log row per request.' },
  platform: { title: 'Platform', short: 'Installable apps, fixtures, hooks, patches, CLI, schema-per-site tenancy.',
    files: ['apps/server/src/apps.ts', 'apps/server/src/patches.ts', 'apps/server/src/cli.ts', 'apps/server/src/tenancy.ts'],
    how: 'apps.ts is the installable-app registry: a manifest declares DocTypes, roles, permissions, doc_events and scheduler jobs; install runs them through the normal engine and records ownership for clean uninstall. patches.ts runs one-off migrations, cli.ts is the bench-equivalent, tenancy.ts demonstrates schema-per-site isolation.' },
};

/* ------------------------------------------------------------------ *
 * 3. Minimal markdown renderer (tuned to this repo's docs)
 * ------------------------------------------------------------------ */
const escapeHtml = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function inline(s) {
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    if (/^https?:/.test(u)) return `<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
    return t; // relative repo links: keep the text, drop the dead link
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return s;
}
function renderMd(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l || '');
  while (i < lines.length) {
    let line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^```/.test(line)) {                                   // fenced code
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const id = h[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      out.push(`<h${lvl} id="${id}">${inline(h[2])}</h${lvl}>`); i++; continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {                                   // blockquote
      const buf = [];
      while (i < lines.length && /^\s*(>|$)/.test(lines[i]) && !(buf.length && /^\s*$/.test(lines[i]) && !/^\s*>/.test(lines[i + 1] || ''))) {
        buf.push(lines[i].replace(/^\s*> ?/, '')); i++;
      }
      out.push(`<blockquote>${renderMd(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*\|/.test(line) && isTableSep(lines[i + 1])) {      // table
      const parseRow = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => inline(c.trim()));
      const head = parseRow(line); i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(parseRow(lines[i++]));
      out.push(`<div class="tablewrap"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {                                                    // list (2 levels)
      const ordered = /\d+\./.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) {
          const depth = m[1].length >= 2 ? 1 : 0;
          items.push({ depth, text: m[3] }); i++;
        } else if (/^\s+\S/.test(lines[i]) && items.length) {    // continuation
          items[items.length - 1].text += ' ' + lines[i].trim(); i++;
        } else break;
      }
      let html = `<${ordered ? 'ol' : 'ul'}>`;
      let liOpen = false, subOpen = false;
      for (const it of items) {
        if (it.depth === 0) {
          if (subOpen) { html += '</ul>'; subOpen = false; }
          if (liOpen) html += '</li>';
          html += `<li>${inline(it.text)}`;
          liOpen = true;
        } else {
          if (!liOpen) { html += '<li>'; liOpen = true; }
          if (!subOpen) { html += '<ul>'; subOpen = true; }
          html += `<li>${inline(it.text)}</li>`;
        }
      }
      if (subOpen) html += '</ul>';
      if (liOpen) html += '</li>';
      html += `</${ordered ? 'ol' : 'ul'}>`;
      out.push(html);
      continue;
    }
    const buf = [line]; i++;                                     // paragraph
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|\s*\||\s*>|\s*([-*]|\d+\.)\s)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

/* auto-link feature IDs (and spec capability IDs) in rendered doc html */
function autolink(html) {
  return html.replace(/\b([A-Z][A-Z0-9]{1,5}-\d{1,3})\b/g, (m, id) => {
    if (byId[id]) return `<a class="fid-link" href="#/f/${id}">${id}</a>`;
    if (/^EDS-\d+$/.test(id)) return `<a class="fid-link" href="#/d/spec-0001">${id}</a>`;
    if (/^VDT-\d+$/.test(id)) return `<a class="fid-link" href="#/d/spec-0002">${id}</a>`;
    return m;
  });
}

/* ------------------------------------------------------------------ *
 * 4. Document library
 * ------------------------------------------------------------------ */
const manifest = [
  ['Start here', 'architecture', 'Architecture — one save traced end to end', 'docs/ARCHITECTURE.md'],
  ['Start here', 'tutorial', 'Tutorial — your first DocType', 'docs/TUTORIAL.md'],
  ['Start here', 'learning-path', 'Learning path — the staged todo app', 'docs/LEARNING-PATH.md'],
  ['Start here', 'glossary', 'Glossary — Frappe terms, codebase pointers', 'docs/GLOSSARY.md'],
  ['Start here', 'testing', 'Testing — the SQL-sandbox model', 'docs/TESTING.md'],
  ['Start here', 'deploy', 'Deploy — the production runbook', 'docs/DEPLOY.md'],
  ['Design & plan', 'design-topology', 'Design framework — 7 axes, 21 decisions', 'docs/design/data-and-admin-topology.md'],
  ['Design & plan', 'execution-plan', 'Execution plan — milestones M1–M5', 'docs/design/execution-plan.md'],
  ['Design & plan', 'vision', 'Vision — what this is for', 'docs/VISION.md'],
  ['Design & plan', 'roadmap', 'Roadmap (superseded original)', 'docs/ROADMAP.md'],
  ['Specs', 'specs-index', 'Specs index', 'docs/specs/README.md'],
  ['Specs', 'spec-0001', 'Spec 0001 — External data sources', 'docs/specs/0001-external-data-sources.md'],
  ['Specs', 'spec-0002', 'Spec 0002 — Virtual DocTypes', 'docs/specs/0002-virtual-doctypes.md'],
  ['ADRs', 'adr-0007', 'ADR 0007 — App & database topology', 'docs/adr/0007-app-and-database-topology.md'],
  ['ADRs', 'adr-0006', 'ADR 0006 — React + Hono + Postgres', 'docs/adr/0006-stack-react-hono-postgres.md'],
  ['ADRs', 'adr-0005', 'ADR 0005 — Naming: Featherbase', 'docs/adr/0005-naming-featherbase.md'],
  ['ADRs', 'adr-0004', 'ADR 0004 — Materialization (superseded)', 'docs/adr/0004-materialization-admin-triggered.md'],
  ['ADRs', 'adr-0003', 'ADR 0003 — Definitions as JSON, two sources', 'docs/adr/0003-definitions-as-json-two-sources.md'],
  ['ADRs', 'adr-0002', 'ADR 0002 — Per-DocType tables + sidecar', 'docs/adr/0002-storage-per-doctype-tables-plus-fieldindex-sidecar.md'],
  ['ADRs', 'adr-0001', 'ADR 0001 — Convex stack (superseded)', 'docs/adr/0001-stack-convex-react-vite.md'],
  ['Research', 'frappe-architecture', 'Frappe architecture study (v17)', 'docs/research/frappe-architecture.md'],
  ['Research', 'multi-app-1', 'Frappe: multi-app & multi-DB (note 1)', 'docs/research/frappe-multi-app-multi-db.md'],
  ['Research', 'multi-app-2', 'Frappe: multi-app & multi-DB (note 2)', 'docs/research/frappe-multi-app-and-multi-db.md'],
  ['Log & harness', 'harness', 'The agent harness — how this was built (archived)', 'docs/archive/harness-2026/README.md'],
  ['Log & harness', 'progress', 'Progress log — every session, newest first', 'PROGRESS.md'],
];
if (existsSync(join(ROOT, 'CONTRIBUTING.md'))) manifest.splice(6, 0, ['Start here', 'contributing', 'Contributing — prerequisites & commands', 'CONTRIBUTING.md']);
for (const f of readdirSync(join(ROOT, 'docs/research/studies')).sort()) {
  if (!f.endsWith('.md')) continue;
  const slug = 'study-' + f.replace(/\.md$/, '');
  const title = f === 'README.md' ? 'Studies index — the two families' :
    'Study — ' + f.replace(/\.md$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  manifest.push(['System studies', slug, title, 'docs/research/studies/' + f]);
}
const docs = manifest.filter(([, , , p]) => existsSync(join(ROOT, p))).map(([group, slug, title, path]) => {
  const md = read(path);
  const words = md.split(/\s+/).length;
  return { group, slug, title, path, mins: Math.max(1, Math.round(words / 220)), html: autolink(renderMd(md)) };
});

/* ------------------------------------------------------------------ *
 * 5. Map-page data
 * ------------------------------------------------------------------ */
const axes = [
  { k: 'A', t: 'Organization & delegation', d: 'Apps, modules as admin boundaries, scoped types & field-sets.' },
  { k: 'B', t: 'Storage & system of record', d: 'Driver × ownership mode × sync bindings; analytics egress.' },
  { k: 'C', t: 'Naming, reflection, augmentation', d: 'No forced prefixes; adopt existing tables; opt-in audit columns.' },
  { k: 'D', t: 'Extensibility & distribution', d: 'Contribution points, micro/macro packages, upgrade-safe layers.' },
  { k: 'E', t: 'Time', d: 'Audit trail, version history, effectivity dating, as-of reads.' },
  { k: 'F', t: 'Change lifecycle', d: 'Environments, promotion with plan preview, rollback.' },
  { k: 'G', t: 'Actors & identity', d: 'Humans, portal users, machines, AI agents; on-behalf-of chains.' },
];
const lifecycle = [
  'A client calls save_doc or PATCH /api/table/:table/:name — never Postgres directly (API-001).',
  'Auth resolves the session or token to a user and their roles.',
  'Permissions gate the Table, the column tiers, and own-rows-only scope (PERM rows).',
  'Zod validation, generated from the Table metadata, checks the payload column-wise (META-013).',
  'The lifecycle chain runs: validate → before_save hooks in registered controllers (DOC-003).',
  'One transaction writes parent + sub-table rows, id-pattern counters, reference checks (DOC-001, DOC-005).',
  'after_save fans out: versions, audit, background jobs, webhooks, realtime push (DOC-009).',
  'The generic Admin UI re-renders from the same metadata that defined all of the above (UI-002, UI-004).',
];
const milestones = [
  'M1 · dbt seeds → DocTypes', 'M2 · CRUD manager retires', 'M3 · MotherDuck browser',
  'M4 · storage seam refactor', 'M5 · generated egress configs',
];

/* ------------------------------------------------------------------ *
 * 6. Assemble
 * ------------------------------------------------------------------ */
const data = {
  repo: REPO, decisions: 21,
  features: features.map(({ id, title, category, priority, deps, verify, status, tests, src }) =>
    ({ id, title, category, priority, deps: deps || [], verify, status, tests: tests.slice(0, 8), src: src.slice(0, 8) })),
  cats, docs, axes, lifecycle, milestones, learnSlug: 'learning-path',
};
const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
const css = readFileSync(join(HERE, 'style.css'), 'utf8');
const js = readFileSync(join(HERE, 'app.js'), 'utf8');

const nav = `
<header class="topbar"><div class="topbar-inner">
  <a class="wordmark" href="#/"><span class="feather">🪶</span>Featherbase Explorer</a>
  <nav class="nav">
    <a href="#/map">Map</a><a href="#/features">Features</a><a href="#/docs">Docs</a>
    <a href="#/learn">Learn</a><a href="#/questions" id="nav-q">Questions</a>
  </nav>
</div></header>
<main id="app"></main>
<div class="toast" role="status" aria-live="polite"></div>`;

const body = `<title>Featherbase Explorer</title>
<style>${css}</style>
${nav}
<script>window.__DATA__=${dataJson};</script>
<script>${js}</script>`;

const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🪶</text></svg>">
${body}
</html>`;

writeFileSync(join(HERE, 'index.html'), full);
writeFileSync(join(HERE, 'artifact.html'), body);
const kb = (s) => Math.round(Buffer.byteLength(s) / 1024);
console.log(`site/index.html      ${kb(full)} KB`);
console.log(`site/artifact.html   ${kb(body)} KB`);
console.log(`features: ${features.length}  docs: ${docs.length}  ` +
  `with-tests: ${features.filter(f => f.tests.length).length}  with-src: ${features.filter(f => f.src.length).length}`);
