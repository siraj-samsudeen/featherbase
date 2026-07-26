/* Featherbase Explorer — client. Data injected by build.mjs as window.__DATA__ */
(function () {
  const D = window.__DATA__;
  const $main = document.getElementById('app');
  const byId = {};
  D.features.forEach(f => { byId[f.id] = f; });
  const dependents = {};
  D.features.forEach(f => (f.deps || []).forEach(d => {
    (dependents[d] = dependents[d] || []).push(f.id);
  }));

  /* ---------- notes (questions) ---------- */
  const NKEY = 'fbx-notes-v1';
  const loadNotes = () => { try { return JSON.parse(localStorage.getItem(NKEY) || '[]'); } catch { return []; } };
  const saveNotes = (n) => localStorage.setItem(NKEY, JSON.stringify(n));
  function addNote(ctx, ctxTitle, text) {
    const notes = loadNotes();
    notes.unshift({ id: 'q' + Date.now().toString(36), ctx, ctxTitle, text, ts: new Date().toISOString() });
    saveNotes(notes);
    updateNavBadge();
  }
  function updateNavBadge() {
    const n = loadNotes().length;
    const el = document.getElementById('nav-q');
    if (el) el.textContent = n ? `Questions (${n})` : 'Questions';
  }

  /* ---------- tiny helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linkIds = (s) => esc(s).replace(/\b([A-Z][A-Z0-9]{1,5}-\d{3})\b/g, (m, id) =>
    byId[id] ? `<a class="fid-link" href="#/f/${id}">${id}</a>` : m);
  const gh = (p) => `${D.repo}/blob/main/${p}`;
  const chip = (txt, cls) => `<span class="chip ${cls || ''}">${esc(txt)}</span>`;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800);
  }

  function qboxHTML(ctx, ctxTitle) {
    return `<div class="card qbox" data-ctx="${esc(ctx)}" data-ctxtitle="${esc(ctxTitle)}">
      <div class="eyebrow">Ask / note something here</div>
      <textarea placeholder="A question, a doubt, a thing to dig into later…"></textarea>
      <div class="row">
        <button class="btn primary" data-act="save-note">Save note</button>
        <span class="qhint">Saved in this browser only — export from the Questions tab.</span>
      </div>
    </div>`;
  }

  /* ---------- pages ---------- */
  function pageHome() {
    const passing = D.features.filter(f => f.status === 'passing').length;
    return `
    <div class="hero">
      <h1>What the agent built, made explorable.</h1>
      <p>Featherbase is a metadata-driven app platform — Frappe's core ideas rebuilt on
      React + Hono + Postgres by a long-running agent harness. This site interlinks every
      harness feature with its tests, code, and the design documents, so you can audit it,
      learn it, and own it — from a phone.</p>
    </div>
    <div class="statrow">
      <span class="stat"><b>${passing}/${D.features.length}</b> features passing</span>
      <span class="stat"><b>${D.docs.length}</b> documents</span>
      <span class="stat"><b>${D.docs.filter(d => d.group === 'System studies').length}</b> system studies</span>
      <span class="stat"><b>${D.decisions}</b> design decisions</span>
    </div>
    <div class="grid2">
      <a class="card pathcard" href="#/map">
        <h3>Get the big picture</h3>
        <p>One request traced through the whole engine, the seven design axes, and every
        feature category at a glance.</p><span class="go">Open the map →</span>
      </a>
      <a class="card pathcard" href="#/features">
        <h3>Explore what was built</h3>
        <p>All ${D.features.length} harness features — each linked to its verification
        criteria, its tests, and the code behind it.</p><span class="go">Browse features →</span>
      </a>
      <a class="card pathcard" href="#/learn">
        <h3>Learn by building</h3>
        <p>A staged todo-app path — plain CRUD, then projects, subtasks, checklists,
        hooks, and permissions. Each stage names the features it exercises.</p>
        <span class="go">Start the path →</span>
      </a>
      <a class="card pathcard" href="#/docs">
        <h3>Read the thinking</h3>
        <p>Design framework, execution plan, ADRs, specs, research notes, and thirteen
        system studies — rendered for reading, not for git.</p><span class="go">Open the library →</span>
      </a>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="eyebrow">While you read</div>
      <p style="margin:6px 0 0;font-size:14px;color:var(--muted)">Anything unclear —
      press the note box at the bottom of any feature or document. Notes stay on this
      device; export them as JSON from the <a href="#/questions">Questions</a> tab and
      hand them to the next agent session.</p>
    </div>`;
  }

  function pageMap() {
    const life = D.lifecycle.map(s => `<li>${linkIds(s)}</li>`).join('');
    const axes = D.axes.map(a => `
      <div class="card axiscard"><h3><span class="ax">${esc(a.k)}</span>${esc(a.t)}</h3>
      <p>${esc(a.d)}</p></div>`).join('');
    const cats = Object.entries(D.cats).map(([key, c]) => {
      const n = D.features.filter(f => f.category === key).length;
      return `<a class="card catcard" href="#/features?cat=${encodeURIComponent(key)}">
        <b>${esc(c.title)}</b><span class="n">${n}</span><p>${esc(c.short)}</p></a>`;
    }).join('');
    const miles = D.milestones.map(m => chip(m, 'brand')).join(' ');
    return `
    <h1 class="page-title">The big picture</h1>
    <div class="stack">
      <div class="card">
        <div class="eyebrow">One save, end to end</div>
        <p class="lede" style="margin-bottom:10px">Every mutation follows this path — it is
        the spine the whole system hangs off (full walkthrough:
        <a href="#/d/architecture">Architecture</a>).</p>
        <ol class="lifecycle">${life}</ol>
      </div>
      <div class="card">
        <div class="eyebrow">The seven design axes</div>
        <p class="lede" style="margin-bottom:10px">The requirement space, organized. Full
        detail and all ${D.decisions} decisions:
        <a href="#/d/design-topology">the design framework</a>.</p>
        <div class="grid2">${axes}</div>
      </div>
      <div class="card">
        <div class="eyebrow">What gets built next</div>
        <p style="font-size:14px;color:var(--muted);margin:6px 0 10px">Concrete slices first,
        the seam refactor when a second backend forces it —
        <a href="#/d/execution-plan">the execution plan</a>.</p>
        <div>${miles}</div>
      </div>
      <div>
        <div class="eyebrow" style="margin:6px 2px">Feature categories</div>
        <div class="grid3">${cats}</div>
      </div>
    </div>`;
  }

  function pageFeatures(params) {
    const cat = params.get('cat') || '';
    const q = params.get('q') || '';
    const catChips = ['', ...Object.keys(D.cats)].map(c => {
      const label = c ? D.cats[c].title : 'All';
      const on = c === cat ? 'on' : '';
      return `<button class="chip ${on}" data-cat="${esc(c)}">${esc(label)}</button>`;
    }).join('');
    return `
    <h1 class="page-title">Features</h1>
    <div class="toolrow">
      <input class="search" id="fsearch" type="search" placeholder="Search ${D.features.length} features — try 'child table' or PERM" value="${esc(q)}">
      <div class="chiprow" id="fcats">${catChips}</div>
    </div>
    <div id="fresults"></div>`;
  }
  function renderFeatureList(cat, q) {
    const ql = q.trim().toLowerCase();
    const rows = D.features.filter(f =>
      (!cat || f.category === cat) &&
      (!ql || (f.id + ' ' + f.title + ' ' + f.verify).toLowerCase().includes(ql)));
    const html = rows.map(f => `
      <a class="frow" href="#/f/${f.id}">
        <span class="dot ${f.status === 'passing' ? 'pass' : 'fail'}"></span>
        <span><span class="fid mono">${f.id}</span> —
          <span class="ft">${esc(f.title)}</span>
          <div class="fc">${esc(D.cats[f.category].title)} · priority ${f.priority}</div>
        </span>
      </a>`).join('');
    document.getElementById('fresults').innerHTML =
      `<div class="count-note">${rows.length} of ${D.features.length}</div><div class="flist">${html}</div>`;
  }

  function pageFeature(id) {
    const f = byId[id];
    if (!f) return `<p class="empty">No feature ${esc(id)}.</p>`;
    const c = D.cats[f.category];
    const deps = (f.deps || []).map(d => `<a class="chip brand" href="#/f/${d}">${d}</a>`).join('') || '<span class="qhint">none</span>';
    const rdeps = (dependents[id] || []).map(d => `<a class="chip" href="#/f/${d}">${d}</a>`).join('') || '<span class="qhint">none</span>';
    const tests = f.tests.length
      ? f.tests.map(t => `<li><a class="mono" href="${gh(t.file)}" target="_blank" rel="noopener">${esc(t.file)}</a><span class="n">${t.n}×</span></li>`).join('')
      : '<li class="qhint">No test file mentions this ID directly — its coverage lives under the category\'s test files below.</li>';
    const src = f.src.length
      ? f.src.map(t => `<li><a class="mono" href="${gh(t.file)}" target="_blank" rel="noopener">${esc(t.file)}</a><span class="n">${t.n}×</span></li>`).join('')
      : '';
    const catFiles = c.files.map(p => `<li><a class="mono" href="${gh(p)}" target="_blank" rel="noopener">${esc(p)}</a></li>`).join('');
    return `
    <a class="backlink" href="#/features">← All features</a>
    <div class="stack">
      <div class="card">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="dot ${f.status === 'passing' ? 'pass' : 'fail'}"></span>
          <span class="fid mono" style="font-size:14px">${f.id}</span>
          ${chip(c.title)} ${chip('priority ' + f.priority)}
          ${f.status === 'passing' ? chip('passing', 'good') : chip(f.status, 'warn')}
        </div>
        <h1 class="page-title" style="margin:10px 0 6px">${esc(f.title)}</h1>
        <div class="kv" style="margin-top:10px">
          <span class="k">Verified by (the harness contract)</span>
          <span style="font-size:14px">${linkIds(f.verify)}</span>
        </div>
      </div>
      <div class="card">
        <div class="kv"><span class="k">How this area works</span></div>
        <p style="font-size:14px;margin:8px 0">${linkIds(c.how)}</p>
        <div class="kv" style="margin-top:10px"><span class="k">Key code for ${esc(c.title)}</span></div>
        <ul class="filelist">${catFiles}</ul>
      </div>
      <div class="card">
        <div class="kv"><span class="k">Tests that name ${f.id}</span></div>
        <ul class="filelist">${tests}</ul>
        ${src ? `<div class="kv" style="margin-top:12px"><span class="k">Source files that name ${f.id}</span></div><ul class="filelist">${src}</ul>` : ''}
      </div>
      <div class="card">
        <div class="grid2">
          <div class="kv"><span class="k">Depends on</span><div class="deprow">${deps}</div></div>
          <div class="kv"><span class="k">Needed by</span><div class="deprow">${rdeps}</div></div>
        </div>
      </div>
      ${qboxHTML('feature:' + f.id, f.id + ' — ' + f.title)}
    </div>`;
  }

  function pageDocs() {
    const groups = {};
    D.docs.forEach(d => (groups[d.group] = groups[d.group] || []).push(d));
    const order = ['Start here', 'Design & plan', 'Specs', 'ADRs', 'System studies', 'Research', 'Log & harness'];
    return `<h1 class="page-title">Library</h1>
      <p class="lede">Everything written for this project, rendered for reading. Feature IDs
      inside any document are live links.</p>` +
      order.filter(g => groups[g]).map(g => `
        <div class="docgroup"><h2>${esc(g)}</h2><div class="doclist">
          ${groups[g].map(d => `<a href="#/d/${d.slug}"><span>${esc(d.title)}</span><span class="sub">${d.mins} min</span></a>`).join('')}
        </div></div>`).join('');
  }

  function pageDoc(slug) {
    const d = D.docs.find(x => x.slug === slug);
    if (!d) return `<p class="empty">No document “${esc(slug)}”.</p>`;
    return `<a class="backlink" href="#/docs">← Library</a>
      <div class="prose">${d.html}</div>
      ${qboxHTML('doc:' + d.slug, d.title)}`;
  }

  function pageLearn() {
    const d = D.docs.find(x => x.slug === D.learnSlug);
    return `<h1 class="page-title">Learn by building</h1>
      <p class="lede">A staged todo app — each stage adds exactly one engine concept and names
      the features it exercises. Built twice each time: once in the Desk, once over raw HTTP.</p>
      <div class="prose">${d ? d.html : ''}</div>
      ${qboxHTML('learn', 'Learning path')}`;
  }

  function pageQuestions() {
    const notes = loadNotes();
    const items = notes.map(n => `
      <div class="card qitem" data-note="${n.id}">
        <div class="ctx">${esc(new Date(n.ts).toLocaleString())} · ${
          n.ctx.startsWith('feature:') ? `<a href="#/f/${esc(n.ctx.slice(8))}">${esc(n.ctxTitle)}</a>`
          : n.ctx.startsWith('doc:') ? `<a href="#/d/${esc(n.ctx.slice(4))}">${esc(n.ctxTitle)}</a>`
          : esc(n.ctxTitle)}</div>
        <div class="txt">${esc(n.text)}</div>
        <div class="row"><button class="del" data-act="del-note" data-id="${n.id}">delete</button></div>
      </div>`).join('');
    return `<h1 class="page-title">Questions & notes</h1>
      <p class="lede">Captured while reading, stored in this browser. Export the JSON and drop
      it into a session — “answer these against the codebase” — to turn curiosity into docs.</p>
      <div class="row" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn primary" data-act="export-notes">Download JSON</button>
        <button class="btn" data-act="copy-notes">Copy JSON</button>
      </div>
      <div class="stack">${items || '<div class="empty">Nothing yet. Note boxes live at the bottom of every feature and document.</div>'}</div>
      ${qboxHTML('general', 'General')}`;
  }

  /* ---------- router ---------- */
  const routes = [
    [/^#?\/?$/, () => pageHome()],
    [/^#\/map$/, () => pageMap()],
    [/^#\/features(\?(.*))?$/, (m) => pageFeatures(new URLSearchParams(m[2] || ''))],
    [/^#\/f\/([A-Z0-9-]+)$/, (m) => pageFeature(m[1])],
    [/^#\/docs$/, () => pageDocs()],
    [/^#\/d\/([a-z0-9-]+)$/, (m) => pageDoc(m[1])],
    [/^#\/learn$/, () => pageLearn()],
    [/^#\/questions$/, () => pageQuestions()],
  ];
  function render() {
    const h = location.hash || '#/';
    for (const [re, fn] of routes) {
      const m = h.match(re);
      if (m) {
        $main.innerHTML = fn(m);
        if (h.startsWith('#/features')) {
          const params = new URLSearchParams((h.split('?')[1] || ''));
          renderFeatureList(params.get('cat') || '', params.get('q') || '');
        }
        break;
      }
    }
    document.querySelectorAll('.nav a').forEach(a => {
      const seg = (location.hash || '#/').split(/[/?]/)[1] || '';
      const target = a.getAttribute('href').split('/')[1] || '';
      const alias = { f: 'features', d: 'docs' }[seg] || seg;
      a.classList.toggle('active', target === alias);
    });
    updateNavBadge();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);

  /* ---------- events ---------- */
  document.addEventListener('input', (e) => {
    if (e.target.id === 'fsearch') {
      const cat = document.querySelector('#fcats .chip.on')?.dataset.cat || '';
      renderFeatureList(cat, e.target.value);
    }
  });
  document.addEventListener('click', (e) => {
    const catBtn = e.target.closest('#fcats .chip');
    if (catBtn) {
      document.querySelectorAll('#fcats .chip').forEach(c => c.classList.remove('on'));
      catBtn.classList.add('on');
      renderFeatureList(catBtn.dataset.cat, document.getElementById('fsearch').value);
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'save-note') {
      const box = act.closest('.qbox');
      const ta = box.querySelector('textarea');
      if (ta.value.trim()) {
        addNote(box.dataset.ctx, box.dataset.ctxtitle, ta.value.trim());
        ta.value = '';
        toast('Saved — see the Questions tab');
      }
    }
    if (act.dataset.act === 'del-note') {
      saveNotes(loadNotes().filter(n => n.id !== act.dataset.id));
      render();
    }
    if (act.dataset.act === 'export-notes') {
      const blob = new Blob([JSON.stringify(loadNotes(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'featherbase-questions.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }
    if (act.dataset.act === 'copy-notes') {
      navigator.clipboard.writeText(JSON.stringify(loadNotes(), null, 2))
        .then(() => toast('Copied to clipboard'));
    }
  });

  render();
})();
