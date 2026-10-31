'use strict';

// The running example of #738: Section Mapping's ten columns, as a sheet.
// Values are synthetic.

const SECTION_MAPPING_COLUMNS = [
  'Section', 'MCH', 'Floor', 'Zone', 'Rack', 'Owner', 'Category', 'Remarks', 'Updated By', 'Notes',
];

const ROWS = [
  ['Sarees', 'MCH-101', 'Ground', 'A', 'R1', 'Team North', 'Apparel', 'Check stock weekly', 'Admin', 'Seasonal'],
  ['Kids Wear', 'MCH-202', 'First', 'B', 'R2', 'Team South', 'Apparel', 'Near the lift', 'Admin', 'Year round'],
];

/** A one-sheet CSV with these columns, filled from the example rows. */
function sheet(columns, tableName = 'Section Mapping') {
  const rows = ROWS.map((r, n) =>
    columns.map((c) => {
      const i = SECTION_MAPPING_COLUMNS.indexOf(c);
      return i >= 0 ? r[i] : `${c} ${n + 1}`;
    }),
  );
  return { tableName, fileName: `${tableName}.csv`, columns, rows };
}

function toCsv({ columns, rows }) {
  return [columns, ...rows].map((r) => r.join(',')).join('\n') + '\n';
}

// The column names the import would give these labels ("Updated By" steps
// aside from the standard updated_by column).
const COLUMN_NAMES = {
  Section: 'section', MCH: 'mch', Floor: 'floor', Zone: 'zone', Rack: 'rack', Owner: 'owner',
  Category: 'category', Remarks: 'remarks', 'Updated By': 'updated_by_1', Notes: 'notes',
};

const ROW_IDS = ['SM-1', 'SM-2'];

/**
 * Section Mapping as a table definition whose list columns are exactly
 * `listColumns`, with its example rows (row IDs SM-1 and SM-2).
 */
function sectionMappingTable(listColumns, tableName = 'Section Mapping') {
  const unknown = listColumns.filter((c) => !SECTION_MAPPING_COLUMNS.includes(c));
  if (unknown.length) throw new Error(`Section Mapping has no column ${unknown.join(', ')}`);
  const def = {
    name: tableName,
    id_pattern: 'prompt',
    columns: SECTION_MAPPING_COLUMNS.map((label) => ({
      column_name: COLUMN_NAMES[label],
      label,
      column_type: 'Data',
      in_list_view: listColumns.includes(label),
    })),
  };
  const rows = ROWS.map((r, n) => ({
    row_id: ROW_IDS[n],
    ...Object.fromEntries(SECTION_MAPPING_COLUMNS.map((label, i) => [COLUMN_NAMES[label], r[i]])),
  }));
  return { def, rows, rowIds: ROW_IDS };
}

module.exports = { SECTION_MAPPING_COLUMNS, COLUMN_NAMES, ROW_IDS, sheet, toCsv, sectionMappingTable };
