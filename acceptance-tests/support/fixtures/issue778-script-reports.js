'use strict';

// Real server-executed reports, also reusable for manual browser reproduction.
// Missing and falsy are deliberately different answers: defaults in execute()
// would conceal a browser that forgets to send zero or false.
const stock = [
  { item: 'small zero off', kind: 'small', quantity: 0, enabled: false },
  { item: 'small two off', kind: 'small', quantity: 2, enabled: false },
  { item: 'large zero off', kind: 'large', quantity: 0, enabled: false },
  { item: 'large seven on', kind: 'large', quantity: 7, enabled: true },
];

function report(name, defaults) {
  return {
    name,
    filters: [
      { column_name: 'kind', label: 'Kind', column_type: 'Choice', choices: '\nsmall\nlarge', default: defaults.kind },
      { column_name: 'quantity', label: 'Quantity', column_type: 'Int', default: defaults.quantity },
      { column_name: 'enabled', label: 'Enabled', column_type: 'Check', default: defaults.enabled },
      { column_name: 'note', label: 'Note', column_type: 'Data', default: defaults.note },
      { column_name: 'as_of', label: 'As of', column_type: 'Date', default: defaults.as_of },
      { column_name: 'include_details', label: 'Include details', column_type: 'Check', default: true },
    ],
    async execute(filters) {
      const present = key => Object.hasOwn(filters, key) && filters[key] !== '';
      const matches = stock.filter(row =>
        (!present('kind') || row.kind === filters.kind) &&
        (!present('quantity') || row.quantity === Number(filters.quantity)) &&
        (!present('enabled') || row.enabled === filters.enabled));
      return {
        columns: ['items', 'quantity_received', 'enabled_received', 'note', 'as_of', 'include_details'],
        rows: [{
          items: matches.map(row => row.item).join(', '),
          quantity_received: present('quantity') ? String(filters.quantity) : 'MISSING',
          enabled_received: present('enabled') ? String(filters.enabled) : 'MISSING',
          note: present('note') ? String(filters.note) : 'MISSING',
          as_of: present('as_of') ? String(filters.as_of) : 'MISSING',
          include_details: present('include_details') ? String(filters.include_details) : 'MISSING',
        }],
      };
    },
  };
}

module.exports = {
  stockCheck: report('issue778-stock-check', {
    kind: 'small', quantity: 0, enabled: false, note: 'starting note', as_of: '2026-01-15',
  }),
  stockReview: report('issue778-stock-review', {
    kind: 'large', quantity: 7, enabled: true, note: 'review note', as_of: '2026-02-20',
  }),
};
