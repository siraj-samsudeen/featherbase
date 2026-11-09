'use strict';

// The running example of relational navigation (#910): Jeyarama-style
// organisation masters, made up. Region ← Site Master ← Plant ← Profit Centre ←
// Cost Centre. Regions and sites get ids the system makes up; a plant's id is
// its plant code (1503), and profit and cost centres are known by codes too.
//
// Kerala has three sites, Tamil Nadu one: four sites in all. Enchakkal has
// three plants; its supermarket (1503) has 40 profit centres, the first of
// them "EKL - Retail (All)", which has the cost centres, EKL-Marketing among
// them. Enchakkal's long note and its two empty fields (City, PIN code) are
// what the pane's fields scenario reads.

// The sites' table: "Site" itself names platform storage, so it cannot be a Table's name.
const SITE = 'Site Master';

// Dropped child first: a table another table links to refuses deletion.
const TABLES = ['Cost Centre', 'Profit Centre', 'Plant', SITE, 'Region'];

const LONG_NOTE =
  'Two rented floors above the old bus stand, leased since 2019. The ground floor holds the supermarket ' +
  'and its stock room; the first floor holds textiles and a small hardware counter. The landlord renews ' +
  'the lease every three years, and the next renewal needs the parking area marked out again before the ' +
  'monsoon, because the drains along the front road overflow every July and flood the loading bay.';

const SITES = [
  { name: 'Enchakkal', region: 'Kerala', site_code: 'EKL', note: LONG_NOTE },
  { name: 'Attakulangara', region: 'Kerala', site_code: 'ATK', city: 'Thiruvananthapuram', pin_code: '695023', note: 'Sample row' },
  { name: 'Pazhavangadi', region: 'Kerala', site_code: 'PKD', city: 'Thiruvananthapuram', pin_code: '695023', note: 'Sample row' },
  { name: 'Tenkasi', region: 'Tamil Nadu', site_code: 'TKS', city: 'Tenkasi', pin_code: '627811', note: 'Sample row' },
];

const PLANTS = [
  { row_id: '1503', name: 'Enchakkal Supermarket', site: 'Enchakkal', business_line: 'Retail' },
  { row_id: '1504', name: 'Enchakkal Textiles', site: 'Enchakkal', business_line: 'Textiles' },
  { row_id: '1505', name: 'Enchakkal Hardware', site: 'Enchakkal', business_line: 'Hardware' },
  { row_id: '1601', name: 'Attakulangara Store', site: 'Attakulangara', business_line: 'Retail' },
];

const RETAIL_ALL = { row_id: '1503100100', name: 'EKL - Retail (All)' };
const PROFIT_CENTRES = [
  RETAIL_ALL,
  ...Array.from({ length: 39 }, (_, i) => ({
    row_id: String(1503101000 + i),
    name: `EKL - Line ${String(i + 1).padStart(2, '0')}`,
  })),
].map((pc) => ({ ...pc, plant: '1503', business_unit: 'Enchakkal Retail' }));

const COST_CENTRES = [
  { row_id: '1503100101', name: 'EKL-Operations' },
  { row_id: '1503100103', name: 'EKL-Logistics' },
  { row_id: '1503100104', name: 'EKL-Marketing' },
  { row_id: '1503100105', name: 'EKL-Facility' },
].map((cc) => ({ ...cc, profit_centre: RETAIL_ALL.row_id, category: 'Overheads' }));

const data = (column_name, label, extra = {}) => ({ column_name, column_type: 'Data', label, in_list_view: true, ...extra });
const link = (column_name, label, reference_table) =>
  ({ column_name, column_type: 'Reference', label, reference_table, in_list_view: true });

