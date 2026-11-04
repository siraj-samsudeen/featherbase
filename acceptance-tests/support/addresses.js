'use strict';

// Admin page addresses, spelled as the web app spells them (tableSlug,
// tableHref and rowHref in packages/shared/src/app-routes.ts); this suite is
// CommonJS and cannot import that TypeScript.

const tableSlug = (name) => name.toLowerCase().replace(/[-_\s]+/g, ' ').trim().replace(/ /g, '-');
const tableHref = (name) => `/featherbase/admin/table/${encodeURIComponent(tableSlug(name))}`;
const rowHref = (table, rowId) => `${tableHref(table)}/row/${encodeURIComponent(rowId)}`;
const mapHref = (table, rowId) => `${rowHref(table, rowId)}/map`;

module.exports = { tableHref, rowHref, mapHref };
