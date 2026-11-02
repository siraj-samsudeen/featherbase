'use strict';

// A Table with everything a phone card has to carry: a title column, a
// status, five other listed columns (more than a card's three), one column
// left out of the list, nested rows, and more rows than one page of the list.
// Values are synthetic.

const STOCK_COUNT = 'Stock Count';
const STOCK_COUNT_LINE = 'Stock Count Line';
const STATUSES = ['Open', 'Counted', 'Closed'];
const ROW_COUNT = 25; // one page of the list is 20

// Listed besides the title (Item) and the status.
const OTHER_LISTED = ['Aisle', 'Shelf', 'Counted By', 'Counted On', 'Quantity'];

function stockCountTables() {
  const line = {
    name: STOCK_COUNT_LINE,
    kind: 'sub_table',
    columns: [
      { column_name: 'instruction', label: 'Instruction', column_type: 'Data' },
      { column_name: 'done', label: 'Done', column_type: 'Check' },
    ],
  };
  const def = {
    name: STOCK_COUNT,
    id_pattern: 'prompt',
    title_column: 'item',
    columns: [
      { column_name: 'item', label: 'Item', column_type: 'Data', in_list_view: true },
      { column_name: 'count_status', label: 'Status', column_type: 'Choice', choices: STATUSES.join('\n'), in_list_view: true },
      { column_name: 'aisle', label: 'Aisle', column_type: 'Data', in_list_view: true },
      { column_name: 'shelf', label: 'Shelf', column_type: 'Data', in_list_view: true },
      { column_name: 'counted_by', label: 'Counted By', column_type: 'Data', in_list_view: true },
      { column_name: 'counted_on', label: 'Counted On', column_type: 'Date', in_list_view: true },
      { column_name: 'quantity', label: 'Quantity', column_type: 'Int', in_list_view: true },
      { column_name: 'notes', label: 'Notes', column_type: 'Data' },
      { column_name: 'lines', label: 'Lines', column_type: 'Sub-table', row_table: STOCK_COUNT_LINE },
    ],
  };
  const rows = Array.from({ length: ROW_COUNT }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      row_id: `SC-${n}`,
      item: `Item ${n}`,
      count_status: STATUSES[i % STATUSES.length],
      aisle: `Aisle ${(i % 4) + 1}`,
      shelf: `Shelf ${n}`,
      counted_by: 'Acceptance Counter',
      counted_on: '2026-10-01',
      quantity: i + 1,
      notes: `Note ${n}`,
      lines: [{ instruction: `Count bin ${n}`, done: false }],
    };
  });
  return { line, def, rows };
}

module.exports = { STOCK_COUNT, OTHER_LISTED, ROW_COUNT, stockCountTables };
