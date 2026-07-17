#!/usr/bin/env node
// Renders harness/features.json as a self-contained HTML status board.
// Usage: node harness/render-features.mjs <output.html>
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = process.argv[2]
if (!out) {
  console.error('usage: node render-features.mjs <output.html>')
  process.exit(1)
}
const data = JSON.parse(readFileSync(join(here, 'features.json'), 'utf8'))
const features = data.features

const CATEGORY_META = [
  ['metadata', 'Metadata engine', 'DocType JSON → tables, fields, naming, validation'],
  ['document-engine', 'Document engine', 'Lifecycle hooks, transactions, submit/cancel, versions'],
  ['rest-api', 'REST API & auth', 'Generic CRUD, RPC, sessions, tokens'],
  ['permissions', 'Permissions', 'Roles, DocPerm, row/field-level, RLS'],
  ['desk-ui', 'Desk UI', 'Generic list/form views, link fields, views'],
  ['files', 'Files', 'Uploads, attachments, signed access'],
  ['reports', 'Reports', 'Report view, saved/query/script reports, export'],
  ['printing', 'Printing', 'Print formats, PDF, letterheads'],
  ['workflow', 'Workflow', 'States, transitions, approvals'],
  ['customization', 'Customization', 'Custom fields, property setters, scripts'],
  ['background-jobs', 'Background jobs', 'Queue, retries, scheduler, monitoring'],
  ['realtime', 'Realtime', 'Live lists, edit awareness, notifications'],
  ['email', 'Email & notifications', 'Accounts, queue, rules, assignments'],
  ['system', 'System', 'Singles, users, permission manager, settings'],
  ['website', 'Website & portal', 'Web pages, web forms, portal'],
  ['i18n', 'Internationalization', 'Translations, locales, formats'],
  ['platform', 'Platform', 'Apps, hooks, migrations, CLI, webhooks, tenancy'],
]

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const passing = features.filter((f) => f.status === 'passing').length
const total = features.length
const pct = total ? Math.round((passing / total) * 100) : 0
const statusById = Object.fromEntries(features.map((f) => [f.id, f.status]))

const sections = CATEGORY_META.filter(([key]) => features.some((f) => f.category === key))
  .map(([key, label, blurb]) => {
    const items = features.filter((f) => f.category === key)
    const done = items.filter((f) => f.status === 'passing').length
    const rows = items
      .map((f) => {
        const deps = (f.deps ?? [])
          .map((d) => `<span class="dep ${statusById[d] === 'passing' ? 'dep-ok' : ''}">${esc(d)}</span>`)
          .join('')
        return `<details class="feat ${f.status}">
  <summary>
    <span class="fid">${esc(f.id)}</span>
    <span class="ftitle">${esc(f.title)}</span>
    <span class="chips"><span class="prio p${f.priority}">P${f.priority}</span>
    <span class="pill ${f.status}">${f.status === 'passing' ? 'passing' : 'failing'}</span></span>
  </summary>
  <div class="fbody">
    <p class="verify"><span class="lbl">Verified by</span>${esc(f.verify)}</p>
    ${deps ? `<p class="deps"><span class="lbl">Depends on</span>${deps}</p>` : ''}
  </div>
</details>`
      })
      .join('\n')
    return `<section>
  <header class="cat">
    <div><h2>${esc(label)}</h2><p class="blurb">${esc(blurb)}</p></div>
    <span class="catcount">${done}<span class="of">/${items.length}</span></span>
  </header>
  <div class="catmeter"><i style="width:${items.length ? (done / items.length) * 100 : 0}%"></i></div>
  ${rows}
</section>`
  })
  .join('\n')