const DEFS = {
  Region: { name: 'Region', id_pattern: 'hash', title_column: 'name', columns: [data('name', 'Name')] },
  [SITE]: {
    name: SITE, id_pattern: 'hash', title_column: 'name',
    columns: [
      data('name', 'Name'), data('site_code', 'Site code'), link('region', 'Region', 'Region'),
      data('city', 'City'), data('pin_code', 'PIN code'),
      { column_name: 'note', column_type: 'Text', label: 'Note', in_list_view: true },
    ],
  },
  Plant: {
    name: 'Plant', id_pattern: 'prompt', title_column: 'name',
    columns: [data('name', 'Name'), link('site', 'Site', SITE), data('business_line', 'Business line')],
  },
  'Profit Centre': {
    name: 'Profit Centre', id_pattern: 'prompt', title_column: 'name',
    columns: [data('name', 'Name'), link('plant', 'Plant', 'Plant'), data('business_unit', 'Business unit')],
  },
  'Cost Centre': {
    name: 'Cost Centre', id_pattern: 'prompt', title_column: 'name',
    columns: [
      data('name', 'Name'), link('profit_centre', 'Profit Centre', 'Profit Centre'), data('category', 'Category'),
      // Two links to the same table: separate groups on a plant (#910).
      { ...link('supplying_plant', 'Supplying plant', 'Plant'), in_list_view: false },
      { ...link('billing_plant', 'Billing plant', 'Plant'), in_list_view: false },
    ],
  },
};

/** The labels a table's list shows (besides its row id), as seeded. */
function listColumns(table) {
  return DEFS[table].columns.filter((c) => c.in_list_view).map((c) => c.label);
}

async function add(api, table, row) {
  const res = await api.call('POST', `/api/table/${encodeURIComponent(table)}`, row, [201], `add ${row.name} to ${table}`);
  return (await res.json()).row_id;
}

async function dropOrganisation(api) {
  for (const table of TABLES) await api.removeTableIfPresent(table);
}

/**
 * Seeds the organisation masters afresh. Returns the row ids by name:
 * { Region: { Kerala: id }, 'Site Master': { Enchakkal: id }, Plant: {...}, ... }.
 */
async function seedOrganisation(api) {
  await dropOrganisation(api);
  for (const table of [...TABLES].reverse()) await api.createTable(DEFS[table]);
  const ids = { Region: {}, [SITE]: {}, Plant: {}, 'Profit Centre': {}, 'Cost Centre': {} };
  for (const name of ['Kerala', 'Tamil Nadu']) ids.Region[name] = await add(api, 'Region', { name });
  for (const site of SITES) ids[SITE][site.name] = await add(api, SITE, { ...site, region: ids.Region[site.region] });
  for (const plant of PLANTS) ids.Plant[plant.name] = await add(api, 'Plant', { ...plant, site: ids[SITE][plant.site] });
  // Forty profit centres, a few at a time.
  for (let i = 0; i < PROFIT_CENTRES.length; i += 10)
    await Promise.all(PROFIT_CENTRES.slice(i, i + 10).map(async (pc) => {
      ids['Profit Centre'][pc.name] = await add(api, 'Profit Centre', pc);
    }));
  for (const cc of COST_CENTRES) ids['Cost Centre'][cc.name] = await add(api, 'Cost Centre', cc);
  return ids;
}

/** A role per table that may read it: what a non-manager user of the masters holds. */
async function readerRoles(api, tables = TABLES) {
  const roles = [];
  for (const table of tables) roles.push(await api.readerRoleFor(table));
  return roles;
}

/** Limits a person to these rows of a table (a Data Scope per row). */
async function limitRows(api, email, table, rowIds) {
  const filters = encodeURIComponent(JSON.stringify([['email', '=', email]]));
  const res = await api.call('GET', `/api/table/Person?filters=${filters}`, undefined, [200], `find ${email}`);
  const person = (await res.json()).data[0].row_id;
  for (const rowId of rowIds) await api.saveRow('Data Scope', { person, allow_table: table, for_value: rowId });
}

module.exports = {
  add, SITE, seedOrganisation, dropOrganisation, readerRoles, limitRows, listColumns,
  PLANTS, PROFIT_CENTRES, COST_CENTRES,
};
