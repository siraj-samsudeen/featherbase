'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { acceptanceSql, restartAcceptance } = require('../stack');

function zones() {
  return Array.from({ length: 61 }, (_, i) => ({
    row_id: `ZONE-${String(i + 1).padStart(3, '0')}`,
    zone_code: `Z${String(i + 1).padStart(3, '0')}`,
    region: 'North',
    population: 1000 + i,
  }));
}

function zonesCsv(rows) {
  return ['Zone Code,Region,Population', ...rows.map(r => `${r.zone_code},${r.region},${r.population}`)].join('\n');
}

async function importedZones(world, { corrected = false, history = true } = {}) {
  const table = `Reimport Zones ${randomUUID().slice(0, 8)}`;
  const rows = zones();
  await world.withApi(async api => {
    await api.createTable({
      name: table,
      columns: [
        { column_name: 'zone_code', label: 'Zone Code', column_type: 'Data', in_list_view: true },
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
    const seeded = await api.call('POST', `/api/table/${encodeURIComponent(table)}:import`, {
      rows, context: { run_id: randomUUID(), file_name: 'zones.csv' },
    }, [201], 'import the original 61 zones');
    const result = await seeded.json();
    assert.equal(result.inserted, 61);
    assert.deepEqual(result.failed, []);
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
  world.reimport = { table, rows, checked: false };
}

module.exports = { importedZones, zonesCsv };