const html = `<title>Frappe Clone — Feature Board</title>
<style>
:root{
  --ground:#F8F7F5; --panel:#FFFFFF; --ink:#201E1B; --muted:#6E6A63;
  --line:#E5E2DC; --accent:#0F6B62; --accent-soft:#E3EFED;
  --fail:#B4552D; --fail-soft:#F6EAE2; --pass:#2E7D4F; --pass-soft:#E4F0E8;
}
@media (prefers-color-scheme: dark){:root{
  --ground:#171614; --panel:#201E1B; --ink:#E8E5E0; --muted:#9B968D;
  --line:#33302B; --accent:#3FA396; --accent-soft:#1E332F;
  --fail:#D98757; --fail-soft:#382720; --pass:#66B285; --pass-soft:#20301F;
}}
:root[data-theme="dark"]{
  --ground:#171614; --panel:#201E1B; --ink:#E8E5E0; --muted:#9B968D;
  --line:#33302B; --accent:#3FA396; --accent-soft:#1E332F;
  --fail:#D98757; --fail-soft:#382720; --pass:#66B285; --pass-soft:#20301F;
}
:root[data-theme="light"]{
  --ground:#F8F7F5; --panel:#FFFFFF; --ink:#201E1B; --muted:#6E6A63;
  --line:#E5E2DC; --accent:#0F6B62; --accent-soft:#E3EFED;
  --fail:#B4552D; --fail-soft:#F6EAE2; --pass:#2E7D4F; --pass-soft:#E4F0E8;
}
*{box-sizing:border-box}
body{background:var(--ground);color:var(--ink);
  font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0}
.wrap{max-width:880px;margin:0 auto;padding:0 20px 80px}
.top{position:sticky;top:0;z-index:5;background:var(--ground);
  border-bottom:1px solid var(--line);padding:18px 0 14px;margin-bottom:8px}
.top-inner{max-width:880px;margin:0 auto;padding:0 20px;
  display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 18px}
h1{font-size:19px;font-weight:650;margin:0;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:13px}
.counts{margin-left:auto;display:flex;gap:14px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-variant-numeric:tabular-nums;font-size:13px}
.counts b{font-weight:650}
.counts .cp b{color:var(--pass)} .counts .cf b{color:var(--fail)}
.meter{flex-basis:100%;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.meter i{display:block;height:100%;background:var(--accent);border-radius:3px}
section{margin-top:34px}
.cat{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:6px}
h2{font-size:15px;font-weight:650;margin:0;letter-spacing:.01em}
.blurb{margin:1px 0 0;font-size:12.5px;color:var(--muted)}
.catcount{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-variant-numeric:tabular-nums;font-size:14px;font-weight:600}
.catcount .of{color:var(--muted);font-weight:400}
.catmeter{height:3px;border-radius:2px;background:var(--line);margin-bottom:10px;overflow:hidden}
.catmeter i{display:block;height:100%;background:var(--accent)}
.feat{background:var(--panel);border:1px solid var(--line);border-radius:6px;margin:5px 0}
.feat summary{display:flex;align-items:center;gap:10px;padding:9px 12px;
  cursor:pointer;list-style:none}
.feat summary::-webkit-details-marker{display:none}
.feat summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
.fid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  color:var(--muted);flex:0 0 74px;font-variant-numeric:tabular-nums}
.ftitle{flex:1;font-size:14px;min-width:0}
.chips{display:flex;gap:6px;align-items:center;flex:none}
.prio{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;
  color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.prio.p1{color:var(--accent);border-color:var(--accent)}
.pill{font-size:11px;font-weight:600;letter-spacing:.04em;border-radius:10px;padding:2px 9px}
.pill.failing{background:var(--fail-soft);color:var(--fail)}
.pill.passing{background:var(--pass-soft);color:var(--pass)}
.fbody{padding:2px 12px 11px 96px;font-size:13px}
.fbody .lbl{display:block;font-size:10.5px;font-weight:650;letter-spacing:.08em;
  text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.verify{margin:6px 0;color:var(--ink)}
.deps{margin:10px 0 2px}
.dep{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:11.5px;border:1px solid var(--fail);color:var(--fail);
  border-radius:4px;padding:1px 6px;margin:2px 6px 0 0}
.dep.dep-ok{border-color:var(--pass);color:var(--pass)}
@media (max-width:560px){
  .fid{flex-basis:auto}.fbody{padding-left:12px}
  .cat{flex-direction:column;align-items:flex-start;gap:2px}.catcount{align-self:flex-end}
}
</style>
<div class="top"><div class="top-inner">
  <h1>Frappe Clone — Feature Board</h1>
  <span class="sub">126 features · autonomous build · updated ${new Date().toISOString().slice(0, 10)}</span>
  <span class="counts"><span class="cp"><b>${passing}</b> passing</span>
  <span class="cf"><b>${total - passing}</b> failing</span><span><b>${pct}%</b></span></span>
  <div class="meter"><i style="width:${pct}%"></i></div>
</div></div>
<div class="wrap">
${sections}
</div>
`
writeFileSync(out, html)
console.log(`wrote ${out} (${passing}/${total} passing)`)
