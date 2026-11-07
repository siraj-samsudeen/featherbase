# Dash wiring decisions

Siraj's decisions on how Dash reads the core tables, as he makes them. Working notes that can
become the spec; nothing here is built yet.

## Decided

### D1. The Dive's data comes only from the warehouse (06-Nov-2026)

Featherbase sends the Dive only the filters: which store, and which subcategories (or the whole
store). Everything the Dive shows, section names and groupings included, it reads from the
warehouse.

- Dash stops sending the section-to-subcategory mapping. This removes one way for the page to go
  wrong: with too much to send, MotherDuck's 64 KB limit could drop the sections.
- The Dive changes: it reads sections from a warehouse table.

### D2. Featherbase holds the one correct section mapping (06-Nov-2026)

The `Section Subcategory` table in Featherbase is the source. It reaches the warehouse through
bronze, then silver or gold, and replaces today's warehouse mappings.

- `gold.masters.section_merchandise_map` and `gold.hr.section_subcategory_map` are to be retired,
  or at least marked so, once that path exists. Where the new table sits is still to be worked out.

### D3. A new warehouse table, and the merchandise map stays for now (06-Nov-2026)

Featherbase's `Section Subcategory` reaches the warehouse as a new table,
`gold.masters.section_subcategory`, and the Dive reads it. `gold.masters.section_merchandise_map`
is not disturbed. The new table should carry everything the merchandise map has; how each column
gets there is being walked through.

### D4. Featherbase holds the union, and HR corrects it there (06-Nov-2026)

- Section names for people come from StyleHR, which HR cleaned: that is the latest work.
- HR's section mapping workbook stays loaded as it is, even where a row looks wrong. A row that
  looks wrong is flagged in a data quality ticket, for HR to correct in Featherbase.
- A subcategory the workbook leaves out is loaded from other sources, so Featherbase has
  everything; HR can correct it later.
- What can't be decided from the data goes to HR as a question in a data quality ticket.

### D5. What the new table does and doesn't carry (06-Nov-2026)

