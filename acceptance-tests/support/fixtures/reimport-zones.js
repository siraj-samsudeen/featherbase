'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { acceptanceSql, restartAcceptance, API_URL } = require('../stack');
const { Api } = require('../api');

function zones(count = 61) {
  return Array.from({ length: count }, (_, i) => ({
    row_id: `ZONE-${String(i + 1).padStart(3, '0')}`,
    zone_code: `Z${String(i + 1).padStart(3, '0')}`,
    region: 'North',
    population: 1000 + i,
  }));
}

function zonesCsv(rows) {
  return ['Zone Code,Region,Population', ...rows.map(r => `${r.zone_code},${r.region},${r.population}`)].join('\n');
}

async function importedZones(world, { corrected = false, history = true, count = 61, keyed = false, repeated = false, restricted = false } = {}) {
  const table = `Reimport Zones ${randomUUID().slice(0, 8)}`;
  const rows = zones(count);
  if (repeated) rows[1].zone_code = rows[0].zone_code;
  await world.withApi(async api => {
    await api.createTable({
      name: table,
      columns: [
        { column_name: 'zone_code', label: 'Zone Code', column_type: 'Data', in_list_view: true, ...(restricted ? { tier: 'restricted' } : {}) },
        { column_name: 'region', label: 'Region', column_type: 'Data' },
        { column_name: 'population', label: 'Population', column_type: 'Int' },
      ],
    });
    // No public setting exposes this metadata flag. Change only the disposable
    // acceptance DB and restart its API so no cached metadata survives.
    if (!history) {
      await acceptanceSql('update featherbase.table_def set track_changes = false where name = $1', [table]);
      await restartAcceptance();
    }
    const runId = randomUUID();
    for (let start = 0; start < rows.length; start += 500) {
      const seeded = await api.call('POST', `/api/table/${encodeURIComponent(table)}:import`, {
        rows: rows.slice(start, start + 500), ...(keyed ? { key_column: 'zone_code' } : {}),
        context: { run_id: runId, file_name: 'zones.csv' },
      }, [201], 'import the original zones');
      const result = await seeded.json();
      assert.equal(result.inserted, Math.min(500, rows.length - start));
      assert.deepEqual(result.failed, []);
    }
    if (corrected) {
      const first = await api.row(table, rows[0].row_id);
      await api.call('PATCH', `/api/table/${encodeURIComponent(table)}/${rows[0].row_id}`, {
        region: 'South', updated_at: first.updated_at,
      }, [200], 'correct the first region');
      assert.equal((await api.row(table, rows[0].row_id)).region, 'South');
    }
    const meta = await api.call('GET', `/api/table/${encodeURIComponent(table)}:meta`, undefined, [200], 'read zone metadata');
    assert.equal((await meta.json()).track_changes, history);
  });
  if (restricted) {
    const role = `${table} Importer`;
    await world.withApi(async api => {
      await api.saveRow('Role', { row_id: role });
      await api.saveRow('Permission', { ref_table: table, role, can_read: true, can_write: true, can_create: true });
    });
    await world.person('the user', [role]);
  }
  world.reimport = { table, rows, checked: false, restricted };
}

// The Import Wizard deliberately requires System Manager, which bypasses
// column tiers. Exercise the public analysis boundary as a real restricted
// person instead; never give that person System Manager to make the UI open.
async function analyzeRestrictedKeys(world) {
  const page = await world.actor();
  const state = await page.context().storageState();
  const token = state.origins.flatMap(origin => origin.localStorage).find(entry => entry.name === 'fc_token').value;
  const api = new Api(page.request, { Authorization: `Bearer ${token}` });
  const path = `${API_URL}/api/table/${encodeURIComponent(world.reimport.table)}`;
  const read = await api.call('GET', `${path}?fields=${encodeURIComponent('["row_id","region"]')}`, undefined, [200], 'restricted person reads zones');
  assert.equal((await read.json()).total, 61);
  const analysis = await api.call('POST', `${path}:import`, {
    analyze_keys: true, columns: ['zone_code'], rows: world.reimport.rows.map(({ zone_code }) => ({ zone_code })),
  }, [201], 'restricted person prepares matching analysis');
  return analysis.json();
}

async function zoneCount(world) {
  return world.withApi(async api => {
    const response = await api.call('GET', `/api/table/${encodeURIComponent(world.reimport.table)}:count`, undefined, [200], 'count zones');
    return (await response.json()).count;
  });
}

async function populations(world) {
  return world.withApi(async api => {
    const fields = encodeURIComponent('["zone_code","population"]');
    const rows = [];
    for (let start = 0; ; ) {
      const response = await api.call('GET', `/api/table/${encodeURIComponent(world.reimport.table)}?fields=${fields}&order_by=row_id%20asc&limit_page_length=500&limit_start=${start}`, undefined, [200], 'read populations');
      const page = await response.json();
      rows.push(...page.data);
      if (page.data.length === 0 || rows.length >= page.total) break;
      start += page.data.length;
    }
    return Object.fromEntries(rows.map(row => [row.zone_code, row.population]));
  });
}

module.exports = { importedZones, zonesCsv, zoneCount, analyzeRestrictedKeys, populations };
