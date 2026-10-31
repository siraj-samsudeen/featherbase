'use strict';

// A small table none of whose columns is in its list: Shelf, Aisle, Checked
// On and Note. Values are synthetic.

const SHELF_CHECK_COLUMNS = ['Shelf', 'Aisle', 'Checked On', 'Note'];

function shelfCheckTable(tableName = 'Shelf Check') {
  const name = (label) => label.toLowerCase().replace(/ /g, '_');
  const def = {
    name: tableName,
    id_pattern: 'prompt',
    columns: SHELF_CHECK_COLUMNS.map((label) => ({
      column_name: name(label),
      label,
      column_type: 'Data',
      in_list_view: false,
    })),
  };
  const rows = [
    { row_id: 'SC-1', shelf: 'S1', aisle: 'A', checked_on: 'Monday', note: 'Tidy' },
    { row_id: 'SC-2', shelf: 'S2', aisle: 'B', checked_on: 'Tuesday', note: 'Restock' },
  ];
  return { def, rows, rowIds: rows.map((r) => r.row_id) };
}

module.exports = { SHELF_CHECK_COLUMNS, shelfCheckTable };