- Stores come through Store Master, the view on sites. (Later changed: see [Later changes](#later-changes).)
- Say subcategory wherever possible. The warehouse's merchandise levels are division, subdivision,
  category and subcategory.
- LOB and main category exist only for SAP and are never shown to anyone.
- `mapping_source`, `mapping_status` and `section_is_corrected` are dropped: not in the new table,
  not in Featherbase.

### D6. Names in the new table, and how a name gets fixed (06-Nov-2026)

- Store Master is the shared "Stores" view on Site Master (`is_store` ticked). (Later changed: see [Later changes](#later-changes).)
- `store_code` is the short code (ATK). There is no `store_short_code`.
- There is one section name and no separate label, so a section's name must be unique in its store.
- `Subcategory` carries division and subdivision. `main_category` goes.
- When we fix a section name ourselves, a data quality ticket comes first, so the fix has a source.
- Load the subcategories only gold has, and file the data quality tickets for HR.
- Section names, floors and wrong rows are not fixed by us. They go to HR as tickets, and HR fixes
  them on production. (Later changed: see [Later changes](#later-changes).)
- `Section` keeps `site`: the business owner wants sections at every site later, though only stores have them today.

### D7. Section and floor IDs are fully readable (06-Nov-2026)

Floors look like `ATK-GF` and sections like `ATK-GF-Women Tops`, built by the loader so the fresh
install starts with them. `source` keeps the tie to StyleHR. Unclear floor names and sections that
would still get the same ID go to HR in a data quality ticket first.

### D8. A separate table links tickets to rows (06-Nov-2026)

One row can have several data quality issues, fixed by different people, so a single tag on the row
can't hold them. Each ticket and row pair is its own row in `Data Quality Row`: ticket, table, row,
fixed_on, fixed_by. A person marks each pair fixed.

`Section Subcategory.section` becomes optional, so subcategories with no known section load with it
blank and HR fills them in. They reach no Team Leader's report until then.

### D9. Column changes before section data loads (06-Nov-2026)

- `Section`: drop `team_leaders_allowed` and `source_name`. `site` stays, because the business owner wants sections
  at every site later.
- `Section Subcategory`: `placement_id` becomes `section_subcategory_id`, and `site` becomes `store`.
- `Subcategory`: `main_category` becomes `subdivision`, `is_merchandise` becomes `subcategory_type`
  (Merchandise, Consumable, Service). The code stays the ID; the name is what people see.
- `deleted_at_source` stays, correcting what was agreed: Featherbase adds it to every copied table
  and refuses to rename or remove it.
- Agreed data loads as it is finished. Tickets are linked to rows when they are filed.
- Every dataset goes to Siraj as a CSV before it is committed or loaded.

### D10. A code keeps its source system's name (06-Nov-2026)

`material_group_code`, not `subcategory_code`, wherever the column holds that code. `plant_code`
stays for the same reason. The words people read still say subcategory.

`gold.masters.section_subcategory` carries `material_group_code` and `subcategory` only from the
merchandise levels. Category, subdivision and division come from a join to
`gold.masters.merchandise_hierarchy`. The code stays for linking because 53 subcategory names cover
132 codes.

### D11. Table conventions, State and Region (06-Nov-2026)

- A column holding a number or code says so, with the system as a suffix: `sales_org_code_sap`.
- Columns start with the key, then logical groups, most important first.
- `State`: `state` (the key, so links read Kerala) and `gst_code`. `sap_region_code` and `country` go.
- `Region` becomes the `Operating Region` table: `region`, `sales_org_code_sap`, `note`, and links to
  it from other tables are named `operating_region`. The note doesn't fix a brand to it: Kerala is generally
  Ramachandran, but Marthandam is Jeyachandran.

- `Source System` holds real systems only. Budget file and Section map go, with their 42 `Source Link`
  rows; those labels stay in the warehouse's `plant_alias` seed.

- `Source System` names are `AX Retail` and `PetPooja`.
- `City` stays as it is, with 7 rows: `city`, `state`, `district` (filled where relevant). A city is the wider city, so Kattakada
  sits under Thiruvananthapuram and many areas under Chennai.

- No table is called "... Master". `Site Master` is now `Site`: `code`, `name`, `status`, `is_store`,
  `opened_on`, `operating_region`, `cluster`, `state`, `city`, `postal_code`, `source_system`, `note`.

- Each table has a link format: Name (code) by default, Code (name), Name only or Code only. `Cluster`
  is Name only. Being built by the production session.

- A view (Store on Site) is filed as an issue, featherbase#1021. Links point at `Site` until it exists.

- Rent stays off `Building`: `monthly_rent` is on `Rent Contract`. On production `Rent Contract` carries `building` and `premises_part` itself, and there is no `Rent Contract Premises` table (07-Nov-2026). A rent history table may come later.

- A row's origin is two columns: `source_system` (a link) and `source_key` (the record there). No free-text `source` on new tables.
- Floors and sections are Kerala only for now.

- KHO has no floors or sections in Featherbase for now: its "sections" are really departments, and the business owner doesn't want its floors represented. To be revisited with departments.

- PKD is 8 shops: Shops 3 and 7 have Ground, First and Second floors, and the other six have only a Ground Floor.

- Sections load for Kerala when they have a subcategory or staff; otherwise they stay out, and HR cleans up or adds what's missing.
- A section StyleHR also has on another floor loads once, on HR's floor, and its staff move to it. HR's sheet decides the floor.

- The VAM garment factory is out of scope for now. EKL's warehouse sections load. ATK's Women Panties is on the Third Floor only.

- All staff load, Kerala and Tamil Nadu, including leavers, with personal data visible to those signed in. Employee's key is `employee_code`.
- Subcategory wording comes from the warehouse; HR's sheet is matched to it by name, and mismatches go to HR.

- `Subcategory` holds the business's four levels and SAP's four side by side on one row; `Subcategory Correction` isn't loaded. The warehouse still needs to read corrections from here.
- Only what section and subcategory need, plus what the business maintains, loads; the rest stays in the warehouse. POS items share one table, `POS Item Map`.

- The `Decision` table stays out; its 3 useful rules move to the glossary and a decision record. Warehouse settings stay in the warehouse.

- A table's status column is plain `status`, labelled Status, on `Site`, `Building`, `Section`, `Employee`, `Employment`, `Rent Contract` and `Payment Terminal` (07-Nov-2026).

- Tickets show one number, `TICK-0001`. An older DQ number stays only as a line in a ticket's description. Not built yet (07-Nov-2026).
- Featherbase data is fixed directly, not ticketed. A ticket states the affected rows, how to check them and how to fix them.

## Later changes

Decisions above that a later one changed. The earlier text stays as it was decided.

- **Store Master (D5, D6).** No table is called "... Master": `Site Master` is now `Site`, and the stores view is "Store on Site" (featherbase#1021). Links point at `Site` until it exists.
- **Who fixes a row (D4, D6, D8).** On 07-Nov-2026: "Featherbase data is fixed directly, not ticketed. A ticket states the affected rows, how to check them and how to fix them." Whether HR still corrects section names and floors themselves, or the team fixes them from HR's answer, isn't written down. Siraj to confirm.

On production since 06-Nov-2026: `State`, `Operating Region`, `Source System`, `City`, `Cluster`, `Site`, `Address`, `Building`, `Store Floor`, `Section`, `Business Line`, `Legal Company`, `Designation`, `Employee`, `Employment`, `Job Assignment`, `Subcategory`, `Section Subcategory`, `Plant`, `Source Link`, `Payment Terminal`, `Channel`, `Sales Org`, `Purchasing Org`, `Brand`, `Business Line Segment`, `Business Unit`, `Profit Centre`, `Cost Centre`, `Company Event`, `Rent Contract`, `POS Item Map`, `Unit of Measure Alias`, `Brand Family Correction`, `Data Quality Row`.

What the three tables held on 06-Nov-2026:

| Table | Rows | Stores | Fed by | Read by |
|---|---|---|---|---|
| `gold.hr.section_subcategory_map` | 3 | 1 | a hand-kept seed file | nothing but its own test |
| `gold.masters.section_merchandise_map` | 13,849 | 18 | a hand-kept seed file | 5 warehouse models, a report page, tests |
| Featherbase `Section Subcategory` (staging) | 14,450 | 18 | loaded from the section mapping workbook, 29-Oct-2026 | Dash, once wired |
