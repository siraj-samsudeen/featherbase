# Relational navigation — design exploration (2026-07-31)

Interactive companion: open `relational-navigation.html` in a browser. Six
clickable patterns over one hypothetical dataset (Suppliers → Purchase Orders
→ PO Lines → Items; Employees ← Attendance / Payroll / Leave, plus a
`reports_to` self-reference). This is an exploration record, not a spec —
nothing here is committed work.

## Motivating journeys

- Purchase Order → its Lines (child rows)
- Employee → their Attendance & Payroll (backlinks)
- Payroll Slip → its Employee (forward reference hop)

## The six patterns

| # | Pattern | Prior art | Metadata config | Best at |
|---|---------|-----------|-----------------|---------|
| 1 | Connections panel | Frappe | none — fully derived | universal "what relates to this row?" |
| 2 | Smart counters + related tabs | Odoo, Salesforce | opt-in per table | 360° hub records (Employee, Customer) |
| 3 | Peek panel stack | Airtable, Glide | none — reuses FormView | glancing without losing your place |
| 4 | Cross-filter workspace | Tableau, Finder (Miller columns) | pick the pane chain | interrogating a relationship across many rows |
| 5 | Expandable rows in list | MS Access subdatasheets, AG Grid | none for child tables | scanning parents + children in bulk |
| 6 | Relationship map | (nobody ships this well) | none — it *is* the schema | orientation; schema comprehension for builders |

## What the codebase already gives us

- ListView route already accepts `?filters=[["field","=","value"]]`
  (`apps/web/src/router.tsx`, `parseFilters`) — every "open filtered list"
  click in the patterns is just a link.
- The reverse-lookup primitive ("which Reference columns target table X?")
  already exists as SQL in `apps/server/src/document.ts` (used twice: delete
  blocking at ~:787 and rename re-pointing at ~:870). Lift into `meta.ts` and
  cache alongside the meta cache to power a Connections panel.
- Counts can come from the existing `POST /api/dashboard/count`.
- Gap: `LinkControl` in `FormView.tsx` renders references as a plain
  autocomplete with **no way to visit the referenced row** — the single
  biggest missing affordance today.
- Sub-table backlinks need the Frappe "internal links" treatment: Item is
  reached via PO Line, so the Connections entry surfaces the owning
  Purchase Orders (resolve `parent`/`parenttype`), not the line rows.

## Recommended layering (by leverage)

1. **Ship now** — link-out on every Reference control + auto-derived
   Connections panel on FormView (pattern 1). Zero new metadata.
2. **Next** — generic read-only peek slide-over for any (table, id)
   (pattern 3); upgrades every reference link from "navigate away" to
   "glance first". Then opt-in related tabs on hub tables (pattern 2),
   declared in `table_def` rather than code.
3. **Later** — cross-filter "Explore" surface next to Dashboards
   (pattern 4); expandable child rows as a ListView option (pattern 5,
   watch virtualization).
4. **Garnish** — relationship map (pattern 6), best on the builder/All
   Tables side as a walkable schema.

## Sources reviewed

Frappe actions-and-links docs, Airtable community & interface docs, Glide
relations/collections docs, NocoDB links & expanded-record docs, Tableau
filter-actions docs, Oracle APEX / Alta master-detail patterns.
