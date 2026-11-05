'use strict';

// A data source on the run's outside database (support/stack.js), reached
// through one reader login that may read the named tables and owns nothing.

const assert = require('node:assert/strict');
const { externalSql, EXTERNAL_URL_ENV, EXTERNAL_READER, EXTERNAL_READER_PASSWORD } = require('./stack');

// A role is shared by the whole cluster, so it is made again.
async function givenReaderSource(world, source, schema, tables) {
  const [exists] = await externalSql('select 1 from pg_roles where rolname = $1', [EXTERNAL_READER]);
  if (!exists) await externalSql(`create role ${EXTERNAL_READER} login password '${EXTERNAL_READER_PASSWORD}'`);
  else await externalSql(`alter role ${EXTERNAL_READER} login password '${EXTERNAL_READER_PASSWORD}'`);
  await externalSql(`grant usage on schema ${schema} to ${EXTERNAL_READER}`);
  for (const table of tables) await externalSql(`grant select on ${schema}.${table} to ${EXTERNAL_READER}`);
  const [owned] = await externalSql(
    `select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = $1`, [EXTERNAL_READER]);
  assert.equal(owned.n, 0, 'the reader login must own nothing');
  await world.withApi(async (api) => {
    await api.call('DELETE', `/api/table/Data%20Source/${source}`);
    await api.call('POST', '/api/table/Data%20Source', {
      row_id: source, engine: 'postgres', url_env: EXTERNAL_URL_ENV, default_schema: schema, access: 'read_only',
    }, [201], `register the ${source} data source`);
  });
}

module.exports = { givenReaderSource };
