import { writeFile } from 'node:fs/promises'

const policy = { kind: 'stores', storeTable: 'scopeproof.store', readRoles: ['Scope Reader', 'Scope Planner'], actionRoles: ['Scope Planner'] }
const request = { policy, scope: { kind: 'request' }, authorization: { kind: 'generic' } }
const object = { policy, scope: { kind: 'resolver', name: 'object', facts: [
  { table: 'scopeproof.object', columns: ['stores'] }, { table: 'scopeproof.line', columns: ['parent_id'] },
] }, authorization: { kind: 'generic' } }
const product = { policy, scope: { kind: 'resolver', name: 'pairs', facts: [] },
  authorization: { kind: 'product', name: 'pairs', facts: [{ table: 'scopeproof.access', columns: ['pairs'] }] } }
const tables = [
  ['store', [{ column_name: 'label', column_type: 'Data' }]],
  ['object', [{ column_name: 'stores', column_type: 'JSON' }, { column_name: 'secret', column_type: 'Data' }]],
  ['line', [{ column_name: 'parent_id', column_type: 'Data' }]],
  ['access', [{ column_name: 'pairs', column_type: 'JSON' }]],
  ['effect', [{ column_name: 'value', column_type: 'Data' }]],
].map(([name, columns]) => ({ name: `scopeproof.${name}`, label: name, id_pattern: 'prompt', columns }))
await writeFile(new URL('featherbase.json', import.meta.url), JSON.stringify({
  manifestVersion: 1, apiVersion: 1, name: 'scopeproof', title: 'App scope proof',
  entryTable: 'scopeproof.object', server: 'server.mjs', tables,
  roles: ['Scope Reader', 'Scope Planner'],
  permissions: [
    ...tables.map(t => ({ table: t.name, role: 'All', can_read: true, can_create: true, can_write: true, can_delete: true })),
    ...['Scope Reader', 'Scope Planner'].map(role => ({ table: 'scopeproof.object', role, can_read: true })),
  ],
  actions: { version: 2, tables: tables.map(t => t.name), operations: { write: request, discard: object, product } },
  reads: { version: 1, tables: tables.map(t => t.name), operations: {
    stores: { ...request, discoverStoreAccess: true }, object, product: { ...product, discoverStoreAccess: true },
  } },
}, null, 2) + '\n')
