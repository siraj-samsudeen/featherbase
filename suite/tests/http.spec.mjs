import { test, expect } from '../fixtures.mjs';
import { exactlyOneWinner, unchanged } from '../lib/assertions.mjs';

test('API lifecycle, stable identity, duplicate titles, filters and untouched sentinel', async ({ app }) => {
  const api = app.api;
  const sentinel = await api.create('Untouched');
  let record = await api.create('Buy milk');
  const duplicate = await api.create('Buy milk');
  expect(duplicate.id).not.toEqual(record.id);
  record = await api.change('rename', record, { title: 'Buy oat milk' });
  expect(record).toMatchObject({ title: 'Buy oat milk', completed: false });
  const identity = record.id;
  record = await api.change('complete', record, { completed: true });
  expect(record).toMatchObject({ id: identity, title: 'Buy oat milk', completed: true });
  expect((await api.list('completed')).map(r => r.id)).toEqual([identity]);
  expect(new Set((await api.list('open')).map(r => r.id))).toEqual(new Set([sentinel.id, duplicate.id]));
  record = await api.change('rename', record, { title: 'Still completed' });
  expect(record.completed).toBe(true);
  record = await api.change('complete', record, { completed: false });
  expect(record.completed).toBe(false);
  await api.change('delete', record);
  api.error(await api.call('read', record), 'missing');
  api.error(await api.call('delete', record), 'missing');
  expect(await api.read(sentinel.id)).toEqual(sentinel);
  expect(await api.read(duplicate.id)).toEqual(duplicate);
});

const accepted = [
  ['x', 'x'], ['😀'.repeat(200), '😀'.repeat(200)],
  [`\u2003${'😀'.repeat(200)}\u2003`, '😀'.repeat(200)],
  ['\u0085\u2003 Buy  milk \u2029', 'Buy  milk'],
  ['e\u0301 MiXeD', 'e\u0301 MiXeD'], ['\uFEFFx\uFEFF', '\uFEFFx\uFEFF'],
  ['<script>alert(1)</script>', '<script>alert(1)</script>'],
];
const rejected = ['', ' \t\u0085\u2003', 'a'.repeat(201), '😀'.repeat(201), null, 42, false, [], {}, ...['\n', '\r', '\u0085', '\u2028', '\u2029'].map(v => `a${v}b`)];

test('API title rules apply equally to creation and rename', async ({ app }) => {
  const api = app.api;
  let target = await api.create('Original');
  for (const [input, saved] of accepted) {
    expect((await api.create(input)).title).toBe(saved);
    target = await api.change('rename', target, { title: input });
    expect(target.title).toBe(saved);
  }
  for (const title of rejected) {
    const before = await api.snapshot();
    api.error(await api.call('create', { title }), 'invalid');
    api.error(await api.call('rename', { ...target, title }), 'invalid');
    unchanged(await api.snapshot(), before);
    expect(await api.read(target.id)).toEqual(target);
  }
});

test('Malformed JSON, unknown filters, invalid states and missing proof change nothing', async ({ app }) => {
  const api = app.api;
  const target = await api.create('Original');
  const before = await api.snapshot();
  api.error(await api.call('create', {}, { body: '{', headers: { 'content-type': 'application/json' } }), 'invalid');
  api.error(await api.call('list', { filter: 'not-a-real-filter' }), 'invalid');
  for (const completed of ['true', 1, null, {}, []]) api.error(await api.call('complete', { ...target, completed }), 'invalid');
  for (const name of ['rename', 'complete', 'delete']) api.error(await api.call(name, { id: target.id, title: 'No proof', completed: true }), 'invalid');
  expect(await api.snapshot()).toEqual(before);
  expect((await api.create('Still works')).title).toBe('Still works');
});

for (const operation of ['rename', 'complete', 'reopen', 'delete']) {
  test(`Stale ${operation}, including changed-away-and-back, is rejected`, async ({ app }) => {
    const api = app.api;
    const sentinel = await api.create('Sentinel');
    let stale = await api.create('Original');
    if (operation === 'reopen') stale = await api.change('complete', stale, { completed: true });
    let latest = await api.change('rename', stale, { title: 'Changed' });
    latest = await api.change('rename', latest, { title: 'Original' });
    expect(latest.proof).not.toEqual(stale.proof);
    const result = await api.call(operation === 'reopen' ? 'complete' : operation, { ...stale, title: 'Stale overwrite', completed: operation !== 'reopen' });
    api.error(result, 'conflict');
    expect(await api.read(stale.id)).toEqual(latest);
    expect(await api.read(sentinel.id)).toEqual(sentinel);
    await api.change('delete', latest);
    for (const name of ['rename', 'complete', 'delete']) api.error(await api.call(name, { ...latest, title: 'Resurrect', completed: false }), 'missing');
    expect(await api.snapshot()).toEqual([{ id: sentinel.id, title: 'Sentinel', completed: false }]);
  });
}

test('Exactly one competing write wins, including different fields', async ({ app }) => {
  const api = app.api;
  const target = await api.create('Original');
  const results = await Promise.all([
    api.call('rename', { ...target, title: 'Winner title' }),
    api.call('complete', { ...target, completed: true }),
  ]);
  exactlyOneWinner(results);
  api.error(results.find(r => r.status >= 400), 'conflict');
  const final = await api.read(target.id);
  expect({ title: final.title, completed: final.completed }).toEqual(results[0].status < 300 ? { title: 'Winner title', completed: false } : { title: 'Original', completed: true });
});
