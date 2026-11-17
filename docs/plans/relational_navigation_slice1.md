# Relational navigation, slice 1: links read by what they point to

The issue is not filed yet. Filing it was blocked by a permission check on 17-Nov-2026, so the owner files it when he returns. Parent design: #1218. The full structure is in the explainer, `docs/plans/issue_1218_relational_navigation.html` on branch `issue-1218-jobs-and-roles`.

## Why

Featherbase shows a record's links in several places: the chips under its title, the record panel's "Pointed At By", the Map and the Tree. Today each shows a link-table row by its own code:

- A section's eight job assignments read as a code such as "KL-RR-0000-XYZ-S00000", not as eight people.
- Its 312 "Section Subcategory" rows read as codes, not as subcategories.
- In the record panel, an opened group is drawn as a squeezed table whose rows stretch tall.
- The Map's "Open in Explore" button leads to a page the owner calls unusable.

## The far side of a link row

A row in a group (rows pointing at the current record) is named by its first readable link that is neither:

- the link back to the current record, nor
- a link holding the same value as one of the current record's own links. For example, a Section Subcategory's store is the section's own site, so it is skipped.

If no such link exists, the row keeps its own name.

Examples on a section:

- Job Assignment rows read as employees.
- Section Subcategory rows read as subcategories.

## Checklist (what the verifier checks)

1. In the record panel, an opened "Pointed At By" group lists its rows one per line, each shown by the far side's name as a link. It is never a squeezed table.
2. Under each line, at most two of the row's own facts appear in small text, for example dates and status, and only when they have values.
3. A group shows its first 10 rows, then "Show all N", which opens the existing filtered list.
4. On the record page, the Tree's "Linked from" rows use the same far-side names.
5. On the Map, a group whose rows all point to one far-side Table reads as that Table, for example "Employee 8 · through Job Assignment" or "Subcategory 312 · through Section Subcategory".
6. On the Map, "via <link>" is shown only when the group's Table points at the record by more than one link.
7. The Map's "Open in Explore" button is gone.
8. A far-side row the viewer may not open shows as plain words, never as a link. A link row the viewer may not read is never listed.
9. No machine ids or codes are shown where a name exists.

## Later slices (not in this one)

- On the record page, Tree becomes Links: Edit as ticks, source chips, Why? and Open as grid.
- The Map gets a Why mode.
- The path bar gets a sideways step.
- The filter bar gets "Linked to…" and "Not linked to…".
- Explore is retired.
