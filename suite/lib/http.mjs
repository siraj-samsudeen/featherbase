import assert from 'node:assert/strict';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { randomUUID } from 'node:crypto';

export function pointer(value, path = '') {
  return path.split('/').slice(1).reduce((v, key) => v?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], value);
}
function expand(value, args) {
  if (typeof value === 'string' && value.startsWith('$')) return args[value.slice(1)];
  if (Array.isArray(value)) return value.map(v => expand(v, args));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, args)]).filter(([, v]) => v !== undefined));
  return value;
}

export class API {
  constructor(baseURL, mapping) { this.baseURL = baseURL; this.mapping = mapping; }
  async discover() {
    const response = await fetch(new URL(this.mapping.openapi, this.baseURL));
    assert.equal(response.status, 200, 'OpenAPI discovery');
    const raw = await response.json();
    assert.match(raw.openapi, /^3\.1\./, 'OpenAPI 3.1 required');
    // Published HTTP references are allowed; never load candidate source or local files.
    this.document = await $RefParser.dereference(new URL(this.mapping.openapi, this.baseURL).href, raw, {
      resolve: {
        file: false,
        candidateHTTP: {
          order: 1,
          canRead: file => new URL(file.url).origin === new URL(this.baseURL).origin,
          read: async file => {
            const response = await fetch(file.url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
            assert.ok(response.ok, `Unreachable published schema ${file.url}`);
            return response.text();
          },
        },
      },
    });
    this.ajv = addFormats(new Ajv({ strict: false, allErrors: true, validateFormats: true }));
    for (const name of ['list', 'read', 'create', 'rename', 'complete', 'delete']) {
      const operation = this.mapping.operations[name];
      assert.ok(operation, `Mapping missing ${name}`);
      assert.ok(this.document.paths[operation.path]?.[operation.method.toLowerCase()], `Unpublished operation ${name}`);
    }
    return this.document;
  }
  request(name, args = {}) {
    const operation = this.mapping.operations[name];
    assert.ok(operation, `Unknown mapped operation ${name}`);
    args = { ...args };
    for (const [key, values] of Object.entries(operation.values || {})) {
      const encoded = JSON.stringify(args[key]);
      if (Object.hasOwn(values, encoded)) args[key] = values[encoded];
    }
    const pathArgs = expand(operation.pathArgs || {}, args);
    const url = new URL(operation.path.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(pathArgs[key] ?? args[key])), this.baseURL);
    for (const [key, value] of Object.entries(expand(operation.query || {}, args))) url.searchParams.set(key, String(value));
    const headers = expand(operation.headers || {}, args);
    const body = expand(operation.body, args);
    if (body !== undefined) headers['content-type'] = 'application/json';
    return { url, method: operation.method.toUpperCase(), headers, body: body === undefined ? undefined : JSON.stringify(body) };
  }
  matches(name, request) {
    const operation = this.mapping.browser?.[name] ?? this.mapping.operations[name];
    const pattern = '^' + operation.path.split(/\{[^}]+\}/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$';
    const url = new URL(request.url());
    return url.origin === new URL(this.baseURL).origin && request.method() === operation.method.toUpperCase() && new RegExp(pattern).test(url.pathname)
      && (!operation.postDataIncludes || (request.postData() || '').includes(operation.postDataIncludes));
  }
  async call(name, args = {}, override = {}) {
    const request = this.request(name, { key: randomUUID(), ...args });
    const response = await fetch(request.url, { ...request, ...override, signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    let body;
    if (text) { assert.match(response.headers.get('content-type') || '', /\bjson\b|\+json\b/); body = JSON.parse(text); }
    const result = { status: response.status, headers: Object.fromEntries(response.headers), body };
    this.validate(name, result);
    return result;
  }
  validateRequest(name, args) {
    const request = this.request(name, args);
    const mapping = this.mapping.operations[name];
    const path = this.document.paths[mapping.path];
    const operation = path[mapping.method.toLowerCase()];
    if (request.body !== undefined) {
      const schema = operation.requestBody?.content?.['application/json']?.schema;
      assert.ok(schema, `Missing published JSON input schema for ${name}`);
      const valid = this.ajv.compile(schema);
      assert.ok(valid(JSON.parse(request.body)), `Valid ${name} request violates published schema: ${JSON.stringify(valid.errors)}`);
    }
    const parameters = [...(path.parameters || []), ...(operation.parameters || [])];
    for (const key of request.url.searchParams.keys()) assert.ok(parameters.some(p => p.in === 'query' && p.name === key && p.schema), `Undocumented query parameter ${key}`);
    for (const key of Object.keys(mapping.headers || {})) assert.ok(parameters.some(p => p.in === 'header' && p.name.toLowerCase() === key.toLowerCase() && p.schema), `Undocumented header ${key}`);
  }
  validate(name, result) {
    const operation = this.mapping.operations[name];
    const responses = this.document.paths[operation.path][operation.method.toLowerCase()].responses;
    const declared = responses[String(result.status)] || responses[`${Math.floor(result.status / 100)}XX`] || responses.default;
    assert.ok(declared, `Undocumented ${name} status ${result.status}`);
    if (result.body !== undefined) {
      const media = Object.entries(declared.content || {}).find(([type]) => type === result.headers['content-type']?.split(';')[0]);
      assert.ok(media?.[1]?.schema, `Missing response schema for ${name} ${result.status}`);
      const valid = this.ajv.compile(media[1].schema);
      assert.ok(valid(result.body), JSON.stringify(valid.errors));
    } else assert.ok(!declared.content || result.status === 204, 'Documented response body is missing');
  }
  record(result, item) {
    const fields = this.mapping.fields;
    const raw = item ?? pointer(result.body, fields.record);
    const record = {
      id: pointer(raw, fields.id), title: pointer(raw, fields.title), completed: pointer(raw, fields.completed),
      proof: fields.proofHeader ? result.headers[fields.proofHeader.toLowerCase()] : pointer(raw, fields.proof),
    };
    if (fields.stateValues) {
      assert.ok(Object.values(fields.stateValues).includes(record.completed), 'Unknown saved state');
      record.completed = record.completed === fields.stateValues.completed;
    }
    assert.ok(['string', 'number'].includes(typeof record.id), 'Stable scalar identity required');
    assert.equal(typeof record.title, 'string');
    assert.equal(typeof record.completed, 'boolean');
    return record;
  }
  async list(filter = 'all') {
    const args = { filter: this.mapping.filters[filter] ?? filter };
    this.validateRequest('list', args);
    const result = await this.call('list', args);
    assert.ok(result.status >= 200 && result.status < 300);
    const items = pointer(result.body, this.mapping.fields.list);
    assert.ok(Array.isArray(items), 'List mapping must identify array');
    return items.map(item => this.record(result, item));
  }
  async read(id) {
    this.validateRequest('read', { id });
    const result = await this.call('read', { id });
    assert.ok(result.status >= 200 && result.status < 300);
    const record = this.record(result);
    assert.notEqual(record.proof, undefined, 'Published version proof required');
    return record;
  }
  async create(title) {
    const args = { title, key: randomUUID() };
    this.validateRequest('create', args);
    const result = await this.call('create', args);
    assert.ok(result.status >= 200 && result.status < 300);
    const fields = this.mapping.fields;
    const id = fields.createId !== undefined ? pointer(result.body, fields.createId) : pointer(pointer(result.body, fields.record), fields.id);
    assert.ok(['string', 'number'].includes(typeof id), 'Map the created identity with fields.createId');
    return this.read(id);
  }
  async change(name, record, changes = {}) {
    this.validateRequest(name, { ...record, ...changes });
    const result = await this.call(name, { ...record, ...changes });
    assert.ok(result.status >= 200 && result.status < 300);
    return name === 'delete' ? result : this.read(record.id);
  }
  error(result, kind) {
    assert.ok(result.status >= 400 && result.status < 500, `Expected client error, got ${result.status}`);
    const expected = this.mapping.errors[kind];
    assert.ok(expected?.codes?.length, `Missing ${kind} error mapping`);
    assert.ok(expected.statuses.includes(result.status));
    assert.ok(expected.codes.includes(pointer(result.body, this.mapping.fields.error)), `Wrong machine-readable ${kind} error`);
  }
  async snapshot() {
    return (await this.list()).map(({ id, title, completed }) => ({ id, title, completed })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
}
