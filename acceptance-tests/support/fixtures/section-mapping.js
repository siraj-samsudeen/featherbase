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

module.exports = { SECTION_MAPPING_COLUMNS, sheet, toCsv };
